/**
 * AnalysisService — cliente del análisis perceptual del backend Audiorr.
 *
 * Mirror del Swift `AnalysisCacheService` + `BackendService` (`analyzeSong`
 * y `getBulkAnalysisStatus`). Endpoints consumidos:
 *
 *   - POST   /api/analysis/song         → analiza + cachea (90s + cooldown 500ms)
 *   - POST   /api/analysis/bulk-status  → estado cached de N songs
 *   - DELETE /api/analysis/cache        → limpia todo el cache (admin)
 *   - DELETE /api/analysis/cache/:id    → invalida una entry concreta
 *
 * NO replicamos el `memoryCache` + `diskCache` del cliente iOS (que duplica
 * el cache del backend). El backend ya cachea, es local en LAN, latencias
 * <50ms. Si en el futuro se ve costoso, se añade un Map en memoria aquí.
 */

import { z } from 'zod';
import { backendService, BackendError } from './BackendService.svelte';
import {
  AnalysisResultSchema,
  BulkStatusResponseSchema,
  type AnalysisResult,
  type BulkStatusResponse
} from '$types/analysis';

// ============================================================================
// Payload types
// ============================================================================

/** Payload de POST /api/analysis/song. Mirror del Swift `AnalysisPayload`. */
export type AnalysisPayload = {
  songId: string;
  streamUrl: string;
  duration?: number;
  /** Timeout server-side. iOS usa 90s; replicamos. */
  timeoutMs?: number;
};

const AnalyzeOkSchema = z.object({ status: z.string() }).passthrough();

// ============================================================================
// API
// ============================================================================

/**
 * Solicita un análisis fresco al backend para una song concreta. Idempotente:
 * el backend devuelve el cache si ya existe. Tira `BackendError` en 4xx/5xx.
 */
export async function analyzeSong(payload: AnalysisPayload): Promise<AnalysisResult> {
  return backendService.post('/api/analysis/song', payload, AnalysisResultSchema);
}

/**
 * Pide al backend el estado de cache para una lista de songIds. Solo devuelve
 * entries para songs que YA tienen análisis — las que no existen no aparecen.
 *
 * Devuelve el `Record<songId, AnalysisResult>` directo (vs `{results: ...}`),
 * que es lo que el caller necesita para iterar.
 */
export async function getBulkAnalysisStatus(
  songIds: string[]
): Promise<Record<string, AnalysisResult>> {
  if (songIds.length === 0) return {};
  const response: BulkStatusResponse = await backendService.post(
    '/api/analysis/bulk-status',
    { songIds },
    BulkStatusResponseSchema
  );
  return response.results;
}

/** Borra el cache entero del backend. Solo admins via /housekeeping. */
export async function clearAnalysisCache(): Promise<void> {
  await backendService.delete('/api/analysis/cache', AnalyzeOkSchema);
}

/** Invalida la entry de una song concreta (re-análisis al siguiente request). */
export async function invalidateAnalysisCache(songId: string): Promise<void> {
  await backendService.delete(
    `/api/analysis/cache/${encodeURIComponent(songId)}`,
    AnalyzeOkSchema
  );
}

// Re-export para que callers no tengan que importar de `BackendService` aparte
export { BackendError };
