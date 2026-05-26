/**
 * Filter automation — runtime coefficient computation for the 4-stage
 * biquad worklet on A and B.
 *
 * Port de `applyFiltersA` / `applyFiltersB` en iOS
 * `CrossfadeExecutor.swift` v15.m:2479-3118. **Incluido tras Fase 2C-3b**:
 *   - Branch principal: sweep base por banda con expInterp (freq) +
 *     linInterp (gain) + pivot al 40%.
 *   - bassKill cosSquared ramp (lowshelf A/B).
 *   - dynamicQ Gaussian bell sweep en highpass A/B.
 *   - Phaser notch sweep en B band 2 (parametric con freq exp +
 *     gain bell, con re-map [0.5, 1.0] en anticipation).
 *   - Pre-roll bands 0-3 con cascade staggering 150/300 ms — ventana
 *     [preRollStart, filterStartTime] donde las bandas ya curvan desde
 *     su initial state. Band 0 constante en startFreq (≥60 Hz) o sweep
 *     20→startFreq (gentle). Bands 1/2/3 con rampStart efectivo
 *     adelantado a preRollStart (+ cascade offsets) para continuidad
 *     C0 con el branch principal.
 *
 * **No incluido todavía**:
 *   - Stutter cut runtime gate.
 *   - Anticipation extension v15.d (bassKill arranca en anticipationStart).
 *   - snappedRampStart al downbeat en bassKill (cap 1 bar).
 *
 * CLEAN_HANDOFF / VINYL_STOP / SEQUENTIAL → todas las bandas en
 * passthrough (filtros bypassed). CUT family rebasea rampStart al
 * sub-intervalo `[cutStart, transitionEnd]`.
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
  /** Instant low-frequency cut at bassSwapTime — replaces the normal
      lowshelf ramp with a cosSquared 0→-16dB curve on A, and a hold +
      cosSquared startGain→endGain on B (split at bassSwapTime). */
  readonly useBassKill: boolean;
  /** Bell-shaped Q resonance sweep on the highpass — A bell center 0.55,
      B bell center 0.40 (B fires first → "knob handoff" perception). */
  readonly useDynamicQ: boolean;
  /** Phaser-style narrow parametric notch on B's band 2. Center sweeps
      `NOTCH_START_FREQ → NOTCH_END_FREQ` exponentially while depth
      follows a bell (`tailGain → peakGain → tailGain`). Rides alongside
      dynamicQ for the "DJ knob ride" feel. */
  readonly useNotchSweep: boolean;
};

// ============================================================================
// MARK: - bassKill + dynamicQ constants (DSPFilterManager.swift:341, 285-294)
// ============================================================================

/** bassKill target depth (dB). Mirrors `DSPFilterManager.bassKillTargetDepth`.
    −16 dB still marks the DJ "bass swap" gesture but avoids the snap that a
    deeper cut (−18 dB+) produces when A's outro carries a long tail. */
const BASS_KILL_TARGET_DEPTH = -16.0;

/** dynamicQ A bell center as a fraction of `[rampStart, rampEnd]`. */
const DYN_Q_BELL_CENTER_A = 0.55;
/** dynamicQ A bell width — narrower for full crossfades (0.30), wider for
    CUT-family local ramps (0.45) so the bell doesn't "blink" inside the
    compressed window. */
const DYN_Q_BELL_WIDTH_NORMAL = 0.30;
const DYN_Q_BELL_WIDTH_CUT = 0.45;
/** dynamicQ B bell center as a fraction of `[fadeInStart, fadeInEnd]`.
    Earlier than A's so B's resonance peak fires first → "knob handoff". */
const DYN_Q_BELL_CENTER_B = 0.40;
const DYN_Q_BELL_WIDTH_B = 0.30;
/** Peak Q reached at bell center. */
const DYN_Q_PEAK_Q = 3.5;
/** Hard ceiling — biquad self-oscillates above ~5.0. */
const DYN_Q_MAX_Q = 4.0;

/** Phaser notch sweep tuning (CrossfadeExecutor.swift:410-423). */
const NOTCH_START_FREQ = 250;
const NOTCH_END_FREQ = 6000;
/** Bandwidth in octaves — narrower = more "phasey". */
const NOTCH_BANDWIDTH = 0.3;
const NOTCH_TAIL_GAIN = -6;
const NOTCH_PEAK_GAIN = -24;
const NOTCH_BELL_CENTER = 0.50;
const NOTCH_BELL_WIDTH = 0.30;

function gaussianBell(progress: number, center: number, width: number): number {
  const exponent = (-Math.pow((progress - center) / width, 2)) / 2.0;
  return Math.exp(Math.max(-10, exponent));
}

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

  // ── No-overlap types: A and B never share air (or 50ms in SEQUENTIAL).
  //    Spectral shaping has no purpose — bypass entirely (also blocks
  //    pre-roll from firing).
  if (
    config.transitionType === 'CLEAN_HANDOFF' ||
    config.transitionType === 'VINYL_STOP' ||
    config.transitionType === 'SEQUENTIAL'
  ) {
    return FILTERS_NOT_SET;
  }

  const isCutFamily =
    config.transitionType === 'CUT' || config.transitionType === 'CUT_A_FADE_IN_B';

  // ── Pre-roll: short window [preRollStart, filterStartTime] where the
  //    bands curve from initial state toward their target so the main
  //    branch doesn't enter "filter from nowhere" at filterStartTime.
  //
  //    preRollDur cap 0.9 s with ratio 0.35, gated by filterLead ≥ 0.6 s.
  //    Not active for CUT family (filter window is too compressed),
  //    no-overlap types (already returned above), or energy-down
  //    (lowpass at 20 Hz would silence the whole audible band — the
  //    sweep semantics are inverted).
  const preRollDur = Math.min(0.9, timings.filterLead * 0.35);
  const preRollActive =
    !isCutFamily && !useLowpassA && preRollDur > 0 && timings.filterLead >= 0.6;
  const preRollStart = timings.filterStartTime - preRollDur;

  // Cascade staggering: bands 2/3 (midScoop, highShelf) start their
  // ramps 150 ms / 300 ms after preRollStart when preRollDur ≥ 0.6 s.
  // Reproduces the typical DJ cascade (HPF/bassKill first, mid-scoop
  // next, hi-shelf last) instead of a simultaneous block.
  const cascadeOffsetMidScoop = preRollDur >= 0.6 ? 0.150 : 0;
  const cascadeOffsetHighShelf = preRollDur >= 0.6 ? 0.300 : 0;
  const midScoopRampStartOverride =
    preRollActive && useMidScoop ? preRollStart + cascadeOffsetMidScoop : undefined;
  const highShelfRampStartOverride =
    preRollActive && useHighShelfCut ? preRollStart + cascadeOffsetHighShelf : undefined;
  // bassKill A rampStart adelantado a preRollStart cuando preRollActive
  // y useBassKill. Sin el override, la cosSquared 0→-16 dB arrancaría
  // en filterStartTime y el bassKill se percibiría como "de repente"
  // — el override hace que band 1 vaya perdiendo graves suavemente
  // desde el inicio del pre-roll.
  const bassKillRampStartOverride =
    preRollActive && ctx.useBassKill ? preRollStart : undefined;

  // ── CUT family special handling (computed before pre-roll branch
  //    because pre-roll is gated by `!isCutFamily`) ──
  let rampStart = timings.filterStartTime;
  const rampEnd = timings.transitionEndTime;
  if (isCutFamily) {
    if (config.fadeDuration < 5.0) return FILTERS_NOT_SET;
    const volDuration = timings.transitionEndTime - timings.volumeFadeStartTime;
    const cutCap = config.danceability < 0.5 ? 4.0 : 3.0;
    const cutDuration = Math.min(cutCap, volDuration);
    const cutStart = timings.transitionEndTime - cutDuration;
    if (t < cutStart) return FILTERS_NOT_SET;
    rampStart = cutStart;
  } else if (t < timings.filterStartTime) {
    // Pre-roll window OR pre-pre-roll (no filters yet).
    if (preRollActive && t >= preRollStart) {
      return applyPreRollA(t, ctx, {
        preRollStart,
        preRollDur,
        midScoopRampStartOverride,
        highShelfRampStartOverride,
        bassKillRampStartOverride
      });
    }
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
    // dynamicQ Gaussian bell: bell peaks at center 0.55 of the ramp
    // window (CUT widens the bell to 0.45 so it doesn't blink). The bell
    // adds (peakQ − baseQ) at the peak, capped at DYN_Q_MAX_Q.
    let qValue = hp.q;
    if (ctx.useDynamicQ && totalFilterDur > 0) {
      const qProgress = (t - rampStart) / totalFilterDur;
      const isCutLocalRamp =
        config.transitionType === 'CUT' || config.transitionType === 'CUT_A_FADE_IN_B';
      const bellWidth = isCutLocalRamp ? DYN_Q_BELL_WIDTH_CUT : DYN_Q_BELL_WIDTH_NORMAL;
      const bellValue = gaussianBell(qProgress, DYN_Q_BELL_CENTER_A, bellWidth);
      qValue = Math.min(DYN_Q_MAX_Q, hp.q + (DYN_Q_PEAK_Q - hp.q) * bellValue);
    }
    band0A = calcHighpass(freq, qValue, sampleRate);
  }

  // ── Band 1: lowshelf bass swap (with optional bassKill) ──
  let band1A: BiquadCoefficients = PASSTHROUGH;
  if (useBassManagement && preset.lowshelfA) {
    const ls = preset.lowshelfA;
    let gain: number;
    if (ctx.useBassKill) {
      // cosSquared 0 → BASS_KILL_TARGET_DEPTH over the bass-kill ramp.
      // When pre-roll is active, rampStart is adelantado a preRollStart
      // para continuidad numérica con el branch pre-roll (misma fórmula
      // se evalúa allí — sin discontinuidad en filterStartTime).
      const bkRampStart = bassKillRampStartOverride ?? rampStart;
      const totalDur = rampEnd - bkRampStart;
      if (totalDur > 0) {
        const p = Math.min(1, Math.max(0, (t - bkRampStart) / totalDur));
        const angle = (p * Math.PI) / 2;
        const sinSq = Math.sin(angle) * Math.sin(angle);
        gain = sinSq * BASS_KILL_TARGET_DEPTH;
      } else {
        gain = 0;
      }
    } else if (t < effectiveBassSwapTime) {
      // Normal pre-bass-swap: start → mid.
      const dur = effectiveBassSwapTime - rampStart;
      const p = dur > 0 ? (t - rampStart) / dur : 1.0;
      gain = linInterp(ls.startGain, ls.midGain, p);
    } else {
      // Normal post-bass-swap: mid → end.
      const dur = rampEnd - effectiveBassSwapTime;
      const p = dur > 0 ? (t - effectiveBassSwapTime) / dur : 1.0;
      gain = linInterp(ls.midGain, ls.endGain, p);
    }
    band1A = calcLowShelf(ls.frequency, gain, 1.0, sampleRate);
  }

  // ── Band 2: midScoop A (parametric notch ~1.5 kHz) ──
  // Cuando pre-roll activo, rampStart efectivo se adelanta a
  // preRollStart + cascadeOffsetMidScoop (150 ms post-preRollStart si
  // preRollDur ≥ 0.6) para continuidad con el branch pre-roll.
  let band2A: BiquadCoefficients = PASSTHROUGH;
  if (useMidScoop && preset.midScoopA) {
    const ms = preset.midScoopA;
    const msRampStart = midScoopRampStartOverride ?? rampStart;
    const msTotalDur = rampEnd - msRampStart;
    const msPivot = msRampStart + msTotalDur * 0.40;
    const holdTarget = ms.startGain + (ms.endGain - ms.startGain) * 0.35;
    let gain: number;
    if (t < msPivot) {
      const denom = msPivot - msRampStart;
      const p = denom > 0 ? (t - msRampStart) / denom : 1.0;
      gain = linInterp(ms.startGain, holdTarget, p);
    } else {
      const denom = rampEnd - msPivot;
      const p = denom > 0 ? (t - msPivot) / denom : 1.0;
      gain = linInterp(holdTarget, ms.endGain, p);
    }
    band2A = calcPeaking(ms.frequency, gain, ms.bandwidth, sampleRate);
  }

  // ── Band 3: highShelf A (cut ~7 kHz) ──
  // Cuando pre-roll activo, rampStart efectivo se adelanta a
  // preRollStart + cascadeOffsetHighShelf (300 ms post-preRollStart).
  let band3A: BiquadCoefficients = PASSTHROUGH;
  if (useHighShelfCut && preset.highShelfA) {
    const hs = preset.highShelfA;
    const hsRampStart = highShelfRampStartOverride ?? rampStart;
    const hsTotalDur = rampEnd - hsRampStart;
    const hsPivot = hsRampStart + hsTotalDur * 0.40;
    const holdTarget = hs.startGain + (hs.endGain - hs.startGain) * 0.35;
    let gain: number;
    if (t < hsPivot) {
      const denom = hsPivot - hsRampStart;
      const p = denom > 0 ? (t - hsRampStart) / denom : 1.0;
      gain = linInterp(hs.startGain, holdTarget, p);
    } else {
      const denom = rampEnd - hsPivot;
      const p = denom > 0 ? (t - hsPivot) / denom : 1.0;
      gain = linInterp(holdTarget, hs.endGain, p);
    }
    band3A = calcHighShelf(hs.frequency, gain, 1.0, sampleRate);
  }

  return { set: true, stages: [band0A, band1A, band2A, band3A] };
}

/**
 * Pre-roll branch — short window [preRollStart, filterStartTime] where
 * each band curves from its initial state toward its target so the main
 * branch doesn't snap at filterStartTime. Mirrors iOS:2640-2755.
 *
 * Band 0: constant at `startFreq` when `startFreq > 60` (avoids the
 * 20 → startFreq sweep that puts band 0 into infrasonic territory mid
 * pre-roll). Gentle path: sweep 20 → startFreq (startFreq = 60 Hz, the
 * sweep is perceptually irrelevant anyway).
 *
 * Band 1: bassKill cosSquared with `rampStart = preRollStart` (extended)
 * OR initial-state lowshelf at `startGain` (no bassKill).
 *
 * Bands 2/3: linInterp from `startGain` toward `holdTarget` (35% of the
 * range) over the first 40% of their extended ramp. Cascade staggering
 * 150 ms / 300 ms shifts band 2/3 ramp starts later than band 0/1.
 */
function applyPreRollA(
  t: number,
  ctx: FilterAutomationContext,
  args: {
    preRollStart: number;
    preRollDur: number;
    midScoopRampStartOverride: number | undefined;
    highShelfRampStartOverride: number | undefined;
    bassKillRampStartOverride: number | undefined;
  }
): FilterStages {
  const { preset, sampleRate, useBassManagement, useMidScoop, useHighShelfCut, timings } = ctx;
  const {
    preRollStart,
    preRollDur,
    midScoopRampStartOverride,
    highShelfRampStartOverride,
    bassKillRampStartOverride
  } = args;
  const rampEnd = timings.transitionEndTime;
  const p = (t - preRollStart) / preRollDur;

  // ── Band 0: highpass constante en startFreq cuando > 60 Hz ──
  // El sweep "20 → startFreq" dejaba band 0 en infrasonido durante ~300
  // ms del pre-roll (la zona audible 80-200 Hz se cruzaba en <200 ms,
  // audible como step espectral). Para presets audibles (anticipation
  // 600, normal 400, aggressive 600, dropMix 600, stemMix 200) band 0 =
  // highpass(startFreq) constante. Gentle (startFreq = 60) cae al else
  // con sweep 20→60 perceptualmente irrelevante.
  const hp = preset.highpassA;
  let freqA: number;
  if (hp.startFreq > 60) {
    freqA = hp.startFreq;
  } else {
    const pAdj = p < 0.15 ? p * (p / 0.15) : p;
    freqA = expInterp(20.0, hp.startFreq, Math.min(1, pAdj));
  }
  const band0A = calcHighpass(freqA, hp.q, sampleRate);

  // ── Band 1: bassKill cosSquared con rampStart adelantado, o initial ──
  let band1A: BiquadCoefficients = PASSTHROUGH;
  if (useBassManagement && preset.lowshelfA) {
    const ls = preset.lowshelfA;
    if (ctx.useBassKill && bassKillRampStartOverride !== undefined) {
      const totalDur = rampEnd - bassKillRampStartOverride;
      if (totalDur > 0) {
        const bkP = Math.min(1, Math.max(0, (t - bassKillRampStartOverride) / totalDur));
        const angle = (bkP * Math.PI) / 2;
        const sinSq = Math.sin(angle) * Math.sin(angle);
        const gain = sinSq * BASS_KILL_TARGET_DEPTH;
        band1A = calcLowShelf(ls.frequency, gain, 1.0, sampleRate);
      }
    } else {
      // Initial: lowshelf at startGain. Coefs estables = setupInitialEQ
      // (no salto numérico cuando startGain != 0).
      band1A = calcLowShelf(ls.frequency, ls.startGain, 1.0, sampleRate);
    }
  }

  // ── Band 2: midScoop ramping startGain → holdTarget sobre 40% de su
  //    rampa extendida.
  let band2A: BiquadCoefficients = PASSTHROUGH;
  if (useMidScoop && preset.midScoopA && midScoopRampStartOverride !== undefined) {
    const ms = preset.midScoopA;
    const msTotalDur = rampEnd - midScoopRampStartOverride;
    const msPivot = midScoopRampStartOverride + msTotalDur * 0.40;
    const holdTarget = ms.startGain + (ms.endGain - ms.startGain) * 0.35;
    let gain = ms.startGain;
    if (t < msPivot && msPivot > midScoopRampStartOverride) {
      const denom = msPivot - midScoopRampStartOverride;
      const pp = Math.min(1, Math.max(0, (t - midScoopRampStartOverride) / denom));
      gain = linInterp(ms.startGain, holdTarget, pp);
    }
    band2A = calcPeaking(ms.frequency, gain, ms.bandwidth, sampleRate);
  }

  // ── Band 3: highShelf simétrico a band 2 ──
  let band3A: BiquadCoefficients = PASSTHROUGH;
  if (useHighShelfCut && preset.highShelfA && highShelfRampStartOverride !== undefined) {
    const hs = preset.highShelfA;
    const hsTotalDur = rampEnd - highShelfRampStartOverride;
    const hsPivot = highShelfRampStartOverride + hsTotalDur * 0.40;
    const holdTarget = hs.startGain + (hs.endGain - hs.startGain) * 0.35;
    let gain = hs.startGain;
    if (t < hsPivot && hsPivot > highShelfRampStartOverride) {
      const denom = hsPivot - highShelfRampStartOverride;
      const pp = Math.min(1, Math.max(0, (t - highShelfRampStartOverride) / denom));
      gain = linInterp(hs.startGain, holdTarget, pp);
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
      if (ctx.useBassKill) {
        // bassKill B: hold startGain until bassSwapTime, then cosSquared
        // startGain → endGain on [bassSwapTime, fadeInEndTime]. Symmetric
        // to bassKill A — both run cosSquared on the same window so the
        // perceived bass swap is smooth (no pile-up with A's −16 dB).
        if (t < bassSwapTime) {
          lsGain = preset.lowshelfB.startGain;
        } else {
          const bkDur = timings.fadeInEndTime - bassSwapTime;
          if (bkDur > 0) {
            const bkP = Math.min(1, Math.max(0, (t - bassSwapTime) / bkDur));
            const angle = (bkP * Math.PI) / 2;
            const sinSq = Math.sin(angle) * Math.sin(angle);
            lsGain =
              preset.lowshelfB.startGain +
              (preset.lowshelfB.endGain - preset.lowshelfB.startGain) * sinSq;
          } else {
            lsGain = preset.lowshelfB.endGain;
          }
        }
      } else {
        // Normal lowshelf swap completes at bassSwapTime (linear).
        const bassDur = bassSwapTime - timings.fadeInStartTime;
        const bassP =
          bassDur > 0 ? Math.min(1, (t - timings.fadeInStartTime) / bassDur) : 1.0;
        lsGain = linInterp(preset.lowshelfB.startGain, preset.lowshelfB.endGain, bassP);
      }
    } else {
      lsGain = linInterp(preset.lowshelfB.startGain, preset.lowshelfB.endGain, p);
    }
  }

  // dynamicQ B Gaussian bell (center 0.40, B fires first to "hand off"
  // the resonance to A). Anchored to B's own window so it's independent
  // of A's filterLead. Disabled in anticipation to preserve that path's
  // multi-stage shape.
  let qBValue = preset.highpassB.q;
  if (ctx.useDynamicQ && !config.needsAnticipation) {
    const bWindowDur = timings.fadeInEndTime - timings.fadeInStartTime;
    if (bWindowDur > 0) {
      const qProgress = (t - timings.fadeInStartTime) / bWindowDur;
      const qProgressClamped = Math.min(1, Math.max(0, qProgress));
      const bellValue = gaussianBell(qProgressClamped, DYN_Q_BELL_CENTER_B, DYN_Q_BELL_WIDTH_B);
      qBValue = Math.min(
        DYN_Q_MAX_Q,
        preset.highpassB.q + (DYN_Q_PEAK_Q - preset.highpassB.q) * bellValue
      );
    }
  }

  const band0B = calcHighpass(hpFreq, qBValue, sampleRate);
  const band1B = calcLowShelf(preset.lowshelfB.frequency, lsGain, 1.0, sampleRate);

  // ── Band 2: Phaser notch sweep ──
  // Narrow parametric (BW ≈ 0.3 oct) whose center frequency sweeps
  // exponentially 250 → 6000 Hz over B's window, while depth follows a
  // Gaussian bell (-6 → -24 → -6 dB). Sounds like a static phaser
  // "riding through" B. With anticipation: re-map [0.5, 1.0] → [0.0, 1.0]
  // so the active sweep waits for the second half of B's window (the
  // first half is already busy with the multi-stage highpass curve).
  let band2B: BiquadCoefficients = PASSTHROUGH;
  if (ctx.useNotchSweep) {
    const bWindowDur = timings.fadeInEndTime - timings.fadeInStartTime;
    if (bWindowDur > 0) {
      const notchProgress = (t - timings.fadeInStartTime) / bWindowDur;
      const notchProgressEffective = config.needsAnticipation
        ? Math.max(0, (notchProgress - 0.5) * 2.0)
        : notchProgress;
      const p = Math.min(1, Math.max(0, notchProgressEffective));
      const notchFreq = expInterp(NOTCH_START_FREQ, NOTCH_END_FREQ, p);
      const bellValue = gaussianBell(p, NOTCH_BELL_CENTER, NOTCH_BELL_WIDTH);
      const notchGain = NOTCH_TAIL_GAIN + (NOTCH_PEAK_GAIN - NOTCH_TAIL_GAIN) * bellValue;
      band2B = calcPeaking(notchFreq, notchGain, NOTCH_BANDWIDTH, sampleRate);
    }
  }

  // Band 3 stays passthrough on B — no high-shelf cut runs on B.
  return { set: true, stages: [band0B, band1B, band2B, PASSTHROUGH] };
}
