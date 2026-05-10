/**
 * Cliente REST scrobble del backend Audiorr — fallback cuando el hub
 * Connect (socket.io) no está conectado. Mirror del Swift
 * `BackendService.recordScrobble` (BackendService.swift).
 *
 * El backend dedupe en ventana 600s, así que el doble write
 * Navidrome+backend no genera duplicados.
 */

import { backendService } from '$services/BackendService.svelte';

export type ScrobblePayload = {
  username: string;
  songId: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  duration: number;
  /** ISO 8601 con TZ, ej. `2026-05-10T14:30:00.000Z`. */
  playedAt: string;
  year?: number;
  genre?: string;
  bpm?: number;
  energy?: number;
  contextUri?: string;
  contextName?: string;
};

/** POST /api/scrobble. No requiere auth header — el backend confía en el
    `username` del body. Si el endpoint cae 4xx/5xx, el caller decide si
    enqueuea para retry. */
export async function recordScrobble(payload: ScrobblePayload): Promise<boolean> {
  const url = `${backendService.baseUrl}/api/scrobble`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch {
    return false;
  }
}
