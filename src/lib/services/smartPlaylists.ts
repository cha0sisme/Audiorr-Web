/**
 * smartPlaylists — cliente del endpoint `/api/smart-playlists` del backend.
 *
 * Smart playlists son playlists curadas por Audiorr basadas en el listening
 * history del usuario. Cron semanal/diario las regenera. Keys conocidas:
 * - `en_bucle`        — daily, canciones que el usuario repite mucho.
 * - `tiempo_atras`    — semanal (domingo), throwbacks por anchorWeeks.
 * - `radar_novedades` — semanal (viernes), nuevas canciones de artistas
 *                        que el usuario sigue.
 */

import { backendService } from './BackendService.svelte';
import {
  SmartPlaylistsResponseSchema,
  SmartPlaylistsCronStatusSchema,
  GenerateAllSmartPlaylistsResponseSchema,
  type SmartPlaylist,
  type SmartPlaylistsCronStatus,
  type GenerateAllSmartPlaylistsResponse
} from '$types/backend';
import { playlistCovers } from '$stores/playlist-covers.svelte';

/**
 * Lista de smart playlists. Side effect: registra `coverContentHash` en el
 * store global `playlistCovers` (igual que getDailyMixes).
 */
export async function getSmartPlaylists(username: string): Promise<SmartPlaylist[]> {
  const data = await backendService.get('/api/smart-playlists', SmartPlaylistsResponseSchema, {
    'x-navidrome-user': username
  });
  const playlists = data?.playlists ?? [];
  playlistCovers.setMany(
    playlists.map((p) => ({ id: p.navidromeId, hash: p.coverContentHash }))
  );
  return playlists;
}

/**
 * Estado de los crons que regeneran cada smart playlist (en_bucle daily,
 * tiempo_atras y radar_novedades weekly). Devuelve {} si el server aún no
 * ha completado la primera ejecución.
 */
export async function getSmartPlaylistsCronStatus(): Promise<SmartPlaylistsCronStatus> {
  const data = await backendService.get(
    '/api/smart-playlists/cron-status',
    SmartPlaylistsCronStatusSchema
  );
  return data ?? {};
}

/**
 * Dispara la regeneración de TODAS las smart playlists para todos los users.
 * El backend tiene cooldown 30s server-side; un 429 indica "espera" y el
 * BackendError preserva el status para que el caller muestre el cooldown.
 */
export async function generateAllSmartPlaylists(): Promise<GenerateAllSmartPlaylistsResponse> {
  return backendService.post(
    '/api/smart-playlists/generate-all',
    undefined,
    GenerateAllSmartPlaylistsResponseSchema
  );
}
