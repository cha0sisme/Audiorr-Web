/**
 * Helpers que replican las propiedades `computed var` del Swift
 * `AnalysisCacheService.AnalysisResult`. La estructura del backend mantiene
 * varios campos anidados dentro de `diagnostics > fadeInfo / analysisLog`;
 * estas funciones aplanan el acceso para que SmartMix consuma los datos
 * sin pegarse al shape backend.
 *
 * Mirror exacto de los getters Swift en SmartMixManager.AnalyzedSong y de los
 * `var` computed de AnalysisResult.
 */

import type {
  AnalysisResult,
  EnergyProfile,
  StructureSegment
} from '$types/analysis';

// ── Fade info (vive en diagnostics.fadeInfo) ─────────────────────────────────

export function fadeInDuration(a: AnalysisResult): number | undefined {
  return a.diagnostics?.fadeInfo?.fadeInDuration ?? undefined;
}

export function fadeOutDuration(a: AnalysisResult): number | undefined {
  return a.diagnostics?.fadeInfo?.fadeOutDuration ?? undefined;
}

export function cuePoint(a: AnalysisResult): number | undefined {
  return a.diagnostics?.fadeInfo?.cuePoint ?? undefined;
}

export function energyProfile(a: AnalysisResult): EnergyProfile | undefined {
  return a.diagnostics?.fadeInfo?.energyProfile ?? undefined;
}

// ── Chorus structure (vive en diagnostics.analysisLog.lastChorusEnd) ─────────

/** Prefiere `diagnostics.analysisLog.lastChorusEnd.chorusStructure`, cae a
    `structure` top-level. Mirror de `var chorusStructure` en Swift. */
export function chorusStructure(a: AnalysisResult): StructureSegment[] | undefined {
  return (
    a.diagnostics?.analysisLog?.lastChorusEnd?.chorusStructure ??
    a.structure ??
    undefined
  );
}

// ── lastVocalTime (vive en analysisLog.instrumentalOutro) ────────────────────

export function lastVocalTime(a: AnalysisResult): number | undefined {
  return a.diagnostics?.analysisLog?.instrumentalOutro?.lastVocalTimeCandidate ?? undefined;
}
