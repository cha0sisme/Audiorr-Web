/**
 * CrossfadeRuntime — máquina de estados del crossfade. Cierra Fase 2D + 2E.
 *
 * Clase orquestadora que consume un `CrossfadeResult` + dependencias del
 * audio engine (inyectadas, no acopladas) y conduce el fade end-to-end:
 *   - Pre-computa `timings`, `preset`, `bassSwapTime`, `stutterState`.
 *   - `start()`: pre-arma rateB ramp, programa play de B, arranca tick
 *     loop (`setInterval` ~16 ms anclado a `audioContext.currentTime`).
 *   - `tick()`: lee `now` via deps, llama `gainForPlayerA/B` +
 *     `applyFiltersA/B` + rateB cosSquared ramp, escribe via deps.
 *   - `cancel()`: detiene tick, restaura A.
 *   - `completeCrossfade()`: detiene tick + dispara `onComplete` (caller
 *     swap A↔B y libera).
 *
 * Las deps son una interface — `runCrossfadeConfig` (Fase 2F, en
 * `AudioEngine.svelte.ts`) pasa un object real que cablea al
 * `AudioContext` / `AudioWorklet` / `<audio>` element. Tests pasan mocks
 * para verificar la coreografía sin AudioContext.
 *
 * Divergencias plataforma vs iOS:
 *   - iOS usa `DispatchSourceTimer` en queue dedicada `.userInteractive`
 *     (background-safe). Web usa `setInterval` — funciona en tabs
 *     activas, se throttlea en background. Para mejorar background
 *     behavior, futuro: AudioWorklet timer (más complejo).
 *   - iOS `playerB.scheduleSegment(file, startingFrame, ...)`
 *     sample-accurate. Web `<audio>.currentTime = startOffset; play()`
 *     aproximado (~10-30 ms drift). Suficiente para crossfades de
 *     varios segundos; queda corto para SEQUENTIAL 50 ms (acepted limit).
 *   - iOS `AVAudioUnitTimePitch.rate` independiente del pitch. Web
 *     `<audio>.playbackRate` con `preservesPitch=true` mantiene pitch
 *     pero la calidad audible >8% change degrada igual que iOS.
 */

import type { BiquadCoefficients } from './BiquadCoefficients';
import {
  computeBassSwapTime,
  computeEnergyCompensationB,
  computeStutterState,
  applyBCleanOverride,
  calculateTimings,
  gainForPlayerA,
  gainForPlayerB,
  selectPreset,
  type GainContext,
  type StutterState
} from './CrossfadeExecutor';
import {
  applyFiltersA,
  applyFiltersB,
  type FilterAutomationContext
} from './filter-automation';
import type { FilterPreset, Timings } from './crossfade-types';
import type { CrossfadeResult } from './dj-types';

// ============================================================================
// Dependencies (DI) — caller provides these to wire the runtime to the
// audio graph. Mock for tests, real for production (Fase 2F cablea).
// ============================================================================

export type CrossfadeRuntimeDeps = {
  /** Wall-clock anchor — typically `audioContext.currentTime`. */
  getCurrentTime(): number;
  /** Set chain A's master gain. Used for the volume curve A. */
  setGainA(value: number): void;
  /** Set chain B's master gain. */
  setGainB(value: number): void;
  /** Set both A's max replay-gain pre-fade. The runtime locks A at
      `maxVolumeA` during the hold phase before the volume curve kicks
      in — but the caller may have set replay gain elsewhere; this
      method gives the runtime a way to confirm/override. Optional. */
  setReplayGainA?(value: number): void;
  /** Set chain B's max replay-gain pre-fade (after energy compensation). */
  setReplayGainB?(value: number): void;
  /** Write the 4 biquad stages for the named chain to the worklet. */
  setBiquadCoeffsAll(label: 'A' | 'B', stages: readonly BiquadCoefficients[]): void;
  /** Program B to start playing from `startOffset` seconds into its
      file, at wall-clock `atTime` (best-effort web; iOS does
      sample-accurate scheduleSegment). */
  schedulePlayB(startOffset: number, atTime: number): void;
  /** Cancel any pending B playback (web: pause + reset). */
  stopB(): void;
  /** Set B's `<audio>.playbackRate` for time-stretch. */
  setPlaybackRateB(rate: number): void;
  /** Called when the crossfade completes naturally (t ≥
      `transitionEndTime`). The caller swaps A↔B labels and releases A. */
  onComplete(): void;
  /** Tick interval in ms. Default 16 ms (~60 Hz). */
  tickIntervalMs?: number;
};

// ============================================================================
// CrossfadeRuntime
// ============================================================================

type RuntimeState = 'idle' | 'running' | 'completed' | 'cancelled';

const DEFAULT_TICK_MS = 16;
const DEFAULT_MAX_VOLUME = 1.0;
/** Watchdog buffer past transitionEndTime — if the tick loop somehow
    misses the natural complete (e.g. throttling in background), force
    complete this many seconds after the expected end. */
const WATCHDOG_GRACE_S = 0.5;

export class CrossfadeRuntime {
  readonly config: CrossfadeResult;
  readonly timings: Timings;
  readonly preset: FilterPreset;
  readonly maxVolumeA: number;
  readonly maxVolumeB: number;
  readonly bassSwapTime: number;
  readonly stutterState: StutterState | undefined;

  private readonly deps: CrossfadeRuntimeDeps;
  private readonly tickIntervalMs: number;
  private state: RuntimeState = 'idle';
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private watchdogHandle: ReturnType<typeof setTimeout> | undefined;
  // rateB ramp state (Fase 2E)
  private rateBRampActive = false;
  private rateBRampStart = 0;
  private rateBRampEnd = 0;
  // Filter context (built once, snapshot of preset + bools). NOT readonly:
  // `setSampleRate()` rebuilds it before `start()`.
  private filterContext: FilterAutomationContext;

  constructor(args: {
    config: CrossfadeResult;
    /** Replay-gain base for A (before energy compensation does NOT apply
        to A; the caller passes the value already in place). */
    maxVolumeA?: number;
    /** Replay-gain base for B — energy compensation will be applied
        on top inside the constructor. */
    maxVolumeB?: number;
    /** A's file-time (currentTime) at the moment start() will be called.
        Used by stutter cut runtime gate to map cut moment back to A's
        beat grid. Defaults to 0 (no stutter). */
    startFileTimeA?: number;
    deps: CrossfadeRuntimeDeps;
  }) {
    this.config = args.config;
    this.deps = args.deps;
    this.tickIntervalMs = args.deps.tickIntervalMs ?? DEFAULT_TICK_MS;
    this.maxVolumeA = args.maxVolumeA ?? DEFAULT_MAX_VOLUME;
    const baseB = args.maxVolumeB ?? DEFAULT_MAX_VOLUME;
    this.maxVolumeB = computeEnergyCompensationB(args.config, baseB);

    // Pre-compute timings using the audio clock at construction. The
    // caller MUST call start() right after — small skew (<10 ms) is OK.
    const now = args.deps.getCurrentTime();
    this.timings = calculateTimings(args.config, now);

    // Preset selection + B-clean override.
    const baseSel = selectPreset(args.config);
    this.preset = applyBCleanOverride(baseSel.preset, args.config).preset;

    this.bassSwapTime = computeBassSwapTime(args.config, this.timings);
    this.stutterState = computeStutterState({
      config: args.config,
      timings: this.timings,
      startFileTimeA: args.startFileTimeA ?? 0
    });

    // Filter context — boolean flags derived from config + preset.
    const isEnergyDown = args.config.energyB < args.config.energyA - 0.2;
    this.filterContext = {
      config: args.config,
      timings: this.timings,
      preset: this.preset,
      sampleRate: 48000, // overridden via deps if needed; placeholder OK
      useBassManagement: this.preset.lowshelfA !== undefined,
      bassSwapTime: this.bassSwapTime,
      useLowpassA: isEnergyDown && this.preset.lowpassA !== undefined,
      useMidScoop: args.config.useMidScoop && this.preset.midScoopA !== undefined,
      useHighShelfCut: args.config.useHighShelfCut && this.preset.highShelfA !== undefined,
      useBassKill: args.config.useBassKill,
      useDynamicQ: args.config.useDynamicQ,
      useNotchSweep: args.config.useNotchSweep
    };
  }

  /** Build the gain context once — `applyStutterGate` reads stutterState. */
  private gainContext(): GainContext {
    return {
      config: this.config,
      timings: this.timings,
      maxVolumeA: this.maxVolumeA,
      maxVolumeB: this.maxVolumeB,
      stutter: this.stutterState
    };
  }

  /**
   * Override the sample rate of the filter context. Call BEFORE
   * `start()`. Default 48 kHz placeholder is enough for the math but
   * the worklet expects coefs computed against the real AudioContext
   * sample rate.
   */
  setSampleRate(sampleRate: number): void {
    this.filterContext = { ...this.filterContext, sampleRate };
  }

  /**
   * Start the crossfade. Programs B to play at `volumeFadeStartTime`
   * with `startOffset` seconds into B's file, pre-arms rateB ramp,
   * starts the tick loop.
   */
  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'running';

    // Set initial gains: A at full volume, B silent.
    this.deps.setGainA(this.maxVolumeA);
    this.deps.setGainB(0);
    if (this.deps.setReplayGainA) this.deps.setReplayGainA(this.maxVolumeA);
    if (this.deps.setReplayGainB) this.deps.setReplayGainB(this.maxVolumeB);

    // Schedule B to start playing at fadeInStart (volumeFadeStart =
    // fadeInStart in all paths). startOffset = where B's playhead
    // begins in its own file so B reaches `entryPoint` at
    // `transitionEndTime`.
    this.deps.schedulePlayB(this.timings.startOffset, this.timings.fadeInStartTime);

    // Pre-arm rateB ramp (Fase 2E).
    this.setupTimeStretchRamp();

    // Start tick loop. setInterval throttles in background tabs;
    // acceptable for now — future: AudioWorklet timer.
    this.intervalHandle = setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);

    // Watchdog: force complete if tick somehow misses transitionEnd.
    const now = this.deps.getCurrentTime();
    const msUntilWatchdog = Math.max(
      0,
      (this.timings.transitionEndTime - now + WATCHDOG_GRACE_S) * 1000
    );
    this.watchdogHandle = setTimeout(() => {
      if (this.state === 'running') {
        this.completeCrossfade();
      }
    }, msUntilWatchdog);
  }

  /** Cancel the crossfade — used when the user skips, scrubs, or the
      caller decides to abort. Restores A to maxVolume, stops B,
      resets time-stretch. Idempotent. */
  cancel(): void {
    if (this.state === 'completed' || this.state === 'cancelled') return;
    this.state = 'cancelled';
    this.teardown();
    // Restore A to its pre-fade gain, silence B.
    this.deps.setGainA(this.maxVolumeA);
    this.deps.setGainB(0);
    this.deps.stopB();
    if (this.config.useTimeStretch) {
      this.deps.setPlaybackRateB(1.0);
    }
  }

  /** Returns the current state for the caller to query. */
  getState(): RuntimeState {
    return this.state;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal: tick loop
  // ──────────────────────────────────────────────────────────────────────────

  /** Tick — the heart of the runtime. Reads `now`, computes the 4
      pieces of audio state (A gain, B gain, A filters, B filters,
      rateB), writes via deps. */
  private tick(): void {
    if (this.state !== 'running') return;
    const now = this.deps.getCurrentTime();

    // Natural complete: t reached transitionEnd → fire onComplete.
    if (now >= this.timings.transitionEndTime) {
      this.completeCrossfade();
      return;
    }

    // ── Volume curves ──
    const ctx = this.gainContext();
    this.deps.setGainA(gainForPlayerA(now, ctx));
    this.deps.setGainB(gainForPlayerB(now, ctx));

    // ── Filter automation ──
    const aFilters = applyFiltersA(now, this.filterContext);
    if (aFilters.set) {
      this.deps.setBiquadCoeffsAll('A', aFilters.stages);
    }
    const bFilters = applyFiltersB(now, this.filterContext);
    if (bFilters.set) {
      this.deps.setBiquadCoeffsAll('B', bFilters.stages);
    }

    // ── rateB cosSquared ramp (Fase 2E) ──
    if (this.config.useTimeStretch && this.rateBRampActive) {
      if (now >= this.rateBRampEnd) {
        // Lock at target and disarm ramp.
        this.deps.setPlaybackRateB(this.config.rateB);
        this.rateBRampActive = false;
      } else if (now >= this.rateBRampStart) {
        const dur = this.rateBRampEnd - this.rateBRampStart;
        const p = Math.min(1, Math.max(0, (now - this.rateBRampStart) / dur));
        const angle = (p * Math.PI) / 2;
        const sinSq = Math.sin(angle) * Math.sin(angle);
        const rate = 1.0 + (this.config.rateB - 1.0) * sinSq;
        this.deps.setPlaybackRateB(rate);
      }
    }
  }

  /**
   * Pre-arm the rateB cosSquared ramp. Mirrors iOS:1282 setupTimeStretch.
   *
   * When `useTimeStretch + |rateB - 1| >= 0.02 + filterLead >= 0.6`:
   * ramp from 1.0 → rateB over [rampEnd - duration, rampEnd] with
   * `rampEnd = fadeInStart - 0.30 s` (the AU needs ~300 ms cushion
   * before mixerB opens). Duration = max(0.25, min(filterLead - 0.30,
   * 0.25 + 5 × |rateB - 1|)) capped at 1 s.
   *
   * Outside that gate (|rateB - 1| < 0.02 or filterLead < 0.6): set
   * rateB directly without ramp.
   */
  private setupTimeStretchRamp(): void {
    if (!this.config.useTimeStretch) return;
    const rateBDelta = Math.abs(this.config.rateB - 1.0);
    const hasRampMargin = this.timings.filterLead >= 0.6;
    if (rateBDelta >= 0.02 && hasRampMargin) {
      // Initialize B at rate 1.0 — ramp will move it.
      this.deps.setPlaybackRateB(1.0);
      const maxRampDuration = Math.min(1.0, this.timings.filterLead - 0.30);
      const rampDuration = Math.max(
        0.25,
        Math.min(maxRampDuration, 0.25 + 5.0 * rateBDelta)
      );
      this.rateBRampEnd = this.timings.fadeInStartTime - 0.30;
      this.rateBRampStart = this.rateBRampEnd - rampDuration;
      this.rateBRampActive = true;
    } else {
      // No ramp — set rateB directly (audible step but small enough).
      this.deps.setPlaybackRateB(this.config.rateB);
      this.rateBRampActive = false;
    }
  }

  /** Natural completion (t ≥ transitionEnd) — final state writes and
      callback. */
  private completeCrossfade(): void {
    if (this.state !== 'running') return;
    this.state = 'completed';
    this.teardown();
    // Final state: B at maxVolume, A at 0 (will be released by caller).
    this.deps.setGainA(0);
    this.deps.setGainB(this.maxVolumeB);
    // rateB locked at target.
    if (this.config.useTimeStretch) {
      this.deps.setPlaybackRateB(this.config.rateB);
    }
    this.deps.onComplete();
  }

  private teardown(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (this.watchdogHandle !== undefined) {
      clearTimeout(this.watchdogHandle);
      this.watchdogHandle = undefined;
    }
  }
}
