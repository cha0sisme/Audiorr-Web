import { z } from 'zod';

/**
 * Tipos del dashboard de Housekeeping (Resumen). Cada schema corresponde a un
 * endpoint del Audiorr Backend ya verificado en producción con Bearer.
 * Derivamos los tipos TS del schema (fuente de verdad) — patrón del proyecto.
 */

// ── GET /api/diagnostics/coverage ──────────────────────────────────────────
// Cobertura del pipeline de análisis: para cada campo de analysis_cache,
// cuántas filas lo tienen. `total` = canciones analizadas en cache.
export const CoverageFieldSchema = z.object({
  withField: z.number(),
  withoutField: z.number(),
  percentage: z.number()
});
export const CoverageSchema = z.object({
  total: z.number(),
  fields: z.record(z.string(), CoverageFieldSchema)
});
export type Coverage = z.infer<typeof CoverageSchema>;

// ── GET /api/diagnostics/system ────────────────────────────────────────────
// Snapshot de runtime del backend. `passthrough` porque trae más campos
// (config/python/pid…) que el dashboard no consume; solo tipamos lo que usa.
export const SystemDatabaseSchema = z.object({
  file: z.string(),
  status: z.string(),
  size: z.number(),
  rows: z.number().nullable(),
  description: z.string().nullable().optional(),
  error: z.string().nullable().optional()
});
export const SystemInfoSchema = z
  .object({
    service: z.string(),
    version: z.string(),
    uptimeSec: z.number(),
    bootedAt: z.string().optional(),
    node: z.string().optional(),
    platform: z.string().optional(),
    memory: z.object({
      rss: z.number(),
      heapUsed: z.number(),
      heapTotal: z.number()
    }),
    databases: z.array(SystemDatabaseSchema)
  })
  .passthrough();
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
export type SystemDatabase = z.infer<typeof SystemDatabaseSchema>;

// ── GET /api/diagnostics/summary ───────────────────────────────────────────
// Resumen del motor DJ en una llamada (evita 3+ a /aggregate y /sessions).
export const DjSummarySchema = z.object({
  totalTransitions: z.number(),
  ratedPct: z.number(),
  meanRating: z.number().nullable(),
  lastSessionAt: z.string().nullable(),
  currentAlgorithmVersion: z.string().nullable()
});
export type DjSummary = z.infer<typeof DjSummarySchema>;

// ── GET /api/stats/scrobbles-daily?days=N ──────────────────────────────────
// Serie diaria de reproducciones (rellena con 0 los días sin escuchas). Las
// fechas son UTC; el sparkline las usa solo como secuencia, no como eje.
export const ScrobblesDailySchema = z.object({
  days: z.number(),
  series: z.array(z.object({ date: z.string(), plays: z.number() })),
  total: z.number()
});
export type ScrobblesDaily = z.infer<typeof ScrobblesDailySchema>;

// ── GET /api/auth/hub-status ───────────────────────────────────────────────
// Estado del hub Connect (Socket.io): sesiones/usuarios/dispositivos vivos.
export const HubStatusSchema = z
  .object({
    ok: z.boolean(),
    sessions: z.number(),
    users: z.number(),
    totalDevices: z.number(),
    uptimeSeconds: z.number(),
    persistent: z.boolean().optional(),
    serverIp: z.string().optional()
  })
  .passthrough();
export type HubStatus = z.infer<typeof HubStatusSchema>;
