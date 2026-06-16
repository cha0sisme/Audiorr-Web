/**
 * dashboard — capa de datos del Resumen de Housekeeping.
 *
 * Cada función pega contra un endpoint del Audiorr Backend ya verificado y
 * devuelve el payload tipado vía Zod. Sigue el patrón del resto de servicios:
 * `backendService.get(path, schema, headers)` (404 → null).
 *
 * Auth:
 *   - /api/diagnostics/* exige Bearer + `x-navidrome-user` (el backend filtra
 *     por userId; sin el header devuelve 401).
 *   - /api/stats/* y /api/auth/hub-status van solo con Bearer (lo adjunta
 *     `backendService` automáticamente).
 */

import { backendService } from './BackendService.svelte';
import { credentials } from '$stores/credentials.svelte';
import {
  CoverageSchema,
  SystemInfoSchema,
  DjSummarySchema,
  ScrobblesDailySchema,
  HubStatusSchema,
  type Coverage,
  type SystemInfo,
  type DjSummary,
  type ScrobblesDaily,
  type HubStatus
} from '$types/dashboard';

function userHeader(): Record<string, string> {
  const u = credentials.current?.username ?? '';
  return u ? { 'x-navidrome-user': u } : {};
}

/** Cobertura del pipeline de análisis (total + % por campo). */
export function getCoverage(): Promise<Coverage | null> {
  return backendService.get('/api/diagnostics/coverage', CoverageSchema, userHeader());
}

/** Snapshot de runtime del backend (uptime, memoria, DBs). */
export function getSystemInfo(): Promise<SystemInfo | null> {
  return backendService.get('/api/diagnostics/system', SystemInfoSchema, userHeader());
}

/** Resumen del motor DJ (transiciones, % valoradas, media, última sesión). */
export function getDjSummary(): Promise<DjSummary | null> {
  return backendService.get('/api/diagnostics/summary', DjSummarySchema, userHeader());
}

/** Serie diaria de reproducciones para el sparkline de actividad. */
export function getScrobblesDaily(days = 7): Promise<ScrobblesDaily | null> {
  return backendService.get(`/api/stats/scrobbles-daily?days=${days}`, ScrobblesDailySchema);
}

/** Estado del hub Connect (dispositivos/usuarios conectados ahora). */
export function getHubStatus(): Promise<HubStatus | null> {
  return backendService.get('/api/auth/hub-status', HubStatusSchema);
}
