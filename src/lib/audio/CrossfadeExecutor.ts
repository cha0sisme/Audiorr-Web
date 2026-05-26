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
