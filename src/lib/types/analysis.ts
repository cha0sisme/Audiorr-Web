/**
 * Schemas zod del análisis de pistas — mirror del Swift
 * `AnalysisCacheService.AnalysisResult`. El backend Audiorr cachea estos
 * análisis por song y los expone via:
 *
 *   - POST /api/analysis/song            → analiza + devuelve `AnalysisResult`
 *   - POST /api/analysis/bulk-status     → devuelve `{ results: Record<id, AnalysisResult> }`
 *
 * Diseño:
 *   - Schemas son `passthrough`: el backend puede añadir campos nuevos sin
 *     romper al cliente. Solo validamos los que SmartMix consume hoy.
 *   - Estructura anidada `diagnostics > fadeInfo / analysisLog` se respeta tal
 *     cual viene del backend. Las propiedades "computed" (lastVocalTime,
 *     fadeInDuration, energyProfile…) se exponen via helpers en
 *     `analysis-helpers.ts` para mantener la equivalencia con los `var`
 *     computed del Swift `AnalysisResult`.
 */

import { z } from 'zod';

// ============================================================================
// Sub-schemas
// ============================================================================

export const SpeechSegmentSchema = z.object({
  start: z.number(),
  end: z.number()
});
export type SpeechSegment = z.infer<typeof SpeechSegmentSchema>;

export const StructureSegmentSchema = z.object({
  label: z.string(),
  startTime: z.number(),
  endTime: z.number()
});
export type StructureSegment = z.infer<typeof StructureSegmentSchema>;

export const EnergyProfileSchema = z
  .object({
    intro: z.number().nullable().optional(),
    main: z.number().nullable().optional(),
    outro: z.number().nullable().optional(),
    introSlope: z.number().nullable().optional(),
    outroSlope: z.number().nullable().optional(),
    introVocals: z.boolean().nullable().optional(),
    outroVocals: z.boolean().nullable().optional()
  })
  .passthrough();
export type EnergyProfile = z.infer<typeof EnergyProfileSchema>;

const FadeInfoSchema = z
  .object({
    fadeInDuration: z.number().nullable().optional(),
    fadeOutDuration: z.number().nullable().optional(),
    cuePoint: z.number().nullable().optional(),
    fadeOutLeadTime: z.number().nullable().optional(),
    energyProfile: EnergyProfileSchema.nullable().optional()
  })
  .passthrough();

const LastChorusEndSchema = z
  .object({
    chorusStructure: z.array(StructureSegmentSchema).nullable().optional()
  })
  .passthrough();

const InstrumentalOutroSchema = z
  .object({
    lastVocalTimeCandidate: z.number().nullable().optional(),
    decision: z.string().nullable().optional()
  })
  .passthrough();

const IntroCandidatesSchema = z
  .object({
    vocal: z.number().nullable().optional(),
    percussive: z.number().nullable().optional(),
    energyBeat: z.number().nullable().optional()
  })
  .passthrough();

const IntroDecisionSchema = z
  .object({
    candidates: IntroCandidatesSchema.nullable().optional()
  })
  .passthrough();

const SpeechSegmentLogSchema = z
  .object({
    decision: z.string().nullable().optional(),
    segments: z.array(SpeechSegmentSchema).nullable().optional()
  })
  .passthrough();

const AnalysisLogSchema = z
  .object({
    lastChorusEnd: LastChorusEndSchema.nullable().optional(),
    instrumentalOutro: InstrumentalOutroSchema.nullable().optional(),
    introDecision: IntroDecisionSchema.nullable().optional(),
    speechSegmentLog: SpeechSegmentLogSchema.nullable().optional()
  })
  .passthrough();

const DiagnosticsSchema = z
  .object({
    fadeInfo: FadeInfoSchema.nullable().optional(),
    analysisLog: AnalysisLogSchema.nullable().optional(),
    introEndTime: z.number().nullable().optional(),
    finalOutroStartTime: z.number().nullable().optional()
  })
  .passthrough();

// ============================================================================
// AnalysisResult (top-level)
// ============================================================================

export const AnalysisResultSchema = z
  .object({
    bpm: z.number().nullable().optional(),
    beats: z.array(z.number()).nullable().optional(),
    beatInterval: z.number().nullable().optional(),
    energy: z.number().nullable().optional(),
    key: z.string().nullable().optional(),
    danceability: z.number().nullable().optional(),
    outroStartTime: z.number().nullable().optional(),
    introEndTime: z.number().nullable().optional(),
    vocalStartTime: z.number().nullable().optional(),
    speechSegments: z.array(SpeechSegmentSchema).nullable().optional(),
    structure: z.array(StructureSegmentSchema).nullable().optional(),

    bpmEssentia: z.number().nullable().optional(),
    bpmConfidence: z.number().nullable().optional(),
    introEndTimeHeuristic: z.number().nullable().optional(),
    outroStartTimeHeuristic: z.number().nullable().optional(),
    modelUsed: z.boolean().nullable().optional(),

    rmsCurve: z.array(z.number()).nullable().optional(),
    percussiveCurve: z.array(z.number()).nullable().optional(),
    harmonicCurve: z.array(z.number()).nullable().optional(),
    onsetDensity: z.array(z.number()).nullable().optional(),
    rmsTailCurve: z.array(z.number()).nullable().optional(),

    diagnostics: DiagnosticsSchema.nullable().optional()
  })
  .passthrough();

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ============================================================================
// Bulk status response
// ============================================================================

export const BulkStatusResponseSchema = z.object({
  results: z.record(z.string(), AnalysisResultSchema)
});
export type BulkStatusResponse = z.infer<typeof BulkStatusResponseSchema>;
