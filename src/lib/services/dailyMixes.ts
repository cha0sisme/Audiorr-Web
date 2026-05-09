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

import { z } from 'zod';
import { backendService } from './BackendService.svelte';
import {
  DailyMixesResponseSchema,
  CronStatusSchema,
  GenerateAllDailyMixesResponseSchema,
  type DailyMix,
  type CronStatus,
  type GenerateAllDailyMixesResponse
} from '$types/backend';
import { playlistCovers } from '$stores/playlist-covers.svelte';

/**
 * Lista de daily mixes para el usuario dado. Devuelve [] si el cron aún no
 * los generó (instalación nueva o usuario sin scrobbles suficientes).
 *
 * Side effect: registra `coverContentHash` de cada mix en el store global
 * `playlistCovers` para que `getPlaylistCoverUrl` pueda servir URLs con
 * `?v=<hash>` (cache HTTP `immutable` 1 año).
 */
export async function getDailyMixes(username: string): Promise<DailyMix[]> {
  const data = await backendService.get('/api/daily-mixes', DailyMixesResponseSchema, {
    'x-navidrome-user': username
  });
  const mixes = data?.mixes ?? [];
  playlistCovers.setMany(mixes.map((m) => ({ id: m.navidromeId, hash: m.coverContentHash })));
  return mixes;
}

/**
 * URL del cover personalizado del backend para una playlist.
 *
 * SIEMPRE se sirve desde el backend (nunca Navidrome directo) — incluso
 * para playlists creadas por el usuario, el backend las re-renderiza con
 * estilo Audiorr. El backend cachea agresivamente (30 min TTL, hasta 1 año
 * con cache buster `?v=<hash>`) y regenera por cron cuando cambian.
 *
 * Si tenemos `coverContentHash` registrado en el store global, lo usamos
 * como `?v=<hash>` → respuesta `immutable` 1 año, cero revalidaciones.
 * Si no, URL sin buster → 30 min TTL del backend, suficiente.
 */
export function getPlaylistCoverUrl(navidromeId: string): string {
  const base = backendService.fileUrl(`/api/playlists/${encodeURIComponent(navidromeId)}/cover.png`);
  const hash = playlistCovers.get(navidromeId);
  return hash ? `${base}?v=${encodeURIComponent(hash)}` : base;
}

/**
 * Estado del cron único que regenera Daily Mixes a las 3am. Diferente al
 * de smart playlists (que tiene varios crons, uno por key). Aquí es uno
 * solo porque la generación de los 4 mixes ocurre en el mismo job.
 */
export async function getDailyMixesCronStatus(): Promise<CronStatus | null> {
  return backendService.get('/api/daily-mixes/cron-status', CronStatusSchema);
}

/**
 * Dispara la regeneración de Daily Mixes para TODOS los usuarios conocidos.
 * Server-side cooldown 30s — el backend devuelve 429 con `retryAfterMs` si
 * estás dentro de la ventana. La response trae:
 *   - `users`: lista de usernames procesados.
 *   - `results`: { generated, reason? } por usuario.
 *   - `totalGenerated`: número absoluto de mixes generados.
 */
export async function generateAllDailyMixes(): Promise<GenerateAllDailyMixesResponse> {
  return backendService.post(
    '/api/daily-mixes/generate-all',
    undefined,
    GenerateAllDailyMixesResponseSchema
  );
}

/**
 * Encola la regeneración de TODAS las covers personalizadas (daily mixes,
 * smart playlists, editoriales, "This is …"). El backend itera las
 * playlists Navidrome, calcula el contentHash para cada una y mete jobs
 * `low priority` en la coverQueue.
 *
 * Respuesta: solo necesitamos saber que arrancó — el shape completo
 * incluye `queuedCount` y otros internos que ignoramos.
 */
const QueueResponseSchema = z
  .object({
    queuedCount: z.number().optional(),
    status: z.string().optional()
  })
  .passthrough();

export async function regenerateAllCovers(): Promise<{ queuedCount?: number | undefined }> {
  const data = await backendService.post(
    '/api/playlists/regenerate-all',
    undefined,
    QueueResponseSchema
  );
  return { queuedCount: data.queuedCount };
}
