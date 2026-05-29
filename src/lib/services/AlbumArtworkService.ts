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
  ArtworkFetchEnqueuedSchema,
  ArtworkJobSchema,
  type AlbumArtworkEntry,
  type ArtworkFetchEnqueued,
  type ArtworkJob
} from '$types/backend';

export type { AlbumArtworkEntry, ArtworkFetchEnqueued, ArtworkJob };

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
 * POST /api/album-artwork/fetch — body { albumId, artist, title }.
 * Devuelve el jobId para hacer poll con `pollArtworkJob`.
 *
 * 409 = ya existe artwork sin `force`, o hay un job activo — propaga BackendError
 * para que el caller lo maneje.
 */
export async function triggerArtworkFetch(params: {
  albumId: string;
  artist: string;
  title: string;
}): Promise<ArtworkFetchEnqueued> {
  return backendService.post(
    '/api/album-artwork/fetch',
    params,
    ArtworkFetchEnqueuedSchema
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
