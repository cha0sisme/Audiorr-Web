/**
 * dailyMixes — cliente del endpoint `/api/daily-mixes` del backend Audiorr.
 *
 * Los daily mixes los genera un cron del backend a las 03:00 (4 mixes
 * personalizados por usuario). Se materializan como playlists en Navidrome
 * (campo `navidromeId`) — el cliente puede navegar a `/playlist/<navidromeId>`.
 *
 * Cuando `navidromeId` es null, el mix existe en wrapped.db pero aún no se
 * sincronizó (transitorio). El cliente puede mostrar la card pero deshabilitar
 * la navegación.
 */

import { backendService } from './BackendService.svelte';
import { DailyMixesResponseSchema, type DailyMix } from '$types/backend';

/**
 * Lista de daily mixes para el usuario dado. Devuelve [] si el cron aún no
 * los generó (instalación nueva o usuario sin scrobbles suficientes).
 */
export async function getDailyMixes(username: string): Promise<DailyMix[]> {
  const data = await backendService.get('/api/daily-mixes', DailyMixesResponseSchema, {
    'x-navidrome-user': username
  });
  return data?.mixes ?? [];
}

/**
 * URL del cover generado por el backend para esta playlist (mix o smart).
 * El backend la cachea y firma con `coverContentHash` o `coverVersion` —
 * el `?v=` rompe el cache del browser cuando el cover cambia.
 *
 * Si no hay versión (el cover aún no se ha generado), pedimos sin `?v=` —
 * el backend devuelve un placeholder.
 */
export function getPlaylistCoverUrl(
  navidromeId: string,
  cacheBuster?: string | number | null
): string {
  const base = backendService.fileUrl(`/api/playlists/${encodeURIComponent(navidromeId)}/cover.png`);
  return cacheBuster != null ? `${base}?v=${encodeURIComponent(String(cacheBuster))}` : base;
}
