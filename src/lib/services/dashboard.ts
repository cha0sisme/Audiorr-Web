/**
 * dashboard — capa de datos del Resumen de Housekeeping (observabilidad).
 *
 * Cada función pega contra un endpoint del Audiorr Backend ya verificado y
 * devuelve el payload tipado vía Zod (`backendService.get`, 404 → null).
 *
 * Auth:
 *   - /api/diagnostics/* exige Bearer + `x-navidrome-user`.
 *   - /api/stats/* y /api/admin/* van con Bearer (lo adjunta backendService);
 *     /api/admin/security-summary además exige rol admin (lo deriva del Bearer).
 */

import { backendService } from './BackendService.svelte';
import { credentials } from '$stores/credentials.svelte';
import {
  SystemInfoSchema,
  ScrobblesDailySchema,
  SecuritySummarySchema,
  type SystemInfo,
  type ScrobblesDaily,
  type SecuritySummary
} from '$types/dashboard';

function userHeader(): Record<string, string> {
  const u = credentials.current?.username ?? '';
  return u ? { 'x-navidrome-user': u } : {};
}

/** Snapshot de runtime del backend (uptime, memoria, DBs, crons). */
export function getSystemInfo(): Promise<SystemInfo | null> {
  return backendService.get('/api/diagnostics/system', SystemInfoSchema, userHeader());
}

/** Serie diaria de reproducciones para el sparkline de actividad. */
export function getScrobblesDaily(days = 7): Promise<ScrobblesDaily | null> {
  return backendService.get(`/api/stats/scrobbles-daily?days=${days}`, ScrobblesDailySchema);
}

/** Resumen de accesos/seguridad (logins, IPs con fallos, sesiones, lockouts). */
export function getSecuritySummary(): Promise<SecuritySummary | null> {
  return backendService.get('/api/admin/security-summary', SecuritySummarySchema, userHeader());
}
