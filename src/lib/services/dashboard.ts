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
  AuthDailySeriesSchema,
  RateLimitStatsSchema,
  AuthRecentEventsSchema,
  FailIpsListSchema,
  AuthByCountrySchema,
  type SystemInfo,
  type ScrobblesDaily,
  type SecuritySummary,
  type AuthDailySeries,
  type RateLimitStats,
  type AuthRecentEvents,
  type FailIpsList,
  type AuthByCountry
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

/** Serie diaria de accesos (ok/fail/blocked) para la card de actividad. */
export function getAuthDailySeries(days = 30): Promise<AuthDailySeries | null> {
  return backendService.get(`/api/admin/auth-daily-series?days=${days}`, AuthDailySeriesSchema, userHeader());
}

/** Contadores de rate-limit por limiter (detección de abuso). */
export function getRateLimitStats(): Promise<RateLimitStats | null> {
  return backendService.get('/api/admin/rate-limit-stats', RateLimitStatsSchema, userHeader());
}

/** Drill-down de Accesos: eventos individuales recientes del auth-audit-log. */
export function getAuthRecentEvents(days = 7, limit = 100): Promise<AuthRecentEvents | null> {
  return backendService.get(
    `/api/admin/auth-recent-events?days=${days}&limit=${limit}`,
    AuthRecentEventsSchema,
    userHeader()
  );
}

/** Drill-down de IPs: lista ranked completa de IPs con fallos. */
export function getFailIps(days = 7, limit = 50): Promise<FailIpsList | null> {
  return backendService.get(
    `/api/admin/fail-ips?days=${days}&limit=${limit}`,
    FailIpsListSchema,
    userHeader()
  );
}

/** Accesos agregados por país (cf-ipcountry) para el mapa de origen. */
export function getAuthByCountry(days = 7): Promise<AuthByCountry | null> {
  return backendService.get(
    `/api/admin/auth-by-country?days=${days}`,
    AuthByCountrySchema,
    userHeader()
  );
}
