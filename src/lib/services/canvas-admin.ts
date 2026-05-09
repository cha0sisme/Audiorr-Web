/**
 * canvas — flujo individual de asignación de Canvas a una canción.
 *
 * Pasos:
 *   1. El usuario busca la canción en Navidrome (con `nav.search3`).
 *   2. Pega la URL de un track Spotify; extraemos el trackId con
 *      `extractSpotifyTrackId`.
 *   3. Llamamos `fetchSpotifyCanvas(trackId)` → devuelve el .mp4 URL si
 *      el track tiene Canvas.
 *   4. Confirmamos con `saveCanvasEntry` para persistirlo en cache (de ahí
 *      en adelante NowPlaying lo usa via `getCanvasBySongId`).
 *
 * No incluye bulk worker (decisión del director: solo modo individual).
 */

import { backendService } from './BackendService.svelte';
import {
  CanvasEntrySchema,
  SpotifyCanvasResponseSchema,
  type CanvasEntry,
  type SpotifyCanvasResponse
} from '$types/backend';

/** Acepta una URL completa de Spotify track o el ID puro. Devuelve solo
    el ID. Formatos soportados:
      https://open.spotify.com/track/<id>
      https://open.spotify.com/track/<id>?si=...
      spotify:track:<id>
      <id> (puro). */
export function extractSpotifyTrackId(input: string): string {
  const trimmed = input.trim();
  // URL https
  const httpMatch = trimmed.match(/track\/([a-zA-Z0-9]{22,})/);
  if (httpMatch?.[1]) return httpMatch[1];
  // URI spotify:track:
  const uriMatch = trimmed.match(/^spotify:track:([a-zA-Z0-9]{22,})$/);
  if (uriMatch?.[1]) return uriMatch[1];
  // ID puro
  if (/^[a-zA-Z0-9]{22,}$/.test(trimmed)) return trimmed;
  return '';
}

/** Llama al backend para resolver el Canvas de un track Spotify. Devuelve
    el primer (y normalmente único) Canvas si existe, null si el track no
    tiene Canvas asociado. */
export async function fetchSpotifyCanvas(trackId: string): Promise<string | null> {
  if (!trackId) throw new Error('trackId vacío');
  const data: SpotifyCanvasResponse | null = await backendService.get(
    `/api/spotify/canvas?trackId=${encodeURIComponent(trackId)}`,
    SpotifyCanvasResponseSchema
  );
  if (!data || data.canvasesList.length === 0) return null;
  return data.canvasesList[0]!.canvasUrl;
}

/** Persiste la asociación (Navidrome songId ↔ Spotify trackId + canvasUrl)
    en el backend cache. NowPlaying la lee con `getCanvasBySongId`. */
export async function saveCanvasEntry(input: {
  songId: string;
  title: string;
  artist: string;
  album?: string | undefined;
  spotifyTrackId: string;
  canvasUrl: string;
}): Promise<CanvasEntry> {
  return backendService.post('/api/canvas', input, CanvasEntrySchema);
}

/** Lee la entry actual del cache (para mostrar al usuario si esa canción
    ya tiene Canvas asignado). 404 → null. */
export async function getCanvasBySongId(songId: string): Promise<CanvasEntry | null> {
  return backendService.get(
    `/api/canvas/${encodeURIComponent(songId)}`,
    CanvasEntrySchema
  );
}
