/**
 * DJ Mixing types — ported from `DJMixingService.swift` v15.m.
 *
 * Pure data — no behavior. The functions live in `DJMixingService.ts`.
 * Mirrors iOS naming verbatim so cross-references stay 1:1.
 *
 * Conventions vs Swift:
 *   - `Double?` → `number | undefined` (NOT null — `exactOptionalPropertyTypes`
 *     in tsconfig treats them as distinct). Internal sentinel: `undefined`
 *     means "unknown / no detection" exactly like Swift's nil.
 *   - `[Double]` → `readonly number[]`. Curves are immutable.
 *   - Swift `enum Foo: String` → TS `const`-style union. We avoid TS `enum`
 *     because it produces non-tree-shakeable runtime objects, and the rawValue
 *     IS the wire format used to bridge to backend telemetry.
 *   - `struct` with `let` fields → readonly TS `type`. No mutation allowed
 *     after construction; matches Swift `let` semantics.
 */

// ============================================================================
// MARK: - Algorithm version (mirrors DJMixingService.swift:128)
// ============================================================================

/**
 * iOS algorithm version that this port mirrors. Bump in sync when porting a
 * new iOS round (e.g., when iOS lands v15.n with algorithm changes).
 * Pure metadata — used to tag transition telemetry once we wire it up.
 */
export const PORTED_FROM_IOS_VERSION = 'v15.m' as const;

// ============================================================================
// MARK: - MixMode (DJMixingService.swift:200)
// ============================================================================

export type MixMode = 'dj' | 'normal';

export type MixModeConfig = {
  readonly minFadeDuration: number;
  readonly maxFadeDuration: number;
  readonly baseFadeDuration: number;
  readonly fallbackPercent: number;
  readonly fallbackMaxSeconds: number;
};

/** Mirrors `DJMixingService.configs` (DJMixingService.swift:244). */
export const MIX_MODE_CONFIGS: Record<MixMode, MixModeConfig> = {
  dj: {
    minFadeDuration: 5,
    maxFadeDuration: 10,
    baseFadeDuration: 6,
    fallbackPercent: 0.02,
    fallbackMaxSeconds: 3
  },
  normal: {
    minFadeDuration: 6,
    maxFadeDuration: 12,
    baseFadeDuration: 8,
    fallbackPercent: 0.01,
    fallbackMaxSeconds: 2
  }
};

// ============================================================================
// MARK: - TransitionType (DJMixingService.swift:206)
// ============================================================================

/**
 * Possible high-level shapes a transition can take. CrossfadeExecutor must
 * mirror this exactly — the string IS the wire format used to bridge them
 * and to send telemetry to the backend.
 */
export const TRANSITION_TYPES = [
  'CROSSFADE',
  'EQ_MIX',
  'CUT',
  'NATURAL_BLEND',
  'BEAT_MATCH_BLEND',
  'CUT_A_FADE_IN_B',
  'FADE_OUT_A_CUT_B',
  'STEM_MIX',
  'DROP_MIX',
  // Sequential handoff with tiny gap — A fades out (cos²), short respiro of
  // dead air, then B sin² ramps in. NO overlap. Used when the pairing is
  // fundamentally unmixable.
  'CLEAN_HANDOFF',
  // Vinyl-stop / spin-down. A's playback rate ramps 1.0→0 with exponential
  // curve, then a short pause before B enters in seco. Cooldown: max 1 every
  // 6 transitions.
  'VINYL_STOP',
  // Sequential handoff. A plays to natural endTime; B enters with 50ms cos²/sin²
  // overlap to dodge clicks. Honest fallback when a pairing isn't blendable —
  // listener hears the end of A and the start of B with inaudible seam.
  'SEQUENTIAL'
] as const;

export type TransitionType = (typeof TRANSITION_TYPES)[number];

// ============================================================================
// MARK: - Profile relationships (DJMixingService.swift:345-375)
// ============================================================================

/**
 * BPM relationship after harmonic normalization (half/double-time folded).
 *   - identical:    diff < 3
 *   - compatible:   diff 3-12 (stretchable within 8% rate change)
 *   - borderline:   diff 12-18 — gentle blend still works, no beat-match
 *   - incompatible: diff > 18 (truly unmixable, sequential-style only)
 */
export type BPMRelationship = 'identical' | 'compatible' | 'borderline' | 'incompatible';

/** Energy flow A→B (gap = energyB − energyA, ±0.15 threshold). */
export type EnergyFlow = 'energyUp' | 'energyDown' | 'steady';

/** Vocal overlap risk between A's outro and B's intro. */
export type VocalOverlapRisk = 'none' | 'aOnly' | 'bOnly' | 'both';

/** High-level character derived from the A↔B relationship. */
export type TransitionCharacter = 'punch' | 'smooth' | 'dramatic' | 'minimal';

// ============================================================================
// MARK: - Harmonic (DJMixingService.swift:4511)
// ============================================================================

export type HarmonicCompatibility = 'compatible' | 'acceptable' | 'tense' | 'clash';

export type HarmonicPenalty = {
  readonly distance: number;
  readonly compatibility: HarmonicCompatibility;
};

export function harmonicPenaltyIsClash(p: HarmonicPenalty): boolean {
  return p.compatibility === 'tense' || p.compatibility === 'clash';
}

// ============================================================================
// MARK: - Telemetry tags (DJMixingService.swift:57, :83, :111)
// ============================================================================

/** Path por el que el calculador de entryPoint decidió la posición de B. */
export type EntryPointSource =
  | 'smooth'
  | 'smoothChorusFallback'
  | 'smoothVocalAligned'
  | 'dramaticChorus'
  | 'dramaticVocal'
  | 'dramaticReference'
  | 'dramaticFallback'
  | 'punchVocalAvoidance'
  | 'punchChorusPromotion'
  | 'punchVocalTarget'
  | 'punchEntryReference'
  | 'punchChorusFallback'
  | 'punchBufferFallback'
  | 'punchEnergyBoost'
  | 'punchVocalCappedRollback'
  | 'minimal'
  | 'unknown';

/** Gate label cuando Tier 4 no dispara (undefined cuando dispara con éxito). */
export type Tier4FailedGate =
  | 'disabled'
  | 'typeIncompat'
  | 'fadeShort'
  | 'aMissing'
  | 'noVocalEndData'
  | 'outroVocal'
  | 'bMissing'
  | 'bpmUntrusted'
  | 'bpmToxic'
  | 'noDownbeats'
  | 'invalidBarDur'
  | 'perceptual'
  | 'vocalStart'
  | 'noIntroEnd'
  | 'introBarsShort'
  | 'noFirstEvent'
  | 'structureCollision'
  | 'clash'
  | 'rangeInvalid'
  | 'noCandidates'
  | 'notImproving';

export type Tier4Telemetry = {
  introSlopeB?: number;
  downbeatDensityB20s?: number;
  failedGate?: Tier4FailedGate;
};

// ============================================================================
// MARK: - SongAnalysis (DJMixingService.swift:256)
// ============================================================================

/**
 * Song analysis data from backend (`/api/analysis/song`) or local fallback.
 *
 * Optional semantics: `undefined` ≡ Swift `nil` (unknown / no detection).
 * Numeric fields without `?` default to 0 (Swift default initializers).
 * Code paths must fall back to heuristics when the optional is `undefined`;
 * NEVER collapse `undefined` to `0` — they're distinct semantics.
 */
export type SongAnalysis = {
  bpm: number;
  beatInterval: number;
  energy: number;
  danceability: number;
  key?: string;
  outroStartTime: number;
  introEndTime: number;
  /**
   * `undefined` → unknown / no detection. Fall back to introEndHeuristic /
   *               speechSegments / introEndTime.
   * `0`         → literal "vocal at t=0" (track opens singing).
   * `>0`        → real vocal onset timestamp.
   */
  vocalStartTime?: number;
  chorusStartTime: number;
  phraseBoundaries: readonly number[];
  /** Beats[] del backend (todos los beats detectados, no solo downbeats). */
  downbeatTimes: readonly number[];
  /**
   * v15.g — downbeats musicales del backend (primer beat de cada compás).
   * Diferente de `downbeatTimes` que recibe beats[] por compat. Usado por el
   * snap de rampStart en el bassKill. Vacío si el backend aún no lo expone.
   */
  realDownbeats: readonly number[];
  meter: number;
  speechSegments: readonly { readonly start: number; readonly end: number }[];
  hasError: boolean;
  hasOutroData: boolean;
  hasIntroData: boolean;
  cuePoint: number;
  hasCuePoint: boolean;
  energyIntro: number;
  energyMain: number;
  energyOutro: number;
  hasEnergyProfile: boolean;
  hasIntroVocals: boolean;
  hasOutroVocals: boolean;
  hasVocalData: boolean;
  backendFadeInDuration?: number;
  backendFadeOutDuration?: number;
  backendFadeOutLeadTime?: number;
  lastVocalTime: number;
  hasVocalEndData: boolean;
  // BPM confidence system (Essentia cross-validation)
  bpmConfidence: number;
  bpmEssentia?: number;
  hasBpmConfidence: boolean;
  // ML override tracking
  modelUsed: boolean;
  introEndTimeHeuristic?: number;
  outroStartTimeHeuristic?: number;
  // v13.G — perceptual decay data from backend
  outroSlope?: number;
  introSlope?: number;
  rmsTailCurve?: readonly number[];
  rmsCurve?: readonly number[];
  percussiveCurve?: readonly number[];
  genres: readonly string[];
  subBassIntroRms?: number;
  subBassOutroRms?: number;
};

/**
 * Default-initialized SongAnalysis (matches Swift's struct member-wise default
 * init). Use as a base when constructing test fixtures or when the backend
 * delivers a partial response; spread + override the fields you have.
 */
export const SONG_ANALYSIS_DEFAULT: SongAnalysis = {
  bpm: 120,
  beatInterval: 0,
  energy: 0.5,
  danceability: 0.5,
  outroStartTime: 0,
  introEndTime: 0,
  chorusStartTime: 0,
  phraseBoundaries: [],
  downbeatTimes: [],
  realDownbeats: [],
  meter: 4,
  speechSegments: [],
  hasError: false,
  hasOutroData: false,
  hasIntroData: false,
  cuePoint: 0,
  hasCuePoint: false,
  energyIntro: 0,
  energyMain: 0,
  energyOutro: 0,
  hasEnergyProfile: false,
  hasIntroVocals: false,
  hasOutroVocals: false,
  hasVocalData: false,
  lastVocalTime: 0,
  hasVocalEndData: false,
  bpmConfidence: 1.0,
  hasBpmConfidence: false,
  modelUsed: false,
  genres: []
};

// ============================================================================
// MARK: - TransitionProfile (DJMixingService.swift:378)
// ============================================================================

/**
 * Captures the full A↔B relationship. Computed ONCE upstream and drives ALL
 * downstream decisions (transition type, fade duration, filter usage,
 * anticipation, entry point).
 */
export type TransitionProfile = {
  // ── Energy relationship ──
  readonly energyA: number;
  readonly energyB: number;
  readonly energyGap: number;
  readonly energyFlow: EnergyFlow;

  // ── Rhythm relationship ──
  readonly bpmA: number;
  readonly bpmB: number;
  readonly bpmBNormalized: number;
  readonly bpmDiff: number;
  readonly bpmRelationship: BPMRelationship;
  readonly bpmTrusted: boolean;

  // ── Harmonic relationship ──
  readonly harmonic: HarmonicPenalty;

  // ── Vocal relationship ──
  readonly vocalOverlapRisk: VocalOverlapRisk;
  readonly aHasOutroVocals: boolean;
  readonly bHasIntroVocals: boolean;

  // ── Groove/style relationship ──
  readonly danceabilityA: number;
  readonly danceabilityB: number;
  readonly avgDanceability: number;
  readonly bassConflictRisk: boolean;

  // ── High-level character ──
  readonly character: TransitionCharacter;
  /** 0-1: stylistic similarity inferred from BPM/energy/danceability. */
  readonly styleAffinity: number;

  readonly mode: MixMode;
};

// ============================================================================
// MARK: - Result shapes (DJMixingService.swift:2571, :3514)
// ============================================================================

export type TransitionTypeResult = {
  readonly type: TransitionType;
  readonly reason: string;
  /**
   * v15.m telemetry: when the decisor escalated DROP_MIX/STEM_MIX to
   * SEQUENTIAL via the retirement guard, this tags which type was retired.
   * `undefined` when no retirement happened (organic SEQUENTIAL or any
   * other type).
   */
  readonly f5bRetiredFrom?: 'DROP_MIX' | 'STEM_MIX';
  /**
   * v15 telemetry: true when the defensive guard escalated CUT_A_FADE_IN_B
   * to SEQUENTIAL because energyB < 0.10. Always present (true/false) for
   * parity with iOS — distinguishes organic SEQUENTIAL from defensive.
   */
  readonly sequentialOverrideByVectorD: boolean;
};

export type FadeDurationResult = {
  readonly duration: number;
  readonly decision: string;
};

export type FilterDecisionResult = {
  readonly useFilters: boolean;
  readonly useAggressiveFilters: boolean;
  /** Absolute energyGap of the profile (snapshot, for telemetry). */
  readonly energyDiff: number;
  /** bpmDiff of the profile (snapshot, for telemetry). */
  readonly bpmDiff: number;
  readonly reason: string;
};

export type TimeStretchResult = {
  readonly useTimeStretch: boolean;
  /** Playback rate to apply to A. 1.0 = no stretch. */
  readonly rateA: number;
  /** Playback rate to apply to B. 1.0 = no stretch. */
  readonly rateB: number;
  readonly reason: string;
};

export type TriggerBiasResult = {
  /** Negative = earlier than default, positive = later, 0 = default
      ("as late as possible so fade fits before A ends"). */
  readonly bias: number;
  readonly reason: string;
};

export type DJFilterResult = {
  /** Cosine-bell mid-scoop active on band 2 of both A and B. Used to
      separate overlapping vocals frequency-wise during the fade. */
  readonly useMidScoop: boolean;
  /** High-shelf cut at ~7kHz to tame brittle hi-hat / cymbal layering.
      Disabled when either song's genre signature relies on the hi-hat
      as a groove element (Hip-Hop family, Trap, Drill, Reggaeton, etc). */
  readonly useHighShelfCut: boolean;
  readonly reason: string;
};

export type EntryPointResult = {
  /** Final entry point of B (seconds from B's t=0). */
  readonly entryPoint: number;
  /** Human-readable beat-sync info (downbeat alignment, grid snap, cross-phase). */
  readonly beatSyncInfo: string;
  /** True when next analysis is missing/errored and we fell back to defaults. */
  readonly usedFallback: boolean;
  readonly isBeatSynced: boolean;
  /** Path that picked this entry — used for diagnostics. */
  readonly entrySource: EntryPointSource;
  /** Chorus cap telemetry from `calculatePunchEntry`:
      - `undefined` → path didn't evaluate cap (vocal avoidance / vocalTarget / energyBoost overrode).
      - `false` → cap evaluated but NOT applied (chorus ≤ 50 or B drop-driven exempt).
      - `true` → cap applied (chorus capped at 50 in promotion non-drop or fallback). */
  readonly genreCapApplied?: boolean;
  /** Final defensive cap (POST snap + beat sync). `true` when entry > 50s
      and B not drop-driven percussive. `undefined` when entry ≤ 50 (cap
      never evaluated). */
  readonly entryFinalCapApplied?: boolean;
};

export type AnticipationResult = {
  readonly needsAnticipation: boolean;
  /** Seconds of tease/pre-fade before the main fade actually starts. */
  readonly anticipationTime: number;
  readonly reason: string;
  /** PRE_PUNCH: B has a long instrumental intro (≥6s) and the type is
      blendy. The caller forces `skipBFilters` when this is true so B
      plays clean during the tease. */
  readonly isPrePunch: boolean;
  /** Internal tag of which path triggered the anticipation extra
      ("outroSlopeSteep" / "filtersAggressive" / both / undefined). For
      diagnostics — not user-facing. */
  readonly anticipationReason?: string;
};

export type DJEffectsResult = {
  /** Instant low-frequency cut at bassSwapTime — removes "double-bombo"
      when both A and B carry kicking low end at the same time. */
  readonly useBassKill: boolean;
  /** Bell-shaped Q sweep on A's highpass — DJ filter-rise effect. */
  readonly useDynamicQ: boolean;
  /** Phaser-style narrow parametric notch on B's band 2. Pairs with
      dynamicQ for the "DJ knob ride" feel during the handoff. */
  readonly useNotchSweep: boolean;
  /** 1/8-note volume gate over A's last 2 beats before a CUT — DJ
      Premier mixtape chop. Requires beat grid for runtime alignment. */
  readonly useStutterCut: boolean;
  readonly reason: string;
};
