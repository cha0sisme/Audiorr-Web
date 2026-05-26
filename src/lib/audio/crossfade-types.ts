/**
 * Types for `CrossfadeExecutor` — Fase 2 of the iOS DJ algorithm port.
 *
 * Mirrors structs from `ios/App/App/CrossfadeExecutor.swift` v15.m:
 *   - `Timings` (line 228)
 *   - `FilterPreset` + sub-types (line 242)
 *   - DJ effects tuning constants (lines 394-423)
 *
 * The `Config` struct of iOS CrossfadeExecutor maps 1:1 to
 * `CrossfadeResult` from `dj-types.ts` — the executor consumes the output
 * of `calculateCrossfadeConfig` directly. No separate type needed.
 */

// ============================================================================
// MARK: - Timings (CrossfadeExecutor.swift:228)
// ============================================================================

/**
 * Wall-clock timing layout of the crossfade. Computed once at executor
 * start; the automation loop reads from this snapshot. All times in
 * seconds, anchored on the audio context clock.
 *
 *   startTime              = trigger moment (executor.start()).
 *   anticipationStartTime  = startTime (anticipation arms preset on A).
 *   filterStartTime        = startTime + anticipationTime (filter sweep
 *                            arms in earnest).
 *   volumeFadeStartTime    = filterStartTime + filterLead (A's gain
 *                            begins descending, B's begins rising).
 *   transitionEndTime      = filterStartTime + (fadeOutDuration +
 *                            filterLead) (everything done; B at maxVolB).
 *   fadeInStartTime        = volumeFadeStartTime (B fades in alongside
 *                            A's fade out — no delay).
 *   fadeInEndTime          = fadeInStartTime + fadeDuration.
 *   startOffset            = where B's playhead starts in its own file
 *                            (max(0, entryPoint - totalTime)) so B
 *                            reaches `entryPoint` at transitionEndTime.
 */
export type Timings = {
  readonly startTime: number;
  readonly anticipationStartTime: number;
  readonly filterStartTime: number;
  readonly volumeFadeStartTime: number;
  readonly transitionEndTime: number;
  readonly filterLead: number;
  readonly fadeOutDuration: number;
  readonly totalTime: number;
  readonly fadeInStartTime: number;
  readonly fadeInEndTime: number;
  readonly startOffset: number;
};

// ============================================================================
// MARK: - FilterPreset (CrossfadeExecutor.swift:242)
// ============================================================================

/**
 * Highpass biquad sweep (3-point: start → mid → end frequencies). The mid
 * point bends the rate of change so the perceptual sweep isn't a flat
 * exponential — it accelerates through the audible region.
 */
export type Highpass = {
  readonly startFreq: number;
  readonly midFreq: number;
  readonly endFreq: number;
  readonly q: number;
};

/** Lowpass biquad sweep (2-point: start → end). Used for energy-down
    transitions — A "fades away" darkly. */
export type Lowpass = {
  readonly startFreq: number;
  readonly endFreq: number;
  readonly q: number;
};

/** Lowshelf biquad gain ramp (3-point: start → mid → end gains in dB).
    Used to swap bass between A and B during the fade. */
export type Lowshelf = {
  readonly frequency: number;
  readonly startGain: number;
  readonly midGain: number;
  readonly endGain: number;
};

/** Parametric mid scoop: dips midrange on A to avoid vocal clashing
    with B. */
export type MidScoop = {
  readonly frequency: number;
  readonly bandwidth: number;
  readonly startGain: number;
  readonly endGain: number;
};

/** High-shelf cut: attenuates hi-hats / cymbals on A so B's highs come
    through clean. */
export type HighShelfCut = {
  readonly frequency: number;
  readonly startGain: number;
  readonly endGain: number;
};

/** Full filter preset. `lowshelfA`, `lowpassA`, `midScoopA`, `highShelfA`
    are nullable — different presets carve A differently. Bands on B
    (highpass + lowshelf) are always present. */
export type FilterPreset = {
  readonly highpassA: Highpass;
  readonly highpassB: Highpass;
  readonly lowshelfA: Lowshelf | undefined;
  readonly lowshelfB: Lowshelf;
  readonly lowpassA: Lowpass | undefined;
  readonly midScoopA: MidScoop | undefined;
  readonly highShelfA: HighShelfCut | undefined;
};

// ============================================================================
// MARK: - DJ effects tuning constants (CrossfadeExecutor.swift:394-423)
// ============================================================================

/**
 * Twin dynQ: A and B both run a bell-shaped Q sweep on their highpass.
 * B's bell fires slightly earlier than A's so its resonance peak hits
 * BEFORE A's — produces the "knob handoff" perception.
 */
export const DYN_Q_BELL_CENTER_A = 0.55;
export const DYN_Q_BELL_CENTER_B = 0.40;
export const DYN_Q_BELL_WIDTH = 0.30;
export const DYN_Q_PEAK_Q = 3.5;
/** Hard ceiling — biquad self-oscillates above ~5.0; 4.0 is a safe
    musical max. */
export const DYN_Q_MAX_Q = 4.0;

/**
 * Phaser Notch Sweep: narrow parametric notch on B's band 2. Center
 * sweeps `notchStart → notchEnd` exponentially while depth follows a
 * bell (`tailGain → peakGain → tailGain`). Always rides alongside
 * twin dynQ for the "DJ knob ride" feel.
 */
export const NOTCH_START_FREQ = 250;
export const NOTCH_END_FREQ = 6000;
export const NOTCH_BANDWIDTH = 0.3;
export const NOTCH_TAIL_GAIN = -6;
export const NOTCH_PEAK_GAIN = -24;
export const NOTCH_BELL_CENTER = 0.50;
export const NOTCH_BELL_WIDTH = 0.30;
