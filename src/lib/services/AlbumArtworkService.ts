/**
 * AlbumArtworkService — Animated artwork (Apple Music motion artwork) por álbum.
 *
 *   GET /api/album-artwork/:albumId → AlbumArtworkEntry | 404
 *   GET /api/album-artwork/files/album_<albumId>.mp4 → static MP4 (H.264 1:1)
 *
 * 404 es el estado normal cuando el álbum no tiene entrada aún. No es un error
 * ruidoso: significa "sin animated artwork (todavía)" → el caller usa el cover
 * estático como fallback.
 *
 * La URL absoluta del .mp4 se construye con `backendService.fileUrl(entry.fileUrl)`
 * de la misma manera que lo hace CanvasService para los canvas de canciones.
 */

import { backendService } from '$services/BackendService.svelte';
import { AlbumArtworkEntrySchema, type AlbumArtworkEntry } from '$types/backend';

export type { AlbumArtworkEntry };

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
