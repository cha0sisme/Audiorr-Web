/**
 * sync — cliente de `/api/sync/*`.
 *
 * Funciones legacy Spotify (retrocompat, sin cambio de comportamiento):
 *   - listSyncs()                  → playlists configuradas (todas las fuentes).
 *   - previewSync(spotifyId)       → % de matches sin guardar (source=spotify implícito).
 *   - startSync(spotifyId, name?)  → guarda + sincroniza (source=spotify implícito).
 *   - forceSync(spotifyId)         → re-sincroniza (source=spotify implícito).
 *   - removeSync(spotifyId)        → elimina (source=spotify implícito).
 *
 * Funciones Deezer (source-aware, backend adec1dc+):
 *   - listDeezerSyncs()                     → filtra source==='deezer'.
 *   - previewDeezerSync(urlOrId)            → GET /api/sync/preview/:id?source=deezer.
 *   - startDeezerSync(urlOrId, name?)       → POST /api/sync/start { source:'deezer', externalId }.
 *   - forceDeezerSync(urlOrId)              → POST /api/sync/sync/:id?source=deezer.
 *   - removeDeezerSync(urlOrId)             → DELETE /api/sync/deezer/:id.
 *   - manualMatchDeezer(req)                → POST /api/sync/manual-match { source:'deezer', ... }.
 *   - searchSongs(q)                        → GET /api/sync/search-songs?q=... (agnóstico).
 *
 * Reconciliación editorial (backend `47b3d58`+, agnóstico de fuente):
 *   - reconcileEditorial()                  → POST /api/sync/reconcile-editorial (sin body).
 *
 * Input Deezer aceptado: URL `deezer.com/playlist/{id}`, URL con query string,
 * o ID numérico pelado.
 */

import { backendService } from './BackendService.svelte';
import {
  SyncedPlaylistSchema,
  SyncedPlaylistsArraySchema,
  SyncPreviewSchema,
  SyncedPlaylistsV2ArraySchema,
  SyncPreviewV2Schema,
  SyncedPlaylistV2Schema,
  SearchSongsResponseSchema,
  StatusOkSchema,
  ReconcileEditorialResultSchema,
  type SyncedPlaylist,
  type SyncPreview,
  type SyncedPlaylistV2,
  type SyncPreviewV2,
  type ManualMatchRequest,
  type SearchSongItem,
  type ReconcileEditorialResult
} from '$types/backend';

// ============================================================================
// Helpers de extracción de IDs
// ============================================================================

/** Acepta link de Spotify o id puro. Devuelve solo el id. */
export function extractSpotifyId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/playlist\/([a-zA-Z0-9]+)/);
  return match?.[1] ?? trimmed;
}

/**
 * Acepta URL deezer.com/playlist/{id}, deezer.com/en/playlist/{id}?...,
 * o un ID numérico pelado. Devuelve el ID como string.
 */
export function extractDeezerPlaylistId(input: string): string {
  const trimmed = input.trim();
  // Captura el segmento numérico tras /playlist/
  const match = trimmed.match(/\/playlist\/(\d+)/);
  if (match?.[1]) return match[1];
  // Fallback: si es numérico puro, lo devuelve tal cual
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed;
}

// ============================================================================
// Funciones Spotify legacy (retrocompat — sin cambio de comportamiento)
// ============================================================================

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

// ============================================================================
// Funciones Deezer (source-aware, backend adec1dc+)
// ============================================================================

/** Lista todas las syncs del backend y filtra las de fuente Deezer. */
export async function listDeezerSyncs(): Promise<SyncedPlaylistV2[]> {
  const data = await backendService.get('/api/sync/list', SyncedPlaylistsV2ArraySchema);
  if (!data) return [];
  // El backend devuelve `source` desde adec1dc. En builds anteriores al
  // deploy, el campo no existía → el schema le da default 'spotify', con lo
  // que el filtro es seguro: sin source nunca saldrá como deezer.
  return data.filter((p) => p.source === 'deezer');
}

/** Preview de una playlist Deezer. `urlOrId` puede ser URL completa o ID. */
export async function previewDeezerSync(urlOrId: string): Promise<SyncPreviewV2> {
  const id = extractDeezerPlaylistId(urlOrId);
  const data = await backendService.get(
    `/api/sync/preview/${encodeURIComponent(id)}?source=deezer`,
    SyncPreviewV2Schema
  );
  if (!data) throw new Error('Preview Deezer vacío del backend');
  return data;
}

/** Inicia el sync de una playlist Deezer por primera vez. */
export async function startDeezerSync(urlOrId: string, name?: string): Promise<SyncedPlaylistV2> {
  const externalId = extractDeezerPlaylistId(urlOrId);
  return backendService.post(
    '/api/sync/start',
    { source: 'deezer', externalId, ...(name ? { name } : {}) },
    SyncedPlaylistV2Schema
  );
}

/** Fuerza un re-sync de una playlist Deezer ya guardada. */
export async function forceDeezerSync(urlOrId: string): Promise<SyncedPlaylistV2> {
  const id = extractDeezerPlaylistId(urlOrId);
  return backendService.post(
    `/api/sync/sync/${encodeURIComponent(id)}?source=deezer`,
    undefined,
    SyncedPlaylistV2Schema
  );
}

/** Elimina la sincronización de una playlist Deezer. */
export async function removeDeezerSync(urlOrId: string): Promise<void> {
  const id = extractDeezerPlaylistId(urlOrId);
  await backendService.deleteVoid(`/api/sync/deezer/${encodeURIComponent(id)}`);
}

/** Crea un match manual entre un track Deezer y una canción Navidrome. */
export async function manualMatchDeezer(req: ManualMatchRequest): Promise<void> {
  await backendService.post('/api/sync/manual-match', req, StatusOkSchema);
}

/** Busca canciones en Navidrome por texto (agnóstico de fuente). */
export async function searchSongs(q: string): Promise<SearchSongItem[]> {
  const data = await backendService.get(
    `/api/sync/search-songs?q=${encodeURIComponent(q)}`,
    SearchSongsResponseSchema
  );
  return data ?? [];
}

/**
 * One-shot idempotente (backend `47b3d58`): marca `[Editorial]` en todas las
 * playlists ya sincronizadas (Spotify/Deezer) que aún no lo tenían, para que
 * el branding "Audiorr" se active sin re-sincronizar. Sin body.
 */
export async function reconcileEditorial(): Promise<ReconcileEditorialResult> {
  return backendService.post(
    '/api/sync/reconcile-editorial',
    undefined,
    ReconcileEditorialResultSchema
  );
}
