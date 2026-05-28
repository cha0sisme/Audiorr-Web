/**
 * user — cliente de los endpoints `/api/user/*` del backend Audiorr.
 *
 * Encapsula:
 *   - getUserPreferences:  preferencias completas (incluye avatar + pinned)
 *   - getPinnedPlaylists:  solo las playlists ancladas (más barato)
 *   - updateAvatar:        PUT del avatar URL
 *   - togglePinPlaylist:   añade/quita una playlist de pinned
 */

import { backendService, BackendError } from './BackendService.svelte';
import {
  PinnedPlaylistsResponseSchema,
  UserPreferencesSchema,
  AdminUsersResponseSchema,
  type PinnedPlaylist,
  type UserPreferences,
  type AdminUser
} from '$types/backend';

export async function getUserPreferences(username: string): Promise<UserPreferences | null> {
  const path = `/api/user/${encodeURIComponent(username)}/preferences`;
  return backendService.get(path, UserPreferencesSchema);
}

/**
 * Lista todos los usuarios del sistema con su último scrobble. Solo admins
 * deben llamar este endpoint (el backend no fuerza guardia, pero solo el
 * panel /housekeeping lo usa).
 */
export async function getAdminUsers(): Promise<AdminUser[]> {
  const data = await backendService.get('/api/user/admin/users', AdminUsersResponseSchema);
  return data ?? [];
}

export async function getPinnedPlaylists(username: string): Promise<PinnedPlaylist[]> {
  const path = `/api/user/${encodeURIComponent(username)}/pinned-playlists`;
  const data = await backendService.get(path, PinnedPlaylistsResponseSchema);
  return data?.pinnedPlaylists ?? [];
}

/**
 * PUT del avatar. `avatarUrl` puede ser null para reset.
 *
 * El backend valida y persiste; devuelve el shape `{ avatarUrl }`.
 */
export async function updateAvatar(
  username: string,
  avatarUrl: string | null
): Promise<{ avatarUrl: string | null }> {
  const path = `/api/user/${encodeURIComponent(username)}/avatar`;
  const res = await backendService.authedFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarUrl })
  });
  if (!res.ok) {
    throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Replace de la lista pinneada completa. El backend valida que cada item
 * tenga al menos id+name. Devuelve el array actualizado.
 */
export async function setPinnedPlaylists(
  username: string,
  pinnedPlaylists: PinnedPlaylist[]
): Promise<PinnedPlaylist[]> {
  const path = `/api/user/${encodeURIComponent(username)}/pinned-playlists`;
  const res = await backendService.authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinnedPlaylists })
  });
  if (!res.ok) {
    throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
  }
  const data = PinnedPlaylistsResponseSchema.parse(await res.json());
  return data.pinnedPlaylists;
}

/** Desancla una playlist específica. */
export async function unpinPlaylist(
  username: string,
  playlistId: string
): Promise<PinnedPlaylist[]> {
  const path = `/api/user/${encodeURIComponent(username)}/pinned-playlists/${encodeURIComponent(playlistId)}`;
  const res = await backendService.authedFetch(path, { method: 'DELETE' });
  if (!res.ok) {
    throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
  }
  const data = PinnedPlaylistsResponseSchema.parse(await res.json());
  return data.pinnedPlaylists;
}
