/**
 * CrossfadeExecutor — real-time crossfade state machine.
 *
 * Port of `ios/App/App/CrossfadeExecutor.swift` v15.m. Consumes the
 * `CrossfadeResult` produced by `calculateCrossfadeConfig` and drives the
 * audio graph (`AudioEngine.svelte.ts`): volume curves, EQ automation,
 * beat-aligned bass swap, time-stretch rate ramp.
 *
 * Phase 2A (this file, initial commit):
 *   - Filter presets (Normal, Aggressive, Anticipation, EnergyDown,
 *     Gentle, DropMix, StemMix).
 *   - `calculateTimings(config, now)` — wall-clock layout.
 *   - `selectPreset(config)` — preset chosen from transition type, energy
 *     flow, instrumental flags, useFilters, useAggressive.
 *   - `applyBCleanOverride(preset, config)` — relax highpassB / lowshelfB
 *     on instrumental intros (B-clean).
 *   - `computeEnergyCompensationB(config, maxVolumeB)` — boost B's
 *     volume slightly when B is much quieter than A.
 *   - `computeBassSwapTime(config, timings)` — target wall-clock time
 *     for the lowshelf bass swap.
 *   - `snappedRampStart(...)` — snap bass-kill rampStart to nearest real
 *     downbeat backwards (cap 1 bar).
 *
 * Phase 2B (next): `gainForPlayerA(t)` / `gainForPlayerB(t)` — the
 * volume curves (matemáticas puras).
 *
 * Phase 2C: `applyFiltersA(t)` / `applyFiltersB(t)` — coefficient updates
 * via `audioEngine.setBiquadCoeffs(chain, stage, coeffs)`.
 *
 * Phase 2D: state machine (`start`, `cancel`, `completeCrossfade`,
 * watchdogs) + automation thread (setInterval anchored to AudioContext).
 *
 * Phase 2E: time-stretch ramp (rateB cosSquared via
 * `<audio>.playbackRate`).
 *
 * Phase 2F: cableo en `AudioEngine.svelte.ts`.
 */

import type { CrossfadeResult } from './dj-types';
import type { FilterPreset, Timings } from './crossfade-types';

// ============================================================================
// MARK: - Filter presets (CrossfadeExecutor.swift:261-392)
// ============================================================================

/**
 * Standard preset: vocal mid-scoop @ 1.5kHz to −14dB, high-shelf cut
 * @ 7kHz to −10dB, bass swap A→B across the lowshelf.
 */
export const PRESET_NORMAL: FilterPreset = {
  highpassA: { startFreq: 400, midFreq: 4000, endFreq: 8000, q: 1.1 },
  highpassB: { startFreq: 400, midFreq: 200, endFreq: 60, q: 0.6 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -6, endGain: -14 },
  lowshelfB: { frequency: 200, startGain: -8, midGain: -4, endGain: 0 },
  lowpassA: undefined,
  midScoopA: { frequency: 1500, bandwidth: 1.2, startGain: 0, endGain: -14 },
  highShelfA: { frequency: 7000, startGain: 0, endGain: -10 }
};

/**
 * Aggressive preset: pulls A further into the upper mids (HPF endFreq
 * 5kHz vs 8kHz), deeper bass cut on both sides, stronger mid scoop.
 * Activated when filters detect clash + vocal overlap + dance + energy.
 */
export const PRESET_AGGRESSIVE: FilterPreset = {
  highpassA: { startFreq: 600, midFreq: 2500, endFreq: 5000, q: 1.2 },
  highpassB: { startFreq: 800, midFreq: 200, endFreq: 60, q: 0.6 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -10, endGain: -18 },
  lowshelfB: { frequency: 200, startGain: -12, midGain: -6, endGain: 0 },
  lowpassA: undefined,
  midScoopA: { frequency: 1500, bandwidth: 1.5, startGain: 0, endGain: -17 },
  highShelfA: { frequency: 7000, startGain: 0, endGain: -12 }
};

/**
 * Anticipation preset: chosen when `needsAnticipation`. B-side aligned
 * with Aggressive (carving B harder than Aggressive itself was
 * counter-productive — anticipation fires WITHOUT clash, so an extreme
 * carve creates a problem instead of resolving one). A-side keeps tense
 * lowshelf to build the perceptual lead-in.
 *
 *   - highpassA.q = 0.7 (Butterworth-ish, no resonance peak — earlier
 *     1.2 left a +1.6dB ear-tracked "metallic" color on the sweep tail).
 *   - lowshelfA.endGain = -12dB (was -16dB — too audible on full-volume
 *     A during the 2-4s anticipation window).
 */
export const PRESET_ANTICIPATION: FilterPreset = {
  highpassA: { startFreq: 600, midFreq: 2500, endFreq: 5000, q: 0.7 },
  highpassB: { startFreq: 800, midFreq: 200, endFreq: 60, q: 0.6 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -8, endGain: -12 },
  lowshelfB: { frequency: 200, startGain: -12, midGain: -6, endGain: 0 },
  lowpassA: undefined,
  midScoopA: { frequency: 1500, bandwidth: 1.5, startGain: 0, endGain: -15 },
  highShelfA: { frequency: 8000, startGain: 0, endGain: -10 }
};

/**
 * Energy-down preset: lowpass sweep on A (song "fades away" darkly).
 * highpassA bypassed effectively (40Hz, flat). Lighter mid scoop, no
 * hi-shelf (the lowpass already darkens).
 */
export const PRESET_ENERGY_DOWN: FilterPreset = {
  highpassA: { startFreq: 40, midFreq: 40, endFreq: 40, q: 0.7 },
  highpassB: { startFreq: 400, midFreq: 200, endFreq: 60, q: 0.6 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -4, endGain: -10 },
  lowshelfB: { frequency: 200, startGain: -8, midGain: -4, endGain: 0 },
  lowpassA: { startFreq: 20000, endFreq: 800, q: 1.0 },
  midScoopA: { frequency: 1500, bandwidth: 1.0, startGain: 0, endGain: -8 },
  highShelfA: undefined
};

/**
 * Gentle preset: smooth NATURAL_BLEND transitions with subtle real
 * spectral separation. Q stays at 0.5 (no resonance) so the filtering
 * sounds colorless — never "DJ-y", just clean.
 */
export const PRESET_GENTLE: FilterPreset = {
  highpassA: { startFreq: 60, midFreq: 200, endFreq: 500, q: 0.5 },
  highpassB: { startFreq: 250, midFreq: 150, endFreq: 40, q: 0.5 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -4, endGain: -10 },
  lowshelfB: { frequency: 200, startGain: -8, midGain: -4, endGain: 0 },
  lowpassA: undefined,
  midScoopA: { frequency: 1500, bandwidth: 1.0, startGain: 0, endGain: -10 },
  highShelfA: { frequency: 8000, startGain: 0, endGain: -4 }
};

/**
 * Drop-mix preset: aggressive HPF ramp on A pulling it out fast, B
 * enters clean. A sweeps 600 → 2500Hz (was 6000Hz — turned A into
 * walkie-talkie on the tail).
 */
export const PRESET_DROP_MIX: FilterPreset = {
  highpassA: { startFreq: 600, midFreq: 1500, endFreq: 2500, q: 1.3 },
  highpassB: { startFreq: 200, midFreq: 100, endFreq: 40, q: 0.5 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -14, endGain: -22 },
  lowshelfB: { frequency: 200, startGain: -10, midGain: -5, endGain: 0 },
  lowpassA: undefined,
  midScoopA: { frequency: 1500, bandwidth: 1.5, startGain: 0, endGain: -14 },
  highShelfA: { frequency: 8000, startGain: 0, endGain: -10 }
};

/**
 * Stem-mix preset: B enters filtered to vocals/mids only, A stays full
 * then exits via highpass. Simulates DJ stem mixing without real stem
 * separation.
 */
export const PRESET_STEM_MIX: FilterPreset = {
  highpassA: { startFreq: 200, midFreq: 1500, endFreq: 6000, q: 1.0 },
  highpassB: { startFreq: 300, midFreq: 200, endFreq: 40, q: 0.5 },
  lowshelfA: { frequency: 200, startGain: 0, midGain: -12, endGain: -20 },
  lowshelfB: { frequency: 200, startGain: -18, midGain: -12, endGain: 0 },
  lowpassA: undefined,
  midScoopA: { frequency: 1500, bandwidth: 1.5, startGain: 0, endGain: -14 },
  highShelfA: { frequency: 8000, startGain: 0, endGain: -10 }
};

// ============================================================================
// MARK: - Preset selection (CrossfadeExecutor.swift:566-635)
// ============================================================================

export type PresetSelection = {
  readonly preset: FilterPreset;
  readonly name: string;
};

/**
 * Pick a filter preset from the config. Mirrors the init-time selection
 * in `CrossfadeExecutor.swift:566-635`.
 *
 * Priority order:
 *   1. Type-specific (dropMix / stemMix / naturalBlend / cleanHandoff /
 *      vinylStop / sequential → gentle stub).
 *   2. needsAnticipation → anticipation.
 *   3. energyDown (energyB < energyA - 0.2) → energy-down.
 *   4. Both instrumental → normal (lighter — no clash to resolve).
 *   5. useAggressiveFilters → aggressive.
 *   6. Default → normal.
 *
 * For naturalBlend / cleanHandoff / vinylStop / sequential, the gentle
 * preset is a defensive seed: filters never actually run at runtime for
 * those types (`skipBFilters=true` + early-return in applyFiltersA/B).
 */
export function selectPreset(config: CrossfadeResult): PresetSelection {
  const isEnergyDown = config.energyB < config.energyA - 0.2;
  const bothInstrumental = config.isOutroInstrumental && config.isIntroInstrumental;

  if (config.transitionType === 'DROP_MIX') {
    return { preset: PRESET_DROP_MIX, name: 'drop-mix' };
  }
  if (config.transitionType === 'STEM_MIX') {
    return { preset: PRESET_STEM_MIX, name: 'stem-mix' };
  }
  if (
    config.transitionType === 'NATURAL_BLEND' ||
    config.transitionType === 'CLEAN_HANDOFF' ||
    config.transitionType === 'VINYL_STOP' ||
    config.transitionType === 'SEQUENTIAL'
  ) {
    const nameMap = {
      NATURAL_BLEND: 'gentle',
      CLEAN_HANDOFF: 'clean-handoff',
      VINYL_STOP: 'vinyl-stop',
      SEQUENTIAL: 'sequential'
    } as const;
    return { preset: PRESET_GENTLE, name: nameMap[config.transitionType] };
  }
  if (config.needsAnticipation) {
    return { preset: PRESET_ANTICIPATION, name: 'anticipation' };
  }
  if (isEnergyDown) {
    return { preset: PRESET_ENERGY_DOWN, name: 'energy-down' };
  }
  if (bothInstrumental) {
    return { preset: PRESET_NORMAL, name: 'normal' };
  }
  if (config.useAggressiveFilters) {
    return { preset: PRESET_AGGRESSIVE, name: 'aggressive' };
  }
  return { preset: PRESET_NORMAL, name: 'normal' };
}

/**
 * Relax highpassB / lowshelfB on instrumental intros (B-clean override).
 * Mirrors `CrossfadeExecutor.swift:602-635`.
 *
 * The HPF on B (start 400-800 Hz) and the bass shelf cut (-8 to -12 dB)
 * exist to prevent vocal/bass clash. When B's intro is purely
 * instrumental there is no clash to prevent — the filtering just makes
 * B sound thin and "telephonic" on entry. Skipped for transition types
 * that already shape B differently or bypass B filters anyway
 * (anticipation, stemMix, dropMix, cleanHandoff, vinylStop, sequential).
 *
 * Returns the (possibly relaxed) preset and an eligibility flag.
 */
export function applyBCleanOverride(
  basePreset: FilterPreset,
  config: CrossfadeResult
): { preset: FilterPreset; applied: boolean } {
  let eligible: boolean;
  switch (config.transitionType) {
    case 'CROSSFADE':
    case 'EQ_MIX':
    case 'BEAT_MATCH_BLEND':
    case 'NATURAL_BLEND':
    case 'FADE_OUT_A_CUT_B':
    case 'CUT_A_FADE_IN_B':
    case 'CUT':
      eligible = config.isIntroInstrumental && !config.skipBFilters;
      break;
    case 'STEM_MIX':
    case 'DROP_MIX':
    case 'CLEAN_HANDOFF':
    case 'VINYL_STOP':
    case 'SEQUENTIAL':
      eligible = false;
      break;
  }
  if (!eligible) return { preset: basePreset, applied: false };

  const hpQ = basePreset.highpassB.q;
  const lsB = basePreset.lowshelfB;
  return {
    preset: {
      ...basePreset,
      highpassB: { startFreq: 150, midFreq: 100, endFreq: 40, q: hpQ },
      lowshelfB: { frequency: lsB.frequency, startGain: -3, midGain: -2, endGain: 0 }
    },
    applied: true
  };
}

// ============================================================================
// MARK: - Volume compensation (CrossfadeExecutor.swift:637-649)
// ============================================================================

/**
 * Boost B's max volume when B is meaningfully quieter than A so the
 * perceived loudness drop during crossfade is mitigated. Mirrors
 * `CrossfadeExecutor.swift:637-649`.
 *
 *   - General: energyDiff > 0.2 → +2 to +4dB (linear 1.26 to 1.58).
 *   - CUT extra: rapid B entry makes drops more noticeable → an
 *     additional CUT-specific boost on top of the general one when
 *     energyDiff > 0.15.
 *
 * Always clamped to ≤ 1.0 (no clipping headroom blown).
 */
export function computeEnergyCompensationB(
  config: CrossfadeResult,
  maxVolumeB: number
): number {
  let out = maxVolumeB;
  const energyDiff = config.energyA - config.energyB;
  if (energyDiff > 0.2) {
    const compensation = 1.0 + Math.min(0.58, energyDiff * 0.8);
    out = Math.min(1.0, maxVolumeB * compensation);
  }
  if (config.transitionType === 'CUT' && energyDiff > 0.15) {
    const cutBoost = 1.0 + Math.min(0.3, (energyDiff - 0.15) * 0.6);
    out = Math.min(1.0, out * cutBoost);
  }
  return out;
}

// ============================================================================
// MARK: - calculateTimings (CrossfadeExecutor.swift:980-1041)
// ============================================================================

/**
 * Compute the wall-clock timing layout for the crossfade. Mirrors
 * `CrossfadeExecutor.swift:980 calculateTimings`.
 *
 *   - `filterLead` = 0 for CLEAN_HANDOFF / VINYL_STOP / SEQUENTIAL
 *     (volumeFadeStartTime == fadeInStartTime — A's drop and rate ramp
 *     fire immediately at trigger). For everything else with
 *     `useFilters`: `min(3.5, fadeDuration × 0.32)`.
 *   - `fadeOutDuration` = fadeDuration (1:1, no multiplier — A
 *     disappears cleanly within the window).
 *   - `totalTime` = anticipationTime + filterLead + fadeOutDuration.
 *   - `startOffset` = `max(0, entryPoint - totalTime)` — so B reaches
 *     `entryPoint` exactly at `transitionEndTime`.
 *
 * `now` is the wall-clock anchor (typically `audioContext.currentTime`).
 * Injecting it lets the caller pick the audio clock (sample-accurate)
 * instead of `Date.now()` (millisecond drift).
 */
export function calculateTimings(config: CrossfadeResult, now: number): Timings {
  let filterLead: number;
  if (
    config.transitionType === 'CLEAN_HANDOFF' ||
    config.transitionType === 'VINYL_STOP' ||
    config.transitionType === 'SEQUENTIAL'
  ) {
    filterLead = 0;
  } else {
    filterLead = config.useFilters ? Math.min(3.5, config.fadeDuration * 0.32) : 0;
  }

  const fadeOutDuration = config.fadeDuration;
  const totalTransition = fadeOutDuration + filterLead;

  const anticipationStartTime = now;
  const filterStartTime = now + config.anticipationTime;
  const volumeFadeStartTime = filterStartTime + filterLead;
  const transitionEndTime = filterStartTime + totalTransition;
  const totalTime = config.anticipationTime + totalTransition;

  const fadeInStartTime = volumeFadeStartTime;
  const fadeInEndTime = fadeInStartTime + config.fadeDuration;

  const startOffset = Math.max(0, config.entryPoint - totalTime);

  return {
    startTime: now,
    anticipationStartTime,
    filterStartTime,
    volumeFadeStartTime,
    transitionEndTime,
    filterLead,
    fadeOutDuration,
    totalTime,
    fadeInStartTime,
    fadeInEndTime,
    startOffset
  };
}

// ============================================================================
// MARK: - snappedRampStart (CrossfadeExecutor.swift:1058-1113)
// ============================================================================

/**
 * Snap a bass-kill rampStart target backward to the nearest real
 * downbeat (cap 1 bar = `60 × meter / bpm`). Mirrors
 * `CrossfadeExecutor.swift:1058 snappedRampStart`.
 *
 * Snap is BACKWARD only (advancing rampStart would shorten the bass
 * ramp). When `downbeats` is empty or the candidate falls outside the
 * cap, returns `target` unchanged.
 *
 * Half-time iOS detection: if `beats[]` median delta suggests an
 * effective tempo at 2× `bpmReported`, consume only even-indexed
 * downbeats so each snap lands on a musical bar at the perceived tempo
 * (not at half-bar). This defends against the backend sanitizer that
 * sometimes divides BPM by 2 while `downbeats = beats[::4]` continues
 * at the detected rate.
 *
 * `lowerBound` clamps the result so we never escape the transition's
 * own frame (sub-60 bpm tracks with ~4s bars could otherwise snap
 * earlier than `timings.startTime`).
 */
export function snappedRampStart(args: {
  target: number;
  downbeats: readonly number[];
  beats: readonly number[];
  bpmReported: number;
  meter: number;
  lowerBound: number;
}): number {
  const { target, downbeats, beats, bpmReported, meter, lowerBound } = args;
  if (downbeats.length === 0 || bpmReported <= 0) return target;

  // Half-time detection on `beats`.
  let effectiveDownbeats: readonly number[] = downbeats;
  if (beats.length >= 4) {
    const limit = Math.min(30, beats.length);
    const diffs: number[] = [];
    for (let i = 1; i < limit; i++) {
      diffs.push((beats[i] ?? 0) - (beats[i - 1] ?? 0));
    }
    diffs.sort((a, b) => a - b);
    const med = diffs[Math.floor(diffs.length / 2)] ?? 0;
    if (med > 0) {
      const bpmFromBeats = 60.0 / med;
      const ratio = bpmFromBeats / bpmReported;
      if (ratio >= 1.5) {
        effectiveDownbeats = downbeats.filter((_, idx) => idx % 2 === 0);
      }
    }
  }

  const barDur = (60.0 * meter) / bpmReported;
  const maxDistanceBack = barDur;

  // Largest downbeat ≤ target.
  let best: number | undefined;
  for (const db of effectiveDownbeats) {
    if (db <= target && (best === undefined || db > best)) {
      best = db;
    }
  }
  if (best === undefined) return target;
  const delta = target - best;
  if (delta <= maxDistanceBack) {
    return Math.max(best, lowerBound);
  }
  return target;
}

// ============================================================================
// MARK: - computeBassSwapTime (CrossfadeExecutor.swift:1117-1180+)
// ============================================================================

/**
 * Best wall-clock time for the lowshelf bass swap between A and B.
 * Mirrors `CrossfadeExecutor.swift:1117 computeBassSwapTime`.
 *
 * Bass-first mixing: a DJ cuts A's bass BEFORE dropping volume — so
 * the swap fires early in the fade (typically 25% of the window) so
 * B's bass enters while A still has mids and highs above the swap.
 *
 *   - CUT / CUT_A_FADE_IN_B: 75% of fade (B's entry, not the start).
 *   - DROP_MIX: 20% (A drops fast, B needs bass immediately).
 *   - STEM_MIX: 35% (B's vocals need to establish before bass swap).
 *   - Outro instrumental: 15% (no bass on A to clash with).
 *   - Default: 25%.
 *
 * When B downbeats are available, the target is shifted to the nearest
 * downbeat WITHIN A SAFE WINDOW (different per type) to align the swap
 * to a musical landmark. The "wall_clock = fadeStart + (db_in_file -
 * bFileStart)" mapping assumes B was scheduled with `startOffset`
 * computed by `calculateTimings`.
 */
export function computeBassSwapTime(config: CrossfadeResult, timings: Timings): number {
  const fadeStart = timings.volumeFadeStartTime;
  const fadeEnd = timings.transitionEndTime;
  const fadeDur = fadeEnd - fadeStart;
  if (fadeDur <= 0) return fadeStart;

  let targetPercent: number;
  if (config.transitionType === 'CUT' || config.transitionType === 'CUT_A_FADE_IN_B') {
    targetPercent = 0.75;
  } else if (config.transitionType === 'DROP_MIX') {
    targetPercent = 0.20;
  } else if (config.transitionType === 'STEM_MIX') {
    targetPercent = 0.35;
  } else {
    targetPercent = config.isOutroInstrumental ? 0.15 : 0.25;
  }
  const targetTime = fadeStart + fadeDur * targetPercent;
  const beatInterval =
    config.beatIntervalB > 0 ? config.beatIntervalB : config.beatIntervalA;

  if (beatInterval <= 0) {
    return targetTime;
  }

  // B downbeats present → look for closest one within a per-type window.
  if (config.downbeatTimesB.length > 0) {
    const bFileStart = timings.startOffset;
    let bestTime = targetTime;
    let bestDist = Infinity;
    for (const db of config.downbeatTimesB) {
      const wallTime = fadeStart + (db - bFileStart);
      let minT: number;
      let maxT: number;
      if (config.transitionType === 'CUT' || config.transitionType === 'CUT_A_FADE_IN_B') {
        minT = fadeStart + fadeDur * 0.60;
        maxT = fadeStart + fadeDur * 0.85;
      } else {
        minT = fadeStart + fadeDur * (config.isOutroInstrumental ? 0.05 : 0.10);
        maxT = fadeStart + fadeDur * (config.isOutroInstrumental ? 0.35 : 0.45);
      }
      if (wallTime < minT || wallTime > maxT) continue;
      const dist = Math.abs(wallTime - targetTime);
      if (dist < bestDist) {
        bestDist = dist;
        bestTime = wallTime;
      }
    }
    return bestTime;
  }

  return targetTime;
}

// ============================================================================
// MARK: - Volume curves (CrossfadeExecutor.swift:1671-2299)
// ============================================================================

/**
 * Runtime context for the gain functions. Built once at `executor.start()`
 * and read-only thereafter.
 */
export type GainContext = {
  readonly config: CrossfadeResult;
  readonly timings: Timings;
  readonly maxVolumeA: number;
  /** B's maxVolume AFTER energy compensation. Use the output of
      `computeEnergyCompensationB`. */
  readonly maxVolumeB: number;
  /** Stutter gate state — `undefined` when stutter not active. */
  readonly stutter: StutterState | undefined;
};

/**
 * Stutter Cut runtime state. Pre-computed at executor start when the
 * decision-layer flag `useStutterCut` AND the runtime beat-anchor check
 * both pass. If runtime anchor check fails, `stutter` stays `undefined`
 * (graceful degradation — the CUT still happens, just without the chop).
 */
export type StutterState = {
  /** Wall-clock time when the stutter pattern STARTS (= 2 beats before
      the anchor). */
  readonly startWall: number;
  /** Wall-clock time when the stutter pattern ENDS (= the anchor = A's
      nearest real beat to the cut moment). */
  readonly anchorWall: number;
  /** Cell duration = beatInterval / 2 (1/8 note). */
  readonly cellDuration: number;
};

const STUTTER_ANTI_CLICK_S = 0.003;

/**
 * Stutter gate: 1/8-note ON/OFF/ON/OFF pattern over A's last 2 beats.
 * No-op when `stutter` is undefined or `t` is outside
 * `[startWall, anchorWall)`. Includes a 3ms anti-click ramp at each cell
 * boundary to suppress pops through the biquad chain. Mirrors
 * `CrossfadeExecutor.swift:1679 applyStutterGate`.
 */
export function applyStutterGate(args: {
  baseGain: number;
  t: number;
  stutter: StutterState | undefined;
}): number {
  const { baseGain, t, stutter } = args;
  if (
    stutter === undefined ||
    t < stutter.startWall ||
    t >= stutter.anchorWall ||
    stutter.cellDuration <= 0
  ) {
    return baseGain;
  }
  const elapsed = t - stutter.startWall;
  const cellIndex = Math.floor(elapsed / stutter.cellDuration);
  const timeInCell = elapsed - cellIndex * stutter.cellDuration;
  const isOnCell = cellIndex % 2 === 0;
  const targetGate = isOnCell ? 1.0 : 0.0;
  let gate: number;
  if (timeInCell < STUTTER_ANTI_CLICK_S && cellIndex > 0) {
    const prevGate = (cellIndex - 1) % 2 === 0 ? 1.0 : 0.0;
    const p = timeInCell / STUTTER_ANTI_CLICK_S;
    gate = prevGate + (targetGate - prevGate) * p;
  } else {
    gate = targetGate;
  }
  return baseGain * gate;
}

/**
 * Gain on A at wall-clock time `t`. Mirrors `CrossfadeExecutor.swift:1671
 * gainForPlayerA`. Pure: only depends on `t` + `ctx` snapshot.
 *
 * Phases:
 *   - `t < volumeFadeStart` → full maxVolumeA (hold).
 *   - `t >= transitionEnd` → 0.
 *   - Otherwise: progress = (t − volumeFadeStart) / (transitionEnd −
 *     volumeFadeStart), switch on transitionType for 12 distinct curves,
 *     then apply stutter gate.
 *
 * Modulations (B→A communication, applies to CROSSFADE / EQ_MIX /
 * BEAT_MATCH_BLEND):
 *   - `bHarmonicClashLevel ≥ 0.7` → lower holdLevel by 0.15 (A retreats
 *     earlier to shrink clash overlap).
 *   - `bImmediateImpact` → compress holdEnd/dropEnd (A cedes antes del
 *     punch de B).
 *   - `bIntroBars ≥ 4 && !needsAnticipation` → extend holdEnd + dropEnd
 *     (A breathes longer while B's instrumental intro plays).
 *   - `tier4Active` → earlyBlend curve (A holds 100% for first ~50%,
 *     drops cos² to 0.30 by ~75%, exponential tail).
 */
export function gainForPlayerA(t: number, ctx: GainContext): number {
  const baseGain = unstutteredGainForPlayerA(t, ctx);
  return applyStutterGate({ baseGain, t, stutter: ctx.stutter });
}

function unstutteredGainForPlayerA(t: number, ctx: GainContext): number {
  const { config, timings, maxVolumeA } = ctx;
  if (t < timings.volumeFadeStartTime) return maxVolumeA;
  if (t >= timings.transitionEndTime) return 0;

  const duration = timings.transitionEndTime - timings.volumeFadeStartTime;
  const progress = (t - timings.volumeFadeStartTime) / duration;

  switch (config.transitionType) {
    case 'CUT':
    case 'CUT_A_FADE_IN_B': {
      // Hard cut: A holds, then exponential drop over 3s (4s for slow
      // BPM tracks where the filter sweep needs more room).
      const cutCap = config.danceability < 0.5 ? 4.0 : 3.0;
      const cutDuration = Math.min(cutCap, duration);
      const cutStart = Math.max(0, 1.0 - cutDuration / duration);
      if (progress < cutStart) return maxVolumeA;
      const cutP = (progress - cutStart) / (1.0 - cutStart);
      return maxVolumeA * Math.pow(0.0001 / maxVolumeA, cutP);
    }

    case 'EQ_MIX':
    case 'BEAT_MATCH_BLEND':
      return blendCurveA(progress, ctx, { holdLevel: 0.65, holdEnd: 0.50, dropEnd: 0.85 });

    case 'NATURAL_BLEND': {
      // Equal-power cos² with a 0.15 floor + exponential tail.
      const dropEnd = 0.85;
      const floor = 0.15;
      if (progress < dropEnd) {
        const p = progress / dropEnd;
        const angle = (p * Math.PI) / 2.0;
        const cosSq = Math.cos(angle) * Math.cos(angle);
        return maxVolumeA * (floor + (1.0 - floor) * cosSq);
      }
      const tailP = (progress - dropEnd) / (1.0 - dropEnd);
      return maxVolumeA * floor * Math.pow(0.0001 / floor, tailP);
    }

    case 'CLEAN_HANDOFF': {
      // Cos descent over the first 70% (or 85% when A is quiet) so the
      // tail has body during the 25% overlap zone with B's sin ramp.
      const aFadeEnd = config.energyA < 0.20 ? 0.85 : 0.70;
      if (progress < aFadeEnd) {
        const p = progress / aFadeEnd;
        const angle = (p * Math.PI) / 2.0;
        return maxVolumeA * Math.cos(angle);
      }
      return 0;
    }

    case 'FADE_OUT_A_CUT_B': {
      // A fades out ahead of B's firm entry at ~55%.
      const holdLevel = 0.85;
      const holdEnd = 0.45;
      if (progress < holdEnd) {
        const p = progress / holdEnd;
        const eased = p * p;
        return maxVolumeA * (1.0 - (1.0 - holdLevel) * eased);
      }
      const dropP = (progress - holdEnd) / (1.0 - holdEnd);
      return maxVolumeA * holdLevel * Math.pow(0.0001 / holdLevel, dropP);
    }

    case 'STEM_MIX': {
      // Holds at 95% until 75%, then fast exponential.
      const holdLevel = 0.95;
      const holdEnd = 0.75;
      if (progress < holdEnd) {
        const p = progress / holdEnd;
        const eased = p * p;
        return maxVolumeA * (1.0 - (1.0 - holdLevel) * eased);
      }
      const dropP = (progress - holdEnd) / (1.0 - holdEnd);
      return maxVolumeA * holdLevel * Math.pow(0.0001 / holdLevel, dropP);
    }

    case 'DROP_MIX': {
      // Short hold, aggressive exit.
      const holdLevel = 0.80;
      const holdEnd = 0.30;
      if (progress < holdEnd) {
        const p = progress / holdEnd;
        const eased = p * p;
        return maxVolumeA * (1.0 - (1.0 - holdLevel) * eased);
      }
      const dropP = (progress - holdEnd) / (1.0 - holdEnd);
      return maxVolumeA * holdLevel * Math.pow(0.0001 / holdLevel, dropP);
    }

    case 'CROSSFADE':
      return blendCurveA(progress, ctx, { holdLevel: 0.70, holdEnd: 0.45, dropEnd: 0.85 });

    case 'VINYL_STOP': {
      // Cos² mirrors the rate ramp (which is driven elsewhere).
      const aFadeEnd = 0.225;
      if (progress < aFadeEnd) {
        const p = progress / aFadeEnd;
        const angle = (p * Math.PI) / 2.0;
        return maxVolumeA * Math.cos(angle) * Math.cos(angle);
      }
      return 0;
    }

    case 'SEQUENTIAL': {
      // A holds full, descends cos² in the last 50ms to complement B's
      // sin² entry (sin² + cos² = 1, constant power).
      const solapeWindow = 0.050;
      const solapeStart = Math.max(0, 1.0 - solapeWindow / duration);
      if (progress < solapeStart) return maxVolumeA;
      const p = (progress - solapeStart) / (1.0 - solapeStart);
      const angle = (p * Math.PI) / 2.0;
      return maxVolumeA * Math.cos(angle) * Math.cos(angle);
    }
  }
}

/**
 * Shared blend curve for CROSSFADE / EQ_MIX / BEAT_MATCH_BLEND. The
 * holdLevel/holdEnd/dropEnd parameters distinguish the three types
 * (crossfade holds higher and shorter than eqMix/BMB). Modulated by
 * B→A communication flags + tier4 earlyBlend curve.
 */
function blendCurveA(
  progress: number,
  ctx: GainContext,
  params: { holdLevel: number; holdEnd: number; dropEnd: number }
): number {
  const { config, maxVolumeA } = ctx;
  const floor = 0.15;

  // tier4Active overrides the regular curve with earlyBlend: full hold
  // for the first ~50%, cos² drop to 0.30 by ~75%, exponential tail.
  // holdEndT4 compresses with clash; dropMidT4 compresses with impact.
  if (config.tier4Active) {
    let holdEndT4: number;
    if (config.bHarmonicClashLevel >= 0.7) holdEndT4 = 0.35;
    else if (config.bHarmonicClashLevel >= 0.5) holdEndT4 = 0.40;
    else holdEndT4 = 0.50;
    const dropMidT4 = config.bImmediateImpact ? 0.65 : 0.75;
    if (progress < holdEndT4) return maxVolumeA;
    if (progress < dropMidT4) {
      const dropP = (progress - holdEndT4) / (dropMidT4 - holdEndT4);
      const angle = (dropP * Math.PI) / 2.0;
      const cosSq = Math.cos(angle) * Math.cos(angle);
      return maxVolumeA * (0.30 + 0.70 * cosSq);
    }
    const tailP = (progress - dropMidT4) / (1.0 - dropMidT4);
    const tailFloor = 0.30;
    return maxVolumeA * tailFloor * Math.pow(0.0001 / tailFloor, tailP);
  }

  let holdLevel = params.holdLevel;
  let holdEnd = params.holdEnd;
  let dropEnd = params.dropEnd;

  // B→A communication modulations. Acotado por if/else-if para que
  // intro-aware e impact-aware no colisionen.
  if (config.bHarmonicClashLevel >= 0.7) {
    holdLevel = Math.max(0.40, holdLevel - 0.15);
  }
  if (config.bImmediateImpact) {
    // CROSSFADE caps at 0.40, EQ/BMB caps at 0.45 — preservar shape iOS.
    const impactCap = params.holdEnd >= 0.50 ? 0.45 : 0.40;
    holdEnd = Math.min(holdEnd, impactCap);
    dropEnd = Math.max(holdEnd + 0.20, dropEnd - 0.10);
  } else if (config.bIntroBars >= 4 && !config.needsAnticipation) {
    // CROSSFADE caps holdEnd at 0.55, EQ/BMB at 0.60 — preservar shape iOS.
    const introCap = params.holdEnd >= 0.50 ? 0.60 : 0.55;
    holdEnd = Math.min(introCap, dropEnd - 0.20);
    dropEnd = Math.min(0.90, dropEnd + 0.05);
  }

  if (progress < holdEnd) {
    const p = progress / holdEnd;
    const eased = p * p * (3.0 - 2.0 * p);
    return maxVolumeA * (1.0 - (1.0 - holdLevel) * eased);
  }
  if (progress < dropEnd) {
    const dropP = (progress - holdEnd) / (dropEnd - holdEnd);
    const angle = (dropP * Math.PI) / 2.0;
    const cosSq = Math.cos(angle) * Math.cos(angle);
    return maxVolumeA * holdLevel * (floor + (1.0 - floor) * cosSq);
  }
  const tailP = (progress - dropEnd) / (1.0 - dropEnd);
  const tailFloor = holdLevel * floor;
  return maxVolumeA * tailFloor * Math.pow(0.0001 / tailFloor, tailP);
}

/**
 * Gain on B at wall-clock time `t`. Mirrors `CrossfadeExecutor.swift:1995
 * gainForPlayerB`. Pure: only depends on `t` + `ctx` snapshot.
 *
 * Phases:
 *   - Anticipation pre-fade (when `config.needsAnticipation`):
 *     * t < anticipationStart → 0.
 *     * anticipationStart ≤ t < filterStart → tease 0 → 25% maxVolumeB.
 *     * filterStart ≤ t < fadeInStart → creep 25% → 35% maxVolumeB.
 *     * t ≥ fadeInStart → falls through to main curve below with
 *       baseLevel = 0.35.
 *   - Main curve (anticipation false OR fallthrough):
 *     * t < fadeInStart → 0.
 *     * progress = (t − fadeInStart) / (fadeInEnd − fadeInStart).
 *     * Switch on transitionType for 12 distinct curves.
 *
 * Modulations:
 *   - `aNaturalDecay = isOutroInstrumental && !tier4Active &&
 *     !needsAnticipation` → 10% easing lift to `target` then hold
 *     (avoids thump at t=0 from baseLevel→target step).
 *   - `tier4Active` → earlyBlend curve (B enters at 75% from t=0,
 *     small climb to 0.85 by 75%, eased final to 1.0).
 */
export function gainForPlayerB(t: number, ctx: GainContext): number {
  const { config, timings, maxVolumeB } = ctx;

  if (config.needsAnticipation) {
    if (t < timings.anticipationStartTime) return 0;
    if (t < timings.filterStartTime) {
      const dur = timings.filterStartTime - timings.anticipationStartTime;
      if (dur <= 0) return 0;
      const p = (t - timings.anticipationStartTime) / dur;
      return maxVolumeB * 0.25 * Math.max(0, p);
    }
    if (t < timings.fadeInStartTime) {
      const dur = timings.fadeInStartTime - timings.filterStartTime;
      if (dur <= 0) return maxVolumeB * 0.25;
      const p = (t - timings.filterStartTime) / dur;
      return maxVolumeB * (0.25 + 0.10 * p);
    }
    // Falls through to main curve.
  }

  if (t < timings.fadeInStartTime) return 0;
  const fadeInDuration = timings.fadeInEndTime - timings.fadeInStartTime;
  if (fadeInDuration <= 0) return maxVolumeB;
  const progress = Math.min(1.0, (t - timings.fadeInStartTime) / fadeInDuration);

  const baseLevel = config.needsAnticipation ? 0.35 : 0.0;
  const aNaturalDecay =
    config.isOutroInstrumental && !config.tier4Active && !config.needsAnticipation;

  switch (config.transitionType) {
    case 'CUT': {
      // B enters during the last 3s (4s for slow BPM) — matches A's drop
      // zone. 1.5s ramp avoids the "BAM" effect.
      const cutCap = config.danceability < 0.5 ? 4.0 : 3.0;
      const cutZone = Math.min(cutCap, fadeInDuration);
      const bRampStart = timings.fadeInEndTime - cutZone;
      if (t < bRampStart) {
        if (config.needsAnticipation) {
          // Don't freeze B at a flat level for long fades — creep 0.35 →
          // 0.45 over max 4s then hold.
          const holdStart = timings.fadeInStartTime;
          const holdDur = bRampStart - holdStart;
          if (holdDur > 0) {
            const elapsed = t - holdStart;
            const creepDur = Math.min(4.0, holdDur);
            const creepP = Math.min(1.0, elapsed / creepDur);
            return maxVolumeB * (0.35 + 0.10 * creepP);
          }
          return maxVolumeB * 0.35;
        }
        return 0;
      }
      const startLevel = config.needsAnticipation ? 0.45 : 0.0;
      const rampP = Math.min(1.0, (t - bRampStart) / 1.5);
      return maxVolumeB * (startLevel + (1.0 - startLevel) * rampP);
    }

    case 'FADE_OUT_A_CUT_B': {
      // B waits until A drops (~55% of fade), then quick smoothstep ramp.
      const waitUntil = 0.55;
      if (progress < waitUntil) {
        const p = progress / waitUntil;
        return maxVolumeB * 0.15 * p;
      }
      const rampP = (progress - waitUntil) / (1.0 - waitUntil);
      const eased = rampP * rampP * (3.0 - 2.0 * rampP);
      return maxVolumeB * (0.15 + 0.85 * eased);
    }

    case 'EQ_MIX':
    case 'BEAT_MATCH_BLEND':
      return blendCurveB(progress, ctx, {
        rampStart: 0.35,
        baseLevel,
        aNaturalDecay,
        midTarget: 0.50
      });

    case 'NATURAL_BLEND': {
      // Pure sin² ramp. cos² (A) + sin² (B) = 1 → constant power.
      const angle = (progress * Math.PI) / 2.0;
      const sinSq = Math.sin(angle) * Math.sin(angle);
      return maxVolumeB * (baseLevel + (1.0 - baseLevel) * sinSq);
    }

    case 'CLEAN_HANDOFF': {
      // sin (not sin²) over the last 55%. anticipation forced off
      // upstream → baseLevel always 0 here.
      const bRampStart = 0.45;
      if (progress < bRampStart) return 0;
      const rampP = (progress - bRampStart) / (1.0 - bRampStart);
      const angle = (rampP * Math.PI) / 2.0;
      return maxVolumeB * Math.sin(angle);
    }

    case 'CUT_A_FADE_IN_B': {
      // B reaches ~100% BEFORE A's hard cut at ~98%.
      const rampEnd = 0.80;
      if (progress < rampEnd) {
        const p = progress / rampEnd;
        const eased = p * p * (3.0 - 2.0 * p);
        return maxVolumeB * (baseLevel + (1.0 - baseLevel) * eased);
      }
      return maxVolumeB;
    }

    case 'STEM_MIX':
      return blendCurveB(progress, ctx, {
        rampStart: 0.50,
        baseLevel,
        aNaturalDecay,
        midTarget: 0.40,
        useSmoothstepRamp: true
      });

    case 'DROP_MIX': {
      // B enters fast → 100% by 60%.
      const rampEnd = 0.60;
      if (progress < rampEnd) {
        if (aNaturalDecay) {
          const liftEnd = 0.10;
          const target = 0.60;
          if (progress < liftEnd) {
            const p = progress / liftEnd;
            const eased = p * p * (3.0 - 2.0 * p);
            return maxVolumeB * (baseLevel + (target - baseLevel) * eased);
          }
          const tailP = (progress - liftEnd) / (rampEnd - liftEnd);
          const easedTail = tailP * tailP * (3.0 - 2.0 * tailP);
          return maxVolumeB * (target + (1.0 - target) * easedTail);
        }
        const p = progress / rampEnd;
        const eased = p * p * (3.0 - 2.0 * p);
        return maxVolumeB * (baseLevel + (1.0 - baseLevel) * eased);
      }
      return maxVolumeB;
    }

    case 'CROSSFADE':
      return blendCurveB(progress, ctx, {
        rampStart: 0.30,
        baseLevel,
        aNaturalDecay,
        midTarget: 0.50
      });

    case 'VINYL_STOP': {
      // B silent until A's rate winds down + ~200ms aire buffer.
      const bRampStart = 0.325;
      if (progress < bRampStart) return 0;
      const rampP = (progress - bRampStart) / (1.0 - bRampStart);
      const angle = (rampP * Math.PI) / 2.0;
      const sinSq = Math.sin(angle) * Math.sin(angle);
      return maxVolumeB * sinSq;
    }

    case 'SEQUENTIAL': {
      // B silent until the last 50ms, then sin² enters complementing A's
      // cos² descent.
      const solapeWindow = 0.050;
      const solapeStart = Math.max(0, 1.0 - solapeWindow / fadeInDuration);
      if (progress < solapeStart) return 0;
      const p = (progress - solapeStart) / (1.0 - solapeStart);
      const angle = (p * Math.PI) / 2.0;
      return maxVolumeB * Math.sin(angle) * Math.sin(angle);
    }
  }
}

/**
 * Shared blend ramp for B in CROSSFADE / EQ_MIX / BEAT_MATCH_BLEND /
 * STEM_MIX. Splits into:
 *   - progress < rampStart: lift baseLevel → midTarget (smoothstep or
 *     aNaturalDecay 10% lift then hold).
 *   - progress ≥ rampStart: rise to 1.0 (sin² for blendy types,
 *     smoothstep for stemMix via `useSmoothstepRamp`).
 *
 * `tier4Active` overrides with earlyBlend (B enters at 75% from t=0).
 */
function blendCurveB(
  progress: number,
  ctx: GainContext,
  params: {
    rampStart: number;
    baseLevel: number;
    aNaturalDecay: boolean;
    midTarget: number;
    useSmoothstepRamp?: boolean;
  }
): number {
  const { config, maxVolumeB } = ctx;
  const { rampStart, baseLevel, aNaturalDecay, midTarget } = params;
  const useSmoothstepRamp = params.useSmoothstepRamp ?? false;

  if (config.tier4Active) {
    // earlyBlend: B enters at 75% from t=0, climbs to 0.85 by 75%, eased
    // ramp to 1.0 by end.
    if (progress < 0.50) return maxVolumeB * 0.75;
    if (progress < 0.75) {
      const p = (progress - 0.50) / 0.25;
      return maxVolumeB * (0.75 + 0.10 * p);
    }
    const p = (progress - 0.75) / 0.25;
    const eased = p * p * (3.0 - 2.0 * p);
    return maxVolumeB * (0.85 + 0.15 * eased);
  }

  if (progress < rampStart) {
    if (aNaturalDecay) {
      const liftEnd = 0.10;
      if (progress < liftEnd) {
        const p = progress / liftEnd;
        const eased = p * p * (3.0 - 2.0 * p);
        return maxVolumeB * (baseLevel + (midTarget - baseLevel) * eased);
      }
      return maxVolumeB * midTarget;
    }
    const p = progress / rampStart;
    const eased = p * p * (3.0 - 2.0 * p);
    return maxVolumeB * (baseLevel + (midTarget - baseLevel) * eased);
  }

  const rampP = (progress - rampStart) / (1.0 - rampStart);
  if (useSmoothstepRamp) {
    const eased = rampP * rampP * (3.0 - 2.0 * rampP);
    return maxVolumeB * (midTarget + (1.0 - midTarget) * eased);
  }
  const angle = (rampP * Math.PI) / 2.0;
  const sinSq = Math.sin(angle) * Math.sin(angle);
  return maxVolumeB * (midTarget + (1.0 - midTarget) * sinSq);
}
