/**
 * AlbumArtworkService — Animated artwork (Apple Music motion artwork) por álbum.
 *
 *   GET  /api/album-artwork/:albumId            → AlbumArtworkEntry | 404
 *   GET  /api/album-artwork/files/album_<id>.mp4 → static MP4 (H.264 1:1)
 *   POST /api/album-artwork/fetch               → 202 ArtworkFetchEnqueued (ADMIN)
 *   GET  /api/album-artwork/jobs/:id            → ArtworkJob (ADMIN)
 *
 * 404 es el estado normal cuando el álbum no tiene entrada aún. No es un error
 * ruidoso: significa "sin animated artwork (todavía)" → el caller usa el cover
 * estático como fallback.
 *
 * La URL absoluta del .mp4 se construye con `backendService.fileUrl(entry.fileUrl)`
 * de la misma manera que lo hace CanvasService para los canvas de canciones.
 */

import { backendService } from '$services/BackendService.svelte';
import {
  AlbumArtworkEntrySchema,
  AlbumArtworkListResponseSchema,
  AlbumArtworkDeleteResponseSchema,
  AlbumArtworkSearchResponseSchema,
  ArtworkFetchEnqueuedSchema,
  ArtworkJobSchema,
  type AlbumArtworkEntry,
  type AlbumArtworkDeleteResponse,
  type AlbumArtworkSearchResponse,
  type AppleSearchCandidate,
  type ArtworkFetchEnqueued,
  type ArtworkJob
} from '$types/backend';

export type {
  AlbumArtworkEntry,
  AlbumArtworkDeleteResponse,
  AlbumArtworkSearchResponse,
  AppleSearchCandidate,
  ArtworkFetchEnqueued,
  ArtworkJob
};

/**
 * Fetches the animated artwork entry for the given Navidrome album id.
 * Returns `null` when the album has no entry (404) or the endpoint is not
 * yet deployed (network error treated as "no artwork").
 */
export async function fetchAlbumArtwork(albumId: string): Promise<AlbumArtworkEntry | null> {
  if (!albumId) return null;
  try {
    return await backendService.get(`/api/album-artwork/${albumId}`, AlbumArtworkEntrySchema);
  } catch {
    // Network error or backend not yet deployed → fall back to static cover.
    return null;
  }
}

/**
 * Resolves the absolute URL of the .mp4 file from an AlbumArtworkEntry.
 * `entry.fileUrl` arrives as a relative path like `/api/album-artwork/files/album_<id>.mp4`.
 * We prefix it with `backendService.baseUrl` (same as CanvasService.resolveCanvasVideoUrl).
 *
 * Returns `null` when there is no video (fileUrl is null or entry is null).
 */
export function resolveArtworkVideoUrl(entry: AlbumArtworkEntry | null): string | null {
  if (!entry?.fileUrl) return null;
  return backendService.fileUrl(entry.fileUrl);
}

/**
 * Dispara la descarga de animated artwork para un álbum (ADMIN, requiere Bearer).
 * POST /api/album-artwork/fetch.
 *
 * Dos modos:
 *   - Auto-match: body { albumId, artist, title } → el backend busca y elige.
 *   - Manual: body { albumId, collectionId, origin: 'manual', ... } → el backend
 *     descarga directamente ese collectionId de Apple/iTunes, sin auto-match.
 *     Es el camino del modal de confirmación (el admin elige el candidato).
 *
 * Devuelve el jobId para hacer poll con `pollArtworkJob`.
 *
 * 409 = ya existe artwork sin `force`, o hay un job activo — propaga BackendError
 * para que el caller lo maneje.
 */
export async function triggerArtworkFetch(params: {
  albumId: string;
  artist?: string;
  title?: string;
  /** Collection id de Apple/iTunes elegido a mano → salta el auto-match. */
  collectionId?: string | number;
  country?: string;
  origin?: 'manual';
  /** Sobrescribe el artwork existente si ya hay uno (evita el 409). */
  force?: boolean;
}): Promise<ArtworkFetchEnqueued> {
  return backendService.post(
    '/api/album-artwork/fetch',
    params,
    ArtworkFetchEnqueuedSchema
  );
}

/**
 * Lista los artworks descargados para la vista de gestión en Housekeeping
 * (ADMIN). Ordenados por `cachedAt` desc por el backend.
 *
 * @param onlyWithArtwork  solo entries con vídeo real (matchStatus auto/manual).
 * @param limit            tope de filas (backend cap 500, default 200).
 */
export async function listArtworks(opts?: {
  onlyWithArtwork?: boolean;
  limit?: number;
}): Promise<AlbumArtworkEntry[]> {
  const qs = new URLSearchParams();
  if (opts?.onlyWithArtwork) qs.set('onlyWithArtwork', 'true');
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  const res = await backendService.get(
    `/api/album-artwork${q ? `?${q}` : ''}`,
    AlbumArtworkListResponseSchema
  );
  return res?.entries ?? [];
}

/**
 * Elimina un artwork: borra la fila de la DB y los archivos .mp4 (square +
 * tall) del álbum (ADMIN). Idempotente — un álbum sin entrada devuelve 404
 * (BackendError) que el caller decide cómo tratar.
 */
export async function deleteArtwork(albumId: string): Promise<AlbumArtworkDeleteResponse> {
  return backendService.delete(
    `/api/album-artwork/${albumId}`,
    AlbumArtworkDeleteResponseSchema
  );
}

/**
 * Busca candidatos de Apple/iTunes para (artist, title) SIN descargar ni
 * transcodificar nada (ADMIN). Alimenta el modal de confirmación: el admin ve
 * los candidatos (carátula, nombre, artista, hasMotion) y elige el correcto.
 * `null` si el endpoint no está disponible (404 / backend sin redeploy).
 */
export async function searchArtworkCandidates(params: {
  artist: string;
  title: string;
  country?: string;
}): Promise<AlbumArtworkSearchResponse | null> {
  const qs = new URLSearchParams({ artist: params.artist, title: params.title });
  if (params.country) qs.set('country', params.country);
  return backendService.get(
    `/api/album-artwork/search?${qs.toString()}`,
    AlbumArtworkSearchResponseSchema
  );
}

/**
 * Consulta el estado de un job de descarga de animated artwork (ADMIN, requiere Bearer).
 * GET /api/album-artwork/jobs/:id
 * Devuelve el estado actual del job. El caller hace polling hasta `done` o `failed`.
 */
export async function pollArtworkJob(jobId: string): Promise<ArtworkJob | null> {
  return backendService.get(`/api/album-artwork/jobs/${jobId}`, ArtworkJobSchema);
}
