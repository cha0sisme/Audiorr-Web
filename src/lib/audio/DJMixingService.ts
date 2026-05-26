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
  type AnticipationResult,
  type BPMRelationship,
  type DJEffectsResult,
  type DJFilterResult,
  type EnergyFlow,
  type FadeDurationResult,
  type FilterDecisionResult,
  type HarmonicCompatibility,
  type HarmonicPenalty,
  type MixMode,
  MIX_MODE_CONFIGS,
  type SongAnalysis,
  type TimeStretchResult,
  type TransitionCharacter,
  type TransitionProfile,
  type TransitionType,
  type TransitionTypeResult,
  type TriggerBiasResult,
  type VocalOverlapRisk
} from './dj-types';
import { harmonicPenaltyIsClash } from './dj-types';

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
 * Drop-driven genres (trap, drill, hip-hop, industrial) — used by the A2
 * widening anticipation gate to suppress sub-bass conflict between a
 * high-BPM kick-driven A and a sub-808 drop-driven B. Mirrors
 * `dropDrivenBassGenres` in iOS DJMixingService.swift:4573. Match is
 * substring case-insensitive: "trap" ∈ "Latin Trap" → true.
 */
const DROP_DRIVEN_BASS_GENRES: readonly string[] = [
  'trap', 'drill', 'hip-hop', 'hip hop', 'industrial'
];

/**
 * True if any genre in the list contains one of the drop-driven substrings.
 * Mirrors `DJMixingService.swift:4591 isBDropDrivenBass`.
 */
export function isBDropDrivenBass(genres: readonly string[]): boolean {
  if (genres.length === 0) return false;
  for (const g of genres) {
    const lower = g.toLowerCase();
    for (const pat of DROP_DRIVEN_BASS_GENRES) {
      if (lower.includes(pat)) return true;
    }
  }
  return false;
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
// MARK: - Instrumental detectors (DJMixingService.swift:4268, :4317)
// ============================================================================

/**
 * Detect if A's outro is instrumental in the actual crossfade zone.
 * Mirrors `DJMixingService.swift:4268 detectOutroInstrumental`.
 *
 * Fake-outro guard: trap and conscious hip-hop frequently have a *false outro*
 * — energy dips for 4-8 bars, then a final verse / ad-lib comes back. If we
 * have hard evidence of vocals in the last 4s, override to not-instrumental
 * regardless of any other signal. The 4s window is independent of fadeDuration
 * so a long fade (15s) doesn't mask a late vocal that lands inside the
 * perceptual "outro" of the song.
 */
export function detectOutroInstrumental(args: {
  currentAnalysis?: SongAnalysis;
  bufferADuration: number;
  fadeDuration: number;
}): boolean {
  const { currentAnalysis: cur, bufferADuration, fadeDuration } = args;
  if (!cur || cur.hasError) return false;

  const crossfadeStartA = bufferADuration - fadeDuration;

  // ── Fake-outro guard: vocals in the last 4s override everything ──
  if (bufferADuration >= 4.0) {
    const last4sStart = bufferADuration - 4.0;
    if (cur.hasVocalEndData && cur.lastVocalTime > last4sStart) return false;
    if (cur.speechSegments.length > 0 && cur.speechSegments.some((s) => s.end > last4sStart)) {
      return false;
    }
  }

  if (cur.hasVocalEndData) {
    return cur.lastVocalTime < crossfadeStartA;
  }
  if (cur.hasVocalData && !cur.hasOutroVocals && cur.hasEnergyProfile) {
    if (cur.speechSegments.length > 0) {
      const vocalsInOutro = cur.speechSegments.some((s) => s.end > crossfadeStartA);
      return !vocalsInOutro;
    }
    return true;
  }
  return false;
}

/**
 * Detect if B's intro is instrumental in the actual entry/fade zone.
 * Mirrors `DJMixingService.swift:4317 detectIntroInstrumental`.
 *
 * Uses the same vocal-aware reference as entry point calculation:
 * `vocalStartTime` → `speechSegments[0]` → backend flags.
 *
 * NOTE on `vocalStartTime === 0` literal semantics: backend treats 0.0 as
 * "vocal at t=0" (track opens singing), but legacy cached entries written
 * pre-backfill use 0.0 as camouflaged null. Conservative chain: only consider
 * vocalOnset when `> 0`, falling back to speechSegments / backend flags.
 */
export function detectIntroInstrumental(args: {
  nextAnalysis?: SongAnalysis;
  entryPoint: number;
  fadeDuration: number;
}): boolean {
  const { nextAnalysis: nxt, entryPoint, fadeDuration } = args;
  if (!nxt || nxt.hasError) return false;

  const bEnd = entryPoint + fadeDuration;

  // Vocal onset: prefer explicit vocalStartTime, fall back to first
  // speechSegment.start. 0 is treated as "unknown" pending backfill.
  let vocalOnset = 0;
  if (nxt.vocalStartTime !== undefined && nxt.vocalStartTime > 0) {
    vocalOnset = nxt.vocalStartTime;
  } else if (nxt.speechSegments.length > 0 && (nxt.speechSegments[0]?.start ?? 0) > 0) {
    vocalOnset = nxt.speechSegments[0]?.start ?? 0;
  }

  if (vocalOnset > 0) {
    return vocalOnset > bEnd;
  }

  // No vocal timing data — fall back to backend flags.
  if (nxt.hasVocalData && nxt.hasEnergyProfile && !nxt.hasIntroVocals) {
    return true;
  }
  return false;
}

// ============================================================================
// MARK: - Build Transition Profile (DJMixingService.swift:535)
// ============================================================================

export type BuildTransitionProfileArgs = {
  currentAnalysis?: SongAnalysis;
  nextAnalysis?: SongAnalysis;
  mode: MixMode;
  bufferADuration: number;
  bufferBDuration: number;
};

/**
 * Builds the A↔B `TransitionProfile`. Mirrors
 * `DJMixingService.swift:535 buildTransitionProfile`.
 *
 * Called ONCE upstream by `calculateCrossfadeConfig` (Fase 1 pending) and
 * drives every downstream decision (`decideTransitionType`,
 * `calculateAdaptiveFadeDuration`, filter usage, anticipation, entry point).
 *
 * Sections in order:
 *   1. Energy (per-section preferred — uses `energyOutro` / `energyIntro`
 *      when `hasEnergyProfile`, else `energy`). Floor 0.10 when raw ≤0.02
 *      AND track > 30s (defends against backend RMS-zeroing bug; safe
 *      because 0.10 is below any audible track's real energy).
 *   2. BPM with harmonic fold (half/double-time) + confidence trust gate
 *      (both ≥0.5 + BPM in [20, 300]).
 *   3. Harmonic penalty (Camelot wheel distance).
 *   4. Vocal overlap — conservative estimate (A's last 15s vs B's first 20s).
 *   5. Danceability + bass conflict (both >0.65 → bass overlap risk).
 *   6. Style affinity 0-1: weighted ave of BPM/energy/harmonic/danceability
 *      affinities (35/25/25/15 weights).
 *   7. Character (punch/smooth/dramatic/minimal): rules in order.
 */
export function buildTransitionProfile(args: BuildTransitionProfileArgs): TransitionProfile {
  const { currentAnalysis, nextAnalysis, mode, bufferADuration, bufferBDuration } = args;

  const hasCurrent = currentAnalysis !== undefined && !currentAnalysis.hasError;
  const hasNext = nextAnalysis !== undefined && !nextAnalysis.hasError;

  // ── Energy (per-section preferred) ──
  // Backend RMS-zeroing bug: pistas audibles devuelven energy/energyOutro≈0.
  // Floor a 0.10 cuando raw ≤0.02 Y duración > 30s (pistas <30s pueden ser
  // jingles/SFX donde 0 es legítimo). 0.10 está por debajo de cualquier
  // pista audible real → no afecta tracks legítimamente bajos.
  const computeEnergy = (
    analysis: SongAnalysis | undefined,
    has: boolean,
    perSection: (a: SongAnalysis) => number,
    bufferDur: number
  ): number => {
    let raw: number;
    if (analysis && has && analysis.hasEnergyProfile) raw = perSection(analysis);
    else raw = has ? (analysis?.energy ?? 0.5) : 0.5;
    return raw <= 0.02 && bufferDur > 30 ? 0.10 : raw;
  };
  const eA = computeEnergy(currentAnalysis, hasCurrent, (a) => a.energyOutro, bufferADuration);
  const eB = computeEnergy(nextAnalysis, hasNext, (a) => a.energyIntro, bufferBDuration);

  const gap = eB - eA;
  let flow: EnergyFlow;
  if (gap > 0.15) flow = 'energyUp';
  else if (gap < -0.15) flow = 'energyDown';
  else flow = 'steady';

  // ── BPM (with confidence system) ──
  const bA = hasCurrent ? (currentAnalysis?.bpm ?? 120) : 120;
  const bB = hasNext ? (nextAnalysis?.bpm ?? 120) : 120;
  const bBNorm = harmonicBPM(bA, bB);
  const diff = Math.abs(bA - bBNorm);
  let bpmRel: BPMRelationship;
  if (diff < 3) bpmRel = 'identical';
  else if (diff <= 12) bpmRel = 'compatible';
  else if (diff <= 18) bpmRel = 'borderline';
  else bpmRel = 'incompatible';

  // BPM confidence: both must have confidence ≥ 0.5 AND BPM ∈ [20, 300] for
  // beat-sync / time-stretch / bassKill to be musically justified. Fallback
  // 0.5 (no 1.0): si el backend no devolvió confidence, asumimos el límite
  // mínimo confiable en lugar de confianza máxima injustificada.
  const confA = currentAnalysis?.bpmConfidence ?? 0.5;
  const confB = nextAnalysis?.bpmConfidence ?? 0.5;
  const hasBeatDataA = bA > 20 && bA < 300;
  const hasBeatDataB = bB > 20 && bB < 300;
  const trusted = confA >= 0.5 && confB >= 0.5 && hasBeatDataA && hasBeatDataB;

  // ── Harmonic ──
  const harm = harmonicPenalty(currentAnalysis?.key, nextAnalysis?.key);

  // ── Vocal overlap (conservative: A's last ~15s, B's first ~20s) ──
  const conservativeCrossfadeZoneA = Math.max(0, bufferADuration - 15);
  const conservativeBEnd = 20;

  let aVocals = false;
  if (currentAnalysis && hasCurrent) {
    const cur = currentAnalysis;
    if (cur.hasVocalData && cur.hasOutroVocals) {
      aVocals = true;
    } else if (cur.hasVocalEndData) {
      aVocals = cur.lastVocalTime > conservativeCrossfadeZoneA;
    } else if (cur.speechSegments.length > 0) {
      aVocals = cur.speechSegments.some((s) => s.end > conservativeCrossfadeZoneA);
    } else if (cur.vocalStartTime !== undefined && cur.vocalStartTime > 0) {
      aVocals = cur.outroStartTime <= 0 || cur.outroStartTime > conservativeCrossfadeZoneA;
    }
    // else: vocalStart nil/0 → sin señal → no claim.
  }

  let bVocals = false;
  if (nextAnalysis && hasNext) {
    const nxt = nextAnalysis;
    if (nxt.hasVocalData && nxt.hasIntroVocals) {
      bVocals = true;
    } else if (nxt.speechSegments.length > 0) {
      bVocals = nxt.speechSegments.some((s) => s.start < conservativeBEnd);
    } else if (nxt.vocalStartTime !== undefined && nxt.vocalStartTime > 0) {
      bVocals = nxt.vocalStartTime < conservativeBEnd;
    }
    // else: vs nil (unknown) o 0 (literal vocal-at-t=0) — sin claim.
  }

  let vocalRisk: VocalOverlapRisk;
  if (aVocals && bVocals) vocalRisk = 'both';
  else if (aVocals && !bVocals) vocalRisk = 'aOnly';
  else if (!aVocals && bVocals) vocalRisk = 'bOnly';
  else vocalRisk = 'none';

  // ── Danceability / bass conflict ──
  const dA = hasCurrent ? (currentAnalysis?.danceability ?? 0.5) : 0.5;
  const dB = hasNext ? (nextAnalysis?.danceability ?? 0.5) : 0.5;
  const avgDance = (dA + dB) / 2.0;
  const bassConflict = dA > 0.65 && dB > 0.65;

  // ── Style affinity (0-1) ──
  // Songs in the same BPM bracket, similar energy, similar danceability =
  // same "world". Pondered: BPM matters most (genre identifier), then energy,
  // then harmony, then danceability.
  const bpmAffinity = Math.max(0, 1.0 - diff / 30.0);
  const energyAffinity = Math.max(0, 1.0 - Math.abs(gap) / 0.6);
  const danceAffinity = Math.max(0, 1.0 - Math.abs(dA - dB) / 0.5);
  let harmonicAffinity: number;
  switch (harm.compatibility) {
    case 'compatible':
      harmonicAffinity = 1.0;
      break;
    case 'acceptable':
      harmonicAffinity = 0.7;
      break;
    case 'tense':
      harmonicAffinity = 0.4;
      break;
    case 'clash':
      harmonicAffinity = 0.1;
      break;
  }
  const affinity = Math.min(
    1.0,
    Math.max(
      0,
      bpmAffinity * 0.35 + energyAffinity * 0.25 + harmonicAffinity * 0.25 + danceAffinity * 0.15
    )
  );

  // ── Character ──
  // Backend energy values are compressed (most music falls 0.05-0.30).
  // "Minimal" should only apply to truly ambient/quiet tracks — high
  // danceability = NOT minimal even at low RMS energy.
  let character: TransitionCharacter;
  if (mode !== 'dj') {
    character = 'smooth';
  } else if (eA < 0.15 && eB < 0.15 && avgDance < 0.5) {
    character = 'minimal';
  } else if (Math.abs(gap) > 0.35 || harm.compatibility === 'clash') {
    character = 'dramatic';
  } else if (bpmRel !== 'incompatible' && affinity > 0.4) {
    character = 'punch';
  } else {
    character = 'smooth';
  }

  return {
    energyA: eA,
    energyB: eB,
    energyGap: gap,
    energyFlow: flow,
    bpmA: bA,
    bpmB: bB,
    bpmBNormalized: bBNorm,
    bpmDiff: diff,
    bpmRelationship: bpmRel,
    bpmTrusted: trusted,
    harmonic: harm,
    vocalOverlapRisk: vocalRisk,
    aHasOutroVocals: aVocals,
    bHasIntroVocals: bVocals,
    danceabilityA: dA,
    danceabilityB: dB,
    avgDanceability: avgDance,
    bassConflictRisk: bassConflict,
    character,
    styleAffinity: affinity,
    mode
  };
}

// ============================================================================
// MARK: - Filter Usage Decision (DJMixingService.swift:2786)
// ============================================================================

/**
 * Decide whether to engage DJ-style filtering during the crossfade.
 * Mirrors `DJMixingService.swift:2786 decideFilterUsage`.
 *
 * `useFilters`: ON when any of the gates fires (vocals present, energy gap
 * > 0.20, BPM diff > 20, harmonic clash/tense, bass conflict, fade < 3s).
 *
 * `useAggressiveFilters`: ON only when useFilters AND (vocals + both energies
 * > 0.20, OR harmonic clash, OR vocal overlap both, OR bass conflict, OR
 * fade < 3s). The vocals gate is the most common firer (~80% of catalog),
 * so it requires both A and B energy ≥ 0.20 to avoid putting a "gentle blend"
 * pairing through the full aggressive pipeline (notch + dynamicQ + bassKill
 * + midScoop + hp + ls).
 */
export function decideFilterUsage(args: {
  profile: TransitionProfile;
  fadeDuration: number;
}): FilterDecisionResult {
  const { profile, fadeDuration } = args;

  const hasVocals = profile.aHasOutroVocals || profile.bHasIntroVocals;
  const isVeryShort = fadeDuration < 3;
  const isShort = fadeDuration < 4;
  const isClash = harmonicPenaltyIsClash(profile.harmonic);

  // Threshold v15: energyGap bajado 0.30 → 0.20 para capturar asimetrías
  // perceptuales en catálogo Hip-Hop / R&B.
  const useFilters =
    hasVocals ||
    Math.abs(profile.energyGap) > 0.20 ||
    profile.bpmDiff > 20 ||
    isClash ||
    profile.bassConflictRisk ||
    isVeryShort;

  const useAggressive =
    useFilters &&
    ((hasVocals && profile.energyA > 0.20 && profile.energyB > 0.20) ||
      profile.harmonic.compatibility === 'clash' ||
      profile.vocalOverlapRisk === 'both' ||
      profile.bassConflictRisk ||
      isVeryShort);

  const reasons: string[] = [];
  if (hasVocals) reasons.push('voces');
  if (Math.abs(profile.energyGap) > 0.20) {
    reasons.push(`energia ${Math.trunc(Math.abs(profile.energyGap) * 100)}%`);
  }
  if (profile.bpmDiff > 20) reasons.push(`BPM ±${Math.trunc(profile.bpmDiff)}`);
  if (profile.harmonic.compatibility === 'tense') reasons.push('tension tonal');
  if (profile.harmonic.compatibility === 'clash') reasons.push('clash tonal');
  if (profile.bassConflictRisk) reasons.push('bass conflict');
  if (isVeryShort) reasons.push('fade<3s');
  if (isShort && !isVeryShort) reasons.push('fade<4s (no aggressive)');

  const reason = useFilters
    ? `Filtros ON: ${reasons.join(', ')}`
    : 'Filtros OFF: mezcla simple';

  return {
    useFilters,
    useAggressiveFilters: useAggressive,
    energyDiff: Math.abs(profile.energyGap),
    bpmDiff: profile.bpmDiff,
    reason
  };
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
// MARK: - DJ Filters (DJMixingService.swift:2854)
// ============================================================================

/**
 * Genres where the high-shelf cut hurts more than it helps. Hi-hat is the
 * groove signature in these families — cutting brilliance at 7-8kHz muddies
 * the signature. Case-sensitive match against `SongAnalysis.genres`
 * (Navidrome capitalization).
 */
const HIGH_SHELF_DISABLED_GENRES: ReadonlySet<string> = new Set([
  'Hip-Hop', 'Alternative Hip-Hop', 'Latin Hip-Hop', 'Experimental Hip-Hop',
  'Rap', 'UK Rap', 'Punk Rap', 'Progressive Rap', 'Emo Rap',
  'Contemporary R&B', 'Latin R&B', 'Neo Soul', 'Urban Contemporary',
  'Reggaeton', 'Dancehall',
  'Trap', 'Trap Music', 'Latin Trap', 'Emo Trap',
  'Drill', 'UK Drill', 'Plugg', 'Grime', 'Type Beat'
]);

/**
 * Refined DJ filter decisions using actual fade zone (entry point + fade
 * duration known). Mirrors `DJMixingService.swift:2854 decideDJFilters`.
 *
 * - **midScoop**: ON when A has vocals in the crossfade zone AND B has
 *   vocals in the entry zone (precise zone detection, not just profile
 *   flags).
 * - **highShelfCut**: ON when energyA > 0.20 AND energyB > 0.15 (hi-hat
 *   layering is audible). Overridden OFF when EITHER side has a genre
 *   listed in `HIGH_SHELF_DISABLED_GENRES` — preserves the groove of both
 *   tracks even if only one is hi-hat-driven.
 */
export function decideDJFilters(args: {
  currentAnalysis?: SongAnalysis;
  nextAnalysis?: SongAnalysis;
  profile: TransitionProfile;
  fadeDuration: number;
  entryPoint: number;
  bufferADuration: number;
}): DJFilterResult {
  const { currentAnalysis, nextAnalysis, profile, fadeDuration, entryPoint, bufferADuration } =
    args;

  if (!currentAnalysis && !nextAnalysis) {
    return { useMidScoop: false, useHighShelfCut: false, reason: 'Sin analisis' };
  }

  let useMidScoop = false;
  let useHighShelf = false;
  const reasons: string[] = [];

  const fmt2 = (n: number) => n.toFixed(2);

  // ── Mid Scoop: refine vocal overlap with actual crossfade zone ──
  if (currentAnalysis && nextAnalysis) {
    const crossfadeStartA = bufferADuration - fadeDuration;
    const bOverlapEnd = entryPoint + fadeDuration;

    // A vocals in zone — chain: backend flag → vocalEndData → speechSegments
    // → fallback (assume vocals when no data, safer for pop/hip-hop;
    // outroInstrumental is a separate, more reliable signal applied later).
    let aVocalsInZone = true;
    if (currentAnalysis.hasVocalData && currentAnalysis.hasOutroVocals) {
      aVocalsInZone = true;
    } else if (
      currentAnalysis.hasVocalEndData &&
      currentAnalysis.lastVocalTime > crossfadeStartA
    ) {
      aVocalsInZone = true;
    } else if (currentAnalysis.speechSegments.length > 0) {
      aVocalsInZone = currentAnalysis.speechSegments.some((s) => s.end > crossfadeStartA);
    }
    // else: aVocalsInZone stays true (fallback).

    // B vocals in entry zone — analogous chain.
    let bVocalsInZone = true;
    if (nextAnalysis.hasVocalData && nextAnalysis.hasIntroVocals) {
      bVocalsInZone = true;
    } else if (nextAnalysis.speechSegments.length > 0) {
      bVocalsInZone = nextAnalysis.speechSegments.some(
        (s) => s.start < bOverlapEnd && s.end > entryPoint
      );
    }
    // else: bVocalsInZone stays true (fallback).

    if (aVocalsInZone && bVocalsInZone) {
      useMidScoop = true;
      reasons.push('mid scoop: voces solapadas');
    }
  }

  // ── High-Shelf: energy-based hi-hat detection ──
  // Backend energy values are compressed (most music 0.05-0.42), so
  // thresholds must be low. Hi-hat / cymbal cleanup is subtle and harmless
  // on false positives — err on the side of activating.
  if (profile.energyA > 0.20 && profile.energyB > 0.15) {
    useHighShelf = true;
    reasons.push(
      `hi-shelf: energia A=${fmt2(profile.energyA)} B=${fmt2(profile.energyB)}`
    );
  }

  // ── Genre override: high-shelf cut destroys hi-hat groove signature ──
  if (useHighShelf) {
    const aGenres = currentAnalysis?.genres ?? [];
    const bGenres = nextAnalysis?.genres ?? [];
    const aHit = aGenres.some((g) => HIGH_SHELF_DISABLED_GENRES.has(g));
    const bHit = bGenres.some((g) => HIGH_SHELF_DISABLED_GENRES.has(g));
    if (aHit || bHit) {
      useHighShelf = false;
      const side = aHit && bHit ? 'A+B' : aHit ? 'A' : 'B';
      reasons.push(`hi-shelf OFF [genero ${side}: hi-hat groove]`);
    }
  }

  const reason =
    reasons.length === 0 ? 'DJ filters OFF' : `DJ filters ON: ${reasons.join(', ')}`;
  return { useMidScoop, useHighShelfCut: useHighShelf, reason };
}

// ============================================================================
// MARK: - DJ Effects (DJMixingService.swift:2979)
// ============================================================================

/**
 * Decide which DJ effects to activate. Mirrors
 * `DJMixingService.swift:2979 decideDJEffects`.
 *
 * Effects are conservative — only activate when conditions guarantee they
 * sound good and won't interfere with transition quality.
 *
 *   - **bassKill**: punch / dramatic-up / smooth+dance, BPM trusted, both
 *     energies ≥ 0.10, danceability > 0.4, fade > 4s, compatible type
 *     (eqMix / BMB / crossfade / cutAFadeInB / fadeOutACutB).
 *   - **dynamicQ**: NOT energy-down, fade > 4s, dance > 0.45, character
 *     punch or dramatic-not-down.
 *   - **notchSweep**: pairs with dynamicQ. ALSO requires NOT skipBFilters,
 *     NOT stem mix, fade > 5s, dance > 0.5.
 *   - **stutterCut**: only CUT family, bpmTrusted, BPM ∈ [80, 180], dance
 *     > 0.50, fade ≥ 1.5s, hasBeatGridA.
 *
 * Overrides at the bottom:
 *   - energyA < 0.15 → kill dynQ / notch / stutter (low-energy A makes
 *     filter modulation read as "filter weirdness", not DJ technique).
 *   - isChillContext → kill ALL moving effects (bassKill, dynQ, notch,
 *     stutter). Static EQ presets stay alive.
 */
export function decideDJEffects(args: {
  profile: TransitionProfile;
  transitionType: TransitionType;
  fadeDuration: number;
  isEnergyDown: boolean;
  needsAnticipation?: boolean;
  skipBFilters?: boolean;
  /** True when A has a non-empty beat grid the executor can anchor to.
      Without this, Stutter Cut would chop blindly relative to wall-clock
      and land off-grid. */
  hasBeatGridA?: boolean;
  /** Chill context detected upstream — suppress everything that *moves*
      (sweeps, automations, rhythmic gates). Static EQ presets are not
      affected. */
  isChillContext?: boolean;
}): DJEffectsResult {
  const {
    profile,
    transitionType,
    fadeDuration,
    isEnergyDown,
    skipBFilters = false,
    hasBeatGridA = false,
    isChillContext = false
  } = args;

  let useBassKill = false;
  let useDynamicQ = false;
  let useNotchSweep = false;
  let useStutterCut = false;
  const reasons: string[] = [];

  const fmt1 = (n: number) => n.toFixed(1);
  const fmt2 = (n: number) => n.toFixed(2);

  // ── Bass Kill ──
  let bassKillCompatibleType = false;
  switch (transitionType) {
    case 'EQ_MIX':
    case 'BEAT_MATCH_BLEND':
    case 'CROSSFADE':
    case 'CUT_A_FADE_IN_B':
    case 'FADE_OUT_A_CUT_B':
      bassKillCompatibleType = true;
      break;
    case 'CUT':
    case 'NATURAL_BLEND':
    case 'CLEAN_HANDOFF':
    case 'STEM_MIX':
    case 'DROP_MIX':
    case 'VINYL_STOP':
    case 'SEQUENTIAL':
      // CLEAN_HANDOFF: no overlap, no bass conflict. SEQUENTIAL: 50ms only.
      // STEM_MIX: stem swap IS the moment, adding bass kill muddies it.
      // DROP_MIX: already has HPF ramp on A — three effects in <4s feels busy.
      // CUT: too short to register a kill. NATURAL_BLEND: invisible by design.
      // VINYL_STOP: own gesture IS the effect.
      bassKillCompatibleType = false;
      break;
  }

  const dramaticEligible =
    profile.character === 'dramatic' && profile.energyFlow === 'energyUp';
  const punchEligible = profile.character === 'punch';
  const smoothEligible = profile.character === 'smooth' && profile.avgDanceability >= 0.55;
  const characterEligible = punchEligible || dramaticEligible || smoothEligible;

  if (
    bassKillCompatibleType &&
    profile.bpmTrusted &&
    profile.avgDanceability > 0.4 &&
    fadeDuration > 4.0 &&
    profile.energyA >= 0.10 &&
    profile.energyB >= 0.10 &&
    characterEligible
  ) {
    useBassKill = true;
    const charLabel = punchEligible
      ? 'punch'
      : dramaticEligible
        ? 'dramatic-up'
        : 'smooth+dance';
    reasons.push(
      `bassKill[${charLabel}]: dance=${fmt2(profile.avgDanceability)} energyA=${fmt2(profile.energyA)} energyB=${fmt2(profile.energyB)}`
    );
  }

  // ── Dynamic Q Resonance ──
  if (
    !isEnergyDown &&
    fadeDuration > 4.0 &&
    profile.avgDanceability > 0.45 &&
    (profile.character === 'punch' ||
      (profile.character === 'dramatic' && profile.energyFlow !== 'energyDown'))
  ) {
    useDynamicQ = true;
    reasons.push(
      `dynQ: dance=${fmt2(profile.avgDanceability)} fade=${fmt1(fadeDuration)}s`
    );
  }

  // ── Phaser Notch Sweep ──
  // Stacks musically with dynQ (different biquad bands — band 2 vs band 0/1).
  // Excluded on STEM_MIX (stem swap is its own dramatic moment, adding a
  // colorful notch obscures the intentional mid-only character of B's entry).
  if (
    useDynamicQ &&
    !skipBFilters &&
    transitionType !== 'STEM_MIX' &&
    fadeDuration > 5.0 &&
    profile.avgDanceability > 0.5
  ) {
    useNotchSweep = true;
    reasons.push(`notchSweep: pair with dynQ, fade=${fmt1(fadeDuration)}s`);
  }

  // ── Stutter Cut ──
  const stutterCompatibleType =
    transitionType === 'CUT' || transitionType === 'CUT_A_FADE_IN_B';
  if (
    stutterCompatibleType &&
    profile.bpmTrusted &&
    profile.bpmA >= 80 &&
    profile.bpmA <= 180 &&
    profile.avgDanceability > 0.50 &&
    fadeDuration >= 1.5 &&
    hasBeatGridA
  ) {
    useStutterCut = true;
    reasons.push(
      `stutter: cut@${Math.trunc(profile.bpmA)}BPM dance=${fmt2(profile.avgDanceability)}`
    );
  }

  // ── Energy-A floor: soft modulation effects when A is low-energy ──
  // Backend energy is compressed (most music 0.05–0.30), so <0.15 is a
  // low-energy passage. Filter modulation near-silence reads as "filter
  // weirdness", not DJ technique. bassKill (instant cut) is fine — kept.
  if (profile.energyA < 0.15 && (useDynamicQ || useNotchSweep || useStutterCut)) {
    useDynamicQ = false;
    useNotchSweep = false;
    useStutterCut = false;
    reasons.push('energyA<0.15: soft (no dynQ/notch/stutter)');
  }

  // ── Chill context override ──
  // Kills everything that *moves*. Static EQ presets (lowshelf, fixed
  // highpass) survive — they're upstream of this decisor.
  if (isChillContext && (useBassKill || useDynamicQ || useNotchSweep || useStutterCut)) {
    useBassKill = false;
    useDynamicQ = false;
    useNotchSweep = false;
    useStutterCut = false;
    reasons.push('chill: kill all dynamic FX');
  }

  const reason =
    reasons.length === 0 ? 'DJ effects OFF' : `DJ effects ON: ${reasons.join(', ')}`;
  return { useBassKill, useDynamicQ, useNotchSweep, useStutterCut, reason };
}

// ============================================================================
// MARK: - Anticipation (DJMixingService.swift:3208)
// ============================================================================

export type DecideAnticipationArgs = {
  fadeDuration: number;
  entryPoint: number;
  transitionType: TransitionType;
  /** When A has no real outro (groove until the very end), anticipation
      would cut material the listener is still expecting. */
  noRealOutro?: boolean;
  /** `transitionReason` string from the decisor. Used to detect Vocal
      Trainwreck / Polirritmia overrides which should suppress tease. */
  transitionReason?: string;
  /** B's instrumental intro window (heuristic or backend introEnd). */
  bIntroSpace?: number;
  /** B's vocal onset time (0 = unknown / vocal at t=0, treated as unknown
      until backfill is shipped). */
  vocalStartB?: number;
  /** BPM of A — gate for A2 widening drop-driven skip. */
  bpmA?: number;
  /** B genres — fed into `isBDropDrivenBass`. */
  bGenres?: readonly string[];
  /** A's rmsTailCurve — `deriveSlope(tailWindows=8)` detects natural decay. */
  rmsTailCurveA?: readonly number[];
  /** Caller's prediction of whether aggressive filters (bassKill / dynQ /
      notchSweep / stutterCut) will activate. Adds an anticipation extra
      so the filter onset is not abrupt. */
  filtersAggressivePredicted?: boolean;
};

/**
 * Decide whether to engage anticipation (pre-fade tease of B with filters
 * armed). Mirrors `DJMixingService.swift:3208 decideAnticipation`.
 *
 * Paths in order:
 *   1. noRealOutro → no tease (would cut groove the listener expects).
 *   2. CUT forced by safety (Vocal Trainwreck / Polirritmia) → no tease.
 *   3. DROP_MIX / CLEAN_HANDOFF / VINYL_STOP / SEQUENTIAL → no tease.
 *   4. CUT + entryPoint ≥ 5 → tease (min 2.5s, max 4s, entry × 0.3).
 *   5. PRE_PUNCH path: bIntroSpace ≥ 6s + entryPoint ≥ 7s + blendy type
 *      (CROSSFADE/BMB/EQ_MIX) + vocalSafetyMargin ≥ 4s → extended tease
 *      (4–7s, capped by bIntroSpace − 2 and vocal margin).
 *   6. A2 widening: fade < 11s (or 8s when high-BPM A meets drop-driven
 *      B) + entryPoint ≥ 5 → base anticipation up to 4s.
 *   7. Extra triggers (rmsTailCurve slope < −0.003/s on tailWindows=8 OR
 *      filtersAggressivePredicted) add up to 2s on top, capped at 4s.
 *      If A2 didn't fire but extras do, they trigger anticipation by
 *      themselves (≥ 1s).
 */
export function decideAnticipation(args: DecideAnticipationArgs): AnticipationResult {
  const {
    fadeDuration,
    entryPoint,
    transitionType,
    noRealOutro = false,
    transitionReason = '',
    bIntroSpace = 0,
    vocalStartB = 0,
    bpmA = 0,
    bGenres = [],
    rmsTailCurveA,
    filtersAggressivePredicted = false
  } = args;

  const fmt1 = (n: number) => n.toFixed(1);

  // ── No real outro: pre-mute would cut groove the listener expects ──
  if (noRealOutro) {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: A sin outro real (groove hasta el final)',
      isPrePunch: false
    };
  }

  // ── Safety-forced CUT (Vocal Trainwreck / Polirritmia) skips tease ──
  // Those CUTs evade clashes, not preview B. Tease would emit filtered B
  // at low gain before the swap — heard as unwanted fade. Genuine
  // outro-instrumental + B-abrupta CUT keeps its tease (different reason).
  if (
    transitionType === 'CUT' &&
    (transitionReason.includes('Vocal Trainwreck') ||
      transitionReason.includes('Polirritmia'))
  ) {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: CUT forzado por safety (no tease)',
      isPrePunch: false
    };
  }

  const hasEnoughIntro = entryPoint >= 5;

  // ── DROP_MIX / CLEAN_HANDOFF / VINYL_STOP / SEQUENTIAL: own gestures ──
  if (transitionType === 'DROP_MIX') {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: DROP_MIX - entrada directa',
      isPrePunch: false
    };
  }
  if (transitionType === 'CLEAN_HANDOFF') {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: CLEAN_HANDOFF - entrada secuencial',
      isPrePunch: false
    };
  }
  if (transitionType === 'VINYL_STOP') {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: VINYL_STOP - gesto de A primero',
      isPrePunch: false
    };
  }
  if (transitionType === 'SEQUENTIAL') {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: SEQUENTIAL - A termina natural',
      isPrePunch: false
    };
  }

  // ── CUT-specific tease: preview B filtered before the hard swap ──
  if (transitionType === 'CUT' && hasEnoughIntro) {
    const time = Math.min(4.0, Math.max(2.5, entryPoint * 0.3));
    return {
      needsAnticipation: true,
      anticipationTime: time,
      reason: `Anticipacion CUT: tease +${fmt1(time)}s antes del swap`,
      isPrePunch: false
    };
  }

  // ── PRE_PUNCH path ──
  // B has clear instrumental intro (bIntroSpace ≥ 6) + blendy type
  // + entry ≥ 7s + vocal safety margin ≥ 4s → extended tease where B
  // plays clean for 4-7s before the main fade. Caller forces
  // `skipBFilters=true` when isPrePunch=true so B is audible from the
  // first instant of the tease.
  //
  // Mechanics: B plays from entryPoint. During the tease (X seconds),
  // B sounds positions entryPoint..entryPoint+X. We require
  // entryPoint + X ≤ vocalStartB − 2 → X ≤ vocalStartB − entryPoint − 2.
  // If vocalSafetyMargin < 4 (min reasonable prePunchTime), don't fire.
  const prePunchEligibleType =
    transitionType === 'CROSSFADE' ||
    transitionType === 'BEAT_MATCH_BLEND' ||
    transitionType === 'EQ_MIX';
  if (bIntroSpace >= 6 && entryPoint >= 7 && prePunchEligibleType) {
    const vocalSafetyMargin = vocalStartB - entryPoint - 2.0;
    if (vocalSafetyMargin >= 4.0) {
      const prePunchTime = Math.min(
        7.0,
        Math.max(4.0, Math.min(bIntroSpace - 2.0, vocalSafetyMargin))
      );
      return {
        needsAnticipation: true,
        anticipationTime: prePunchTime,
        reason: `PRE_PUNCH: B suena clean ${fmt1(prePunchTime)}s antes (intro instr ${fmt1(bIntroSpace)}s, vocal margin ${fmt1(vocalSafetyMargin)}s)`,
        isPrePunch: true
      };
    }
  }

  // ── A2 widening ──
  // Original window "fade < 8 → anticipation" is extended to "fade < 11"
  // so intermediate fades also get a tease.
  //
  // Gate skip: when A is high-BPM (≥125, four-on-the-floor euro/dance-pop)
  // AND B is drop-driven (trap/drill/hip-hop/industrial sub-808), the
  // widening would create sub-conflict. Keep the previous behaviour (fade
  // < 8) in that case. Default conservative: if bpmA invalid or bGenres
  // empty → NO skip (apply widening).
  const bpmAValid = Number.isFinite(bpmA) && bpmA > 0;
  const shouldSkipA2Widening = bpmAValid && bpmA >= 125.0 && isBDropDrivenBass(bGenres);
  const widenThreshold = shouldSkipA2Widening ? 8.0 : 11.0;
  const needs = fadeDuration < widenThreshold && hasEnoughIntro;

  // ── Extra triggers (additive to A2 widening, capped at total 4s) ──
  // (a) outroSlopeSteep: A decaying naturally (slope < −0.003/s on tail
  //     windows=8 ≈ last 40s). Give B air before the real fade because
  //     listener already perceives A "leaving".
  // (b) filtersAggressivePredicted: caller anticipates aggressive filter
  //     activation (bassKill/dynQ/notchSweep/stutterCut). Filters enter
  //     hard at filterStartTime which cascades from anticipationTime.
  //     Advancing rampStart smooths the filter onset.
  //
  // Both triggers are gated by hasEnoughIntro (entryPoint ≥ 5 — no
  // margin otherwise).
  const tailSlope = deriveSlope(rmsTailCurveA, { tailWindows: 8 });
  const outroSlopeSteepRaw = tailSlope !== undefined && tailSlope < -0.003;
  const outroSlopeSteep = hasEnoughIntro && outroSlopeSteepRaw;
  const filtersAggressiveExtra = hasEnoughIntro && filtersAggressivePredicted;
  const extraTriggered = outroSlopeSteep || filtersAggressiveExtra;
  const outroSlopeExtra = extraTriggered ? Math.min(2.0, fadeDuration * 0.3) : 0;
  const extraReasonTag: string =
    outroSlopeSteep && filtersAggressiveExtra
      ? 'outroSlopeSteep+filtersAggressive'
      : outroSlopeSteep
        ? 'outroSlopeSteep'
        : filtersAggressiveExtra
          ? 'filtersAggressive'
          : '';

  if (needs) {
    const maxAnticipation = Math.min(4, entryPoint * 0.3);
    const baseTime = Math.min(maxAnticipation, Math.max(2, 10 - fadeDuration));
    const totalTime = Math.min(4.0, baseTime + outroSlopeExtra);
    const detail = shouldSkipA2Widening
      ? `fade corto, A2 gate skip (bpmA=${fmt1(bpmA)} drop-driven B)`
      : 'fade corto';
    if (outroSlopeExtra > 0) {
      return {
        needsAnticipation: true,
        anticipationTime: totalTime,
        reason: `Anticipacion: +${fmt1(totalTime)}s (${detail} + ${extraReasonTag} +${fmt1(totalTime - baseTime)}s)`,
        isPrePunch: false,
        anticipationReason: extraReasonTag
      };
    }
    return {
      needsAnticipation: true,
      anticipationTime: totalTime,
      reason: `Anticipacion: +${fmt1(totalTime)}s (${detail})`,
      isPrePunch: false
    };
  }

  // A2 widening didn't fire. If extras still trigger AND there's room,
  // fire only the extra (covers long fades that wouldn't anticipate
  // otherwise).
  if (extraTriggered) {
    const maxAnticipation = Math.min(4, entryPoint * 0.3);
    const time = Math.min(maxAnticipation, outroSlopeExtra);
    if (time >= 1.0) {
      return {
        needsAnticipation: true,
        anticipationTime: time,
        reason: `Anticipacion: +${fmt1(time)}s (${extraReasonTag}, fade largo)`,
        isPrePunch: false,
        anticipationReason: extraReasonTag
      };
    }
  }

  if (fadeDuration >= widenThreshold) {
    return {
      needsAnticipation: false,
      anticipationTime: 0,
      reason: 'Sin anticipacion: fade largo',
      isPrePunch: false
    };
  }
  return {
    needsAnticipation: false,
    anticipationTime: 0,
    reason: 'Sin anticipacion: intro insuficiente',
    isPrePunch: false
  };
}

// ============================================================================
// MARK: - Time-Stretch Decision (DJMixingService.swift:4001)
// ============================================================================

/**
 * Decide whether and how to time-stretch A and/or B to meet halfway.
 * Mirrors `DJMixingService.swift:4001 decideTimeStretch`.
 *
 * Cuts / handoffs and VINYL_STOP never stretch. Diff < 3 BPM: no stretch
 * needed. Diff ≤ 8: stretch B → A's BPM. Diff ≤ 15: stretch both to the
 * midpoint. Diff > 15: too far, no stretch (a >8% rate change becomes
 * pitch-audible).
 */
export function decideTimeStretch(args: {
  profile: TransitionProfile;
  transitionType: TransitionType;
}): TimeStretchResult {
  const { profile, transitionType } = args;

  switch (transitionType) {
    case 'CUT':
    case 'CUT_A_FADE_IN_B':
    case 'FADE_OUT_A_CUT_B':
    case 'CLEAN_HANDOFF':
    case 'SEQUENTIAL':
      return {
        useTimeStretch: false,
        rateA: 1.0,
        rateB: 1.0,
        reason: 'No stretch: transicion tipo cut/handoff'
      };
    case 'VINYL_STOP':
      // VINYL_STOP OWNS the rate ramp on A (1.0 → 0). No global time-stretch
      // — the curve is driven directly by the executor.
      return {
        useTimeStretch: false,
        rateA: 1.0,
        rateB: 1.0,
        reason: 'No stretch: rate ramp owned por VINYL_STOP'
      };
    default:
      break;
  }

  if (
    profile.bpmA <= 50 ||
    profile.bpmA >= 250 ||
    profile.bpmB <= 50 ||
    profile.bpmB >= 250
  ) {
    return {
      useTimeStretch: false,
      rateA: 1.0,
      rateB: 1.0,
      reason: 'No stretch: BPM fuera de rango'
    };
  }

  if (!profile.bpmTrusted) {
    return {
      useTimeStretch: false,
      rateA: 1.0,
      rateB: 1.0,
      reason: 'No stretch: BPM no confiable (confidence < 0.5)'
    };
  }

  const diff = profile.bpmDiff;
  const maxRateChange = 0.08; // 8% — still inaudible with time-domain stretching

  const fmt1 = (n: number) => n.toFixed(1);
  const fmt3 = (n: number) => n.toFixed(3);

  if (diff < 3) {
    return {
      useTimeStretch: false,
      rateA: 1.0,
      rateB: 1.0,
      reason: `No stretch: BPMs casi iguales (±${fmt1(diff)})`
    };
  } else if (diff <= 8) {
    const rateB = profile.bpmA / profile.bpmBNormalized;
    if (Math.abs(rateB - 1.0) > maxRateChange) {
      return {
        useTimeStretch: false,
        rateA: 1.0,
        rateB: 1.0,
        reason: `No stretch: rate ${fmt1(Math.abs(rateB - 1.0) * 100)}% > 8% (audible)`
      };
    }
    return {
      useTimeStretch: true,
      rateA: 1.0,
      rateB,
      reason: `Stretch B→A: ${Math.trunc(profile.bpmBNormalized)}→${Math.trunc(profile.bpmA)} BPM (rate=${fmt3(rateB)})`
    };
  } else if (diff <= 15) {
    const mid = (profile.bpmA + profile.bpmBNormalized) / 2.0;
    const rateA = mid / profile.bpmA;
    const rateB = mid / profile.bpmBNormalized;
    if (Math.abs(rateA - 1.0) > maxRateChange || Math.abs(rateB - 1.0) > maxRateChange) {
      return {
        useTimeStretch: false,
        rateA: 1.0,
        rateB: 1.0,
        reason: `No stretch: rate change > 8% (A:${fmt1(Math.abs(rateA - 1.0) * 100)}% B:${fmt1(Math.abs(rateB - 1.0) * 100)}%)`
      };
    }
    return {
      useTimeStretch: true,
      rateA,
      rateB,
      reason: `Stretch ambos→${Math.trunc(mid)} BPM: A=${fmt3(rateA)} B=${fmt3(rateB)}`
    };
  } else {
    return {
      useTimeStretch: false,
      rateA: 1.0,
      rateB: 1.0,
      reason: `No stretch: diferencia demasiado grande (±${Math.trunc(diff)} BPM)`
    };
  }
}

// ============================================================================
// MARK: - Trigger Bias (DJMixingService.swift:3443)
// ============================================================================

/**
 * How much earlier or later the crossfade should trigger on A, based on the
 * A↔B relationship. Mirrors `DJMixingService.swift:3443 calculateTriggerBias`.
 *
 * Default trigger = "as late as possible so fade fits before A ends".
 * Bias shifts it: negative = start earlier (longer overlap), positive = start
 * later (tighter).
 *
 *   - minimal: trigger up to fadeDuration*0.4 earlier (cap 5s).
 *   - smooth:  trigger up to fadeDuration*0.25 earlier (cap 3s).
 *   - dramatic DOWN: trigger up to fadeDuration*0.3 earlier (cap 4s).
 *   - dramatic UP:   trigger up to fadeDuration*0.15 later (cap 2s).
 *   - punch: default (0); high styleAffinity adds +1s.
 *   - bass conflict: −fadeDuration*0.15 (cap 2s) when bias > -3.
 *   - vocal overlap both: −fadeDuration*0.2 (cap 2s) when bias > -2.
 *   - high affinity + punch: +1.0s.
 */
export function calculateTriggerBias(args: {
  profile: TransitionProfile;
  fadeDuration: number;
}): TriggerBiasResult {
  const { profile, fadeDuration } = args;
  const reasons: string[] = [];
  let bias = 0;

  const fmt1 = (n: number) => n.toFixed(1);

  switch (profile.character) {
    case 'minimal':
      bias -= Math.min(5, fadeDuration * 0.4);
      reasons.push(`minimal: trigger ${fmt1(Math.abs(bias))}s antes`);
      break;
    case 'smooth':
      bias -= Math.min(3, fadeDuration * 0.25);
      reasons.push(`smooth: trigger ${fmt1(Math.abs(bias))}s antes`);
      break;
    case 'dramatic':
      if (profile.energyFlow === 'energyDown') {
        bias -= Math.min(4, fadeDuration * 0.3);
        reasons.push(`dramatic DOWN: trigger ${fmt1(Math.abs(bias))}s antes`);
      } else if (profile.energyFlow === 'energyUp') {
        bias += Math.min(2, fadeDuration * 0.15);
        reasons.push(`dramatic UP: trigger ${fmt1(bias)}s despues`);
      }
      // steady + dramatic (harmonic clash): default timing, just get through it.
      break;
    case 'punch':
      // Compatible BPMs — default timing. Vocal/bass adjustments below.
      break;
  }

  // ── Bass conflict: start earlier so filters have time to separate the low end ──
  if (profile.bassConflictRisk && bias > -3) {
    const bassAdj = Math.min(2, fadeDuration * 0.15);
    bias -= bassAdj;
    reasons.push(`bass conflict: -${fmt1(bassAdj)}s`);
  }

  // ── Vocal overlap both: A and B both vocal → fade A's earlier ──
  if (profile.vocalOverlapRisk === 'both' && bias > -2) {
    const vocalAdj = Math.min(2, fadeDuration * 0.2);
    bias -= vocalAdj;
    reasons.push(`vocal overlap: -${fmt1(vocalAdj)}s`);
  }

  // ── High style affinity + punch: can afford slightly later trigger ──
  if (profile.styleAffinity > 0.8 && profile.character === 'punch') {
    bias += 1.0;
    reasons.push('alta afinidad: +1s');
  }

  const reason =
    reasons.length === 0
      ? 'Trigger bias: 0 (default)'
      : `Trigger bias: ${bias >= 0 ? '+' : ''}${fmt1(bias)}s (${reasons.join(', ')})`;

  return { bias, reason };
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
