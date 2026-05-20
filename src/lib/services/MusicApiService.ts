/**
 * MusicApiService — cliente del servicio auxiliar Music-API.
 *
 * Música API es un microservicio admin (NO es el Audiorr Backend principal)
 * que permite mutar la DB de Navidrome directamente: actualizar play_count
 * y editar smart tags (mood, genre, language).
 *
 * Base URL:
 *   - dev: `PUBLIC_MUSIC_API_URL` (build-time .env) o fallback hardcoded.
 *   - prod: `window.__AUDIORR_MUSIC_API_URL__` (runtime Docker env.js)
 *           o `PUBLIC_MUSIC_API_URL` (build-time .env).
 *   - fallback: http://192.168.1.43:8014 (admin LAN).
 *
 * Port del legacy `src/services/musicApiService.ts` del frontend
 * Audiorr-backend.
 */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

const FALLBACK_BASE = 'http://192.168.1.43:8014';

declare global {
  interface Window {
    __AUDIORR_MUSIC_API_URL__?: string;
  }
}

function resolveBaseUrl(): string {
  if (browser && window.__AUDIORR_MUSIC_API_URL__) {
    return window.__AUDIORR_MUSIC_API_URL__.replace(/\/+$/, '');
  }
  const fromEnv = env.PUBLIC_MUSIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return FALLBACK_BASE;
}

function BASE(): string {
  return resolveBaseUrl();
}

export type SmartTagField = 'mood' | 'genre' | 'language';

export interface MusicApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SongData {
  success: boolean;
  play_count?: number;
  tags?: { mood: string; genre: string; language: string };
  error?: string;
}

/**
 * Actualiza el play count de una canción.
 * Endpoint: POST /api/update_play_count
 */
export async function updatePlayCount(
  songId: string,
  playCount: number
): Promise<MusicApiResponse> {
  try {
    const response = await fetch(`${BASE()}/api/update_play_count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: songId, play_count: playCount })
    });
    return (await response.json()) as MusicApiResponse;
  } catch (err) {
    console.error('[MusicApiService] updatePlayCount falló:', err);
    return { success: false, error: 'Error de red al conectar con Music-API.' };
  }
}

/**
 * Actualiza un tag (mood, genre, language) de una canción.
 * Endpoint: POST /api/update_tag
 */
export async function updateTag(
  songId: string,
  tag: SmartTagField,
  value: string
): Promise<MusicApiResponse> {
  try {
    const response = await fetch(`${BASE()}/api/update_tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: songId, tag, value })
    });
    return (await response.json()) as MusicApiResponse;
  } catch (err) {
    console.error('[MusicApiService] updateTag falló:', err);
    return { success: false, error: 'Error de red al conectar con Music-API.' };
  }
}

/**
 * Obtiene play_count actual y tags (mood, genre, language) de una canción.
 * Endpoint: GET /api/song_tags/<song_id>
 */
export async function getSongData(songId: string): Promise<SongData> {
  try {
    const response = await fetch(
      `${BASE()}/api/song_tags/${encodeURIComponent(songId)}`
    );
    return (await response.json()) as SongData;
  } catch (err) {
    console.error('[MusicApiService] getSongData falló:', err);
    return { success: false, error: 'Error de red al conectar con Music-API.' };
  }
}
