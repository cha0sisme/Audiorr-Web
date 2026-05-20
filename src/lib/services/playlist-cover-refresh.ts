/**
 * playlist-cover-refresh — orquestador de refresco de `coverContentHash` para
 * todas las playlists, mirror de `NavidromeService.refreshPlaylistCoverHashes`
 * en iOS (`Audiorr-Frontend/ios/App/App/Services/NavidromeService.swift:933`).
 *
 * Dos capas:
 *
 *   1. **Bulk JSON** — invalida las queries `dailyMixes` y `smartPlaylists` de
 *      TanStack Query para que se refetcheen. Los handlers de esos endpoints
 *      llaman a `playlistCovers.setMany(...)` como side effect.
 *
 *   2. **HEAD/ETag** — para playlists no listadas en bulk (editorial, Spotify
 *      Synced, "This Is …", playlists de usuario), `revalidateCoverEtags` hace
 *      `HEAD /api/playlists/{id}/cover.png` con concurrency 8 y TTL 60 s por
 *      playlist. Lee `ETag` (o `Last-Modified` como fallback), lo URL-encodea
 *      y lo registra en `playlistCovers` para que el próximo render de la URL
 *      lleve `?v=<etag>` y el browser haga GET nuevo cuando cambie.
 *
 * El TTL + un inflight Set evitan doble-HEAD entre triggers concurrentes
 * (visibilitychange + onMount disparándose en la misma ventana de ms).
 *
 * Igual que iOS, fallos individuales no propagan: el resto sigue. Una playlist
 * que devuelve 404 (no hay cover backend) se marca como "checked" igualmente
 * para no martillearla.
 */

import * as nav from './NavidromeService';
import { backendService } from './BackendService.svelte';
import { playlistCovers } from '$stores/playlist-covers.svelte';
import type { QueryClient } from '@tanstack/svelte-query';

const ETAG_TTL_MS = 60_000;
const MAX_CONCURRENT = 8;
const HEAD_TIMEOUT_MS = 10_000;

/** Última HEAD por playlist id → timestamp. Sirve de TTL para no rehacer la
    misma comprobación dentro de 60 s. */
const lastChecked = new Map<string, number>();

/** Playlists con HEAD en vuelo. Si un segundo trigger llega antes de que el
    primero registre, lo descartamos para no duplicar GET de red. */
const inflight = new Set<string>();

/** Mutex global para `refreshPlaylistCoverHashes`: dos triggers (visibility
    + onMount) firing en la misma ventana de ms — el segundo es no-op. */
let refreshInFlight: Promise<void> | null = null;

type EtagResult =
  | { kind: 'ok'; etag: string }
  | { kind: 'noCover' }
  | { kind: 'failed' };

/**
 * Refresca hashes de TODAS las playlists.
 *
 * 1. Invalida queries TQ `dailyMixes` y `smartPlaylists` → refetch hidrata el
 *    store vía side effect.
 * 2. Lista todas las playlists Navidrome; para las que no estén ya en el
 *    store (Layer 1 las cubrió), corre `revalidateCoverEtags`.
 *
 * Idempotente: si ya hay un refresh en curso, devuelve la misma promise. Esto
 * cubre el caso típico de un `visibilitychange→visible` que dispara mientras
 * un onMount del componente recién hidratado ya está corriendo el suyo.
 */
export function refreshPlaylistCoverHashes(
  queryClient: QueryClient,
  username: string | undefined
): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh(queryClient, username).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(
  queryClient: QueryClient,
  username: string | undefined
): Promise<void> {
  // Layer 1: refetch bulk endpoints SIN depender de observers montados.
  // `refetchQueries` fuerza el fetch aunque la pestaña esté en otra ruta
  // (ej. /playlist/[id] cuando el backend regeneró daily-mixes). Antes
  // usábamos `invalidateQueries` que solo marca stale → si no había
  // observers, el store de hashes quedaba congelado con valores viejos y
  // la URL `?v=<oldHash>` mantenía el cover stale cacheado immutable.
  if (username) {
    await Promise.allSettled([
      queryClient.refetchQueries({ queryKey: ['dailyMixes', username] }),
      queryClient.refetchQueries({ queryKey: ['smartPlaylists', username] })
    ]);
  }

  // Layer 2: HEAD/ETag a TODAS las playlists, sin filtrar por hash existente.
  // El filtro previo (`!playlistCovers.get(id)`) era el bug raíz: descartaba
  // playlists con hash registrado, asumiendo "tiene hash = está fresh". Pero
  // el hash puede estar stale tras una regeneración del backend, y sin HEAD
  // no nos enteramos. El TTL de 60 s en `lastChecked` ya throttlea spam, así
  // que es seguro pasar la lista completa.
  let allPlaylists;
  try {
    allPlaylists = await nav.getPlaylists();
  } catch {
    return;
  }

  const ids = allPlaylists.map((p) => p.id);
  if (ids.length === 0) return;

  await revalidateCoverEtags(ids);
}

/**
 * HEAD a /api/playlists/{id}/cover.png para una lista de playlists.
 * Concurrency limitada, TTL 60 s por id, inflight set anti-doble-HEAD.
 *
 * Espejo de `NavidromeService.swift:1002 revalidateCoverETags`.
 */
async function revalidateCoverEtags(playlistIds: string[]): Promise<void> {
  // Filtro en dos etapas, atómico contra callers concurrentes:
  //   1. TTL — checked recientemente, no por nosotros.
  //   2. inflight — siendo HEADeada por otra invocación. Insertamos aquí para
  //      que un caller que llegue microsegundos después nos vea on it.
  const now = Date.now();
  const needsCheck: string[] = [];
  for (const id of playlistIds) {
    const ts = lastChecked.get(id);
    if (ts !== undefined && now - ts < ETAG_TTL_MS) continue;
    if (inflight.has(id)) continue;
    inflight.add(id);
    needsCheck.push(id);
  }

  if (needsCheck.length === 0) return;

  const newHashes: Array<{ id: string; hash: string }> = [];

  try {
    // Worker pool con concurrency cap. iOS usa withTaskGroup; aquí workers
    // que toman del iterador hasta agotarlo.
    let cursor = 0;
    const worker = async () => {
      while (cursor < needsCheck.length) {
        const id = needsCheck[cursor++];
        if (!id) break;
        const result = await fetchCoverEtag(id);
        // Marcar como checked independientemente del resultado — el TTL
        // throttlea retries por igual, así un backend transitoriamente 5xx
        // no se machaca.
        lastChecked.set(id, Date.now());
        if (result.kind === 'ok') {
          newHashes.push({ id, hash: result.etag });
        }
      }
    };
    const pool = Array.from({ length: Math.min(MAX_CONCURRENT, needsCheck.length) }, worker);
    await Promise.all(pool);
  } finally {
    // Liberar inflight siempre, también si algo lanzó.
    for (const id of needsCheck) inflight.delete(id);
  }

  if (newHashes.length > 0) {
    playlistCovers.setMany(newHashes);
  }
}

/**
 * HEAD a una sola playlist. Lee `ETag` o `Last-Modified`, los URL-encodea y
 * devuelve la string lista para usar como `?v=`.
 *
 * Comportamiento idéntico a `fetchCoverETag` en iOS
 * (`NavidromeService.swift:1091`): prefer ETag, fallback Last-Modified;
 * descartar 200 sin validators (treat as failed para reintentar en lugar de
 * registrar hash vacío que congelaría el cover actual).
 */
async function fetchCoverEtag(playlistId: string): Promise<EtagResult> {
  const url = backendService.fileUrl(
    `/api/playlists/${encodeURIComponent(playlistId)}/cover.png`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'HEAD',
      credentials: 'omit',
      signal: controller.signal
    });
  } catch {
    return { kind: 'failed' };
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 404) return { kind: 'noCover' };
  if (res.status !== 200) return { kind: 'failed' };

  // Backend devuelve ETag como `"<hash>-v<N>"` (ver
  // backend/src/routes/playlist.routes.ts:162). Para playlists sin cover
  // generada aún, devuelve `"cached-v<N>"` (línea 163) — esto NO es un hash
  // de contenido, así que lo descartamos para no fijar un valor que no
  // representa el cover real.
  const etagHeader = res.headers.get('ETag');
  if (etagHeader && etagHeader.length > 0) {
    const cleaned = etagHeader.replace(/^"(.*)"$/, '$1');
    if (cleaned.length > 0 && !cleaned.startsWith('cached-v')) {
      return { kind: 'ok', etag: encodeURIComponent(cleaned) };
    }
  }
  const lastMod = res.headers.get('Last-Modified');
  if (lastMod && lastMod.length > 0) {
    return { kind: 'ok', etag: encodeURIComponent(lastMod) };
  }
  // 200 pero sin validators — server no ayuda. Tratamos como failed para
  // reintentar tras TTL en lugar de registrar hash vacío.
  return { kind: 'failed' };
}
