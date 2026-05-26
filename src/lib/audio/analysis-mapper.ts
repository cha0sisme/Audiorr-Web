/**
 * Mapper `AnalysisResult` (backend) → `SongAnalysis` (DJ algorithm).
 *
 * El backend Audiorr devuelve `AnalysisResult` (tipo en
 * `src/lib/types/analysis.ts`) con un schema permisivo (passthrough +
 * nullable). El `SongAnalysis` que consume `calculateCrossfadeConfig`
 * exige campos completos con defaults razonables.
 *
 * Estrategia: rellenar lo que el backend expone, dejar los demás en
 * defaults de `SONG_ANALYSIS_DEFAULT` (BPM=120, energy=0.5, etc.). Los
 * campos que el backend aún NO expone en web (downbeats musicales,
 * meter, lastVocalTime, hasOutroVocals, genres, subBass RMS) quedan en
 * sus defaults — el decisor cae a heurísticas seguras cuando faltan.
 *
 * Cuando el schema web del backend evolucione para exponer esos campos,
 * ampliamos este mapper sin tocar el decisor.
 */

import type { SongAnalysis } from './dj-types';
import { SONG_ANALYSIS_DEFAULT } from './dj-types';
import type { AnalysisResult } from '$types/analysis';

/**
 * Convierte una `AnalysisResult` del backend en un `SongAnalysis`
 * consumible por `calculateCrossfadeConfig`. La duración del archivo se
 * pasa aparte porque no viene en el `AnalysisResult` (la conoce el
 * player desde el `<audio>` element).
 *
 * Campos no presentes en `AnalysisResult` actual quedan en sus defaults
 * (ver `SONG_ANALYSIS_DEFAULT`). Lista incompleta deliberada — el
 * decisor maneja la ausencia con heurísticas:
 *   - `downbeatTimes` queda vacío → beat sync usa grid snap.
 *   - `realDownbeats` queda vacío → snap bassKill cae al rampStart raw.
 *   - `hasOutroVocals` / `hasIntroVocals` = false → detect* cae a
 *     fallback de speech segments.
 *   - `genres` vacío → high-shelf cut no se cancela por género.
 *   - `subBassIntroRms` / `subBassOutroRms` undefined → no afectan
 *     decisiones actuales del decisor portado.
 */
export function analysisResultToSongAnalysis(
  result: AnalysisResult,
  duration: number
): SongAnalysis {
  const diagnostics = result.diagnostics;
  const fadeInfo = diagnostics?.fadeInfo;
  const energyProfile = fadeInfo?.energyProfile;

  // outroStartTime: prefer finalOutroStartTime (diagnostics), else
  // top-level outroStartTime.
  const outroStartTime =
    diagnostics?.finalOutroStartTime ??
    result.outroStartTime ??
    SONG_ANALYSIS_DEFAULT.outroStartTime;

  // introEndTime: prefer top-level, else diagnostics.
  const introEndTime =
    result.introEndTime ??
    diagnostics?.introEndTime ??
    SONG_ANALYSIS_DEFAULT.introEndTime;

  // chorusStartTime: derive from analysisLog.lastChorusEnd if available.
  const chorusStructure = diagnostics?.analysisLog?.lastChorusEnd?.chorusStructure;
  const chorusStartTime =
    chorusStructure && chorusStructure.length > 0
      ? (chorusStructure[0]?.startTime ?? SONG_ANALYSIS_DEFAULT.chorusStartTime)
      : SONG_ANALYSIS_DEFAULT.chorusStartTime;

  // lastVocalTime: prefer instrumentalOutro.lastVocalTimeCandidate.
  const lastVocalTimeCandidate =
    diagnostics?.analysisLog?.instrumentalOutro?.lastVocalTimeCandidate;
  const lastVocalTime =
    lastVocalTimeCandidate ?? SONG_ANALYSIS_DEFAULT.lastVocalTime;
  const hasVocalEndData = lastVocalTimeCandidate !== null && lastVocalTimeCandidate !== undefined;

  const speechSegments = result.speechSegments ?? [];

  const energy = result.energy ?? SONG_ANALYSIS_DEFAULT.energy;
  const energyIntro =
    energyProfile?.intro ?? SONG_ANALYSIS_DEFAULT.energyIntro;
  const energyMain = energyProfile?.main ?? SONG_ANALYSIS_DEFAULT.energyMain;
  const energyOutro =
    energyProfile?.outro ?? SONG_ANALYSIS_DEFAULT.energyOutro;
  const hasEnergyProfile = energyProfile !== null && energyProfile !== undefined;

  const hasIntroVocals = energyProfile?.introVocals ?? false;
  const hasOutroVocals = energyProfile?.outroVocals ?? false;
  // hasVocalData when we have any vocal-related signal from the backend.
  const hasVocalData =
    speechSegments.length > 0 ||
    hasVocalEndData ||
    energyProfile?.introVocals !== undefined ||
    energyProfile?.outroVocals !== undefined ||
    result.vocalStartTime !== undefined;

  const bpmConfidence = result.bpmConfidence ?? SONG_ANALYSIS_DEFAULT.bpmConfidence;
  const hasBpmConfidence =
    result.bpmConfidence !== null && result.bpmConfidence !== undefined;

  const base: SongAnalysis = {
    ...SONG_ANALYSIS_DEFAULT,
    bpm: result.bpm ?? SONG_ANALYSIS_DEFAULT.bpm,
    beatInterval: result.beatInterval ?? SONG_ANALYSIS_DEFAULT.beatInterval,
    energy,
    danceability: result.danceability ?? SONG_ANALYSIS_DEFAULT.danceability,
    outroStartTime,
    introEndTime,
    chorusStartTime,
    downbeatTimes: result.beats ?? [],
    speechSegments,
    hasOutroData: outroStartTime > 0,
    hasIntroData: introEndTime > 0,
    energyIntro,
    energyMain,
    energyOutro,
    hasEnergyProfile,
    hasIntroVocals,
    hasOutroVocals,
    hasVocalData,
    lastVocalTime,
    hasVocalEndData,
    bpmConfidence,
    hasBpmConfidence,
    modelUsed: result.modelUsed ?? SONG_ANALYSIS_DEFAULT.modelUsed
  };

  // Optional fields — only attach when the backend provided a value
  // (exactOptionalPropertyTypes treats `?: number` distinctly from
  // `number | undefined`).
  const result_: Partial<SongAnalysis> = {};
  if (result.key !== null && result.key !== undefined) result_.key = result.key;
  if (result.vocalStartTime !== null && result.vocalStartTime !== undefined) {
    result_.vocalStartTime = result.vocalStartTime;
  }
  if (result.bpmEssentia !== null && result.bpmEssentia !== undefined) {
    result_.bpmEssentia = result.bpmEssentia;
  }
  if (
    result.introEndTimeHeuristic !== null &&
    result.introEndTimeHeuristic !== undefined
  ) {
    result_.introEndTimeHeuristic = result.introEndTimeHeuristic;
  }
  if (
    result.outroStartTimeHeuristic !== null &&
    result.outroStartTimeHeuristic !== undefined
  ) {
    result_.outroStartTimeHeuristic = result.outroStartTimeHeuristic;
  }
  if (energyProfile?.introSlope !== null && energyProfile?.introSlope !== undefined) {
    result_.introSlope = energyProfile.introSlope;
  }
  if (energyProfile?.outroSlope !== null && energyProfile?.outroSlope !== undefined) {
    result_.outroSlope = energyProfile.outroSlope;
  }
  if (result.rmsTailCurve !== null && result.rmsTailCurve !== undefined) {
    result_.rmsTailCurve = result.rmsTailCurve;
  }
  if (result.rmsCurve !== null && result.rmsCurve !== undefined) {
    result_.rmsCurve = result.rmsCurve;
  }
  if (result.percussiveCurve !== null && result.percussiveCurve !== undefined) {
    result_.percussiveCurve = result.percussiveCurve;
  }
  if (fadeInfo?.fadeInDuration !== null && fadeInfo?.fadeInDuration !== undefined) {
    result_.backendFadeInDuration = fadeInfo.fadeInDuration;
  }
  if (fadeInfo?.fadeOutDuration !== null && fadeInfo?.fadeOutDuration !== undefined) {
    result_.backendFadeOutDuration = fadeInfo.fadeOutDuration;
  }
  if (fadeInfo?.fadeOutLeadTime !== null && fadeInfo?.fadeOutLeadTime !== undefined) {
    result_.backendFadeOutLeadTime = fadeInfo.fadeOutLeadTime;
  }
  if (fadeInfo?.cuePoint !== null && fadeInfo?.cuePoint !== undefined) {
    result_.cuePoint = fadeInfo.cuePoint;
    result_.hasCuePoint = true;
  }

  // Suppress `duration` unused warning — kept in the signature for
  // future use (e.g. clamping pre-mapper times to file length).
  void duration;
  return { ...base, ...result_ };
}
