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
  PatchSmartPlaylistResponseSchema,
  type SmartPlaylist,
  type SmartPlaylistsCronStatus,
  type GenerateAllSmartPlaylistsResponse,
  type PatchSmartPlaylistResponse,
  type SmartPlaylistCoverVariant
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

/**
 * Cambia la variant de cover de una SmartPlaylist para TODOS los usuarios
 * (allUsers: true → requerido por el panel de covers del Housekeeping).
 *
 * @param key - clave interna de la playlist (ej. `en_bucle`).
 * @param coverVariant - una de las variants válidas (aurora, prism, ripple…).
 */
export async function patchSmartPlaylistVariant(
  key: string,
  coverVariant: SmartPlaylistCoverVariant
): Promise<PatchSmartPlaylistResponse> {
  return backendService.patch(
    `/api/smart-playlists/${encodeURIComponent(key)}`,
    { coverVariant, allUsers: true },
    PatchSmartPlaylistResponseSchema
  );
}

/**
 * Devuelve la URL del preview de una cover 2026 vía el endpoint
 * `GET /api/playlists/cover-preview.png`.
 *
 * El render es determinista por (variant, name) — la URL es estable y puede
 * cachearse en el browser (Cache-Control: public, max-age=300 en el backend).
 *
 * @param name    - nombre REAL de la playlist tal como lo devuelve el listado.
 * @param variant - aurora | prism | ripple.
 * @param size    - px del lado (defecto 400 para grids).
 */
export function getCoverPreviewUrl(
  name: string,
  variant: string,
  size: number = 400
): string {
  const params = new URLSearchParams({ name, variant, size: String(size) });
  return backendService.fileUrl(`/api/playlists/cover-preview.png?${params.toString()}`);
}
