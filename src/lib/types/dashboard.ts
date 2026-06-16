import { z } from 'zod';

/**
 * Tipos del dashboard de Housekeeping (Resumen). Cada schema corresponde a un
 * endpoint del Audiorr Backend verificado en producción con Bearer. Derivamos
 * los tipos TS del schema (fuente de verdad) — patrón del proyecto.
 *
 * El Resumen es de observabilidad/seguridad: accesos, IPs con fallos, estado de
 * seguridad y salud del sistema (crons, uptime, DBs) + pulso de actividad.
 */

// ── GET /api/diagnostics/system ────────────────────────────────────────────
// Snapshot de runtime del backend. `passthrough` porque trae más campos
// (config/python/pid…) que el dashboard no consume; solo tipamos lo que usa.
// `size`/`rows` son nullable: una DB en estado MISSING llega con size:null.
export const SystemDatabaseSchema = z.object({
  file: z.string(),
  status: z.string(),
  size: z.number().nullable(),
  rows: z.number().nullable(),
  description: z.string().nullable().optional(),
  error: z.string().nullable().optional()
});
export const SystemCronSchema = z.object({
  status: z.enum(['idle', 'running', 'error', 'success']).catch('idle'),
  lastRun: z.string().nullable().optional(),
  nextRun: z.string().nullable().optional(),
  lastError: z.string().nullable().optional()
});
export const SystemInfoSchema = z
  .object({
    service: z.string(),
    version: z.string(),
    /** SHA corto del commit desplegado (backend lo resuelve en arranque);
        null si la fuente no está disponible. */
    commit: z.string().nullable().optional(),
    uptimeSec: z.number(),
    bootedAt: z.string().optional(),
    node: z.string().optional(),
    platform: z.string().optional(),
    memory: z.object({
      rss: z.number(),
      heapUsed: z.number(),
      heapTotal: z.number()
    }),
    databases: z.array(SystemDatabaseSchema),
    crons: z.record(z.string(), SystemCronSchema).optional()
  })
  .passthrough();
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
export type SystemDatabase = z.infer<typeof SystemDatabaseSchema>;
export type SystemCron = z.infer<typeof SystemCronSchema>;

// ── GET /api/stats/scrobbles-daily?days=N ──────────────────────────────────
// Serie diaria de reproducciones (rellena con 0 los días sin escuchas). Las
// fechas son UTC; el sparkline las usa solo como secuencia, no como eje.
export const ScrobblesDailySchema = z.object({
  days: z.number(),
  series: z.array(z.object({ date: z.string(), plays: z.number() })),
  total: z.number()
});
export type ScrobblesDaily = z.infer<typeof ScrobblesDailySchema>;

// ── GET /api/admin/security-summary ────────────────────────────────────────
// Resumen de accesos a partir de auth-audit-log.db (logins ok/fail/blocked en
// 24h y 7d), IPs con más fallos, sesiones vivas y lockouts antifuerza-bruta.
export const LoginWindowSchema = z.object({
  ok: z.number(),
  fail: z.number(),
  blocked: z.number()
});
export const FailIpSchema = z.object({
  ip: z.string(),
  count: z.number(),
  lastAttemptAt: z.string()
});
export const SecuritySummarySchema = z.object({
  logins24h: LoginWindowSchema,
  logins7d: LoginWindowSchema,
  topFailIps: z.array(FailIpSchema),
  activeSessions: z.number(),
  lockedUsernames: z.number(),
  trackedUsernames: z.number(),
  auditTotalRecords: z.number()
});
export type SecuritySummary = z.infer<typeof SecuritySummarySchema>;
export type LoginWindow = z.infer<typeof LoginWindowSchema>;
export type FailIp = z.infer<typeof FailIpSchema>;

// ── GET /api/admin/auth-daily-series?days=N ────────────────────────────────
// Serie diaria de accesos (ok/fail/blocked) rellena con 0 los días vacíos.
export const AuthDailySeriesSchema = z.object({
  days: z.number(),
  series: z.array(
    z.object({
      date: z.string(),
      ok: z.number(),
      fail: z.number(),
      blocked: z.number()
    })
  )
});
export type AuthDailySeries = z.infer<typeof AuthDailySeriesSchema>;
export type AuthDayPoint = AuthDailySeries['series'][number];

// ── GET /api/admin/rate-limit-stats ────────────────────────────────────────
// Contadores en memoria por limiter (analyze/backfill/strict).
export const RateLimitStatsSchema = z.object({
  windowMinutes: z.number(),
  limiters: z.array(
    z.object({
      key: z.string(),
      hits: z.number(),
      lastHitAt: z.string().nullable()
    })
  )
});
export type RateLimitStats = z.infer<typeof RateLimitStatsSchema>;

// ── GET /api/admin/auth-recent-events?days=N&limit=M ───────────────────────
// Drill-down de Accesos: eventos individuales del auth-audit-log (desc por ts).
// `result` ya viene categorizado por el backend (ok/fail/blocked/other).
export const AuthEventSchema = z.object({
  at: z.string(),
  event: z.string(),
  username: z.string().nullable(),
  ip: z.string().nullable(),
  result: z.enum(['ok', 'fail', 'blocked', 'other']).catch('other')
});
export const AuthRecentEventsSchema = z.object({
  days: z.number(),
  limit: z.number(),
  events: z.array(AuthEventSchema)
});
export type AuthEvent = z.infer<typeof AuthEventSchema>;
export type AuthRecentEvents = z.infer<typeof AuthRecentEventsSchema>;

// ── GET /api/admin/fail-ips?days=N&limit=M ─────────────────────────────────
// Lista ranked completa de IPs con fallos (reusa la shape de FailIp).
export const FailIpsListSchema = z.object({
  days: z.number(),
  limit: z.number(),
  ips: z.array(FailIpSchema)
});
export type FailIpsList = z.infer<typeof FailIpsListSchema>;
