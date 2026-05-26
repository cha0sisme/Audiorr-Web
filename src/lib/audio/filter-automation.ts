/**
 * Filter automation — runtime coefficient computation for the 4-stage
 * biquad worklet on A and B.
 *
 * Port MVP de `applyFiltersA` / `applyFiltersB` en iOS
 * `CrossfadeExecutor.swift` v15.m:2479-3118. **No incluye** (van en
 * iteraciones sucesivas):
 *   - Pre-roll bands 0-3 con cascade staggering 150/300 ms.
 *   - bassKill cosSquared ramp (lowshelf A/B).
 *   - dynamicQ Gaussian bell sweep en highpass A/B.
 *   - Phaser notch sweep en B band 2.
 *   - Stutter cut runtime gate.
 *   - Anticipation extension v15.d.
 *
 * Branch principal preservado: sweep base de cada banda con expInterp
 * (frecuencias, log-uniforme) + linInterp (gains dB) + pivot al 40% del
 * filter window. CLEAN_HANDOFF / VINYL_STOP / SEQUENTIAL → todas las
 * bandas en passthrough (filtros bypassed). CUT family rebasea rampStart
 * al sub-intervalo `[cutStart, transitionEnd]`.
 *
 * Mapeo bands → stages worklet:
 *   - stage 0: highpass A (o lowpass A en energy-down).
 *   - stage 1: lowshelf A (bass swap).
 *   - stage 2: midScoop A (parametric dip ~1.5 kHz).
 *   - stage 3: highShelf A (cut ~7 kHz).
 *
 *   - B: stage 0 highpass, stage 1 lowshelf, stage 2 passthrough (notch
 *     sweep diferido), stage 3 passthrough.
 */

import {
  calcHighpass,
  calcHighShelf,
  calcLowpass,
  calcLowShelf,
  calcPeaking,
  PASSTHROUGH,
  type BiquadCoefficients
} from './BiquadCoefficients';
import type { Timings, FilterPreset } from './crossfade-types';
import type { CrossfadeResult } from './dj-types';

// ============================================================================
// MARK: - Interpolation helpers (CrossfadeExecutor.swift:3271-3279)
// ============================================================================

/** Linear interp `a → b` over `t ∈ [0, 1]` (clamped). */
export function linInterp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/**
 * Exponential interp `a → b` over `t ∈ [0, 1]` (clamped). Equivalent to
 * linear interp in log-space — used for frequency sweeps so the
 * perceptual rate is constant in octaves-per-second.
 */
export function expInterp(a: number, b: number, t: number): number {
  const safeA = Math.max(a, 0.001);
  const safeB = Math.max(b, 0.001);
  const clampedT = Math.min(1, Math.max(0, t));
  return safeA * Math.pow(safeB / safeA, clampedT);
}

// ============================================================================
// MARK: - Filter automation runtime context
// ============================================================================

export type FilterAutomationContext = {
  readonly config: CrossfadeResult;
  readonly timings: Timings;
  readonly preset: FilterPreset;
  readonly sampleRate: number;
  /** `true` when `lowshelfA` band should run (no danceability override). */
  readonly useBassManagement: boolean;
  /** Pre-computed by `computeBassSwapTime`. Time when the lowshelf gain
      mid-point fires. */
  readonly bassSwapTime: number;
  /** `true` when band 0 should run as lowpass (energy-down preset) instead
      of highpass. */
  readonly useLowpassA: boolean;
  readonly useMidScoop: boolean;
  readonly useHighShelfCut: boolean;
};

/**
 * Output of `applyFiltersA` / `applyFiltersB` — the 4 stages of biquad
 * coefficients in worklet order. The caller pipes this into
 * `audioEngine.setAllBiquadCoeffs(label, coeffs)`.
 *
 * `set` is `true` when the bands were computed (filters active at this
 * `t`); `false` when the function returned early (e.g. `t < filterStart`,
 * `SEQUENTIAL`, `skipBFilters`). In the false case the caller should NOT
 * write new coefficients — leave whatever the worklet currently runs.
 */
export type FilterStages = {
  readonly set: boolean;
  /** 4 stages in worklet order. Only meaningful when `set === true`. */
  readonly stages: readonly [
    BiquadCoefficients,
    BiquadCoefficients,
    BiquadCoefficients,
    BiquadCoefficients
  ];
};

const FILTERS_NOT_SET: FilterStages = {
  set: false,
  stages: [PASSTHROUGH, PASSTHROUGH, PASSTHROUGH, PASSTHROUGH]
};

// ============================================================================
// MARK: - applyFiltersA (CrossfadeExecutor.swift:2479)
// ============================================================================

/**
 * Compute the 4 biquad stages for A at wall-clock `t`. Mirrors the
 * branch principal de `CrossfadeExecutor.swift:2479 applyFiltersA`.
 *
 * Returns `set: false` when filters should NOT update at this `t`:
 *   - `t < filterStartTime` (before the filter window opens).
 *   - CLEAN_HANDOFF / VINYL_STOP / SEQUENTIAL (filters bypassed entirely).
 *   - CUT family + `fadeDuration < 5s` (the quick fade handles
 *     separation; filters skipped).
 *   - CUT family + `t < cutStart` (HOLD phase — A at 100%, no spectral
 *     sweep until A starts dropping).
 *
 * When `set: true`, the 4 stages are computed from the preset using a
 * 3-point sweep (start → mid @ pivot 40% → end) with expInterp for
 * frequencies and linInterp for gains.
 */
export function applyFiltersA(t: number, ctx: FilterAutomationContext): FilterStages {
  const {
    config,
    timings,
    preset,
    sampleRate,
    useBassManagement,
    bassSwapTime,
    useLowpassA,
    useMidScoop,
    useHighShelfCut
  } = ctx;

  // ── CUT family special handling ──
  // - fade < 5s: highpass ramp pointless (skip).
  // - fade >= 5s: skip during HOLD (t < cutStart) and rebase rampStart
  //   to cutStart so the sweep covers the actual drop window.
  let rampStart = timings.filterStartTime;
  const rampEnd = timings.transitionEndTime;
  if (
    config.transitionType === 'CUT' ||
    config.transitionType === 'CUT_A_FADE_IN_B'
  ) {
    if (config.fadeDuration < 5.0) return FILTERS_NOT_SET;
    const volDuration = timings.transitionEndTime - timings.volumeFadeStartTime;
    const cutCap = config.danceability < 0.5 ? 4.0 : 3.0;
    const cutDuration = Math.min(cutCap, volDuration);
    const cutStart = timings.transitionEndTime - cutDuration;
    if (t < cutStart) return FILTERS_NOT_SET;
    rampStart = cutStart;
  } else if (t < timings.filterStartTime) {
    return FILTERS_NOT_SET;
  }

  // ── No-overlap types: A and B never share air (or 50ms in SEQUENTIAL).
  //    Spectral shaping has no purpose — bypass entirely.
  if (
    config.transitionType === 'CLEAN_HANDOFF' ||
    config.transitionType === 'VINYL_STOP' ||
    config.transitionType === 'SEQUENTIAL'
  ) {
    return FILTERS_NOT_SET;
  }

  const totalFilterDur = rampEnd - rampStart;
  if (totalFilterDur <= 0) return FILTERS_NOT_SET;

  // Pivot at 40% — start→mid covers the first 40% (subtle low end),
  // mid→end covers the remaining 60% (audible high end). Audible portion
  // of the sweep lands while A is still loud enough to read it as DJ
  // technique, not "filter dump at the death".
  const pivotTime = rampStart + totalFilterDur * 0.40;
  // bassSwap target may fall before rampStart in CUT (computed against
  // volumeFadeStartTime, not the cut window). Clamp so band1's pre/post
  // split lands inside the active ramp.
  const effectiveBassSwapTime = Math.max(bassSwapTime, rampStart);

  // ── Band 0: highpass (or lowpass for energy-down) ──
  let band0A: BiquadCoefficients;
  if (useLowpassA && preset.lowpassA) {
    // Lowpass 2-point: start → end. Energy-down: A "fades away darkly".
    const lp = preset.lowpassA;
    const dur = rampEnd - rampStart;
    const p = dur > 0 ? (t - rampStart) / dur : 1.0;
    const freq = expInterp(lp.startFreq, lp.endFreq, p);
    band0A = calcLowpass(freq, lp.q, sampleRate);
  } else {
    // Highpass 3-point with pivot at 40%.
    const hp = preset.highpassA;
    let freq: number;
    if (t < pivotTime) {
      const dur = pivotTime - rampStart;
      const p = dur > 0 ? (t - rampStart) / dur : 1.0;
      freq = expInterp(hp.startFreq, hp.midFreq, p);
    } else {
      const dur = rampEnd - pivotTime;
      const p = dur > 0 ? (t - pivotTime) / dur : 1.0;
      freq = expInterp(hp.midFreq, hp.endFreq, p);
    }
    band0A = calcHighpass(freq, hp.q, sampleRate);
  }

  // ── Band 1: lowshelf bass swap (no bassKill in MVP) ──
  let band1A: BiquadCoefficients = PASSTHROUGH;
  if (useBassManagement && preset.lowshelfA) {
    const ls = preset.lowshelfA;
    let gain: number;
    if (t < effectiveBassSwapTime) {
      // Pre-bass-swap: start → mid.
      const dur = effectiveBassSwapTime - rampStart;
      const p = dur > 0 ? (t - rampStart) / dur : 1.0;
      gain = linInterp(ls.startGain, ls.midGain, p);
    } else {
      // Post-bass-swap: mid → end.
      const dur = rampEnd - effectiveBassSwapTime;
      const p = dur > 0 ? (t - effectiveBassSwapTime) / dur : 1.0;
      gain = linInterp(ls.midGain, ls.endGain, p);
    }
    band1A = calcLowShelf(ls.frequency, gain, 1.0, sampleRate);
  }

  // ── Band 2: midScoop A (parametric notch ~1.5 kHz) ──
  let band2A: BiquadCoefficients = PASSTHROUGH;
  if (useMidScoop && preset.midScoopA) {
    const ms = preset.midScoopA;
    const holdTarget = ms.startGain + (ms.endGain - ms.startGain) * 0.35;
    let gain: number;
    if (t < pivotTime) {
      const denom = pivotTime - rampStart;
      const p = denom > 0 ? (t - rampStart) / denom : 1.0;
      gain = linInterp(ms.startGain, holdTarget, p);
    } else {
      const denom = rampEnd - pivotTime;
      const p = denom > 0 ? (t - pivotTime) / denom : 1.0;
      gain = linInterp(holdTarget, ms.endGain, p);
    }
    band2A = calcPeaking(ms.frequency, gain, ms.bandwidth, sampleRate);
  }

  // ── Band 3: highShelf A (cut ~7 kHz) ──
  let band3A: BiquadCoefficients = PASSTHROUGH;
  if (useHighShelfCut && preset.highShelfA) {
    const hs = preset.highShelfA;
    const holdTarget = hs.startGain + (hs.endGain - hs.startGain) * 0.35;
    let gain: number;
    if (t < pivotTime) {
      const denom = pivotTime - rampStart;
      const p = denom > 0 ? (t - rampStart) / denom : 1.0;
      gain = linInterp(hs.startGain, holdTarget, p);
    } else {
      const denom = rampEnd - pivotTime;
      const p = denom > 0 ? (t - pivotTime) / denom : 1.0;
      gain = linInterp(holdTarget, hs.endGain, p);
    }
    band3A = calcHighShelf(hs.frequency, gain, 1.0, sampleRate);
  }

  return { set: true, stages: [band0A, band1A, band2A, band3A] };
}

// ============================================================================
// MARK: - applyFiltersB (CrossfadeExecutor.swift:2952)
// ============================================================================

/**
 * Compute the 4 biquad stages for B at wall-clock `t`. Mirrors el
 * branch principal de `CrossfadeExecutor.swift:2952 applyFiltersB`.
 *
 * Returns `set: false` when filters should NOT update at this `t`:
 *   - `config.skipBFilters` (DROP_MIX, CLEAN_HANDOFF, VINYL_STOP, short
 *     fades, etc. — caller already decided).
 *   - SEQUENTIAL (50 ms overlap, spectral shaping inaudible).
 *
 * Anticipation: 3-stage sweep (anticipationStart → filterStart →
 * fadeInStart → fadeInEnd) with intermediate `hpFreq → midFreq → 300 →
 * endFreq` and `lsGain start → mid → -4 → end`.
 *
 * No anticipation: single-stage sweep (fadeInStart → fadeInEnd).
 *
 * MVP excludes dynamicQ bell, phaser notch sweep, and bassKill cosSquared
 * — all default to passthrough or simple linear ramps.
 */
export function applyFiltersB(t: number, ctx: FilterAutomationContext): FilterStages {
  const { config, timings, preset, sampleRate, bassSwapTime, useBassManagement } = ctx;

  if (config.skipBFilters) return FILTERS_NOT_SET;
  if (config.transitionType === 'SEQUENTIAL') return FILTERS_NOT_SET;

  let hpFreq: number;
  let lsGain: number;

  if (config.needsAnticipation) {
    if (t < timings.filterStartTime) {
      // Stage 1: anticipationStart → filterStart.
      const dur = timings.filterStartTime - timings.anticipationStartTime;
      if (dur <= 0) return FILTERS_NOT_SET;
      const p = (t - timings.anticipationStartTime) / dur;
      hpFreq = expInterp(preset.highpassB.startFreq, preset.highpassB.midFreq, p);
      lsGain = linInterp(preset.lowshelfB.startGain, preset.lowshelfB.midGain, p);
    } else if (t < timings.fadeInStartTime) {
      // Stage 2: filterStart → fadeInStart (intermediate to 300 Hz / -4 dB).
      const dur = timings.fadeInStartTime - timings.filterStartTime;
      if (dur <= 0) return FILTERS_NOT_SET;
      const p = (t - timings.filterStartTime) / dur;
      hpFreq = expInterp(preset.highpassB.midFreq, 300, p);
      lsGain = linInterp(preset.lowshelfB.midGain, -4, p);
    } else if (t < timings.fadeInEndTime) {
      // Stage 3: fadeInStart → fadeInEnd.
      const dur = timings.fadeInEndTime - timings.fadeInStartTime;
      if (dur <= 0) return FILTERS_NOT_SET;
      const p = (t - timings.fadeInStartTime) / dur;
      hpFreq = expInterp(300, preset.highpassB.endFreq, p);
      lsGain = linInterp(-4, preset.lowshelfB.endGain, p);
    } else {
      // Past the fade — hold at endpoint.
      hpFreq = preset.highpassB.endFreq;
      lsGain = preset.lowshelfB.endGain;
    }
  } else {
    if (t < timings.fadeInStartTime) return FILTERS_NOT_SET;
    const dur = timings.fadeInEndTime - timings.fadeInStartTime;
    if (dur <= 0) return FILTERS_NOT_SET;
    const p = Math.min(1, (t - timings.fadeInStartTime) / dur);
    hpFreq = expInterp(preset.highpassB.startFreq, preset.highpassB.endFreq, p);
    if (useBassManagement) {
      // Lowshelf swap completes at bassSwapTime (linear up to that point).
      const bassDur = bassSwapTime - timings.fadeInStartTime;
      const bassP = bassDur > 0 ? Math.min(1, (t - timings.fadeInStartTime) / bassDur) : 1.0;
      lsGain = linInterp(preset.lowshelfB.startGain, preset.lowshelfB.endGain, bassP);
    } else {
      lsGain = linInterp(preset.lowshelfB.startGain, preset.lowshelfB.endGain, p);
    }
  }

  const band0B = calcHighpass(hpFreq, preset.highpassB.q, sampleRate);
  const band1B = calcLowShelf(preset.lowshelfB.frequency, lsGain, 1.0, sampleRate);
  // MVP: bands 2 (notch sweep) and 3 stay passthrough.
  return { set: true, stages: [band0B, band1B, PASSTHROUGH, PASSTHROUGH] };
}
