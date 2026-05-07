/**
 * dailyMixes — cliente del endpoint `/api/daily-mixes` del backend Audiorr.
 *
 * Los daily mixes los genera un cron del backend a las 03:00 (4 mixes
 * personalizados por usuario). Se materializan como playlists en Navidrome
 * (campo `navidromeId`) — el cliente puede navegar a `/playlist/<navidromeId>`.
 *
 * Cuando `navidromeId` es null, el mix existe en wrapped.db pero aún no se
 * sincronizó (transitorio). El cliente puede mostrar la card pero deshabilitar
 * la navegación.
 */

import { backendService } from './BackendService.svelte';
import { DailyMixesResponseSchema, type DailyMix } from '$types/backend';
import { playlistCovers } from '$stores/playlist-covers.svelte';

/**
 * Lista de daily mixes para el usuario dado. Devuelve [] si el cron aún no
 * los generó (instalación nueva o usuario sin scrobbles suficientes).
 *
 * Side effect: registra `coverContentHash` de cada mix en el store global
 * `playlistCovers` para que `getPlaylistCoverUrl` pueda servir URLs con
 * `?v=<hash>` (cache HTTP `immutable` 1 año).
 */
export async function getDailyMixes(username: string): Promise<DailyMix[]> {
  const data = await backendService.get('/api/daily-mixes', DailyMixesResponseSchema, {
    'x-navidrome-user': username
  });
  const mixes = data?.mixes ?? [];
  playlistCovers.setMany(mixes.map((m) => ({ id: m.navidromeId, hash: m.coverContentHash })));
  return mixes;
}

/**
 * URL del cover personalizado del backend para una playlist.
 *
 * SIEMPRE se sirve desde el backend (nunca Navidrome directo) — incluso
 * para playlists creadas por el usuario, el backend las re-renderiza con
 * estilo Audiorr. El backend cachea agresivamente (30 min TTL, hasta 1 año
 * con cache buster `?v=<hash>`) y regenera por cron cuando cambian.
 *
 * Si tenemos `coverContentHash` registrado en el store global, lo usamos
 * como `?v=<hash>` → respuesta `immutable` 1 año, cero revalidaciones.
 * Si no, URL sin buster → 30 min TTL del backend, suficiente.
 */
export function getPlaylistCoverUrl(navidromeId: string): string {
  const base = backendService.fileUrl(`/api/playlists/${encodeURIComponent(navidromeId)}/cover.png`);
  const hash = playlistCovers.get(navidromeId);
  return hash ? `${base}?v=${encodeURIComponent(hash)}` : base;
}
