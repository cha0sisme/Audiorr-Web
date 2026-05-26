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
  calculateTimings,
  computeBassSwapTime,
  computeEnergyCompensationB,
  PRESET_AGGRESSIVE,
  PRESET_ANTICIPATION,
  PRESET_DROP_MIX,
  PRESET_ENERGY_DOWN,
  PRESET_GENTLE,
  PRESET_NORMAL,
  PRESET_STEM_MIX,
  selectPreset,
  snappedRampStart
} from './CrossfadeExecutor';
import type { CrossfadeResult, TransitionType } from './dj-types';

// ============================================================================
// Fixtures
// ============================================================================

function makeConfig(overrides: Partial<CrossfadeResult> = {}): CrossfadeResult {
  return {
    entryPoint: 10,
    fadeDuration: 6,
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

// Sanity: unused import guard.
const _t: TransitionType = 'CROSSFADE';
void _t;
