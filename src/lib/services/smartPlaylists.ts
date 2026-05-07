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
import { SmartPlaylistsResponseSchema, type SmartPlaylist } from '$types/backend';
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
