/**
 * Diagnostics — schemas Zod para el viewer de TransitionRecord/Session.
 *
 * Mirror del shape que sirve `/api/diagnostics/*` del Audiorr Backend.
 * Las columnas indexadas son obligatorias; el resto del payload (campos
 * de telemetría como `bpmA`, `entryPoint`, `genreCapApplied`, etc.) viene
 * mezclado en el response y se modela como opcional — distintos algorithm
 * versions emiten distintos subsets, y queremos tolerancia forward.
 */

import { z } from 'zod';

/** Tipos de transición canónicos (11). El backend valida server-side, los
    listamos como union para acotar el render. */
export const TransitionTypeSchema = z.enum([
  'CROSSFADE',
  'EQ_MIX',
  'CUT',
  'NATURAL_BLEND',
  'BEAT_MATCH_BLEND',
  'CUT_A_FADE_IN_B',
  'FADE_OUT_A_CUT_B',
  'STEM_MIX',
  'DROP_MIX',
  'CLEAN_HANDOFF',
  'VINYL_STOP',
  'SEQUENTIAL'
]);

export type TransitionType = z.infer<typeof TransitionTypeSchema>;

export const TransitionRecordSchema = z
  .object({
    // ── Columnas indexadas (siempre presentes, server-managed) ──────────
    id: z.string(),
    sessionId: z.string(),
    algorithmVersion: z.string(),
    buildId: z.string(),
    createdAt: z.string(),
    date: z.string(),
    ratedAt: z.string().nullable().optional(),
    userRating: z.number().int().min(1).max(10).nullable().optional(),
    userComment: z.string().nullable().optional(),
    fromTitle: z.string(),
    toTitle: z.string(),
    type: z.string(),
    deletedAt: z.string().nullable().optional(),
    updatedAt: z.string().optional(),

    // ── Telemetría del recordJson (mezclada en el response) ─────────────
    // Todos opcionales por compat forward (algorithm versions emiten subsets).
    fromArtist: z.string().optional(),
    toArtist: z.string().optional(),
    bpmA: z.number().optional(),
    bpmB: z.number().optional(),
    energyA: z.number().optional(),
    energyB: z.number().optional(),
    danceability: z.number().optional(),
    replayGainA: z.number().optional(),
    replayGainB: z.number().optional(),
    rateA: z.number().optional(),
    rateB: z.number().optional(),
    fadeDuration: z.number().optional(),
    entryPoint: z.number().optional(),
    startOffset: z.number().optional(),
    anticipationTime: z.number().optional(),
    anticipationReason: z.string().optional(),
    introSlopeB: z.number().optional(),
    downbeatDensityB20s: z.number().optional(),
    entryPointSource: z.string().optional(),
    transitionReason: z.string().optional(),
    beatSyncInfo: z.string().optional(),
    beatSynced: z.boolean().optional(),
    timeStretched: z.boolean().optional(),
    filterPreset: z.string().optional(),
    filtersEnabled: z.boolean().optional(),
    skipBFilters: z.boolean().optional(),
    useBassKill: z.boolean().optional(),
    useMidScoop: z.boolean().optional(),
    useHighShelfCut: z.boolean().optional(),
    useNotchSweep: z.boolean().optional(),
    useStutterCut: z.boolean().optional(),
    useDynamicQ: z.boolean().optional(),
    bRapidFadeIn: z.boolean().optional(),
    chillRecipeApplied: z.boolean().optional(),
    genreCapApplied: z.boolean().optional(),
    isIntroInstrumental: z.boolean().optional(),
    isOutroInstrumental: z.boolean().optional(),
    tier4Active: z.boolean().optional(),
    tier4FailedGate: z.string().optional(),
    bGenres: z.array(z.string()).optional(),
    aGenres: z.array(z.string()).optional(),
    entryFinalCapApplied: z.boolean().optional(),
    outroSlope: z.number().optional()
  })
  .passthrough();

export type TransitionRecord = z.infer<typeof TransitionRecordSchema>;

export const TransitionListResponseSchema = z.object({
  transitions: z.array(TransitionRecordSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  hasMore: z.boolean()
});

export type TransitionListResponse = z.infer<typeof TransitionListResponseSchema>;

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  transitionCount: z.number(),
  rated: z.number(),
  unrated: z.number(),
  meanRating: z.number().nullable().optional(),
  algorithmVersion: z.string().optional(),
  buildId: z.string().optional(),
  diamonds: z.number().optional()
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema)
});

/** Filtros del GET `/transitions` — mismo nombre de query params del backend. */
export type TransitionFilters = {
  since?: string;
  until?: string;
  minRating?: number;
  maxRating?: number;
  unrated?: boolean;
  type?: string | string[];
  sessionId?: string;
  algorithmVersion?: string;
  buildId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};
