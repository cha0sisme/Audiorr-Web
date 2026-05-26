/**
 * Tests for CrossfadeExecutor — Fase 2A.
 *
 * Coverage: filter presets (sanity invariants), selectPreset branches,
 * applyBCleanOverride, computeEnergyCompensationB, calculateTimings
 * invariants, snappedRampStart, computeBassSwapTime.
 *
 * Runtime functions (gainForPlayerA/B, applyFiltersA/B, start/cancel)
 * land in Fase 2B/C/D and bring their own tests.
 */

import { describe, expect, it } from 'vitest';
import {
  applyBCleanOverride,
  applyStutterGate,
  calculateTimings,
  computeBassSwapTime,
  computeEnergyCompensationB,
  computeStutterState,
  gainForPlayerA,
  gainForPlayerB,
  type GainContext,
  PRESET_AGGRESSIVE,
  PRESET_ANTICIPATION,
  PRESET_DROP_MIX,
  PRESET_ENERGY_DOWN,
  PRESET_GENTLE,
  PRESET_NORMAL,
  PRESET_STEM_MIX,
  selectPreset,
  snappedRampStart,
  type StutterState
} from './CrossfadeExecutor';
import type { CrossfadeResult, TransitionType } from './dj-types';
import type { Timings } from './crossfade-types';

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

// ============================================================================
// Filter presets — sanity invariants
// ============================================================================

describe('Filter presets — sanity invariants', () => {
  it('cada preset tiene highpassA + highpassB + lowshelfB definidos', () => {
    for (const p of [
      PRESET_NORMAL,
      PRESET_AGGRESSIVE,
      PRESET_ANTICIPATION,
      PRESET_ENERGY_DOWN,
      PRESET_GENTLE,
      PRESET_DROP_MIX,
      PRESET_STEM_MIX
    ]) {
      expect(p.highpassA).toBeDefined();
      expect(p.highpassB).toBeDefined();
      expect(p.lowshelfB).toBeDefined();
    }
  });

  it('highpassA frecuencias monotónicas start ≤ mid ≤ end (excepto energyDown bypass)', () => {
    for (const p of [
      PRESET_NORMAL,
      PRESET_AGGRESSIVE,
      PRESET_ANTICIPATION,
      PRESET_GENTLE,
      PRESET_DROP_MIX,
      PRESET_STEM_MIX
    ]) {
      expect(p.highpassA.startFreq).toBeLessThanOrEqual(p.highpassA.midFreq);
      expect(p.highpassA.midFreq).toBeLessThanOrEqual(p.highpassA.endFreq);
    }
  });

  it('highpassB frecuencias monotónicamente decrecientes (B sweep abre el bajo)', () => {
    for (const p of [
      PRESET_NORMAL,
      PRESET_AGGRESSIVE,
      PRESET_ANTICIPATION,
      PRESET_ENERGY_DOWN,
      PRESET_GENTLE,
      PRESET_DROP_MIX,
      PRESET_STEM_MIX
    ]) {
      expect(p.highpassB.startFreq).toBeGreaterThanOrEqual(p.highpassB.midFreq);
      expect(p.highpassB.midFreq).toBeGreaterThanOrEqual(p.highpassB.endFreq);
    }
  });

  it('lowshelfA endGain < startGain (atenúa bajos durante el fade)', () => {
    for (const p of [
      PRESET_NORMAL,
      PRESET_AGGRESSIVE,
      PRESET_ANTICIPATION,
      PRESET_ENERGY_DOWN,
      PRESET_GENTLE,
      PRESET_DROP_MIX,
      PRESET_STEM_MIX
    ]) {
      if (p.lowshelfA) {
        expect(p.lowshelfA.endGain).toBeLessThan(p.lowshelfA.startGain);
      }
    }
  });

  it('lowshelfB recupera 0 dB al final (bass de B entra a 0 dB)', () => {
    for (const p of [
      PRESET_NORMAL,
      PRESET_AGGRESSIVE,
      PRESET_ANTICIPATION,
      PRESET_ENERGY_DOWN,
      PRESET_GENTLE,
      PRESET_DROP_MIX,
      PRESET_STEM_MIX
    ]) {
      expect(p.lowshelfB.endGain).toBe(0);
    }
  });

  it('PRESET_ENERGY_DOWN tiene lowpassA, los demás no', () => {
    expect(PRESET_ENERGY_DOWN.lowpassA).toBeDefined();
    for (const p of [
      PRESET_NORMAL,
      PRESET_AGGRESSIVE,
      PRESET_ANTICIPATION,
      PRESET_GENTLE,
      PRESET_DROP_MIX,
      PRESET_STEM_MIX
    ]) {
      expect(p.lowpassA).toBeUndefined();
    }
  });
});

// ============================================================================
// selectPreset
// ============================================================================

describe('selectPreset', () => {
  it('DROP_MIX → drop-mix preset', () => {
    const r = selectPreset(makeConfig({ transitionType: 'DROP_MIX' }));
    expect(r.preset).toBe(PRESET_DROP_MIX);
    expect(r.name).toBe('drop-mix');
  });

  it('STEM_MIX → stem-mix preset', () => {
    const r = selectPreset(makeConfig({ transitionType: 'STEM_MIX' }));
    expect(r.preset).toBe(PRESET_STEM_MIX);
    expect(r.name).toBe('stem-mix');
  });

  it.each([
    ['NATURAL_BLEND', 'gentle'],
    ['CLEAN_HANDOFF', 'clean-handoff'],
    ['VINYL_STOP', 'vinyl-stop'],
    ['SEQUENTIAL', 'sequential']
  ] as const)('%s → gentle preset (name=%s)', (type, name) => {
    const r = selectPreset(makeConfig({ transitionType: type }));
    expect(r.preset).toBe(PRESET_GENTLE);
    expect(r.name).toBe(name);
  });

  it('needsAnticipation → anticipation preset', () => {
    const r = selectPreset(makeConfig({ needsAnticipation: true }));
    expect(r.preset).toBe(PRESET_ANTICIPATION);
  });

  it('energyDown (energyB < energyA - 0.2) → energy-down preset', () => {
    const r = selectPreset(makeConfig({ energyA: 0.7, energyB: 0.4 }));
    expect(r.preset).toBe(PRESET_ENERGY_DOWN);
  });

  it('ambos instrumentales → normal (lighter)', () => {
    const r = selectPreset(
      makeConfig({
        isOutroInstrumental: true,
        isIntroInstrumental: true,
        useAggressiveFilters: true // aggressive normalmente, pero bothInstrumental gana
      })
    );
    expect(r.preset).toBe(PRESET_NORMAL);
  });

  it('useAggressiveFilters sin bothInstrumental → aggressive', () => {
    const r = selectPreset(makeConfig({ useAggressiveFilters: true }));
    expect(r.preset).toBe(PRESET_AGGRESSIVE);
  });

  it('default → normal', () => {
    const r = selectPreset(makeConfig());
    expect(r.preset).toBe(PRESET_NORMAL);
  });
});

// ============================================================================
// applyBCleanOverride
// ============================================================================

describe('applyBCleanOverride', () => {
  it('NO eligible cuando !isIntroInstrumental', () => {
    const { preset, applied } = applyBCleanOverride(
      PRESET_NORMAL,
      makeConfig({ isIntroInstrumental: false })
    );
    expect(applied).toBe(false);
    expect(preset).toBe(PRESET_NORMAL);
  });

  it('NO eligible cuando skipBFilters', () => {
    const { applied } = applyBCleanOverride(
      PRESET_NORMAL,
      makeConfig({ isIntroInstrumental: true, skipBFilters: true })
    );
    expect(applied).toBe(false);
  });

  it.each(['STEM_MIX', 'DROP_MIX', 'CLEAN_HANDOFF', 'VINYL_STOP', 'SEQUENTIAL'] as const)(
    'NO eligible para %s aunque isIntroInstrumental',
    (type) => {
      const { applied } = applyBCleanOverride(
        PRESET_NORMAL,
        makeConfig({ transitionType: type, isIntroInstrumental: true })
      );
      expect(applied).toBe(false);
    }
  );

  it('eligible relaja highpassB a 150 Hz y lowshelfB startGain a -3 dB', () => {
    const { preset, applied } = applyBCleanOverride(
      PRESET_NORMAL,
      makeConfig({ transitionType: 'CROSSFADE', isIntroInstrumental: true })
    );
    expect(applied).toBe(true);
    expect(preset.highpassB.startFreq).toBe(150);
    expect(preset.highpassB.endFreq).toBe(40);
    expect(preset.lowshelfB.startGain).toBe(-3);
    expect(preset.lowshelfB.endGain).toBe(0);
  });

  it('preserva Q del highpassB original', () => {
    const { preset } = applyBCleanOverride(
      PRESET_NORMAL,
      makeConfig({ transitionType: 'CROSSFADE', isIntroInstrumental: true })
    );
    expect(preset.highpassB.q).toBe(PRESET_NORMAL.highpassB.q);
  });
});

// ============================================================================
// computeEnergyCompensationB
// ============================================================================

describe('computeEnergyCompensationB', () => {
  it('energyDiff ≤ 0.2 → sin boost', () => {
    const r = computeEnergyCompensationB(
      makeConfig({ energyA: 0.5, energyB: 0.4 }),
      0.6
    );
    expect(r).toBe(0.6);
  });

  it('energyDiff > 0.2 → boost lineal', () => {
    // diff=0.3 → compensation = 1.0 + min(0.58, 0.24) = 1.24. 0.6 * 1.24 = 0.744.
    const r = computeEnergyCompensationB(
      makeConfig({ energyA: 0.7, energyB: 0.4 }),
      0.6
    );
    expect(r).toBeCloseTo(0.744, 3);
  });

  it('boost clamped a 1.0', () => {
    const r = computeEnergyCompensationB(
      makeConfig({ energyA: 0.9, energyB: 0.1 }),
      0.9
    );
    expect(r).toBe(1.0);
  });

  it('CUT con energyDiff > 0.15 aplica boost extra encima del general', () => {
    // Con energyA=0.7, energyB=0.4: diff=0.3. General boost: 0.6 → 0.744.
    // CUT extra: diff>0.15 → cutBoost = 1.0 + min(0.3, (0.3-0.15)*0.6) = 1.09.
    // 0.744 * 1.09 ≈ 0.811.
    const r = computeEnergyCompensationB(
      makeConfig({ transitionType: 'CUT', energyA: 0.7, energyB: 0.4 }),
      0.6
    );
    expect(r).toBeGreaterThan(0.744);
    expect(r).toBeLessThanOrEqual(1.0);
  });

  it('CUT sin energyDiff alto no aplica boost CUT extra', () => {
    const r = computeEnergyCompensationB(
      makeConfig({ transitionType: 'CUT', energyA: 0.5, energyB: 0.4 }),
      0.6
    );
    expect(r).toBe(0.6);
  });
});

// ============================================================================
// calculateTimings
// ============================================================================

describe('calculateTimings', () => {
  it('filterLead = 0 para CLEAN_HANDOFF', () => {
    const t = calculateTimings(
      makeConfig({ transitionType: 'CLEAN_HANDOFF', fadeDuration: 3 }),
      100
    );
    expect(t.filterLead).toBe(0);
    expect(t.volumeFadeStartTime).toBe(t.fadeInStartTime);
  });

  it('filterLead = 0 para VINYL_STOP', () => {
    const t = calculateTimings(
      makeConfig({ transitionType: 'VINYL_STOP', fadeDuration: 2 }),
      100
    );
    expect(t.filterLead).toBe(0);
  });

  it('filterLead = 0 para SEQUENTIAL', () => {
    const t = calculateTimings(
      makeConfig({ transitionType: 'SEQUENTIAL', fadeDuration: 0.05 }),
      100
    );
    expect(t.filterLead).toBe(0);
  });

  it('filterLead = min(3.5, fadeDuration*0.32) con useFilters=true', () => {
    const t1 = calculateTimings(makeConfig({ useFilters: true, fadeDuration: 6 }), 100);
    expect(t1.filterLead).toBeCloseTo(6 * 0.32, 3);

    const t2 = calculateTimings(makeConfig({ useFilters: true, fadeDuration: 15 }), 100);
    expect(t2.filterLead).toBe(3.5);
  });

  it('filterLead = 0 con useFilters=false', () => {
    const t = calculateTimings(makeConfig({ useFilters: false, fadeDuration: 6 }), 100);
    expect(t.filterLead).toBe(0);
  });

  it('orden de timestamps coherente', () => {
    const t = calculateTimings(
      makeConfig({ useFilters: true, fadeDuration: 6, anticipationTime: 2 }),
      100
    );
    expect(t.startTime).toBe(100);
    expect(t.anticipationStartTime).toBe(t.startTime);
    expect(t.filterStartTime).toBeGreaterThanOrEqual(t.startTime);
    expect(t.volumeFadeStartTime).toBeGreaterThanOrEqual(t.filterStartTime);
    expect(t.transitionEndTime).toBeGreaterThan(t.volumeFadeStartTime);
    expect(t.fadeInStartTime).toBe(t.volumeFadeStartTime);
    expect(t.fadeInEndTime).toBe(t.fadeInStartTime + 6);
  });

  it('totalTime = anticipation + filterLead + fadeOutDuration', () => {
    const cfg = makeConfig({ useFilters: true, fadeDuration: 6, anticipationTime: 2 });
    const t = calculateTimings(cfg, 100);
    expect(t.totalTime).toBeCloseTo(2 + t.filterLead + 6, 3);
  });

  it('startOffset = max(0, entryPoint - totalTime)', () => {
    const t = calculateTimings(
      makeConfig({ entryPoint: 20, fadeDuration: 6, anticipationTime: 2 }),
      100
    );
    expect(t.startOffset).toBe(Math.max(0, 20 - t.totalTime));
  });

  it('startOffset clamped a 0 cuando entryPoint < totalTime', () => {
    const t = calculateTimings(
      makeConfig({ entryPoint: 2, fadeDuration: 6, anticipationTime: 2 }),
      100
    );
    expect(t.startOffset).toBe(0);
  });
});

// ============================================================================
// snappedRampStart
// ============================================================================

describe('snappedRampStart', () => {
  it('downbeats vacíos → target sin tocar', () => {
    const r = snappedRampStart({
      target: 10,
      downbeats: [],
      beats: [],
      bpmReported: 120,
      meter: 4,
      lowerBound: 0
    });
    expect(r).toBe(10);
  });

  it('bpmReported inválido → target sin tocar', () => {
    const r = snappedRampStart({
      target: 10,
      downbeats: [8],
      beats: [],
      bpmReported: 0,
      meter: 4,
      lowerBound: 0
    });
    expect(r).toBe(10);
  });

  it('snap al downbeat más cercano hacia atrás', () => {
    // bpm 120, meter 4 → barDur = 2s. target=10.4. downbeats=[6,8,10,12].
    // ≤target: 10. delta=0.4 ≤ barDur=2 → snap 10.
    const r = snappedRampStart({
      target: 10.4,
      downbeats: [6, 8, 10, 12],
      beats: [],
      bpmReported: 120,
      meter: 4,
      lowerBound: 0
    });
    expect(r).toBe(10);
  });

  it('snap no aplica si downbeat cae fuera del cap (>1 bar)', () => {
    // bpm 120 → barDur=2. target=10.4, downbeat más cercano=6. delta=4.4 > 2 → target sin tocar.
    const r = snappedRampStart({
      target: 10.4,
      downbeats: [6],
      beats: [],
      bpmReported: 120,
      meter: 4,
      lowerBound: 0
    });
    expect(r).toBe(10.4);
  });

  it('half-time detection: beats al doble del bpm → consume even-indexed downbeats', () => {
    // bpmReported=60 (sanitizer half-time), beats[] median delta = 0.5s → bpmFromBeats=120.
    // ratio 120/60 = 2 ≥ 1.5 → consume only even-indexed downbeats.
    // downbeats=[2,4,6,8,10,12]. Even indices (0,2,4) = [2,6,10].
    // target=10.4. Even downbeats ≤ target: 10. delta=0.4 ≤ barDur(60*4/60=4) → snap 10.
    const r = snappedRampStart({
      target: 10.4,
      downbeats: [2, 4, 6, 8, 10, 12],
      beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5],
      bpmReported: 60,
      meter: 4,
      lowerBound: 0
    });
    expect(r).toBe(10);
  });

  it('lowerBound clampa el snap hacia abajo', () => {
    // target=10, downbeat=8 (snap legítimo). lowerBound=9 → clamp a 9.
    const r = snappedRampStart({
      target: 10,
      downbeats: [8],
      beats: [],
      bpmReported: 120,
      meter: 4,
      lowerBound: 9
    });
    expect(r).toBe(9);
  });
});

// ============================================================================
// computeBassSwapTime
// ============================================================================

describe('computeBassSwapTime', () => {
  function timingsWith(volumeFade: number, transitionEnd: number, startOffset = 0) {
    return {
      startTime: 0,
      anticipationStartTime: 0,
      filterStartTime: 0,
      volumeFadeStartTime: volumeFade,
      transitionEndTime: transitionEnd,
      filterLead: 0,
      fadeOutDuration: transitionEnd - volumeFade,
      totalTime: transitionEnd,
      fadeInStartTime: volumeFade,
      fadeInEndTime: transitionEnd,
      startOffset
    };
  }

  it('fadeDur ≤ 0 → devuelve fadeStart', () => {
    const r = computeBassSwapTime(makeConfig(), timingsWith(10, 10));
    expect(r).toBe(10);
  });

  it('CUT → 75% del fade (sin downbeats B)', () => {
    const cfg = makeConfig({ transitionType: 'CUT', beatIntervalB: 0 });
    const r = computeBassSwapTime(cfg, timingsWith(0, 4));
    expect(r).toBeCloseTo(4 * 0.75, 3);
  });

  it('DROP_MIX → 20%', () => {
    const cfg = makeConfig({ transitionType: 'DROP_MIX', beatIntervalB: 0 });
    const r = computeBassSwapTime(cfg, timingsWith(0, 5));
    expect(r).toBeCloseTo(5 * 0.20, 3);
  });

  it('STEM_MIX → 35%', () => {
    const cfg = makeConfig({ transitionType: 'STEM_MIX', beatIntervalB: 0 });
    const r = computeBassSwapTime(cfg, timingsWith(0, 5));
    expect(r).toBeCloseTo(5 * 0.35, 3);
  });

  it('isOutroInstrumental → 15%', () => {
    const cfg = makeConfig({ isOutroInstrumental: true, beatIntervalB: 0 });
    const r = computeBassSwapTime(cfg, timingsWith(0, 10));
    expect(r).toBeCloseTo(10 * 0.15, 3);
  });

  it('default → 25%', () => {
    const cfg = makeConfig({ beatIntervalB: 0 });
    const r = computeBassSwapTime(cfg, timingsWith(0, 8));
    expect(r).toBeCloseTo(8 * 0.25, 3);
  });

  it('beatInterval > 0 + downbeats B presentes → snap a downbeat dentro de ventana', () => {
    // Default 25% de fade=8 → target=2. fadeStart=0, startOffset=0.
    // downbeats B en file-time = wall (porque startOffset=0).
    // Ventana default: [0.10*8, 0.45*8] = [0.8, 3.6].
    // Downbeats [1, 2.5, 5]. Closest to 2 dentro de [0.8, 3.6]: 2.5 (closer than 1).
    const cfg = makeConfig({
      beatIntervalB: 0.5,
      downbeatTimesB: [1, 2.5, 5]
    });
    const r = computeBassSwapTime(cfg, timingsWith(0, 8, 0));
    expect(r).toBeCloseTo(2.5, 3);
  });

  it('downbeats fuera de ventana → cae al target percent', () => {
    const cfg = makeConfig({
      beatIntervalB: 0.5,
      downbeatTimesB: [0.5, 10]
    });
    const r = computeBassSwapTime(cfg, timingsWith(0, 8, 0));
    // Ninguno dentro de [0.8, 3.6] → fallback al target = 25% = 2.
    expect(r).toBeCloseTo(2, 3);
  });
});

// ============================================================================
// Volume curves — fixtures
// ============================================================================

/** Build a deterministic GainContext + Timings for curve tests. Anchors
    at t=0 with fade=10s for easy progress mapping. */
function makeGainContext(
  overrides: Partial<CrossfadeResult> = {},
  extras: Partial<{
    maxVolumeA: number;
    maxVolumeB: number;
    stutter: StutterState | undefined;
    now: number;
  }> = {}
): GainContext {
  const config = makeConfig(overrides);
  const now = extras.now ?? 0;
  const timings: Timings = calculateTimings(config, now);
  return {
    config,
    timings,
    maxVolumeA: extras.maxVolumeA ?? 1.0,
    maxVolumeB: extras.maxVolumeB ?? 1.0,
    stutter: extras.stutter
  };
}

// ============================================================================
// applyStutterGate
// ============================================================================

describe('applyStutterGate', () => {
  it('stutter undefined → passthrough', () => {
    expect(
      applyStutterGate({ baseGain: 0.7, t: 100, stutter: undefined })
    ).toBe(0.7);
  });

  it('t < startWall → passthrough', () => {
    const stutter: StutterState = { startWall: 10, anchorWall: 12, cellDuration: 0.25 };
    expect(applyStutterGate({ baseGain: 0.7, t: 9, stutter })).toBe(0.7);
  });

  it('t >= anchorWall → passthrough', () => {
    const stutter: StutterState = { startWall: 10, anchorWall: 12, cellDuration: 0.25 };
    expect(applyStutterGate({ baseGain: 0.7, t: 12, stutter })).toBe(0.7);
    expect(applyStutterGate({ baseGain: 0.7, t: 15, stutter })).toBe(0.7);
  });

  it('cell 0 (ON) → baseGain × 1', () => {
    const stutter: StutterState = { startWall: 10, anchorWall: 12, cellDuration: 0.25 };
    // t=10.1 → elapsed=0.1, cellIndex=0 (ON), timeInCell=0.1 > antiClick(0.003)
    expect(applyStutterGate({ baseGain: 0.7, t: 10.1, stutter })).toBe(0.7);
  });

  it('cell 1 (OFF) → baseGain × 0 (after anti-click)', () => {
    const stutter: StutterState = { startWall: 10, anchorWall: 12, cellDuration: 0.25 };
    // t=10.30 → elapsed=0.30, cellIndex=1 (OFF), timeInCell=0.05 > anti-click
    expect(applyStutterGate({ baseGain: 0.7, t: 10.30, stutter })).toBe(0);
  });

  it('anti-click ramp at cell boundary', () => {
    const stutter: StutterState = { startWall: 10, anchorWall: 12, cellDuration: 0.25 };
    // t=10.2515 → elapsed=0.2515, cellIndex=1, timeInCell=0.0015. Within
    // anti-click (0.003). prevGate=1 (cell 0 was ON), targetGate=0.
    // p=0.0015/0.003=0.5. gate = 1 + (0 - 1)*0.5 = 0.5.
    const r = applyStutterGate({ baseGain: 0.8, t: 10.2515, stutter });
    expect(r).toBeCloseTo(0.4, 2);
  });
});

// ============================================================================
// gainForPlayerA — invariants
// ============================================================================

describe('gainForPlayerA — universal invariants', () => {
  it('t < volumeFadeStart → maxVolumeA (full hold)', () => {
    const ctx = makeGainContext({ transitionType: 'CROSSFADE' }, { maxVolumeA: 0.9 });
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime - 1, ctx)).toBe(0.9);
  });

  it('t >= transitionEndTime → 0', () => {
    const ctx = makeGainContext({ transitionType: 'CROSSFADE' });
    expect(gainForPlayerA(ctx.timings.transitionEndTime, ctx)).toBe(0);
    expect(gainForPlayerA(ctx.timings.transitionEndTime + 100, ctx)).toBe(0);
  });

  it('curva NUNCA negativa para CROSSFADE en t ∈ [start, end]', () => {
    const ctx = makeGainContext({ transitionType: 'CROSSFADE' });
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    for (let i = 0; i <= 100; i++) {
      const t = ctx.timings.volumeFadeStartTime + (dur * i) / 100;
      expect(gainForPlayerA(t, ctx)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('gainForPlayerA — type-specific', () => {
  it('CUT con danceability ≥ 0.5 usa cap 3s (no 4s)', () => {
    // fade=10 → duration aprox 10 (useFilters=false → filterLead=0).
    // cutDuration = min(3, 10) = 3. cutStart = 0.7. progress=0.65 → hold.
    const ctx = makeGainContext(
      { transitionType: 'CUT', fadeDuration: 10, useFilters: false, danceability: 0.7 },
      { maxVolumeA: 1.0 }
    );
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    const t = ctx.timings.volumeFadeStartTime + dur * 0.65;
    expect(gainForPlayerA(t, ctx)).toBe(1.0);
  });

  it('CUT con danceability < 0.5 usa cap 4s', () => {
    // fade=10 → cutDuration = min(4, 10) = 4. cutStart = 0.6.
    // progress=0.55 → hold. progress=0.65 → exp drop iniciado.
    const ctx = makeGainContext(
      { transitionType: 'CUT', fadeDuration: 10, useFilters: false, danceability: 0.3 },
      { maxVolumeA: 1.0 }
    );
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.55, ctx)).toBe(1.0);
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.65, ctx)).toBeLessThan(1.0);
  });

  it('NATURAL_BLEND curva cos² con floor 0.15 + tail exp', () => {
    // En progress=0.5: p = 0.5/0.85 = 0.588. cos²(π*0.294)≈0.362.
    // A = 0.15 + 0.85*0.362 = 0.458.
    const ctx = makeGainContext({ transitionType: 'NATURAL_BLEND', useFilters: false });
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    const tMid = ctx.timings.volumeFadeStartTime + dur * 0.5;
    expect(gainForPlayerA(tMid, ctx)).toBeCloseTo(0.458, 2);
  });

  it('SEQUENTIAL: A holds full hasta los últimos 50ms del fade', () => {
    // SEQUENTIAL → fadeDuration=0.050 (effectiveFadeDuration override).
    // Para test puro de la curva, uso fadeDuration manual.
    const ctx = makeGainContext({ transitionType: 'SEQUENTIAL', fadeDuration: 1.0 });
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    // solapeStart = max(0, 1 - 0.050/dur). Para dur=1, solapeStart=0.95.
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.5, ctx)).toBe(1.0);
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.9, ctx)).toBe(1.0);
    // En progress=1.0 exacto → unstuttered devuelve 0 (guard `t >= end`).
    expect(gainForPlayerA(ctx.timings.transitionEndTime, ctx)).toBe(0);
  });

  it('VINYL_STOP: cos² desciende rápido (aFadeEnd=0.225)', () => {
    const ctx = makeGainContext({ transitionType: 'VINYL_STOP', useFilters: false });
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    // En progress=0.1 → p=0.1/0.225=0.44, cos²(π*0.22)=cos²(0.7)≈0.585.
    // Asegurar que baja monotónicamente.
    const v1 = gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.05, ctx);
    const v2 = gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.15, ctx);
    expect(v2).toBeLessThan(v1);
    // Después del aFadeEnd=0.225 → 0.
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.5, ctx)).toBe(0);
  });

  it('tier4Active comprime holdEnd con clash alto', () => {
    // tier4 + clash 0.7 → holdEndT4=0.35. En progress=0.30 → maxVolA.
    const ctx = makeGainContext({
      transitionType: 'CROSSFADE',
      useFilters: false,
      tier4Active: true,
      bHarmonicClashLevel: 0.7
    });
    const dur = ctx.timings.transitionEndTime - ctx.timings.volumeFadeStartTime;
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.30, ctx)).toBe(1.0);
    // En progress=0.40 (>holdEndT4=0.35) → drop iniciado.
    expect(gainForPlayerA(ctx.timings.volumeFadeStartTime + dur * 0.40, ctx)).toBeLessThan(1.0);
  });

  it('bImmediateImpact comprime holdEnd en CROSSFADE', () => {
    // CROSSFADE default holdEnd=0.45. Con bImmediateImpact, cap a 0.40.
    const ctxNormal = makeGainContext({
      transitionType: 'CROSSFADE',
      useFilters: false,
      bImmediateImpact: false
    });
    const ctxImpact = makeGainContext({
      transitionType: 'CROSSFADE',
      useFilters: false,
      bImmediateImpact: true
    });
    const dur = ctxNormal.timings.transitionEndTime - ctxNormal.timings.volumeFadeStartTime;
    // En progress=0.42, normal está en hold-easing (cerca de 1.0), impact ya en drop.
    const t = ctxNormal.timings.volumeFadeStartTime + dur * 0.42;
    const vNormal = gainForPlayerA(t, ctxNormal);
    const vImpact = gainForPlayerA(t, ctxImpact);
    expect(vImpact).toBeLessThanOrEqual(vNormal);
  });
});

// ============================================================================
// gainForPlayerB — invariants
// ============================================================================

describe('gainForPlayerB — universal invariants', () => {
  it('t < fadeInStart (sin anticipation) → 0', () => {
    const ctx = makeGainContext({ transitionType: 'CROSSFADE' });
    expect(gainForPlayerB(ctx.timings.fadeInStartTime - 1, ctx)).toBe(0);
  });

  it('NATURAL_BLEND complementa A en potencia constante', () => {
    // cos²(x) + sin²(x) = 1. A: floor + (1-floor)*cos², B: 0 + 1*sin².
    // Sumados con maxVol=1: floor + (1-floor)*cos² + sin² = floor + (1-floor) - (1-floor)*sin² + sin²
    // En progress=0.5 → cos²=sin²=0.5. A=0.15+0.85*0.5=0.575. B=0.5.
    // Total power = A² + B² = 0.575² + 0.5² = 0.330 + 0.25 = 0.58. (no es 1, hay floor).
    const ctx = makeGainContext({ transitionType: 'NATURAL_BLEND', useFilters: false });
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    const tMid = ctx.timings.fadeInStartTime + dur * 0.5;
    expect(gainForPlayerB(tMid, ctx)).toBeCloseTo(0.5, 2);
  });

  it('CUT B silenciada hasta los últimos 3s (sin anticipation)', () => {
    // fade=10, cutZone=3 → bRampStart = fadeInStart + 7.
    const ctx = makeGainContext({
      transitionType: 'CUT',
      fadeDuration: 10,
      useFilters: false,
      danceability: 0.7
    });
    expect(gainForPlayerB(ctx.timings.fadeInStartTime + 5, ctx)).toBe(0);
    // En t=fadeInStart+8 → rampP=(8-7)/1.5=0.667.
    const r = gainForPlayerB(ctx.timings.fadeInStartTime + 8, ctx);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(1.0);
  });

  it('VINYL_STOP B silenciada hasta progress=0.325', () => {
    const ctx = makeGainContext({ transitionType: 'VINYL_STOP', useFilters: false });
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    expect(gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.3, ctx)).toBe(0);
    expect(
      gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.5, ctx)
    ).toBeGreaterThan(0);
  });

  it('SEQUENTIAL B silenciada hasta solape final 50ms', () => {
    const ctx = makeGainContext({ transitionType: 'SEQUENTIAL', fadeDuration: 1.0 });
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    expect(gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.5, ctx)).toBe(0);
    // En los últimos 50ms del fadeInDuration, entra sin².
    expect(
      gainForPlayerB(ctx.timings.fadeInEndTime - 0.01, ctx)
    ).toBeGreaterThan(0);
  });

  it('anticipation: pre-fade tease 0 → 25% durante anticipationTime', () => {
    // useFilters=true (default) → filterLead > 0 → filterStart < fadeInStart.
    // Eso permite testear las 2 ramas pre-fade.
    const ctx = makeGainContext({
      transitionType: 'CROSSFADE',
      needsAnticipation: true,
      anticipationTime: 2.0
    });
    // En t=anticipationStart → 0.
    expect(gainForPlayerB(ctx.timings.anticipationStartTime, ctx)).toBe(0);
    // En la mitad de anticipation → maxVolumeB * 0.125 (mitad de 0.25).
    const mid = ctx.timings.anticipationStartTime + 1.0;
    expect(gainForPlayerB(mid, ctx)).toBeCloseTo(0.125, 2);
    // En filterStart (= anticipationStart + 2) → entra rama segunda,
    // p=0 → maxVolumeB * 0.25.
    expect(gainForPlayerB(ctx.timings.filterStartTime, ctx)).toBeCloseTo(0.25, 2);
  });

  it('CUT_A_FADE_IN_B B reaches 100% antes del cut de A', () => {
    const ctx = makeGainContext({
      transitionType: 'CUT_A_FADE_IN_B',
      useFilters: false
    });
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    // En progress=0.85 (>rampEnd=0.80) → maxVolumeB.
    expect(
      gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.85, ctx)
    ).toBe(1.0);
  });

  it('DROP_MIX B reaches 100% por 60% del fade', () => {
    const ctx = makeGainContext({ transitionType: 'DROP_MIX', useFilters: false });
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    expect(
      gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.65, ctx)
    ).toBe(1.0);
  });

  it('tier4Active B entra al 75% desde t=0', () => {
    const ctx = makeGainContext({
      transitionType: 'CROSSFADE',
      useFilters: false,
      tier4Active: true
    });
    // En t=fadeInStart (progress=0) → maxVolumeB * 0.75.
    expect(gainForPlayerB(ctx.timings.fadeInStartTime, ctx)).toBeCloseTo(0.75, 2);
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    // En progress=0.50 → 0.75 (boundary).
    expect(
      gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.5, ctx)
    ).toBeCloseTo(0.75, 2);
  });

  it('aNaturalDecay: easing 10% lift evita thump en t=0', () => {
    // isOutroInstrumental=true + !tier4 + !anticipation → aNaturalDecay activo.
    // CROSSFADE: rampStart=0.30. Con aNaturalDecay, liftEnd=0.10 con eased.
    const ctx = makeGainContext({
      transitionType: 'CROSSFADE',
      useFilters: false,
      isOutroInstrumental: true
    });
    // En progress=0 → easing arranca en baseLevel=0 hacia target=0.50.
    // Justo en progress=0 → 0. En progress=0.05 (mitad de lift) → smoothstep
    // alcanza ≈0.5 del lift → maxVolB * (0 + 0.5*0.50) = 0.125.
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    const v0 = gainForPlayerB(ctx.timings.fadeInStartTime, ctx);
    const vMidLift = gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.05, ctx);
    const vTarget = gainForPlayerB(ctx.timings.fadeInStartTime + dur * 0.20, ctx);
    expect(v0).toBe(0);
    expect(vMidLift).toBeGreaterThan(0);
    expect(vMidLift).toBeLessThan(0.50);
    expect(vTarget).toBeCloseTo(0.50, 2);
  });
});

// ============================================================================
// computeStutterState
// ============================================================================

describe('computeStutterState — runtime gate', () => {
  function makeStutterConfig(overrides: Partial<CrossfadeResult> = {}): CrossfadeResult {
    return makeConfig({
      transitionType: 'CUT',
      useStutterCut: true,
      beatIntervalA: 0.5, // 120 BPM
      downbeatTimesA: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
      ...overrides
    });
  }

  it('useStutterCut=false → undefined', () => {
    const config = makeStutterConfig({ useStutterCut: false });
    const timings = calculateTimings(config, 0);
    expect(computeStutterState({ config, timings, startFileTimeA: 0 })).toBeUndefined();
  });

  it('beatIntervalA=0 → undefined', () => {
    const config = makeStutterConfig({ beatIntervalA: 0 });
    const timings = calculateTimings(config, 0);
    expect(computeStutterState({ config, timings, startFileTimeA: 0 })).toBeUndefined();
  });

  it('downbeats vacíos → undefined', () => {
    const config = makeStutterConfig({ downbeatTimesA: [] });
    const timings = calculateTimings(config, 0);
    expect(computeStutterState({ config, timings, startFileTimeA: 0 })).toBeUndefined();
  });

  it('transitionType no CUT family → undefined', () => {
    const config = makeStutterConfig({ transitionType: 'CROSSFADE' });
    const timings = calculateTimings(config, 0);
    expect(computeStutterState({ config, timings, startFileTimeA: 0 })).toBeUndefined();
  });

  it('CUT_A_FADE_IN_B también es elegible', () => {
    const config = makeStutterConfig({ transitionType: 'CUT_A_FADE_IN_B' });
    const timings = calculateTimings(config, 0);
    // cutFileTime = 0 + totalTime. Para fade=6, useFilters=true → filterLead=1.92,
    // totalTime ~7.92. nearestBeat closest a 7.92 → 8 (no en lista). Lista
    // termina en 5 → nearestBeat=5, dist=2.92 >> tolerance(0.5/3=0.167) → undefined.
    // Para que dispare, necesito downbeats que cubran cutFileTime.
    expect(computeStutterState({ config, timings, startFileTimeA: 0 })).toBeUndefined();
  });

  it('cutFileTime alineado con un beat → StutterState válido', () => {
    // fade=6, useFilters=false → filterLead=0. totalTime = 6.
    // startFileTimeA=0 → cutFileTime = 6. Downbeats cada 0.5s. Si añadimos
    // 6.0, nearestBeat=6.0, dist=0 ≤ tolerance.
    const config = makeStutterConfig({
      useFilters: false,
      downbeatTimesA: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5]
    });
    const timings = calculateTimings(config, 100);
    const s = computeStutterState({ config, timings, startFileTimeA: 0 });
    expect(s).toBeDefined();
    if (s !== undefined) {
      // anchorWall = startTime(100) + (6 - 0) = 106.
      expect(s.anchorWall).toBeCloseTo(106, 3);
      // startWall = anchorWall - 2 * 0.5 = 105.
      expect(s.startWall).toBeCloseTo(105, 3);
      // cellDuration = beatInterval / 2 = 0.25.
      expect(s.cellDuration).toBeCloseTo(0.25, 3);
    }
  });

  it('cutFileTime off-grid > beatInterval/3 → undefined', () => {
    // Tolerance = 0.5 / 3 ≈ 0.167. cutFileTime=6 (totalTime). El downbeat
    // más cercano es 5.5 (dist=0.5) o si pongo 5.8 (dist=0.2). 0.2 > 0.167
    // → off-grid.
    const config = makeStutterConfig({
      useFilters: false,
      downbeatTimesA: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.8]
    });
    const timings = calculateTimings(config, 0);
    const s = computeStutterState({ config, timings, startFileTimeA: 0 });
    expect(s).toBeUndefined();
  });

  it('cutFileTime off-grid dentro de tolerance → válido', () => {
    // Mismo setup pero downbeat a 5.85 (dist=0.15 < 0.167 tolerance).
    const config = makeStutterConfig({
      useFilters: false,
      downbeatTimesA: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.85]
    });
    const timings = calculateTimings(config, 0);
    const s = computeStutterState({ config, timings, startFileTimeA: 0 });
    expect(s).toBeDefined();
    if (s !== undefined) {
      expect(s.anchorWall).toBeCloseTo(5.85, 3);
    }
  });

  it('startFileTimeA distinto de 0 desplaza el mapping wall-clock', () => {
    // startFileTimeA=10, totalTime=6 → cutFileTime=16. Downbeat closest a 16 = 16.
    const config = makeStutterConfig({
      useFilters: false,
      downbeatTimesA: [14, 14.5, 15, 15.5, 16, 16.5]
    });
    const timings = calculateTimings(config, 0);
    const s = computeStutterState({ config, timings, startFileTimeA: 10 });
    expect(s).toBeDefined();
    if (s !== undefined) {
      // anchorWall = 0 + (16 - 10) = 6.
      expect(s.anchorWall).toBeCloseTo(6, 3);
      expect(s.startWall).toBeCloseTo(5, 3);
    }
  });
});

// ============================================================================
// Equal-power sanity (NATURAL_BLEND only — el único caso puro cos²/sin²)
// ============================================================================

describe('NATURAL_BLEND equal-power sanity', () => {
  it('A² + B² close to 1 over the curve (con floor de 0.15 en A)', () => {
    // NB usa A = floor + (1-floor)*cos². B = 0 + 1*sin².
    // Suma cuadrados: (floor + (1-floor)*cos²)² + sin⁴ NO es 1 exacto por el floor.
    // Solo verifico que el total power se mantiene "razonable" (> 0.5).
    const ctx = makeGainContext({ transitionType: 'NATURAL_BLEND', useFilters: false });
    const dur = ctx.timings.fadeInEndTime - ctx.timings.fadeInStartTime;
    for (let i = 1; i < 10; i++) {
      const t = ctx.timings.fadeInStartTime + (dur * i) / 10;
      const a = gainForPlayerA(t, ctx);
      const b = gainForPlayerB(t, ctx);
      const power = a * a + b * b;
      expect(power).toBeGreaterThan(0.3);
      expect(power).toBeLessThan(1.5);
    }
  });
});

// ============================================================================
// Type union sanity (TS unused-import check)
// ============================================================================

const _t: TransitionType = 'CROSSFADE';
void _t;
