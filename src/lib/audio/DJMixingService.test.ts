/**
 * Tests for DJMixingService — Fase 1.5.
 *
 * Coverage goal: each branch of `decideTransitionType` exercised at least once
 * + the safety overrides + cooldown semantics + the main modulations of
 * `calculateAdaptiveFadeDuration`. NOT exhaustive — Vitest scaffolding sets
 * the pattern so future ports add tests alongside the code.
 *
 * All fixtures fabricate `TransitionProfile` and `SongAnalysis` directly
 * because `buildTransitionProfile` is not ported yet (Fase 1 continuation).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetCooldownForTesting,
  buildTransitionProfile,
  calculateAdaptiveFadeDuration,
  decideTransitionType,
  deriveSlope,
  harmonicBPM,
  harmonicPenalty,
  isBDropDrivenByPercussive
} from './DJMixingService';
import {
  type BPMRelationship,
  type EnergyFlow,
  type SongAnalysis,
  SONG_ANALYSIS_DEFAULT,
  type TransitionCharacter,
  type TransitionProfile,
  type VocalOverlapRisk
} from './dj-types';

// ============================================================================
// Fixtures
// ============================================================================

function makeProfile(overrides: Partial<TransitionProfile> = {}): TransitionProfile {
  return {
    energyA: 0.5,
    energyB: 0.5,
    energyGap: 0,
    energyFlow: 'steady',
    bpmA: 120,
    bpmB: 120,
    bpmBNormalized: 120,
    bpmDiff: 0,
    bpmRelationship: 'identical',
    bpmTrusted: true,
    harmonic: { distance: 0, compatibility: 'compatible' },
    vocalOverlapRisk: 'none',
    aHasOutroVocals: false,
    bHasIntroVocals: false,
    danceabilityA: 0.5,
    danceabilityB: 0.5,
    avgDanceability: 0.5,
    bassConflictRisk: false,
    character: 'punch',
    styleAffinity: 0.7,
    mode: 'normal',
    ...overrides
  };
}

function makeAnalysis(overrides: Partial<SongAnalysis> = {}): SongAnalysis {
  return { ...SONG_ANALYSIS_DEFAULT, ...overrides };
}

beforeEach(() => {
  _resetCooldownForTesting();
});

// ============================================================================
// decideTransitionType — character branches
// ============================================================================

describe('decideTransitionType — character branches', () => {
  it('minimal character → NATURAL_BLEND', () => {
    const result = decideTransitionType({
      profile: makeProfile({ character: 'minimal', energyA: 0.15, energyB: 0.15 }),
      entryPoint: 10,
      fadeDuration: 8,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('NATURAL_BLEND');
  });

  it('smooth + incompatible BPM + outro instrumental + intro abrupt → CUT', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'incompatible',
        bpmDiff: 25
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200,
      outroInstrumental: true,
      introInstrumental: false
    });
    expect(result.type).toBe('CUT');
  });

  it('smooth + incompatible BPM + ambos instrumentales → CROSSFADE gentle', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'incompatible',
        bpmDiff: 22
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200,
      outroInstrumental: true,
      introInstrumental: true
    });
    expect(result.type).toBe('CROSSFADE');
  });

  it('smooth + incompatible BPM + energy drop alto → VINYL_STOP', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'incompatible',
        bpmDiff: 25,
        energyA: 0.6,
        energyB: 0.2
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('VINYL_STOP');
  });

  it('smooth + incompatible BPM default → NATURAL_BLEND (Gentle)', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'incompatible',
        bpmDiff: 22,
        energyA: 0.2,
        energyB: 0.2
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('NATURAL_BLEND');
  });

  it('smooth + borderline BPM → NATURAL_BLEND sutil', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'borderline',
        bpmDiff: 15
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('NATURAL_BLEND');
  });

  it('smooth + compatible BPM → CROSSFADE', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'compatible',
        bpmDiff: 5
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('CROSSFADE');
  });

  it('dramatic + energyUp + compatible + beatSynced → BEAT_MATCH_BLEND', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'dramatic',
        bpmRelationship: 'compatible',
        bpmDiff: 4,
        energyFlow: 'energyUp',
        energyA: 0.3,
        energyB: 0.7
      }),
      entryPoint: 10,
      fadeDuration: 6,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('BEAT_MATCH_BLEND');
  });

  it('dramatic + energyDown extremo → VINYL_STOP', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'dramatic',
        energyFlow: 'energyDown',
        energyA: 0.7,
        energyB: 0.2
      }),
      entryPoint: 10,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('VINYL_STOP');
  });

  it('dramatic + energyDown moderado → NATURAL_BLEND', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'dramatic',
        energyFlow: 'energyDown',
        energyA: 0.5,
        energyB: 0.3
      }),
      entryPoint: 10,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('NATURAL_BLEND');
  });

  it('punch + beatSynced + non-abrupt + fade≥6 + vocal overlap + bpmDiff<6 → STEM_MIX retired → SEQUENTIAL', () => {
    const next = makeAnalysis({ hasIntroData: true, introEndTime: 8, chorusStartTime: 12 });
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'punch',
        bpmRelationship: 'identical',
        bpmDiff: 0,
        energyB: 0.4
      }),
      entryPoint: 10,
      fadeDuration: 7,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200,
      hasVocalOverlap: true,
      currentAnalysis: makeAnalysis(),
      nextAnalysis: next
    });
    expect(result.type).toBe('SEQUENTIAL');
    expect(result.f5bRetiredFrom).toBe('STEM_MIX');
  });

  it('punch + beatSynced + non-abrupt + intro corta → DROP_MIX retired → SEQUENTIAL', () => {
    // bIntroLen < 12 + fadeDuration < 7 → useDropMix true. fade=4 entra
    // por la rama "fadeDuration < 4" → false (fade=4), bpmPerfectMatch
    // (diff>=1.0 → false), aIsDecaying false, bIsDropDriven necesita
    // percussiveCurve. Sin curva → bIsDropDriven=false → plan B BEAT_MATCH_BLEND.
    // Para forzar DROP_MIX: percussiveCurve drop-driven + aDecaying false.
    const next = makeAnalysis({
      hasIntroData: true,
      introEndTime: 8,
      chorusStartTime: 12,
      percussiveCurve: [0.1, 0.1, 0.2, 0.5, 0.6, 0.7] // intro≈0.1, main≈0.6 → ratio 6.0
    });
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'punch',
        bpmRelationship: 'compatible',
        bpmDiff: 3,
        bpmA: 120,
        bpmB: 123
      }),
      entryPoint: 10,
      fadeDuration: 4.5,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200,
      currentAnalysis: makeAnalysis(),
      nextAnalysis: next
    });
    expect(result.type).toBe('SEQUENTIAL');
    expect(result.f5bRetiredFrom).toBe('DROP_MIX');
  });

  it('punch + beatSynced + non-abrupt + intro larga → BEAT_MATCH_BLEND', () => {
    const next = makeAnalysis({
      hasIntroData: true,
      introEndTime: 20,
      chorusStartTime: 24
    });
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'punch',
        bpmRelationship: 'identical',
        bpmDiff: 1,
        bpmA: 120,
        bpmB: 120,
        avgDanceability: 0.3
      }),
      entryPoint: 10,
      fadeDuration: 8,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200,
      currentAnalysis: makeAnalysis(),
      nextAnalysis: next
    });
    expect(result.type).toBe('BEAT_MATCH_BLEND');
  });
});

// ============================================================================
// decideTransitionType — safety overrides
// ============================================================================

describe('decideTransitionType — safety overrides', () => {
  it('fadeDuration < 2 → CUT directo', () => {
    const result = decideTransitionType({
      profile: makeProfile({ character: 'punch' }),
      entryPoint: 5,
      fadeDuration: 1.5,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('CUT');
  });

  it('bpmDiff > 35 + useFilters → CUT forzado (polirritmia)', () => {
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'smooth',
        bpmRelationship: 'compatible',
        bpmDiff: 40,
        bpmA: 80,
        bpmB: 120
      }),
      entryPoint: 8,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    });
    expect(result.type).toBe('CUT');
    expect(result.reason).toContain('Polirritmia');
  });

  it('CUT_A_FADE_IN_B + energyB<0.10 → SEQUENTIAL con sequentialOverrideByVectorD', () => {
    // Para llegar a CUT_A_FADE_IN_B: punch + isAAbrupt + !isBAbrupt sin caer
    // antes en la rama useDropMix (que con bIntroLen<12+fade<7 desviaría a
    // DROP_MIX→SEQUENTIAL). bIntroLen=15 + fade=5 evita useDropMix.
    const cur = makeAnalysis({ hasOutroData: true, outroStartTime: 199 });
    const next = makeAnalysis({ hasIntroData: true, introEndTime: 15 });
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'punch',
        bpmRelationship: 'compatible',
        bpmDiff: 5,
        energyB: 0.05
      }),
      entryPoint: 10,
      fadeDuration: 5,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200,
      currentAnalysis: cur,
      nextAnalysis: next
    });
    expect(result.type).toBe('SEQUENTIAL');
    expect(result.sequentialOverrideByVectorD).toBe(true);
  });

  it('energy crash A→B instrumental → FADE_OUT_A_CUT_B', () => {
    // type previo CROSSFADE (punch + crossfade fallback) + override aplica.
    const next = makeAnalysis({
      hasIntroData: true,
      introEndTime: 8,
      introEndTimeHeuristic: 8
    });
    const result = decideTransitionType({
      profile: makeProfile({
        character: 'punch',
        energyA: 0.5,
        energyB: 0.2,
        bpmRelationship: 'compatible',
        bpmDiff: 5
      }),
      entryPoint: 6,
      fadeDuration: 5,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200,
      introInstrumental: true,
      nextAnalysis: next
    });
    expect(result.type).toBe('FADE_OUT_A_CUT_B');
  });
});

// ============================================================================
// decideTransitionType — cooldown
// ============================================================================

describe('decideTransitionType — VINYL_STOP cooldown', () => {
  it('un segundo VINYL_STOP candidato en <6 transiciones cae a fallback', () => {
    const incompatVinylArgs = {
      profile: makeProfile({
        character: 'smooth' as TransitionCharacter,
        bpmRelationship: 'incompatible' as BPMRelationship,
        bpmDiff: 25,
        energyA: 0.6,
        energyB: 0.2
      }),
      entryPoint: 5,
      fadeDuration: 6,
      isBeatSynced: false,
      useFilters: true,
      bufferADuration: 200
    };

    const first = decideTransitionType(incompatVinylArgs);
    expect(first.type).toBe('VINYL_STOP');

    // Inmediatamente otra transición que volvería a calificar como VINYL_STOP.
    // El cooldown la bloquea — cae al fallback NATURAL_BLEND Gentle.
    const second = decideTransitionType(incompatVinylArgs);
    expect(second.type).toBe('NATURAL_BLEND');
  });
});

// ============================================================================
// calculateAdaptiveFadeDuration
// ============================================================================

describe('calculateAdaptiveFadeDuration', () => {
  it('sin analysis → fallback por mode', () => {
    const result = calculateAdaptiveFadeDuration({
      entryPoint: 10,
      bufferADuration: 200,
      bufferBDuration: 200,
      profile: makeProfile({ mode: 'normal' })
    });
    expect(result.duration).toBeGreaterThanOrEqual(2);
    expect(result.decision).toContain('Sin analisis');
  });

  it('backend fadeIn ≥2s → usa ese valor (clamped)', () => {
    const next = makeAnalysis({ backendFadeInDuration: 7 });
    const cur = makeAnalysis();
    const result = calculateAdaptiveFadeDuration({
      entryPoint: 20,
      bufferADuration: 200,
      bufferBDuration: 200,
      currentAnalysis: cur,
      nextAnalysis: next,
      profile: makeProfile({ mode: 'normal' })
    });
    expect(result.duration).toBeCloseTo(7, 1);
    expect(result.decision).toContain('Backend fadeIn');
  });

  it('minimal character extiende fadeDuration a 8s mínimo (sujeto al cap final)', () => {
    // Cap final v15.h `entryPoint/1.1` aplasta valores grandes — para
    // permitir extender a 8s necesitamos entryPoint > 8.8s. Con entryPoint=12
    // el cap es 10.9, y el outro de A debe ser ≥ 9s para que el cálculo base
    // no quede atrapado en outro × 0.8 = 9.6 → max con 8 = 9.6.
    const cur = makeAnalysis({ hasOutroData: true, outroStartTime: 188 });
    const next = makeAnalysis({ hasIntroData: true, introEndTime: 20 });
    const result = calculateAdaptiveFadeDuration({
      entryPoint: 12,
      bufferADuration: 200,
      bufferBDuration: 200,
      currentAnalysis: cur,
      nextAnalysis: next,
      profile: makeProfile({ character: 'minimal', mode: 'normal' })
    });
    expect(result.duration).toBeGreaterThanOrEqual(8);
  });

  it('harmonic clash reduce 25%', () => {
    const cur = makeAnalysis({ hasOutroData: true, outroStartTime: 195 });
    const next = makeAnalysis({ hasIntroData: true, introEndTime: 20 });
    const baseProfile = makeProfile({ mode: 'normal' });
    const without = calculateAdaptiveFadeDuration({
      entryPoint: 8,
      bufferADuration: 200,
      bufferBDuration: 200,
      currentAnalysis: cur,
      nextAnalysis: next,
      profile: baseProfile
    });
    const withClash = calculateAdaptiveFadeDuration({
      entryPoint: 8,
      bufferADuration: 200,
      bufferBDuration: 200,
      currentAnalysis: cur,
      nextAnalysis: next,
      profile: makeProfile({
        mode: 'normal',
        harmonic: { distance: 5, compatibility: 'clash' }
      })
    });
    // Clash multiplica por 0.75 — esperamos al menos algo de reducción.
    expect(withClash.duration).toBeLessThan(without.duration);
  });

  it('cap final por punch B (entry/1.1) acota fades excesivos', () => {
    // entryPoint = 3 → punchSafeCap = 3/1.1 ≈ 2.73. fadeDuration baseline >2.73.
    const cur = makeAnalysis({ hasOutroData: true, outroStartTime: 195 });
    const next = makeAnalysis({ hasIntroData: true, introEndTime: 20 });
    const result = calculateAdaptiveFadeDuration({
      entryPoint: 3,
      bufferADuration: 200,
      bufferBDuration: 200,
      currentAnalysis: cur,
      nextAnalysis: next,
      profile: makeProfile({ mode: 'normal' })
    });
    expect(result.duration).toBeLessThanOrEqual(3 / 1.1 + 0.001);
  });

  it('floor 2s — nunca devuelve menos', () => {
    const result = calculateAdaptiveFadeDuration({
      entryPoint: 0.5, // forzaría cap a 0.45 sin floor
      bufferADuration: 200,
      bufferBDuration: 200,
      currentAnalysis: makeAnalysis(),
      nextAnalysis: makeAnalysis(),
      profile: makeProfile({ mode: 'normal' })
    });
    expect(result.duration).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Helpers — deriveSlope, isBDropDrivenByPercussive, harmonicBPM, harmonicPenalty
// ============================================================================

describe('deriveSlope', () => {
  it('undefined curve → undefined', () => {
    expect(deriveSlope(undefined, { tailWindows: 4 })).toBeUndefined();
  });

  it('curve más corta que la ventana → undefined', () => {
    expect(deriveSlope([0.1, 0.2], { tailWindows: 4 })).toBeUndefined();
  });

  it('curva creciente lineal en tail → slope positiva', () => {
    const slope = deriveSlope([0, 0, 0.2, 0.4, 0.6, 0.8], { tailWindows: 4 });
    expect(slope).toBeDefined();
    expect(slope!).toBeGreaterThan(0);
  });

  it('curva decreciente en tail → slope negativa', () => {
    const slope = deriveSlope([0.8, 0.7, 0.6, 0.4, 0.2, 0.1], { tailWindows: 4 });
    expect(slope).toBeDefined();
    expect(slope!).toBeLessThan(0);
  });
});

describe('isBDropDrivenByPercussive', () => {
  it('undefined curve → no drop', () => {
    const { isDrop } = isBDropDrivenByPercussive(undefined);
    expect(isDrop).toBe(false);
  });

  it('curve <6 muestras → no drop', () => {
    const { isDrop } = isBDropDrivenByPercussive([0.1, 0.2, 0.3]);
    expect(isDrop).toBe(false);
  });

  it('ratio main/intro ≥ 2 → drop', () => {
    const { isDrop, ratio } = isBDropDrivenByPercussive([0.1, 0.1, 0.2, 0.5, 0.6, 0.7]);
    expect(isDrop).toBe(true);
    expect(ratio).toBeGreaterThanOrEqual(2);
  });

  it('curve plana ratio ≈ 1 → no drop', () => {
    const { isDrop, ratio } = isBDropDrivenByPercussive([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(isDrop).toBe(false);
    expect(ratio).toBeCloseTo(1, 1);
  });
});

describe('harmonicBPM', () => {
  it('half-time fold: 60 vs 120 → 120', () => {
    expect(harmonicBPM(120, 60)).toBe(120);
  });

  it('double-time fold: 180 vs 90 → 180', () => {
    expect(harmonicBPM(180, 90)).toBe(180);
  });

  it('mismo tempo se preserva', () => {
    expect(harmonicBPM(120, 122)).toBe(122);
  });

  it('BPM inválido devuelve bpmB sin tocar', () => {
    expect(harmonicBPM(0, 120)).toBe(120);
  });
});

describe('harmonicPenalty', () => {
  it('keys ausentes → compatible (sentinel)', () => {
    expect(harmonicPenalty(undefined, undefined).compatibility).toBe('compatible');
  });

  it('mismo Camelot → compatible distance 0', () => {
    const p = harmonicPenalty('8A', '8A');
    expect(p.distance).toBe(0);
    expect(p.compatibility).toBe('compatible');
  });

  it('vecino +1 mismo letter → compatible', () => {
    const p = harmonicPenalty('8A', '9A');
    expect(p.compatibility).toBe('compatible');
  });

  it('mismo número distinto letter → distance 1, compatible', () => {
    const p = harmonicPenalty('8A', '8B');
    expect(p.distance).toBe(1);
    expect(p.compatibility).toBe('compatible');
  });

  it('wrap around: 12A vs 1A → distance 1', () => {
    const p = harmonicPenalty('12A', '1A');
    expect(p.distance).toBe(1);
  });

  it('distancia grande → clash', () => {
    const p = harmonicPenalty('1A', '6B');
    expect(p.compatibility).toBe('clash');
  });

  it('key malformada → compatible (sentinel)', () => {
    expect(harmonicPenalty('XYZ', '8A').compatibility).toBe('compatible');
  });
});

// ============================================================================
// buildTransitionProfile — builds the A↔B profile consumed by everyone else
// ============================================================================

describe('buildTransitionProfile', () => {
  it('mode "normal" siempre devuelve character "smooth"', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ bpm: 120, energy: 0.5, danceability: 0.7 }),
      nextAnalysis: makeAnalysis({ bpm: 122, energy: 0.5, danceability: 0.7 }),
      mode: 'normal',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.character).toBe('smooth');
  });

  it('DJ mode + ambos bajos + low dance → minimal', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ energy: 0.10, danceability: 0.3 }),
      nextAnalysis: makeAnalysis({ energy: 0.10, danceability: 0.3 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.character).toBe('minimal');
  });

  it('DJ mode + gap energético >0.35 → dramatic', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ energy: 0.2, danceability: 0.6 }),
      nextAnalysis: makeAnalysis({ energy: 0.7, danceability: 0.7 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.character).toBe('dramatic');
  });

  it('DJ mode + BPM compatible + alta afinidad → punch', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({
        bpm: 120,
        energy: 0.5,
        danceability: 0.7,
        bpmConfidence: 0.9
      }),
      nextAnalysis: makeAnalysis({
        bpm: 122,
        energy: 0.55,
        danceability: 0.7,
        bpmConfidence: 0.9
      }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.character).toBe('punch');
    expect(profile.bpmTrusted).toBe(true);
  });

  it('floor de energy 0.10 cuando raw≈0 y track >30s', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({
        energy: 0,
        hasEnergyProfile: true,
        energyOutro: 0
      }),
      nextAnalysis: makeAnalysis({ energy: 0.5 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.energyA).toBe(0.10);
  });

  it('NO aplica floor cuando track <30s (puede ser jingle/SFX)', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({
        energy: 0,
        hasEnergyProfile: true,
        energyOutro: 0
      }),
      nextAnalysis: makeAnalysis({ energy: 0.5 }),
      mode: 'dj',
      bufferADuration: 15,
      bufferBDuration: 200
    });
    expect(profile.energyA).toBe(0);
  });

  it('half-time fold: bpmA=120, bpmB=60 → normalized 120, identical', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ bpm: 120, bpmConfidence: 0.9 }),
      nextAnalysis: makeAnalysis({ bpm: 60, bpmConfidence: 0.9 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.bpmBNormalized).toBe(120);
    expect(profile.bpmDiff).toBe(0);
    expect(profile.bpmRelationship).toBe('identical');
  });

  it('incompatible cuando bpmDiff > 18 (sin fold half/double)', () => {
    // 120 vs 150: harmonicBPM evalúa 150*0.5=75 (err 45), 150*1.0=150 (err 30),
    // 150*2.0=300 (err 180). Best ratio = 1.0 → no fold. bpmDiff = 30 → incompatible.
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ bpm: 120, bpmConfidence: 0.9 }),
      nextAnalysis: makeAnalysis({ bpm: 150, bpmConfidence: 0.9 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.bpmBNormalized).toBe(150);
    expect(profile.bpmDiff).toBe(30);
    expect(profile.bpmRelationship).toBe('incompatible');
  });

  it('bpmTrusted=false cuando confianza A < 0.5', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ bpm: 120, bpmConfidence: 0.3 }),
      nextAnalysis: makeAnalysis({ bpm: 122, bpmConfidence: 0.9 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.bpmTrusted).toBe(false);
  });

  it('vocalOverlapRisk both cuando A outroVocals + B introVocals', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({
        hasVocalData: true,
        hasOutroVocals: true
      }),
      nextAnalysis: makeAnalysis({
        hasVocalData: true,
        hasIntroVocals: true
      }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.vocalOverlapRisk).toBe('both');
  });

  it('vocalOverlapRisk none por defecto (sin señales vocales)', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis(),
      nextAnalysis: makeAnalysis(),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.vocalOverlapRisk).toBe('none');
  });

  it('bassConflictRisk true cuando ambos danceability > 0.65', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ danceability: 0.75 }),
      nextAnalysis: makeAnalysis({ danceability: 0.80 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(profile.bassConflictRisk).toBe(true);
  });

  it('styleAffinity baja cuando BPMs lejanos + energy lejanos', () => {
    const close = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ bpm: 120, energy: 0.5, danceability: 0.5 }),
      nextAnalysis: makeAnalysis({ bpm: 122, energy: 0.55, danceability: 0.5 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    const far = buildTransitionProfile({
      currentAnalysis: makeAnalysis({ bpm: 80, energy: 0.2, danceability: 0.3 }),
      nextAnalysis: makeAnalysis({ bpm: 140, energy: 0.8, danceability: 0.8 }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    expect(far.styleAffinity).toBeLessThan(close.styleAffinity);
  });

  it('end-to-end: profile + decisor produce un TransitionType válido', () => {
    const profile = buildTransitionProfile({
      currentAnalysis: makeAnalysis({
        bpm: 120,
        energy: 0.5,
        danceability: 0.7,
        bpmConfidence: 0.9
      }),
      nextAnalysis: makeAnalysis({
        bpm: 122,
        energy: 0.55,
        danceability: 0.7,
        bpmConfidence: 0.9,
        hasIntroData: true,
        introEndTime: 18
      }),
      mode: 'dj',
      bufferADuration: 200,
      bufferBDuration: 200
    });
    const result = decideTransitionType({
      profile,
      entryPoint: 12,
      fadeDuration: 7,
      isBeatSynced: true,
      useFilters: true,
      bufferADuration: 200,
      nextAnalysis: makeAnalysis({ hasIntroData: true, introEndTime: 18 })
    });
    // punch + beat-sync + non-abrupt + intro larga → BEAT_MATCH_BLEND
    expect(result.type).toBe('BEAT_MATCH_BLEND');
  });
});

// ============================================================================
// Type union sanity (TS unused-import check)
// ============================================================================

const _checkUnions: [EnergyFlow, VocalOverlapRisk] = ['energyUp', 'none'];
void _checkUnions;
