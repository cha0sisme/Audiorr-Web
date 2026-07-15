/**
 * CrateDiggerService — "Crate Digger": sugerencias para añadir a una playlist
 * privada o a Favoritos. Zona al final del detalle de playlist, estilo
 * Spotify "Recommended songs".
 *
 *   GET /api/playlists/:playlistId/suggestions?limit=&cursor=&refresh=
 *   Auth: Bearer — gestionado automáticamente por BackendService.authedFetch.
 *
 * Contrato completo: D:\Audiorr-shared\decisions\crate-digger-suggestions-api-contract.md
 *
 * El backend es el safety-net real de elegibilidad (403 si la playlist no es
 * del usuario, `eligible:false` en 200 si no es una lista elegible). Este
 * servicio nunca lanza: cualquier fallo (401 irrecuperable, 403, 404, 503,
 * red) degrada a una respuesta "vacía" (`eligible:false`, `items:[]`,
 * `nextCursor:null`) — el caller solo necesita comprobar esos dos campos
 * para decidir si oculta la sección, sin try/catch propio.
 */

import { backendService } from '$services/BackendService.svelte';
import {
  CrateDiggerSuggestionsResponseSchema,
  type CrateDiggerSuggestionsResponse
} from '$types/backend';

export type { CrateDiggerSuggestionsResponse, CrateDiggerItem, CrateDiggerBasis } from '$types/backend';

export type CrateDiggerFetchOptions = {
  /** Tamaño de página. Decisión director 2026-07-15: 10, uniforme en las 3
      plataformas (el "20" de la sección UX del contrato quedó desactualizado
      tras esa decisión — la tabla de query params, correcta, dice 10). */
  limit?: number;
  /** Cursor opaco devuelto por la llamada anterior (`nextCursor`). Ausente = primera página. */
  cursor?: string | null;
  /** `true` = "Actualizar" (descarta el orden anterior, re-baraja con seed nueva). */
  refresh?: boolean;
};

const DEFAULT_LIMIT = 10;

function hiddenResponse(): CrateDiggerSuggestionsResponse {
  return {
    version: 1,
    eligible: false,
    basis: 'playlist',
    sessionId: '',
    items: [],
    nextCursor: null
  };
}

/**
 * Pide una página de sugerencias para `playlistId`. Ver contrato para el
 * shape completo. Nunca lanza (ver comentario de cabecera).
 */
export async function fetchCrateDiggerSuggestions(
  playlistId: string,
  options: CrateDiggerFetchOptions = {}
): Promise<CrateDiggerSuggestionsResponse> {
  if (!playlistId) return hiddenResponse();
  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? DEFAULT_LIMIT));
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.refresh) params.set('refresh', 'true');
  try {
    const res = await backendService.get(
      `/api/playlists/${encodeURIComponent(playlistId)}/suggestions?${params.toString()}`,
      CrateDiggerSuggestionsResponseSchema
    );
    return res ?? hiddenResponse();
  } catch {
    // 403 (playlist no es del usuario), 503 (backend sin Navidrome), 401
    // irrecuperable o network error → sección oculta, nunca un throw visible.
    return hiddenResponse();
  }
}
