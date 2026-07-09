/**
 * playlistCustomCover — cliente de `/api/playlists/:playlistId/custom-cover`.
 *
 * Portada MANUAL de una playlist gestionada (Daily Mix, Smart, Editorial,
 * "This Is"). El usuario sube una imagen propia; el backend la compone con
 * el título de la playlist encima (variante `classic`, igual que el resto
 * de portadas personalizadas) y la sirve desde el `cover.png` de siempre.
 * Contrato completo: `D:\Audiorr-shared\decisions\custom-cover-api-contract.md`.
 *
 * El body del POST es la imagen BINARIA CRUDA (NO multipart, NO base64) con
 * `Content-Type` igual al mime real del archivo — por eso NO usamos
 * `backendService.post` (que siempre serializa JSON), sino `authedFetch` de
 * bajo nivel, que ya adjunta Bearer + refresh-on-401.
 */

import { backendService, BackendError } from './BackendService.svelte';
import {
  CustomCoverStatusSchema,
  CustomCoverUploadResponseSchema,
  CustomCoverRemoveResponseSchema,
  type CustomCoverStatus,
  type CustomCoverUploadResponse,
  type CustomCoverRemoveResponse
} from '$types/backend';

/** Tipos MIME que acepta el backend para la portada manual. */
export const CUSTOM_COVER_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type CustomCoverAcceptedType = (typeof CUSTOM_COVER_ACCEPTED_TYPES)[number];

/** Límite del backend (12 MB) — validar en cliente antes de subir. */
export const CUSTOM_COVER_MAX_BYTES = 12 * 1024 * 1024;

/** `accept` listo para `<input type="file">`. */
export const CUSTOM_COVER_ACCEPT = CUSTOM_COVER_ACCEPTED_TYPES.join(',');

/** ¿Es un tipo de imagen soportado por el endpoint? */
export function isCustomCoverAcceptedType(mime: string): mime is CustomCoverAcceptedType {
  return (CUSTOM_COVER_ACCEPTED_TYPES as readonly string[]).includes(mime);
}

/** ¿La playlist ya tiene una portada manual asignada? O(1), sin tocar red
    más allá del propio GET — úsalo para decidir "Asignar" vs
    "Reemplazar/Quitar" al pintar cada card. */
export async function getCustomCoverStatus(playlistId: string): Promise<CustomCoverStatus> {
  const data = await backendService.get(
    `/api/playlists/${encodeURIComponent(playlistId)}/custom-cover`,
    CustomCoverStatusSchema
  );
  return data ?? { hasCustom: false };
}

/**
 * Sube (o reemplaza — mismo endpoint idempotente) la portada manual.
 *
 * `file` viaja como body binario crudo con su `Content-Type` real. Errores
 * esperables: `409` playlist no elegible (Favoritos, o no gestionada),
 * `415` tipo no soportado, `400` no decodifica como imagen, `503` backend
 * sin config Navidrome — todos llegan con `{ error: string }` en el body,
 * que `BackendError.message` propaga para mostrar al usuario.
 */
export async function uploadCustomCover(
  playlistId: string,
  file: File | Blob
): Promise<CustomCoverUploadResponse> {
  const contentType = file.type || 'application/octet-stream';
  const res = await backendService.authedFetch(
    `/api/playlists/${encodeURIComponent(playlistId)}/custom-cover`,
    {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: file
    }
  );
  if (!res.ok) throw await toCustomCoverError(res);
  const json = await res.json();
  return CustomCoverUploadResponseSchema.parse(json);
}

/** Quita la portada manual — la playlist vuelve a su portada automática
    (el backend encola la regeneración en alta prioridad). */
export async function removeCustomCover(playlistId: string): Promise<CustomCoverRemoveResponse> {
  return backendService.delete(
    `/api/playlists/${encodeURIComponent(playlistId)}/custom-cover`,
    CustomCoverRemoveResponseSchema
  );
}

/** Traduce una respuesta de error del endpoint a `BackendError`, leyendo el
    campo `error` del body JSON cuando existe (típico en 409/415/400) para
    que la UI muestre el motivo real en vez de un "Backend 409" genérico. */
async function toCustomCoverError(res: Response): Promise<BackendError> {
  let message = `Backend ${res.status}: ${res.statusText}`;
  try {
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string' &&
      (body as { error: string }).error.length > 0
    ) {
      message = (body as { error: string }).error;
    }
  } catch {
    // El body no era JSON — nos quedamos con el mensaje genérico.
  }
  return new BackendError(res.status, message);
}
