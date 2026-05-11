/**
 * CanvasService — Canvas (Spotify-style looping video) por canción.
 *
 *   GET /api/canvas/:songId → CanvasEntry | 404
 *   GET /api/canvas/files/:filename → static MP4 (cached 30d)
 *
 * Cache LRU en memoria: `songId → CanvasEntry | null`. Cacheamos también
 * los nulls (canciones sin canvas) para que el cambio repetido a la misma
 * canción no spamee al backend. Tope `CACHE_CAP` para evitar acumulación
 * indefinida. Mismo patrón que LyricsService.
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

const CACHE_CAP = 150;
const cache = new Map<string, CanvasEntry | null>();
const pending = new Map<string, Promise<CanvasEntry | null>>();

export async function fetchCanvas(songId: string): Promise<CanvasEntry | null> {
  if (!browser || !songId) return null;

  // Hit: touch LRU (delete+set) y devolver. Map preserva orden de inserción,
  // por lo que la cabeza queda siempre como la menos recientemente usada.
  if (cache.has(songId)) {
    const value = cache.get(songId) ?? null;
    cache.delete(songId);
    cache.set(songId, value);
    return value;
  }

  // Coalescing: si ya hay un fetch en curso para esta canción (zapping
  // rápido vuelve a llamar antes de que el primero termine), devolvemos el
  // mismo promise — evita doble request.
  const existing = pending.get(songId);
  if (existing) return existing;

  const task = (async () => {
    try {
      return await backendService.get(`/api/canvas/${songId}`, CanvasEntrySchema);
    } catch {
      return null;
    }
  })();
  pending.set(songId, task);
  const result = await task;
  pending.delete(songId);

  cache.set(songId, result);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}

/** Invalida una entrada concreta. Útil tras editar el canvas desde
    housekeeping para que la próxima reproducción de esa canción vea el
    cambio sin esperar al eviction LRU. */
export function invalidateCanvas(songId: string): void {
  cache.delete(songId);
}

/** Vacía el cache. Cambio de servidor / logout. */
export function clearCanvasCache(): void {
  cache.clear();
  pending.clear();
}
