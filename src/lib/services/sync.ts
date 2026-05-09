/**
 * sync — cliente de `/api/sync/*` (Spotify Sync).
 *
 * Endpoints expuestos:
 *   - listSyncs()                  → playlists configuradas.
 *   - previewSync(spotifyId)       → % de matches sin guardar.
 *   - startSync(spotifyId, name?)  → guarda + sincroniza por primera vez.
 *   - forceSync(spotifyId)         → re-sincroniza una existente.
 *   - removeSync(spotifyId)        → elimina la sincronización.
 *
 * El backend acepta tanto el id de Spotify (`37i9dQZF1...`) como una URL
 * completa. Para parsear URLs en cliente y enviar solo el id, ver
 * `extractSpotifyId` en este mismo módulo.
 */

import { backendService } from './BackendService.svelte';
import {
  SyncedPlaylistSchema,
  SyncedPlaylistsArraySchema,
  SyncPreviewSchema,
  StatusOkSchema,
  type SyncedPlaylist,
  type SyncPreview
} from '$types/backend';

/** Acepta link de Spotify o id puro. Devuelve solo el id. */
export function extractSpotifyId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/playlist\/([a-zA-Z0-9]+)/);
  return match?.[1] ?? trimmed;
}

export async function listSyncs(): Promise<SyncedPlaylist[]> {
  const data = await backendService.get('/api/sync/list', SyncedPlaylistsArraySchema);
  return data ?? [];
}

export async function previewSync(spotifyId: string): Promise<SyncPreview> {
  const id = extractSpotifyId(spotifyId);
  const data = await backendService.get(
    `/api/sync/preview/${encodeURIComponent(id)}`,
    SyncPreviewSchema
  );
  if (!data) throw new Error('Preview vacío del backend');
  return data;
}

export async function startSync(spotifyId: string, name?: string): Promise<SyncedPlaylist> {
  const id = extractSpotifyId(spotifyId);
  return backendService.post(
    '/api/sync/start',
    { spotifyId: id, ...(name ? { name } : {}) },
    SyncedPlaylistSchema
  );
}

export async function forceSync(spotifyId: string): Promise<SyncedPlaylist> {
  const id = extractSpotifyId(spotifyId);
  return backendService.post(
    `/api/sync/sync/${encodeURIComponent(id)}`,
    undefined,
    SyncedPlaylistSchema
  );
}

export async function removeSync(spotifyId: string): Promise<void> {
  const id = extractSpotifyId(spotifyId);
  await backendService.delete(`/api/sync/${encodeURIComponent(id)}`, StatusOkSchema);
}
