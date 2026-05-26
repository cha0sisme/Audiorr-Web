/**
 * Tests para CrossfadeRuntime — coreografía del fade end-to-end con
 * deps mockeadas. Verifica el orden de llamadas, transiciones de estado,
 * tick loop, rateB ramp, cancelación, watchdog.
 *
 * NO testea AudioContext real — eso es Fase 2F + tests manuales.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CrossfadeRuntime, type CrossfadeRuntimeDeps } from './crossfade-runtime';
import type { BiquadCoefficients } from './BiquadCoefficients';
import type { CrossfadeResult } from './dj-types';

// ============================================================================
// Fixtures
// ============================================================================

function makeConfig(overrides: Partial<CrossfadeResult> = {}): CrossfadeResult {
  return {
    entryPoint: 10,
    fadeDuration: 6,
    totalTime: 6,
    transitionType: 'CROSSFADE',
    useFilters: true,
    useAggressiveFilters: false,
    needsAnticipation: false,
    anticipationTime: 0,
    beatSyncInfo: '',
    isBeatSynced: false,
    useTimeStretch: false,
    rateA: 1.0,
    rateB: 1.0,
    energyA: 0.5,
    energyB: 0.5,
    beatIntervalA: 0.5,
    beatIntervalB: 0.5,
    downbeatTimesA: [],
    downbeatTimesB: [],
    realDownbeatsA: [],
    meterA: 4,
    useMidScoop: false,
    useHighShelfCut: false,
    isOutroInstrumental: false,
    isIntroInstrumental: false,
    danceability: 0.5,
    skipBFilters: false,
    useBassKill: false,
    useDynamicQ: false,
    useNotchSweep: false,
    useStutterCut: false,
    transitionReason: 'test',
    triggerBias: 0,
    triggerBiasReason: '',
    bIntroBars: 0,
    bImmediateImpact: false,
    bHarmonicClashLevel: 0,
    bRapidFadeIn: false,
    tier4Active: false,
    entryPointSource: 'unknown',
    chillRecipeApplied: false,
    ...overrides
  };
}

type MockDeps = CrossfadeRuntimeDeps & {
  /** Mutable simulated clock — tests advance this and the runtime reads
      via `getCurrentTime()`. */
  clock: { value: number };
  // Spy refs for assertions
  setGainA: Mock<(value: number) => void>;
  setGainB: Mock<(value: number) => void>;
  setBiquadCoeffsAll: Mock<(label: 'A' | 'B', stages: readonly BiquadCoefficients[]) => void>;
  schedulePlayB: Mock<(startOffset: number, atTime: number) => void>;
  stopB: Mock<() => void>;
  setPlaybackRateB: Mock<(rate: number) => void>;
  onComplete: Mock<() => void>;
};

function makeMockDeps(startTime = 0): MockDeps {
  const clock = { value: startTime };
  const setGainA = vi.fn<(value: number) => void>();
  const setGainB = vi.fn<(value: number) => void>();
  const setBiquadCoeffsAll = vi.fn<
    (label: 'A' | 'B', stages: readonly BiquadCoefficients[]) => void
  >();
  const schedulePlayB = vi.fn<(startOffset: number, atTime: number) => void>();
  const stopB = vi.fn<() => void>();
  const setPlaybackRateB = vi.fn<(rate: number) => void>();
  const onComplete = vi.fn<() => void>();
  return {
    clock,
    getCurrentTime: () => clock.value,
    setGainA,
    setGainB,
    setBiquadCoeffsAll,
    schedulePlayB,
    stopB,
    setPlaybackRateB,
    onComplete,
    tickIntervalMs: 1
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('CrossfadeRuntime — construction', () => {
  it('estado inicial idle', () => {
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps: makeMockDeps() });
    expect(rt.getState()).toBe('idle');
  });

  it('pre-computa timings, preset, bassSwapTime, stutterState', () => {
    const deps = makeMockDeps(100);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    expect(rt.timings.startTime).toBe(100);
    expect(rt.timings.transitionEndTime).toBeGreaterThan(100);
    expect(rt.preset).toBeDefined();
    expect(rt.bassSwapTime).toBeGreaterThan(rt.timings.volumeFadeStartTime);
  });

  it('aplica energy compensation a maxVolumeB cuando energyDiff>0.2', () => {
    const deps = makeMockDeps();
    const rt = new CrossfadeRuntime({
      config: makeConfig({ energyA: 0.7, energyB: 0.4 }),
      maxVolumeB: 0.6,
      deps
    });
    expect(rt.maxVolumeB).toBeGreaterThan(0.6);
  });
});

describe('CrossfadeRuntime — start()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('start() setea gain A a maxVolume, B a 0, programa B, transition state→running', () => {
    const deps = makeMockDeps();
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    expect(rt.getState()).toBe('running');
    expect(deps.setGainA).toHaveBeenCalledWith(1.0);
    expect(deps.setGainB).toHaveBeenCalledWith(0);
    expect(deps.schedulePlayB).toHaveBeenCalledTimes(1);
    expect(deps.schedulePlayB).toHaveBeenCalledWith(
      rt.timings.startOffset,
      rt.timings.fadeInStartTime
    );
  });

  it('start() idempotente — segunda llamada no programa B otra vez', () => {
    const deps = makeMockDeps();
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    rt.start();
    expect(deps.schedulePlayB).toHaveBeenCalledTimes(1);
  });
});

describe('CrossfadeRuntime — tick loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tick aplica gain via setGainA/B', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    // Avanzar clock al medio del fade.
    deps.clock.value = rt.timings.volumeFadeStartTime +
      (rt.timings.transitionEndTime - rt.timings.volumeFadeStartTime) * 0.5;
    vi.advanceTimersByTime(2);
    // setGainA/B llamados al menos 1 vez en el tick (más las llamadas
    // iniciales del start()). Al menos 2 llamadas a cada.
    expect(deps.setGainA.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(deps.setGainB.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('tick aplica filtros via setBiquadCoeffsAll cuando filterStart pasó', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({
      config: makeConfig({ useFilters: true, useMidScoop: true }),
      deps
    });
    rt.start();
    // Avanzar al medio del filter window.
    deps.clock.value = rt.timings.filterStartTime +
      (rt.timings.transitionEndTime - rt.timings.filterStartTime) * 0.5;
    vi.advanceTimersByTime(2);
    // setBiquadCoeffsAll debería llamarse para A (filter activo en mitad
    // del fade). Para B también si fadeInStart pasó.
    expect(deps.setBiquadCoeffsAll).toHaveBeenCalled();
    const calls = deps.setBiquadCoeffsAll.mock.calls;
    const labelsA = calls.filter((c) => c[0] === 'A');
    expect(labelsA.length).toBeGreaterThanOrEqual(1);
  });

  it('tick dispara completeCrossfade al alcanzar transitionEnd', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    // Avanzar clock más allá del fin.
    deps.clock.value = rt.timings.transitionEndTime + 0.1;
    vi.advanceTimersByTime(2);
    expect(rt.getState()).toBe('completed');
    expect(deps.onComplete).toHaveBeenCalledTimes(1);
    // Final state: A=0, B=maxVolumeB.
    expect(deps.setGainA).toHaveBeenLastCalledWith(0);
    expect(deps.setGainB).toHaveBeenLastCalledWith(rt.maxVolumeB);
  });
});

describe('CrossfadeRuntime — cancel()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel() detiene tick, restaura A, silencia B, stopB', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    rt.cancel();
    expect(rt.getState()).toBe('cancelled');
    // Última llamada de gainA debería ser maxVolume (restore).
    expect(deps.setGainA).toHaveBeenLastCalledWith(rt.maxVolumeA);
    expect(deps.setGainB).toHaveBeenLastCalledWith(0);
    expect(deps.stopB).toHaveBeenCalledTimes(1);
  });

  it('cancel() idempotente', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    rt.cancel();
    rt.cancel();
    expect(deps.stopB).toHaveBeenCalledTimes(1);
  });

  it('cancel() previene completeCrossfade aunque el clock avance', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    rt.cancel();
    deps.clock.value = rt.timings.transitionEndTime + 1;
    vi.advanceTimersByTime(5);
    expect(deps.onComplete).not.toHaveBeenCalled();
  });
});

describe('CrossfadeRuntime — rateB ramp (Fase 2E)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('useTimeStretch=false → setPlaybackRateB NO se llama', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({
      config: makeConfig({ useTimeStretch: false }),
      deps
    });
    rt.start();
    expect(deps.setPlaybackRateB).not.toHaveBeenCalled();
  });

  it('useTimeStretch + |rateB-1| < 0.02 → rate set directo (sin ramp)', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({
      config: makeConfig({
        useTimeStretch: true,
        rateB: 1.01 // delta=0.01 < 0.02
      }),
      deps
    });
    rt.start();
    expect(deps.setPlaybackRateB).toHaveBeenCalledWith(1.01);
  });

  it('useTimeStretch + delta>=0.02 + filterLead>=0.6 → ramp activo', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({
      config: makeConfig({
        useTimeStretch: true,
        rateB: 1.05, // delta=0.05
        useFilters: true,
        fadeDuration: 10
      }),
      deps
    });
    rt.start();
    // setPlaybackRateB(1.0) inicial (pre-ramp).
    expect(deps.setPlaybackRateB).toHaveBeenCalledWith(1.0);

    // Avanzar al final → debería settear en config.rateB.
    deps.clock.value = rt.timings.transitionEndTime + 0.1;
    vi.advanceTimersByTime(2);
    expect(deps.setPlaybackRateB).toHaveBeenCalledWith(1.05);
  });
});

describe('CrossfadeRuntime — watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('watchdog fuerza complete si el tick no lo hace', () => {
    const deps = makeMockDeps(0);
    const rt = new CrossfadeRuntime({ config: makeConfig(), deps });
    rt.start();
    // No movemos el clock — el tick lee always 0, nunca alcanza
    // transitionEnd. El watchdog setTimeout debería disparar.
    const watchdogMs = (rt.timings.transitionEndTime - 0 + 0.5) * 1000;
    vi.advanceTimersByTime(watchdogMs + 10);
    expect(rt.getState()).toBe('completed');
    expect(deps.onComplete).toHaveBeenCalledTimes(1);
  });
});
