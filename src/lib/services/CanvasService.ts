/**
 * CanvasService — Canvas (Spotify-style looping video) por canción.
 *
 *   GET /api/canvas/:songId → CanvasEntry | 404
 *   GET /api/canvas/files/:filename → static MP4 (cached 30d)
 */

import { browser } from '$app/environment';
import { backendService } from '$services/BackendService.svelte';
import { CanvasEntrySchema, type CanvasEntry } from '$types/backend';

export type { CanvasEntry };

/** Devuelve la URL del archivo de video (o null). Prefiere localPath.
    El backend guarda `localPath` como "/canvas-files/<file>" pero los sirve
    en "/api/canvas/files/<file>" — reescribimos el prefijo. */
export function resolveCanvasVideoUrl(entry: CanvasEntry | null): string | null {
  if (!entry) return null;
  if (entry.localPath) {
    const apiPath = entry.localPath.replace(/^\/canvas-files\//, '/api/canvas/files/');
    return backendService.fileUrl(apiPath);
  }
  return entry.canvasUrl ?? null;
}

export async function fetchCanvas(songId: string): Promise<CanvasEntry | null> {
  if (!browser || !songId) return null;
  try {
    return await backendService.get(`/api/canvas/${songId}`, CanvasEntrySchema);
  } catch {
    return null;
  }
}
