/**
 * lastPlayback — cliente del endpoint per-user de "último estado de
 * reproducción". Mirror del Swift `BackendService.getLastPlayback` /
 * `saveLastPlayback`.
 *
 * Endpoints consumidos:
 *   - GET    /api/user/:username/last-playback  → { lastPlayback: state | null }
 *   - PUT    /api/user/:username/last-playback  body = LastPlaybackPayload
 *   - POST   /api/user/:username/last-playback  alias para navigator.sendBeacon
 *
 * Diseño:
 *   - 404 backend → null (igual que iOS: cuenta nueva sin scrobbles aún).
 *   - PUT errors no se propagan al caller — el save es "best effort"; si el
 *     backend está caído, se reintenta en el próximo throttle window. Mirror
 *     de iOS donde saveToBackend() es fire-and-forget con `try? await`.
 *   - sendBeacon usado en `pagehide` / `beforeunload` para garantizar el
 *     último save antes de cerrar pestaña — el browser bloquea fetch normal
 *     en ese unload window.
 */

import { z } from 'zod';
import { backendService, BackendError } from './BackendService.svelte';
import {
  LastPlaybackResponseSchema,
  type LastPlaybackResponse,
  type LastPlaybackState
} from '$types/backend';

// ============================================================================
// Payload type — lo que el cliente envía al backend
// ============================================================================

/** Payload del PUT/POST. Mismo shape que `LastPlaybackState` excepto que el
    backend pone `savedAt` server-side (no lo enviamos). */
export type LastPlaybackPayload = Omit<LastPlaybackState, 'savedAt'>;

// El response del PUT es un simple `{ ok: true }` — schema permissive para
// no fallar si el backend añade fields.
const PutOkSchema = z.object({ ok: z.boolean() }).passthrough();

// ============================================================================
// API
// ============================================================================

/**
 * Lee el último playback persistido en backend para `username`. 404 → null.
 * Cualquier otro error → null + log (no propagamos para no romper boot).
 */
export async function getLastPlayback(
  username: string
): Promise<LastPlaybackState | null> {
  try {
    const response: LastPlaybackResponse | null = await backendService.get(
      `/api/user/${encodeURIComponent(username)}/last-playback`,
      LastPlaybackResponseSchema
    );
    return response?.lastPlayback ?? null;
  } catch (err) {
    if (err instanceof BackendError) {
      console.warn(`[lastPlayback] GET fallo (${err.status}): ${err.message}`);
    } else {
      console.warn('[lastPlayback] GET fallo:', err);
    }
    return null;
  }
}

/**
 * Persiste el último playback al backend. "Best effort": loguea pero no tira.
 * Mirror de iOS BackendService.saveLastPlayback (try? await).
 */
export async function saveLastPlayback(
  username: string,
  payload: LastPlaybackPayload
): Promise<void> {
  try {
    await backendService.put(
      `/api/user/${encodeURIComponent(username)}/last-playback`,
      payload,
      PutOkSchema
    );
  } catch (err) {
    if (err instanceof BackendError) {
      console.warn(`[lastPlayback] PUT fallo (${err.status}): ${err.message}`);
    } else {
      console.warn('[lastPlayback] PUT fallo:', err);
    }
  }
}

/**
 * Save síncrono via `navigator.sendBeacon`. Único método que el browser
 * permite al unload de la pestaña — fetch normal se aborta. Body como
 * Blob `application/json` para que el backend lo parsee igual que un PUT
 * normal (la ruta POST tiene fallback para `text/plain` con JSON crudo).
 *
 * Devuelve `true` si el browser aceptó la cola del beacon (no garantiza
 * que el server lo reciba, pero sí que se intentará).
 */
export function saveLastPlaybackBeacon(
  username: string,
  payload: LastPlaybackPayload
): boolean {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
  const url = `${backendService.baseUrl}/api/user/${encodeURIComponent(username)}/last-playback`;
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  return navigator.sendBeacon(url, blob);
}
