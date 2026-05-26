/**
 * DJMixingService — pure crossfade intelligence calculations.
 *
 * Port of `ios/App/App/Services/DJMixingService.swift` v15.m (commit 589d4fd).
 * Module of pure functions (matches Swift `enum DJMixingService` with
 * `static func`s — no instance state).
 *
 * NO side effects, NO audio playback — just math. CrossfadeExecutor (web,
 * pending) will consume these outputs and drive `AudioEngine.svelte.ts`.
 *
 * Phase 1 scope (this file):
 *   - `decideTransitionType` — picks one of 12 TransitionType cases from the
 *     A↔B relationship.
 *   - `calculateAdaptiveFadeDuration` — picks the fade window length.
 *   - Helpers used by both: `deriveSlope`, `isBDropDrivenByPercussive`,
 *     `harmonicBPM`, `harmonicPenalty`.
 *   - Cooldown state for expressive types (currently VINYL_STOP only).
 *
 * NOT in Phase 1: `buildTransitionProfile`, `calculateCrossfadeConfig`,
 * `calculateSmartEntryPoint`, `decideFilterUsage`, `decideDJFilters`,
 * `decideDJEffects`, `decideAnticipation`, `decideTimeStretch`,
 * `computeTier4Entry`, `detectOutroInstrumental`, `detectIntroInstrumental`.
 * The callers of `decideTransitionType`/`calculateAdaptiveFadeDuration` are
 * expected to feed already-computed parameters until those are ported.
 */

import {
  type BPMRelationship,
  type FadeDurationResult,
  type HarmonicCompatibility,
  type HarmonicPenalty,
  type MixMode,
  MIX_MODE_CONFIGS,
  type SongAnalysis,
  type TransitionProfile,
  type TransitionType,
  type TransitionTypeResult
} from './dj-types';

// ============================================================================
// MARK: - Algorithm versioning (mirrors DJMixingService.swift:128)
// ============================================================================

export const kAlgorithmVersion = 'v15.m-web1' as const;
export const kBuildId = 'v15.m-web1-pending' as const;

// ============================================================================
// MARK: - Feature flags (mirrors DJMixingService.swift:161)
// ============================================================================

/**
 * Tier 4: adelanta entryPoint de B al primer kick de su intro instrumental
 * cuando A está en outro instrumental confiable.
 * Consumido por `computeTier4Entry` (no portado todavía — Fase 2).
 */
export const kEnableTier4 = true;

/**
 * Cap defensivo POST-snap+beat-sync sobre el entryPoint final. Consumido
 * por `calculateSmartEntryPoint` (Fase 2).
 */
export const kEntryFinalCap = 50.0;

// ============================================================================
// MARK: - Cooldown bookkeeping (mirrors DJMixingService.swift:139)
// ============================================================================

const RECENT_TYPES_LIMIT = 12;

/** Last N transition types chosen by `decideTransitionType`. Module-scoped
    singleton (Swift uses `private static var`). Reset on hot reload — a fresh
    set starts clean, matching iOS behavior on app launch. */
const recentTypes: TransitionType[] = [];

/** Returns true if `type` should be skipped this round because it was used
    too recently. Currently only VINYL_STOP has a cooldown (max 1 every 6
    transitions — DJ recommendation: ≈2-3 spin-downs per 20-track set). */
function isOnCooldown(type: TransitionType): boolean {
  if (type === 'VINYL_STOP') {
    return recentTypes.slice(-6).includes('VINYL_STOP');
  }
  return false;
}

/** Append the chosen type to the cooldown buffer. Trims to keep memory
    bounded. Called at the end of `decideTransitionType` AFTER safety
    overrides so polirritmia/vocal-trainwreck redirections are tracked. */
function recordTransition(type: TransitionType): void {
  recentTypes.push(type);
  while (recentTypes.length > RECENT_TYPES_LIMIT) {
    recentTypes.shift();
  }
}

/** Test hook — wipes cooldown state. NOT exported in production callers;
    test files import via this symbol so Vitest scenarios stay isolated. */
export function _resetCooldownForTesting(): void {
  recentTypes.length = 0;
}

// ============================================================================
// MARK: - Helpers (DJMixingService.swift:4078, :4496, :4524, :4617)
// ============================================================================

/**
 * Linear-regression slope of a curve subset, in units per second.
 * Mirrors `DJMixingService.swift:4078 deriveSlope`.
 *
 *   - `headWindows` set → use the first N points.
 *   - `tailWindows` set → use the last N points.
 *   - Curves are 5s/window normalized 0-1 (backend `rmsTailCurve` etc.), so
 *     the regression slope (per-window) is divided by 5 to get per-second.
 *   - Returns `undefined` if the curve is missing or too short.
 */
export function deriveSlope(
  curve: readonly number[] | undefined,
  opts: { headWindows?: number; tailWindows?: number }
): number | undefined {
  if (!curve) return undefined;
  const { headWindows, tailWindows } = opts;
  let windows: readonly number[];
  if (headWindows !== undefined) {
    if (curve.length < headWindows || headWindows < 2) return undefined;
    windows = curve.slice(0, headWindows);
  } else if (tailWindows !== undefined) {
    if (curve.length < tailWindows || tailWindows < 2) return undefined;
    windows = curve.slice(curve.length - tailWindows);
  } else {
    return undefined;
  }
  const n = windows.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const y = windows[i] ?? 0;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return undefined;
  const slopePerWindow = (n * sumXY - sumX * sumY) / denom;
  return slopePerWindow / 5.0;
}

/**
 * Detects "build drop-driven" intros from the HPSS percussive stem curve.
 * Mirrors `DJMixingService.swift:4617 isBDropDrivenByPercussive`.
 *
 * Ratio between percussive energy of intro (first 10s, windows 0-1) and
 * early body (15-30s, windows 3-5). A dramatic build has ratio ≥ 2.0; a
 * stable ballad stays near 1.0. Returns the ratio for logging when present.
 *
 * Default conservative: curve missing or <6 samples → `(false, undefined)`
 * (assume NOT drop, the cap applies). Backend coverage is 100%, this branch
 * is rare; we prefer over-capping to under-capping.
 */
export function isBDropDrivenByPercussive(
  percussiveCurve: readonly number[] | undefined
): { isDrop: boolean; ratio?: number } {
  if (!percussiveCurve || percussiveCurve.length < 6) {
    return { isDrop: false };
  }
  const intro = ((percussiveCurve[0] ?? 0) + (percussiveCurve[1] ?? 0)) / 2.0;
  const main =
    ((percussiveCurve[3] ?? 0) + (percussiveCurve[4] ?? 0) + (percussiveCurve[5] ?? 0)) / 3.0;
  const denom = Math.max(intro, 0.01);
  const ratio = main / denom;
  return { isDrop: ratio >= 2.0, ratio };
}

/**
 * Folds half-time / double-time relationships in the harmonic BPM mapping.
 * Mirrors `DJMixingService.swift:4496 harmonicBPM`.
 *
 * Only ratios 0.5 / 1.0 / 2.0 are considered musically valid for beat-match.
 * Ratios like 3:2 (80→120) create false compatibles that need >10% stretch
 * and sound terrible in practice. Returns `bpmB` (unchanged) when no fold
 * reduces the distance.
 */
export function harmonicBPM(bpmA: number, bpmB: number): number {
  if (bpmA <= 0 || bpmB <= 0) return bpmB;
  const ratios = [0.5, 1.0, 2.0];
  let best = 1.0;
  let bestErr = Infinity;
  for (const r of ratios) {
    const err = Math.abs(bpmB * r - bpmA);
    if (err < bestErr) {
      bestErr = err;
      best = r;
    }
  }
  const adjusted = bpmB * best;
  return Math.abs(adjusted - bpmA) < Math.abs(bpmB - bpmA) ? adjusted : bpmB;
}

/**
 * Camelot Wheel harmonic distance. Mirrors `DJMixingService.swift:4524
 * harmonicPenalty`.
 *
 * Key format: `<num><A|B>` where num ∈ 1..12, A = minor, B = major.
 *
 * Distance metric:
 *   - `diffNum` = min(|nA - nB|, 12 - |nA - nB|) — wraps around the wheel.
 *   - `diffLetter` = 0 if same minor/major, 1 if different.
 *   - `totalDistance = diffNum + diffLetter`.
 *
 *   0-1 → compatible; 2 → acceptable (if same letter) or tense (if diff
 *   letter); 3 → tense; ≥4 → clash.
 *
 * Returns a default-compatible penalty when either key is missing or
 * malformed — we never want a parsing failure to introduce a phantom clash.
 */
export function harmonicPenalty(
  keyA: string | undefined,
  keyB: string | undefined
): HarmonicPenalty {
  if (!keyA || !keyB) return { distance: 0, compatibility: 'compatible' };

  const re = /^(\d+)([AB])/i;
  const mA = re.exec(keyA);
  const mB = re.exec(keyB);
  if (!mA || !mB) return { distance: 0, compatibility: 'compatible' };

  const numA = Number.parseInt(mA[1] ?? '', 10);
  const numB = Number.parseInt(mB[1] ?? '', 10);
  if (!Number.isFinite(numA) || !Number.isFinite(numB)) {
    return { distance: 0, compatibility: 'compatible' };
  }
  const letterA = (mA[2] ?? '').toUpperCase();
  const letterB = (mB[2] ?? '').toUpperCase();

  const rawDiff = Math.abs(numA - numB);
  const diffNum = Math.min(rawDiff, 12 - rawDiff);
  const diffLetter = letterA !== letterB ? 1 : 0;
  const totalDistance = diffNum + diffLetter;

  let compatibility: HarmonicCompatibility;
  if (totalDistance <= 1) compatibility = 'compatible';
  else if (totalDistance === 2) compatibility = diffLetter === 1 ? 'tense' : 'acceptable';
  else if (totalDistance === 3) compatibility = 'tense';
  else compatibility = 'clash';

  return { distance: totalDistance, compatibility };
}

// ============================================================================
// MARK: - Transition Type Decisor (DJMixingService.swift:3521)
// ============================================================================

export type DecideTransitionTypeArgs = {
  currentAnalysis?: SongAnalysis;
  nextAnalysis?: SongAnalysis;
  profile: TransitionProfile;
  entryPoint: number;
  fadeDuration: number;
  isBeatSynced: boolean;
  useFilters: boolean;
  bufferADuration: number;
  hasVocalOverlap?: boolean;
  outroInstrumental?: boolean;
  introInstrumental?: boolean;
};

/**
 * Picks the TransitionType from the A↔B relationship.
 * Mirrors `DJMixingService.swift:3521 decideTransitionType`.
 *
 * The `character` field of the profile biases the selection:
 *   - punch    → BEAT_MATCH_BLEND / STEM_MIX / DROP_MIX (then escalated to
 *                SEQUENTIAL by the retirement guard) / VINYL_STOP / CUT*FADE*
 *   - smooth   → NATURAL_BLEND / CROSSFADE / CUT (outro instr + abrupt B) /
 *                VINYL_STOP (extreme energy drop)
 *   - dramatic → BEAT_MATCH_BLEND (energy up) / NATURAL_BLEND (energy down)
 *                / VINYL_STOP (energy crash) / CROSSFADE
 *   - minimal  → NATURAL_BLEND
 *
 * Then several safety overrides may upgrade/downgrade the choice:
 *   - extreme BPM jump → CUT
 *   - energy crash A→instrumental B → FADE_OUT_A_CUT_B
 *   - vocal trainwreck → EQ_MIX or CUT
 *   - Retirement of DROP_MIX/STEM_MIX → SEQUENTIAL (with telemetry tag)
 *   - v15 defense CUT_A_FADE_IN_B with energyB<0.10 → SEQUENTIAL
 *
 * Records the final type into the cooldown buffer.
 */
export function decideTransitionType(args: DecideTransitionTypeArgs): TransitionTypeResult {
  const {
    currentAnalysis,
    nextAnalysis,
    profile,
    entryPoint,
    fadeDuration,
    isBeatSynced,
    useFilters,
    bufferADuration,
    hasVocalOverlap = false,
    outroInstrumental = false,
    introInstrumental = false
  } = args;

  // ── Abruptness detection ──
  let isAAbrupt = false;
  if (currentAnalysis && !currentAnalysis.hasError) {
    if (currentAnalysis.hasOutroData) {
      isAAbrupt =
        currentAnalysis.outroStartTime >= bufferADuration - 2 &&
        currentAnalysis.outroStartTime > 0;
    }
  } else if (currentAnalysis === undefined) {
    isAAbrupt = fadeDuration < 3;
  }

  let isBAbrupt = false;
  if (nextAnalysis && !nextAnalysis.hasError) {
    if (nextAnalysis.hasIntroData) {
      // Only consider B truly abrupt when intro is extremely short AND entry
      // point is near the start. introEndTime < 2 alone fires too often for
      // pop songs with quick verse entries.
      isBAbrupt = nextAnalysis.introEndTime < 1 && entryPoint < 2;
    }
  } else if (nextAnalysis === undefined) {
    isBAbrupt = fadeDuration < 3;
  }

  // Beat-match eligibility: stricter than "mixable". 12-18 BPM diff is close
  // enough to blend gently but too far for time-stretch (>8% rate change
  // becomes audible). Borderline/incompatible NOT eligible.
  const bpmBeatMatchable =
    profile.bpmRelationship === 'identical' || profile.bpmRelationship === 'compatible';

  let type: TransitionType = 'CROSSFADE';
  let reason = 'Transicion normal';

  const fmt1 = (n: number) => n.toFixed(1);
  const fmt2 = (n: number) => n.toFixed(2);
  const fmt0 = (n: number) => n.toFixed(0);
  const bpmNote =
    profile.bpmBNormalized !== profile.bpmB
      ? ` [B ${Math.trunc(profile.bpmB)}→${Math.trunc(profile.bpmBNormalized)} half-time]`
      : '';

  // Floor <2 (no <3). Fades 2.0-2.9s son musicalmente válidos (outro corto
  // real / entry temprano legítimo) y caen al switch normal en lugar de
  // degradarse a CUT.
  if (fadeDuration < 2) {
    type = 'CUT';
    reason = `Fade muy corto (raw=${fmt1(fadeDuration)}s, ejecutado=3.0s) → CUT directo`;
  } else {
    switch (profile.character) {
      case 'minimal':
        type = 'NATURAL_BLEND';
        reason = 'Minimal (ambos baja energia) → NATURAL_BLEND suave';
        break;

      case 'smooth': {
        switch (profile.bpmRelationship) {
          case 'incompatible': {
            const energyDrop = profile.energyA - profile.energyB;
            if (outroInstrumental && introInstrumental) {
              type = 'CROSSFADE';
              reason = `BPMs incompatibles (diff=${fmt1(profile.bpmDiff)})${bpmNote} pero ambos instrumentales → CROSSFADE gentle`;
            } else if (outroInstrumental && !introInstrumental) {
              type = 'CUT';
              reason = `Outro instrumental A + intro abrupta B (incompatible)${bpmNote} → CUT`;
            } else if (
              energyDrop > 0.3 &&
              profile.energyA > 0.25 &&
              !isOnCooldown('VINYL_STOP')
            ) {
              type = 'VINYL_STOP';
              reason = `BPMs incompatibles + energy drop ${fmt2(profile.energyA)}→${fmt2(profile.energyB)}${bpmNote} → VINYL_STOP`;
            } else {
              // CLEAN_HANDOFF retirado por dead-air audible en incompatible BPMs.
              type = 'NATURAL_BLEND';
              reason = `CLEAN_HANDOFF retirado (incompatible BPM diff=${fmt1(profile.bpmDiff)})${bpmNote} → NB Gentle`;
            }
            break;
          }
          case 'borderline':
            // 12-18 BPM diff — too far for invisible beat-match but close
            // enough that a thoughtful blend still works. NB gentle preset.
            type = 'NATURAL_BLEND';
            reason = `BPMs borderline (diff=${fmt1(profile.bpmDiff)})${bpmNote} → NATURAL_BLEND sutil`;
            break;
          case 'identical':
          case 'compatible':
            type = 'CROSSFADE';
            reason = `Smooth blend (afinidad=${fmt2(profile.styleAffinity)}) → CROSSFADE`;
            break;
        }
        break;
      }

      case 'dramatic': {
        if (profile.energyFlow === 'energyUp' && bpmBeatMatchable && isBeatSynced) {
          type = 'BEAT_MATCH_BLEND';
          reason = `Dramatic UP + BPMs compatibles → BEAT_MATCH_BLEND (energia ${fmt2(profile.energyA)}→${fmt2(profile.energyB)})`;
        } else if (profile.energyFlow === 'energyDown') {
          const energyDrop = profile.energyA - profile.energyB;
          if (energyDrop > 0.35 && profile.energyA > 0.3 && !isOnCooldown('VINYL_STOP')) {
            type = 'VINYL_STOP';
            reason = `Dramatic DOWN extremo (energia ${fmt2(profile.energyA)}→${fmt2(profile.energyB)}) → VINYL_STOP`;
          } else {
            type = 'NATURAL_BLEND';
            reason = `Dramatic DOWN → NATURAL_BLEND (energia ${fmt2(profile.energyA)}→${fmt2(profile.energyB)})`;
          }
        } else if (profile.harmonic.compatibility === 'clash') {
          type = 'CROSSFADE';
          reason = 'Clash armonico → CROSSFADE corto';
        } else {
          type = 'CROSSFADE';
          reason = 'Dramatic steady → CROSSFADE';
        }
        break;
      }

      case 'punch': {
        // ── VINYL_STOP: bass-heavy A handing off to a hard, abrupt B ──
        const bIntroLen =
          nextAnalysis && !nextAnalysis.hasError
            ? (nextAnalysis.introEndTimeHeuristic ??
              (nextAnalysis.hasIntroData ? nextAnalysis.introEndTime : 30))
            : 30;
        const bChorusStart =
          nextAnalysis && !nextAnalysis.hasError
            ? nextAnalysis.chorusStartTime > 0
              ? nextAnalysis.chorusStartTime
              : 30
            : 30;
        const bIsAbruptIntro =
          !introInstrumental && (bChorusStart < 3 || bIntroLen < 2) && profile.energyB > 0.2;
        // VINYL_STOP gates ablandados: energyA > 0.25, avgDanceability > 0.55.
        // Cooldown intacto.
        const aIsBassHeavy = profile.energyA > 0.25 && profile.avgDanceability > 0.55;
        const vinylStopFits =
          !isOnCooldown('VINYL_STOP') &&
          aIsBassHeavy &&
          bIsAbruptIntro &&
          profile.bpmRelationship !== 'identical' &&
          fadeDuration >= 3;

        // ── DROP_MIX: short intro on B or very short fade ──
        const useDropMix = fadeDuration < 5 || (bIntroLen < 12 && fadeDuration < 7);

        if (vinylStopFits) {
          type = 'VINYL_STOP';
          reason = `Punch + bass-heavy A + B abrupta (chorus B=${fmt0(bChorusStart)}s)${bpmNote} → VINYL_STOP`;
        } else if (useDropMix && fadeDuration >= 2) {
          // DROP_MIX gate restrictivo: 3 ramas en cascada (cobertura iOS).
          const aIsDecaying = (() => {
            const slope = deriveSlope(currentAnalysis?.rmsTailCurve, { tailWindows: 6 });
            return slope !== undefined && slope < -0.003;
          })();
          const { isDrop: bIsDropDriven } = isBDropDrivenByPercussive(
            nextAnalysis?.percussiveCurve
          );
          const bpmPerfectMatch =
            Math.abs(profile.bpmA - profile.bpmB) < 1.0 && isBeatSynced;

          if (fadeDuration < 4) {
            type = 'DROP_MIX';
            reason = `Punch + fade muy corto (${fmt1(fadeDuration)}s) → DROP_MIX (gesto seco)`;
          } else if (bpmPerfectMatch) {
            type = 'DROP_MIX';
            reason = 'Punch + BPM-grid perfecto (diff<1.0, sync) → DROP_MIX (corte seguro)';
          } else if (aIsDecaying || !bIsDropDriven) {
            type = isBeatSynced ? 'BEAT_MATCH_BLEND' : 'NATURAL_BLEND';
            reason = `Plan B DROP_MIX rechazado (aDecaying=${aIsDecaying}, bDropDriven=${bIsDropDriven}) → ${isBeatSynced ? 'BEAT_MATCH_BLEND' : 'NATURAL_BLEND'}`;
          } else {
            type = 'DROP_MIX';
            reason = `Punch + intro B corta (${fmt0(bIntroLen)}s) → DROP_MIX (${fmt1(fadeDuration)}s)`;
          }
        }
        // ── Full DJ treatment ──
        // STEM_MIX guard: bpmDiff < 6 (phase drift) + energyB > 0.10 (B
        // audible enough to read as a stem swap, not a slow fade-in).
        else if (
          isBeatSynced &&
          !isAAbrupt &&
          !isBAbrupt &&
          fadeDuration >= 6 &&
          hasVocalOverlap &&
          profile.bpmDiff < 6 &&
          profile.energyB > 0.1
        ) {
          type = 'STEM_MIX';
          reason = `Punch + vocales solapadas + fade≥6s → STEM_MIX (diff=${fmt1(profile.bpmDiff)})${bpmNote}`;
        } else if (isBeatSynced && !isAAbrupt && !isBAbrupt) {
          type = 'BEAT_MATCH_BLEND';
          reason = `Punch + beats sync (diff=${fmt1(profile.bpmDiff)})${bpmNote} → BEAT_MATCH_BLEND`;
        } else if (isAAbrupt && isBAbrupt) {
          // Sincronizado con floor general <2.
          if (fadeDuration < 2) {
            type = 'CUT';
            reason = 'Ambos abruptos + fade muy corto → CUT';
          } else {
            type = 'EQ_MIX';
            reason = 'Ambos abruptos → EQ_MIX (mid-scoop limpia clash)';
          }
        } else if (isAAbrupt && !isBAbrupt) {
          type = 'CUT_A_FADE_IN_B';
          reason = 'A abrupto, B suave → CUT_A_FADE_IN_B';
        } else if (!isAAbrupt && isBAbrupt) {
          type = 'FADE_OUT_A_CUT_B';
          reason = 'A suave, B abrupto → FADE_OUT_A_CUT_B';
        } else {
          type = 'CROSSFADE';
          reason = 'Punch sin beat sync → CROSSFADE';
        }
        break;
      }
    }
  }

  // ── Override: B abre con voz acapella / hablada ──
  // Override CLEAN_HANDOFF retirado (dead-air > blend). Solo anotamos en
  // el reason si los proxies indican que era acapella.
  if (
    nextAnalysis &&
    !nextAnalysis.hasError &&
    nextAnalysis.vocalStartTime !== undefined &&
    nextAnalysis.vocalStartTime <= 1.0 &&
    entryPoint < 3.0 &&
    nextAnalysis.chorusStartTime > 5.0 &&
    (type === 'CROSSFADE' ||
      type === 'BEAT_MATCH_BLEND' ||
      type === 'NATURAL_BLEND' ||
      type === 'EQ_MIX')
  ) {
    reason = `${reason} (override voz-acapella retirado)`;
  }

  // ── Safety: extreme BPM jump override ──
  const bpmCutThreshold = useFilters ? 35 : 20;
  if (profile.bpmDiff > bpmCutThreshold && fadeDuration > 3 && type !== 'CUT') {
    type = 'CUT';
    const normalizedNote =
      profile.bpmBNormalized !== profile.bpmB ? ` (norm:${Math.trunc(profile.bpmBNormalized)})` : '';
    reason = `Polirritmia evitada (A:${Math.trunc(profile.bpmA)} B:${Math.trunc(profile.bpmB)}${normalizedNote} diff=${fmt1(profile.bpmDiff)}) → CUT forzado`;
  }

  // ── Override: energy crash A → instrumental B ──
  const bIntroSpace =
    nextAnalysis && !nextAnalysis.hasError
      ? (nextAnalysis.introEndTimeHeuristic ??
        (nextAnalysis.hasIntroData ? nextAnalysis.introEndTime : 0))
      : 0;
  if (
    profile.energyA > 0.4 &&
    profile.energyB < 0.25 &&
    introInstrumental &&
    bIntroSpace >= 6 &&
    profile.bpmRelationship !== 'incompatible' &&
    (type === 'CUT' || type === 'CROSSFADE' || type === 'NATURAL_BLEND')
  ) {
    type = 'FADE_OUT_A_CUT_B';
    reason = `Energy crash A→B instrumental (${fmt2(profile.energyA)}→${fmt2(profile.energyB)}) → FADE_OUT_A_CUT_B`;
  }

  // ── Safety: vocal trainwreck ──
  if (
    currentAnalysis &&
    !currentAnalysis.hasError &&
    nextAnalysis &&
    !nextAnalysis.hasError &&
    type !== 'CUT' &&
    type !== 'STEM_MIX'
  ) {
    // vocalStartTime nil/undefined → sentinel 0. The `> 0` guard below filters
    // both undefined and literal 0.0 (vocal-at-t=0 means entryPoint already
    // missed the vocals → vocalBStart ≤ 0 → still flagged via hasIntroVocals).
    const vsB = nextAnalysis.vocalStartTime ?? 0;
    const vocalBStart = vsB - entryPoint;
    const bHasVocalsInFade =
      (nextAnalysis.vocalStartTime ?? -1) > 0 && vocalBStart < fadeDuration;
    const bIntroVocalOverlap = nextAnalysis.hasIntroVocals || bHasVocalsInFade;

    if (bIntroVocalOverlap) {
      // Guard BPM-grid identical+synced: con BPMs idénticos y beat-sync
      // activo, el overlap vocal queda absorbido por groove perfecto.
      const bpmGridPerfect = profile.bpmRelationship === 'identical' && isBeatSynced;
      if (bpmGridPerfect) {
        reason += ' (vocal overlap absorbed: BPM-grid identical+synced)';
      } else {
        const safeOutroA = bufferADuration - fadeDuration;

        // Guard outroInstrumental autoritario (señal multi-source ya validada
        // en producción). Fallback degenerado retirado.
        let aHasVocalsAtEnd = false;
        if (outroInstrumental) {
          aHasVocalsAtEnd = false;
        } else if (currentAnalysis.hasOutroVocals) {
          aHasVocalsAtEnd = true;
        } else if (currentAnalysis.hasVocalEndData) {
          aHasVocalsAtEnd = currentAnalysis.lastVocalTime > safeOutroA;
        } else if (currentAnalysis.speechSegments.length > 0) {
          aHasVocalsAtEnd = currentAnalysis.speechSegments.some((s) => s.end > safeOutroA);
        } else {
          aHasVocalsAtEnd =
            (currentAnalysis.outroStartTime <= 0 ||
              currentAnalysis.outroStartTime > safeOutroA) &&
            (currentAnalysis.vocalStartTime ?? 0) > 0;
        }

        if (aHasVocalsAtEnd) {
          const bInstrumentalWindow = vsB - entryPoint;
          if (bInstrumentalWindow > fadeDuration * 0.6) {
            reason += ` (vocal overlap OK: B vocals after ${fmt0(bInstrumentalWindow)}s)`;
          } else if (fadeDuration >= 6 && hasVocalOverlap) {
            // EQ_MIX antes que CUT cuando el fade da espacio para mid-scoop.
            type = 'EQ_MIX';
            reason = 'Vocal Trainwreck → EQ_MIX (mid-scoop preserva fade)';
          } else {
            type = 'CUT';
            reason = 'Vocal Trainwreck evitado → CUT forzado';
          }
        }
      }
    }
  }

  // Retirada de DROP_MIX y STEM_MIX → SEQUENTIAL. Ambos tipos producen
  // ratings consistentemente bajos en el catálogo del usuario. Redirect a
  // SEQUENTIAL: A llega a su final natural, B arranca completo, solape 50ms
  // inaudible. Mejor cero transición que una mala. Los case branches
  // residuales arriba se preservan por si se reintroducen tras nuevos datos.
  let f5bRetiredFrom: 'DROP_MIX' | 'STEM_MIX' | undefined;
  if (type === 'DROP_MIX') {
    type = 'SEQUENTIAL';
    reason = `[retirar DROP_MIX → SEQUENTIAL] ${reason}`;
    f5bRetiredFrom = 'DROP_MIX';
  } else if (type === 'STEM_MIX') {
    type = 'SEQUENTIAL';
    reason = `[retirar STEM_MIX → SEQUENTIAL] ${reason}`;
    f5bRetiredFrom = 'STEM_MIX';
  }

  // v15: defensa CUT_A_FADE_IN_B con energyB muy baja. Cuando queda en
  // cutAFadeInB pero B viene con energy < 0.10, el fade-in de B no tiene
  // cuerpo audible — degradar a SEQUENTIAL.
  let sequentialOverrideByVectorD = false;
  if (type === 'CUT_A_FADE_IN_B' && profile.energyB < 0.1) {
    type = 'SEQUENTIAL';
    reason = `[v15 energyB<0.10 en CUT_A_FADE_IN_B → SEQUENTIAL] ${reason}`;
    sequentialOverrideByVectorD = true;
  }

  // Record the final type for cooldown bookkeeping. Done at the end so the
  // safety overrides above (polirritmia, vocal trainwreck) are also tracked.
  recordTransition(type);

  return f5bRetiredFrom !== undefined
    ? { type, reason, f5bRetiredFrom, sequentialOverrideByVectorD }
    : { type, reason, sequentialOverrideByVectorD };
}

// ============================================================================
// MARK: - Adaptive Fade Duration (DJMixingService.swift:2579)
// ============================================================================

export type CalculateAdaptiveFadeDurationArgs = {
  entryPoint: number;
  bufferADuration: number;
  bufferBDuration: number;
  currentAnalysis?: SongAnalysis;
  nextAnalysis?: SongAnalysis;
  profile: TransitionProfile;
  userFadeDuration?: number;
};

/**
 * Picks the fade window length. Mirrors
 * `DJMixingService.swift:2579 calculateAdaptiveFadeDuration`.
 *
 * Order of operations (must match iOS so the modulation cascade is identical):
 *   1. Base: backend fadeIn/fadeOut if available + ≥ 2s, else structural
 *      (entryPoint as ideal, outro as constraint), else fallback.
 *   2. Profile modulations: minimal extension → energyDown extension →
 *      bass conflict shortening → low styleAffinity shortening →
 *      harmonic penalty (tense/clash) shortening.
 *   3. Intro B cap (introEndHeuristic × 0.85 if > 2s).
 *   4. v14.h fade-vs-punch cap when introEnd < entryPoint − 1s.
 *   5. Shorten when A has no instrumental outro (×0.80 if B intro is vocal).
 *   6. Absolute max: 25% of the shorter buffer.
 *   7. Cap by B's available audio after entry point.
 *   8. v15.h cap final por punch B (entryPoint / 1.1) — final guard.
 *   9. Floor 2s.
 */
export function calculateAdaptiveFadeDuration(
  args: CalculateAdaptiveFadeDurationArgs
): FadeDurationResult {
  const {
    entryPoint,
    bufferADuration,
    bufferBDuration,
    currentAnalysis,
    nextAnalysis,
    profile,
    userFadeDuration
  } = args;

  const config = MIX_MODE_CONFIGS[profile.mode];
  const baseDuration = userFadeDuration ?? config.baseFadeDuration;
  let fadeDuration = baseDuration;
  let decision = `Base (${fadeDuration}s).`;

  const fmt1 = (n: number) => n.toFixed(1);
  const fmt2 = (n: number) => n.toFixed(2);
  const fmt0 = (n: number) => n.toFixed(0);

  const hasCurrent = currentAnalysis !== undefined && !currentAnalysis.hasError;
  const hasNext = nextAnalysis !== undefined && !nextAnalysis.hasError;

  if (hasCurrent && hasNext && currentAnalysis && nextAnalysis) {
    const backendFadeIn = nextAnalysis.backendFadeInDuration;
    const backendFadeOut = currentAnalysis.backendFadeOutDuration;

    if (userFadeDuration === undefined && backendFadeIn !== undefined && backendFadeIn >= 2) {
      fadeDuration = Math.max(
        config.minFadeDuration,
        Math.min(config.maxFadeDuration, backendFadeIn)
      );
      decision = `Backend fadeIn: ${fmt1(backendFadeIn)}s → ${fmt1(fadeDuration)}s.`;

      if (backendFadeOut !== undefined && backendFadeOut >= 2) {
        const avg =
          (fadeDuration +
            Math.max(config.minFadeDuration, Math.min(config.maxFadeDuration, backendFadeOut))) /
          2;
        fadeDuration = avg;
        decision = `Backend fadeIn/Out: ${fmt1(backendFadeIn)}/${fmt1(backendFadeOut)}s → avg ${fmt1(fadeDuration)}s.`;
      }

      if (entryPoint > 0 && fadeDuration * 1.2 > entryPoint) {
        const localMin = profile.mode === 'dj' ? 2.0 : config.minFadeDuration;
        fadeDuration = Math.max(localMin, entryPoint / 1.2);
        decision += ` Capped por punch a ${fmt1(fadeDuration)}s.`;
      }
    } else {
      const outroAStart =
        currentAnalysis.outroStartTime > 0 ? currentAnalysis.outroStartTime : bufferADuration;
      const outroADuration = bufferADuration - outroAStart;
      const hasValidOutro = outroADuration >= 2;
      const localMin = profile.mode === 'dj' ? 2.0 : config.minFadeDuration;

      const idealFade = entryPoint;
      const outroConstraint = hasValidOutro ? outroADuration : config.maxFadeDuration;

      if (idealFade >= localMin) {
        fadeDuration = Math.max(
          localMin,
          Math.min(config.maxFadeDuration, idealFade, outroConstraint)
        );
        decision = `Estructural: intro=${fmt1(idealFade)}s outro=${fmt1(outroADuration)}s → ${fmt1(fadeDuration)}s.`;
      } else if (hasValidOutro) {
        fadeDuration = Math.max(
          localMin,
          Math.min(config.maxFadeDuration, outroADuration * 0.8)
        );
        decision = `Punch temprano (${fmt1(idealFade)}s), outro=${fmt1(outroADuration)}s → ${fmt1(fadeDuration)}s.`;
      } else {
        fadeDuration = userFadeDuration ?? (profile.mode === 'dj' ? 5 : 6);
        decision = `Sin estructura clara: ${fmt1(fadeDuration)}s.`;
      }

      if (entryPoint > 0 && fadeDuration * 1.2 > entryPoint) {
        fadeDuration = Math.max(localMin, entryPoint / 1.2);
        decision += ` Capped por punch a ${fmt1(fadeDuration)}s.`;
      }
    }

    // ── Profile-driven modulations ──

    if (profile.character === 'minimal' && fadeDuration < 8) {
      fadeDuration = Math.min(config.maxFadeDuration, Math.max(fadeDuration, 8));
      decision += ` Extendido por minimal a ${fmt1(fadeDuration)}s.`;
    }

    if (profile.energyFlow === 'energyDown') {
      const outroAStart2 =
        currentAnalysis.outroStartTime > 0 ? currentAnalysis.outroStartTime : bufferADuration;
      const outroLen = bufferADuration - outroAStart2;
      if (outroLen > 12) {
        fadeDuration = Math.min(15, Math.max(fadeDuration, outroLen * 0.9));
        decision += ` Extendido por caida de energia a ${fmt1(fadeDuration)}s.`;
      }
    }

    if (profile.bassConflictRisk && fadeDuration > 6) {
      fadeDuration = Math.max(5, fadeDuration * 0.85);
      decision += ` Acortado por bass conflict a ${fmt1(fadeDuration)}s.`;
    }

    if (profile.styleAffinity < 0.35 && fadeDuration > 5) {
      fadeDuration = Math.max(4, fadeDuration * 0.8);
      decision += ` Acortado por baja afinidad (${fmt2(profile.styleAffinity)}) a ${fmt1(fadeDuration)}s.`;
    }

    switch (profile.harmonic.compatibility) {
      case 'compatible':
      case 'acceptable':
        break;
      case 'tense':
        fadeDuration = Math.max(2, fadeDuration * 0.85);
        decision += ` Reducido 15% por tension armonica a ${fmt2(fadeDuration)}s.`;
        break;
      case 'clash':
        fadeDuration = Math.max(2, fadeDuration * 0.75);
        decision += ` Reducido 25% por clash armonico a ${fmt2(fadeDuration)}s.`;
        break;
    }
  } else {
    fadeDuration = userFadeDuration ?? (bufferADuration < 30 ? 3 : baseDuration);
    decision = `Sin analisis — duracion ${fmt0(fadeDuration)}s.`;
  }

  // ── Cap by B's intro instrumental window ──
  // Heuristic intro end (percussion/energy-based), not the ML value which is
  // often 2-3x longer. Allow 85% of the intro window so the fade finishes
  // before vocals hit.
  if (nextAnalysis && !nextAnalysis.hasError) {
    const introWindow =
      nextAnalysis.introEndTimeHeuristic ??
      (nextAnalysis.hasIntroData ? nextAnalysis.introEndTime : 0);
    if (introWindow > 2) {
      const introCap = introWindow * 0.85;
      if (fadeDuration > introCap) {
        fadeDuration = Math.max(2, introCap);
        decision += ` Capped por intro B (${fmt1(introWindow)}s×0.85) a ${fmt1(fadeDuration)}s.`;
      }
    }

    // v14.h — gate fade-vs-punch. Si introEnd < entryPoint − 1s, la intro
    // de B ya terminó antes de que B entre en mezcla; el fade largo aplasta
    // el chorus que ya está sonando libre.
    const introEnd = nextAnalysis.introEndTimeHeuristic;
    if (
      introEnd !== undefined &&
      introEnd > 0 &&
      introEnd < entryPoint - 1.0 &&
      fadeDuration > 5
    ) {
      const punchCap = Math.max(3.0, (entryPoint - introEnd) * 0.85);
      if (fadeDuration > punchCap) {
        fadeDuration = punchCap;
        decision += ` Capped por fade-vs-punch (introEnd ${fmt1(introEnd)}s < entry ${fmt1(entryPoint)}s−1) a ${fmt1(fadeDuration)}s.`;
      }
    }
  }

  // ── Shorten when A has no instrumental outro ──
  // If A's outro is vocal (or unconfirmed) AND B's intro is also vocal,
  // reduce fade to minimize the trainwreck. B-intro-instrumental skips
  // the reduction (A's tail vocals fall on B's instrumental → no clash).
  if (currentAnalysis && !currentAnalysis.hasError) {
    const aOutroVocal =
      currentAnalysis.hasOutroVocals ||
      (!currentAnalysis.hasOutroData && (currentAnalysis.vocalStartTime ?? 0) > 0);
    if (aOutroVocal && fadeDuration > 4) {
      const bIntroInstrumental = (() => {
        if (!nextAnalysis || nextAnalysis.hasError) return false;
        if (nextAnalysis.hasVocalData && !nextAnalysis.hasIntroVocals) return true;
        if (nextAnalysis.vocalStartTime !== undefined && nextAnalysis.vocalStartTime > 4)
          return true;
        return false;
      })();
      if (bIntroInstrumental) {
        decision += ' Outro vocal A pero intro B instrumental — sin reduccion.';
      } else {
        fadeDuration = Math.max(3, fadeDuration * 0.8);
        decision += ` Reducido 20% por outro vocal A a ${fmt1(fadeDuration)}s.`;
      }
    }
  }

  // Absolute max: 25% of the shorter buffer.
  const absoluteMax = Math.min(bufferADuration * 0.25, bufferBDuration * 0.25);
  if (fadeDuration > absoluteMax) {
    fadeDuration = Math.max(2, absoluteMax);
    decision += ` Acortado por limite 25% a ${fmt2(fadeDuration)}s.`;
  }

  // Cap to B's available audio after entry point.
  const bAvailable = bufferBDuration - entryPoint - 2.0;
  if (bAvailable > 0 && fadeDuration > bAvailable) {
    fadeDuration = Math.max(2, bAvailable);
    decision += ` Acortado por B corta (disponible: ${fmt1(bAvailable + 2)}s) a ${fmt2(fadeDuration)}s.`;
  }

  // v15.h — cap final por punch B. Aplicado DESPUÉS de todos los
  // modificadores (introCap, outroLen, minimal, reducción 20% outro vocal)
  // porque cualquiera puede inflar el valor sobre el cap pre-modulaciones.
  if (entryPoint > 0 && fadeDuration > entryPoint / 1.1) {
    const punchSafeCap = Math.max(2, entryPoint / 1.1);
    fadeDuration = punchSafeCap;
    decision += ` Cap final por punch B (entry=${fmt1(entryPoint)}s) a ${fmt2(fadeDuration)}s.`;
  }

  return { duration: Math.max(2, fadeDuration), decision };
}

// Re-export the BPMRelationship type for convenience — callers building a
// profile inline often need this. The other relationship types stay in
// dj-types.ts to keep the import graph honest.
export type { BPMRelationship };
