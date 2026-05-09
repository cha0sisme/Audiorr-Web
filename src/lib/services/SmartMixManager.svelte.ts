/**
 * SmartMix v4.0 "Deep Flow" — port directo del Swift `SmartMixManager`.
 *
 * Reordena una playlist según calidad de transición usando análisis del
 * backend Audiorr (BPM, key Camelot, energy profile, vocal clash, structural
 * compatibility, BPM confidence, style affinity, energy + BPM arcs).
 *
 *   v1.0 — JS smartMixUtils.ts (basic Camelot + BPM sorting).
 *   v2.0 — Native Swift port (greedy + swap optimization).
 *   v3.0 — Harmonic Flow: harmonicBPM, energy boost, vocal scoring.
 *   v4.0 — Deep Flow: full backend analysis, structural compatibility,
 *          multi-layer vocal clash, BPM confidence, style affinity.
 *
 * Mirror EXACTO del Swift SmartMixManager.swift (754 LOC). Cualquier cambio
 * de pesos / umbrales / heurísticas debe sincronizarse con iOS para
 * mantener paridad de comportamiento.
 *
 * NOTA arquitectura: en iOS, el manager publica `status` via Combine y
 * llama a `PlayerService.shared.updateSmartMixStatus`. En web no existe
 * PlayerService — los componentes consumen directamente este store via
 * `$state` runes. Equivalente funcional, idiomático Svelte 5.
 */

import { md5 } from 'js-md5';
import { browser } from '$app/environment';
import type { NavidromeSong } from '$types/navidrome';
import type { AnalysisResult, EnergyProfile, StructureSegment } from '$types/analysis';
import { getBulkAnalysisStatus, analyzeSong } from './AnalysisService';
import { getStreamUrl } from './NavidromeService';
import {
  camelotKey,
  harmonicBPM,
  harmonicPenalty,
  HarmonicCompatibility
} from './dj-helpers';
import {
  energyProfile as fp_energyProfile,
  fadeInDuration as fp_fadeInDuration,
  fadeOutDuration as fp_fadeOutDuration,
  cuePoint as fp_cuePoint,
  lastVocalTime as fp_lastVocalTime,
  chorusStructure as fp_chorusStructure
} from './analysis-helpers';

// ============================================================================
// Public types
// ============================================================================

export type SmartMixStatus = 'idle' | 'analyzing' | 'ready' | 'error';

// ============================================================================
// AnalyzedSong — wrapper con propiedades pre-computadas (mirror Swift struct)
// ============================================================================

class AnalyzedSong {
  readonly song: NavidromeSong;
  readonly analysis: AnalysisResult | undefined;
  readonly cachedInstrumentalOutro: number;
  readonly cachedInstrumentalIntro: number;

  constructor(song: NavidromeSong, analysis: AnalysisResult | undefined) {
    this.song = song;
    this.analysis = analysis;

    const dur = song.duration ?? 240;

    // ── Instrumental outro length ────────────────────────────────────────
    const lvt = analysis ? fp_lastVocalTime(analysis) : undefined;
    const ep = analysis ? fp_energyProfile(analysis) : undefined;
    const outroStart = analysis?.outroStartTime ?? undefined;

    if (lvt !== undefined && lvt > 0) {
      this.cachedInstrumentalOutro = Math.max(0, dur - lvt);
    } else if (ep?.outroVocals === true) {
      this.cachedInstrumentalOutro = 0;
    } else if (outroStart !== undefined && outroStart > 0) {
      this.cachedInstrumentalOutro = dur - outroStart;
    } else {
      this.cachedInstrumentalOutro = 15; // unknown, assume moderate
    }

    // ── Instrumental intro length ────────────────────────────────────────
    const segs = analysis?.speechSegments ?? undefined;
    const vs = analysis?.vocalStartTime ?? undefined;
    const introEnd = analysis?.introEndTime ?? undefined;

    if (ep?.introVocals === true) {
      this.cachedInstrumentalIntro = 0;
    } else if (vs !== undefined && vs > 0) {
      this.cachedInstrumentalIntro = vs;
    } else if (segs && segs.length > 0 && segs[0]) {
      this.cachedInstrumentalIntro = segs[0].start;
    } else if (introEnd !== undefined && introEnd > 0) {
      this.cachedInstrumentalIntro = introEnd;
    } else {
      this.cachedInstrumentalIntro = 10; // unknown, assume moderate
    }
  }

  // ── Core (v3.0) ─────────────────────────────────────────────────────────
  get bpm(): number { return this.analysis?.bpm ?? 120; }
  get energy(): number { return this.analysis?.energy ?? 0.5; }
  get key(): string | undefined { return this.analysis?.key ?? undefined; }
  get danceability(): number { return this.analysis?.danceability ?? 0.5; }

  // ── Energy profile ──────────────────────────────────────────────────────
  get energyProfile(): EnergyProfile | undefined {
    return this.analysis ? fp_energyProfile(this.analysis) : undefined;
  }
  get energyIntro(): number { return this.energyProfile?.intro ?? this.energy; }
  get energyMain(): number { return this.energyProfile?.main ?? this.energy; }
  get energyOutro(): number { return this.energyProfile?.outro ?? this.energy; }
  get hasOutroVocals(): boolean { return this.energyProfile?.outroVocals ?? false; }
  get hasIntroVocals(): boolean { return this.energyProfile?.introVocals ?? false; }

  // ── Structural boundaries ───────────────────────────────────────────────
  get outroStartTime(): number | undefined { return this.analysis?.outroStartTime ?? undefined; }
  get introEndTime(): number | undefined { return this.analysis?.introEndTime ?? undefined; }
  get duration(): number { return this.song.duration ?? 240; }

  // ── Vocal timing ────────────────────────────────────────────────────────
  get vocalStartTime(): number | undefined {
    return this.analysis?.vocalStartTime ?? undefined;
  }
  get lastVocalTime(): number | undefined {
    return this.analysis ? fp_lastVocalTime(this.analysis) : undefined;
  }
  get speechSegments() {
    return this.analysis?.speechSegments ?? [];
  }

  // ── Transition quality ──────────────────────────────────────────────────
  get cuePoint(): number | undefined {
    return this.analysis ? fp_cuePoint(this.analysis) : undefined;
  }
  get fadeInDuration(): number | undefined {
    return this.analysis ? fp_fadeInDuration(this.analysis) : undefined;
  }
  get fadeOutDuration(): number | undefined {
    return this.analysis ? fp_fadeOutDuration(this.analysis) : undefined;
  }

  // ── BPM confidence ──────────────────────────────────────────────────────
  get bpmConfidence(): number { return this.analysis?.bpmConfidence ?? 1.0; }
  get bpmEssentia(): number | undefined { return this.analysis?.bpmEssentia ?? undefined; }

  /** BPM normalized to the DJ-standard 70-140 range. Half/double-time fold. */
  get perceivedBPM(): number {
    const b = this.bpm;
    if (b > 150) return b / 2.0;
    if (b < 70) return b * 2.0;
    return b;
  }

  // ── Structure ───────────────────────────────────────────────────────────
  get chorusStructure(): StructureSegment[] | undefined {
    return this.analysis ? fp_chorusStructure(this.analysis) : undefined;
  }
}

// ============================================================================
// SmartMixManager — singleton store (Svelte 5 runes)
// ============================================================================

class SmartMixManagerImpl {
  // ─── Reactive state (consumido por SmartMixButton + Detail views) ───────
  status: SmartMixStatus = $state('idle');
  playlistId: string | null = $state(null);
  generatedMix: NavidromeSong[] = $state([]);
  progress: { analyzed: number; total: number } = $state({ analyzed: 0, total: 0 });

  // ─── Internal ──────────────────────────────────────────────────────────
  private currentController: AbortController | null = null;
  /** Cache: `${playlistId}_v4_${md5(songIds)}` → sorted songs. */
  private cache = new Map<string, NavidromeSong[]>();

  // ──────────────────────────────────────────────────────────────────────
  // Generate
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Genera un SmartMix para la playlist + songs dadas. Cancela cualquier
   * generate() previo todavía en marcha. Idempotente vía cache (cualquier
   * cambio en la lista de songIds invalida el cache hit).
   */
  generate(playlistId: string, songs: NavidromeSong[]): void {
    this.cancelInflight();
    this.playlistId = playlistId;
    this.status = 'analyzing';
    this.generatedMix = [];
    this.progress = { analyzed: 0, total: songs.length };

    const signature = SmartMixManagerImpl.signature(songs);
    const cacheKey = `${playlistId}_v4_${signature}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.generatedMix = cached;
      this.status = 'ready';
      return;
    }

    if (!browser) return; // SSR-safe: no fetch en server.

    const controller = new AbortController();
    this.currentController = controller;

    void (async () => {
      try {
        const sorted = await this.analyzeAndSort(songs, controller.signal);
        if (controller.signal.aborted) return;
        this.generatedMix = sorted;
        this.status = 'ready';
        this.cache.set(cacheKey, sorted);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[SmartMixManager] Error:', err);
        this.status = 'error';
      }
    })();
  }

  /**
   * Limpia status y cancela in-flight. NO toca el cache (un re-`generate`
   * con la misma signature volverá a hit). Mirror del Swift `clear()`.
   */
  clear(): void {
    this.cancelInflight();
    this.status = 'idle';
    this.playlistId = null;
    this.generatedMix = [];
  }

  private cancelInflight(): void {
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Analysis pipeline
  // ──────────────────────────────────────────────────────────────────────

  private async analyzeAndSort(
    songs: NavidromeSong[],
    signal: AbortSignal
  ): Promise<NavidromeSong[]> {
    // 1. Bulk check del backend — qué songs ya tienen análisis cacheado.
    const songIds = songs.map((s) => s.id);
    let analysisMap: Record<string, AnalysisResult> = {};
    try {
      analysisMap = await getBulkAnalysisStatus(songIds);
    } catch (err) {
      console.warn('[SmartMixManager] Bulk status failed:', err);
    }

    // 2. Analizar las que falten (request individual al backend).
    const missing = songs.filter((s) => analysisMap[s.id] == null);
    let analyzed = Object.keys(analysisMap).length;
    this.progress = { analyzed, total: songs.length };

    for (const song of missing) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      const streamUrl = getStreamUrl(song.id);
      try {
        const payload: import('./AnalysisService').AnalysisPayload = {
          songId: song.id,
          streamUrl,
          timeoutMs: 90_000
        };
        if (song.duration !== undefined) payload.duration = song.duration;
        const result = await analyzeSong(payload);
        analysisMap[song.id] = result;
      } catch (err) {
        // Una song fallida no debe abortar todo el SmartMix — sigue con las
        // demás y la trataremos como `invalid` en sortSongs.
        console.warn(`[SmartMixManager] analyzeSong failed for ${song.id}:`, err);
      }
      analyzed += 1;
      this.progress = { analyzed, total: songs.length };
    }

    // 3. Ordenar con el algoritmo SmartMix v4.0.
    return SmartMixManagerImpl.sortSongs(songs, analysisMap);
  }

  // ──────────────────────────────────────────────────────────────────────
  // SmartMix Sorting Algorithm
  // ──────────────────────────────────────────────────────────────────────

  private static sortSongs(
    songs: NavidromeSong[],
    analysisMap: Record<string, AnalysisResult>
  ): NavidromeSong[] {
    if (songs.length < 2) return songs;

    const analyzed = songs.map((s) => new AnalyzedSong(s, analysisMap[s.id]));
    const valid = analyzed.filter((a) => a.analysis != null);
    const invalid = analyzed.filter((a) => a.analysis == null);

    if (valid.length < 2) {
      return [...valid, ...invalid].map((a) => a.song);
    }

    const unmixed = [...valid];
    const mixed: AnalyzedSong[] = [];

    // 1. Starting song: moderate energy, gentle intro, comfortable BPM.
    const startIdx = SmartMixManagerImpl.bestStartingIndex(unmixed);
    mixed.push(unmixed.splice(startIdx, 1)[0]!);

    // 2. Closing song: gentle energy, comfortable BPM, good outro.
    const closeIdx = SmartMixManagerImpl.bestClosingIndex(unmixed);
    const closingSong = unmixed.splice(closeIdx, 1)[0]!;

    // 3. Greedy phase con memoria.
    const total = valid.length;
    while (unmixed.length > 0) {
      let bestIdx = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      const forceDiversity = mixed.length > 0 && mixed.length % 5 === 0;

      const last = mixed[mixed.length - 1]!;
      for (let i = 0; i < unmixed.length; i++) {
        let score = SmartMixManagerImpl.compatibility(
          last,
          unmixed[i]!,
          mixed,
          mixed.length,
          total
        );
        if (forceDiversity && mixed.length >= 2) {
          const recentKeys = mixed
            .slice(-3)
            .map((m) => camelotKey(m.key))
            .filter((k): k is string => k !== undefined);
          const candidateKey = camelotKey(unmixed[i]!.key);
          if (candidateKey !== undefined && recentKeys.includes(candidateKey)) {
            score += 12;
          }
        }
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      mixed.push(unmixed.splice(bestIdx, 1)[0]!);
    }

    // 4. Append closing song.
    mixed.push(closingSong);

    // 5. Optimization pass (swap search) — solo para playlists medianas.
    const optimized =
      mixed.length > 4 && mixed.length < 500
        ? SmartMixManagerImpl.optimizeSequence(mixed)
        : mixed;

    return [...optimized, ...invalid].map((a) => a.song);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Starting / Closing Song Selection
  // ──────────────────────────────────────────────────────────────────────

  private static bestStartingIndex(songs: AnalyzedSong[]): number {
    let bestIdx = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < songs.length; i++) {
      const song = songs[i]!;
      if (song.analysis == null) continue;
      let score = 0;

      // Comfortable BPM
      const bpm = song.perceivedBPM;
      if (bpm >= 80 && bpm <= 120) score += 5;
      if (bpm >= 90 && bpm <= 110) score += 3;

      // Moderate energy
      if (song.energy < 0.45) score += 4;
      if (song.energy > 0.85) score -= 25;

      // Moderate danceability
      if (song.danceability >= 0.35 && song.danceability <= 0.7) score += 3;

      // Energy profile: gentle intro that builds.
      const profile = song.energyProfile;
      if (profile) {
        const intro = profile.intro ?? 0.5;
        const main = profile.main ?? 0.5;
        if (intro < 0.4) score += 5;
        if (intro < main) score += (main - intro) * 12;
        if (intro < 0.3 && main > 0.65) score += 20;
        const slope = profile.introSlope;
        if (slope != null && slope > 0.05) score += 4;
      }

      // v4.0: Instrumental intro — good opener has space to breathe.
      if (song.cachedInstrumentalIntro > 12) score += 6;
      else if (song.cachedInstrumentalIntro > 6) score += 3;

      // v4.0: BPM confidence.
      if (song.bpmConfidence >= 0.7) score += 3;

      // v4.0: Structural intro section.
      const structure = song.chorusStructure;
      if (structure) {
        const introSeg = structure.find((s) => s.label.toLowerCase().includes('intro'));
        if (introSeg) {
          const introLength = introSeg.endTime - introSeg.startTime;
          if (introLength > 10) score += 5;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  private static bestClosingIndex(songs: AnalyzedSong[]): number {
    let bestIdx = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < songs.length; i++) {
      const song = songs[i]!;
      if (song.analysis == null) continue;
      let score = 0;

      // Prefer low energy.
      if (song.energy < 0.4) score += 8;
      if (song.energy < 0.55) score += 4;
      if (song.energy > 0.8) score -= 20;

      // Comfortable / slow BPM.
      const bpm = song.perceivedBPM;
      if (bpm >= 70 && bpm <= 110) score += 5;
      if (bpm < 90) score += 3;

      // Low danceability is fine for closing.
      if (song.danceability < 0.5) score += 3;

      // Good outro (energy fades out).
      const profile = song.energyProfile;
      if (profile) {
        const outro = profile.outro ?? 0.5;
        if (outro < 0.4) score += 6;
        const slope = profile.outroSlope;
        if (slope != null && slope < -0.03) score += 5;
      }

      // v4.0: Instrumental outro detection.
      const outroLen = song.cachedInstrumentalOutro;
      if (outroLen > 20) score += 8;
      else if (outroLen > 10) score += 5;
      else if (outroLen < 3) score -= 6;

      // v4.0: Natural fade-out.
      const fadeOut = song.fadeOutDuration;
      if (fadeOut != null && fadeOut > 5) score += 4;

      // v4.0: Precise vocal end vs coarse boolean.
      const lvt = song.lastVocalTime;
      if (lvt != null) {
        if (lvt < song.duration - 20) score += 6;
      } else if (song.hasOutroVocals) {
        score -= 4;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Compatibility Score (v4.0 — 9 dimensions)
  // ──────────────────────────────────────────────────────────────────────

  private static compatibility(
    a: AnalyzedSong,
    b: AnalyzedSong,
    history: AnalyzedSong[],
    position = 0,
    total = 0
  ): number {
    if (a.analysis == null || b.analysis == null) return Number.POSITIVE_INFINITY;

    const bpmA = a.bpm;
    const bpmB = b.bpm;
    const energyA = a.energy;
    const energyB = b.energy;

    // ── 1. Key penalty — delegates to dj-helpers ─────────────────────────
    const camA = camelotKey(a.key);
    const camB = camelotKey(b.key);
    const harmonic = harmonicPenalty(camA, camB);
    let keyPenalty: number;
    switch (harmonic.compatibility) {
      case HarmonicCompatibility.Compatible: keyPenalty = 0;  break;
      case HarmonicCompatibility.Acceptable: keyPenalty = 5;  break;
      case HarmonicCompatibility.Tense:      keyPenalty = 12; break;
      case HarmonicCompatibility.Clash:      keyPenalty = 20; break;
    }
    // Energy boost discount: rising energy + large key jump = valid DJ boost.
    if (energyB > energyA + 0.1 && harmonic.distance >= 5) {
      keyPenalty *= 0.6;
    }

    // Key fatigue — penalize repeating same key 3+ times in recent history.
    let keyFatiguePenalty = 0;
    if (history.length >= 3 && camB) {
      const recentKeys = history
        .slice(-3)
        .map((h) => camelotKey(h.key))
        .filter((k): k is string => k !== undefined);
      if (recentKeys.filter((k) => k === camB).length >= 2) keyFatiguePenalty = 8;
    }

    // ── 2. BPM penalty — confidence-gated, Essentia cross-validated ──────
    const harmonicB = harmonicBPM(bpmA, bpmB);
    const bpmDiff = Math.abs(bpmA - harmonicB);
    let bpmPenalty = Math.pow(bpmDiff, 1.4) / 8;

    const minConf = Math.min(a.bpmConfidence, b.bpmConfidence);
    if (minConf < 0.5) bpmPenalty *= minConf / 0.5;
    if (a.bpmEssentia != null && Math.abs(a.bpmEssentia - bpmA) / bpmA > 0.1) bpmPenalty *= 0.7;
    if (b.bpmEssentia != null && Math.abs(b.bpmEssentia - bpmB) / bpmB > 0.1) bpmPenalty *= 0.7;

    // ── 3. Energy penalty (low-energy floor recalibrado 2026-05-09) ──────
    const energyDiff = Math.abs(energyA - energyB);
    let energyPenalty = Math.pow(energyDiff, 2) * 15;
    const minEnergy = Math.min(energyA, energyB);
    if (minEnergy < 0.4) {
      energyPenalty += Math.pow(0.4 - minEnergy, 1.5) * 35;
    }

    // ── 4. Transition quality penalty (multi-layer) ──────────────────────
    let transitionPenalty = 12;
    const profA = a.energyProfile;
    const profB = b.energyProfile;
    if (profA && profB) {
      const outroA = profA.outro ?? 0.5;
      const introB = profB.intro ?? 0.5;
      transitionPenalty = Math.pow(Math.abs(outroA - introB), 2) * 40;

      // Layer 1: Energy slope continuity.
      const slopeA = profA.outroSlope;
      const slopeB = profB.introSlope;
      if (slopeA != null && slopeB != null) {
        if (slopeA < -0.05 && slopeB > 0.05) transitionPenalty -= 8;
        if (slopeA > 0.05 && slopeB > 0.05) transitionPenalty += 5;
      }

      // Layer 2: Vocal clash (multi-level fallback).
      transitionPenalty += SmartMixManagerImpl.vocalClashPenalty(a, b);

      // Layer 3: Structural compatibility (instrumental outro↔intro pairing).
      const overlapRoom = Math.min(a.cachedInstrumentalOutro, b.cachedInstrumentalIntro);
      if (overlapRoom > 15) transitionPenalty -= 10;
      else if (overlapRoom > 8) transitionPenalty -= 5;
      else if (overlapRoom < 3) transitionPenalty += 8;

      // Layer 4: CuePoint alignment.
      if (b.cuePoint != null && b.introEndTime != null) {
        if (Math.abs(b.cuePoint - b.introEndTime) < 3) transitionPenalty -= 3;
      }

      // Layer 5: Fade duration compatibility.
      if (a.fadeOutDuration != null && b.fadeInDuration != null) {
        if (a.fadeOutDuration > 3 && b.fadeInDuration > 3) transitionPenalty -= 4;
      }
    }

    // ── 5. Artist penalty ────────────────────────────────────────────────
    let artistPenalty = 0;
    if (a.song.artist === b.song.artist) {
      artistPenalty = 10;
    } else {
      const recent = history.slice(-4).reverse();
      const idx = recent.findIndex((h) => h.song.artist === b.song.artist);
      if (idx !== -1) artistPenalty = Math.max(0, 6 - idx * 2);
    }

    // ── 6. Danceability penalty ──────────────────────────────────────────
    const dancePenalty = Math.pow(Math.abs(a.danceability - b.danceability), 2) * 15;

    // ── 7. BPM arc penalty ───────────────────────────────────────────────
    let bpmArcPenalty = 0;
    if (total > 4 && position > 0) {
      const progress = position / total;
      let idealBpmFactor: number;
      if (progress < 0.15) idealBpmFactor = 0.4;
      else if (progress < 0.65) idealBpmFactor = 0.3 + progress;
      else idealBpmFactor = Math.max(0.3, 1.0 - (progress - 0.65) * 1.5);

      if (history.length >= 2) {
        const prevBpm = history[history.length - 1]!.bpm;
        const bpmDirection = harmonicB - prevBpm;
        if (progress < 0.6 && bpmDirection < -8) {
          bpmArcPenalty = Math.abs(bpmDirection) * 0.3 * idealBpmFactor;
        }
        if (progress > 0.75 && bpmDirection > 10) {
          bpmArcPenalty = bpmDirection * 0.4 * (1.0 - idealBpmFactor);
        }
      }
    }

    // ── 8. Style affinity bonus (recalibrado 2026-05-09) ─────────────────
    const bpmAffinity = Math.max(0, 1.0 - Math.abs(bpmA - harmonicB) / 30.0);
    const energyAffinity = Math.max(0, 1.0 - Math.abs(energyA - energyB) / 0.6);
    const danceAffinity = Math.max(0, 1.0 - Math.abs(a.danceability - b.danceability) / 0.5);
    let harmonicAffinity: number;
    switch (harmonic.compatibility) {
      case HarmonicCompatibility.Compatible: harmonicAffinity = 0.6; break;
      case HarmonicCompatibility.Acceptable: harmonicAffinity = 0.7; break;
      case HarmonicCompatibility.Tense:      harmonicAffinity = 0.4; break;
      case HarmonicCompatibility.Clash:      harmonicAffinity = 0.1; break;
    }
    const styleAffinity =
      bpmAffinity * 0.35 + energyAffinity * 0.25 + harmonicAffinity * 0.25 + danceAffinity * 0.15;
    const affinityBonus = -styleAffinity * 7;

    // ── Weighted sum ─────────────────────────────────────────────────────
    return (
      keyPenalty * 3.5 +
      bpmPenalty * 2.0 +
      energyPenalty * 1.2 +
      transitionPenalty * 2.0 +
      artistPenalty * 1.5 +
      keyFatiguePenalty +
      dancePenalty * 0.8 +
      bpmArcPenalty +
      affinityBonus
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // Vocal Clash Detection (multi-layer fallback)
  // ──────────────────────────────────────────────────────────────────────

  private static vocalClashPenalty(a: AnalyzedSong, b: AnalyzedSong): number {
    // Detect A outro vocals — speechSegments > lastVocalTime > outroVocals.
    let aOutroVocal: boolean;
    let aConfidence: number;
    if (a.speechSegments.length > 0) {
      const outroZone = a.duration - 20;
      aOutroVocal = a.speechSegments.some((s) => s.end > outroZone);
      aConfidence = 0.9;
    } else if (a.lastVocalTime != null) {
      aOutroVocal = a.lastVocalTime > a.duration - 20;
      aConfidence = 0.8;
    } else if (a.hasOutroVocals) {
      aOutroVocal = true;
      aConfidence = 0.6;
    } else {
      aOutroVocal = false;
      aConfidence = 0.4;
    }

    // Detect B intro vocals — speechSegments > vocalStartTime > introVocals.
    let bIntroVocal: boolean;
    let bConfidence: number;
    if (b.speechSegments.length > 0) {
      bIntroVocal = b.speechSegments.some((s) => s.start < 20);
      bConfidence = 0.9;
    } else if (b.vocalStartTime != null && b.vocalStartTime > 0) {
      bIntroVocal = b.vocalStartTime < 20;
      bConfidence = 0.8;
    } else if (b.hasIntroVocals) {
      bIntroVocal = true;
      bConfidence = 0.6;
    } else {
      bIntroVocal = false;
      bConfidence = 0.4;
    }

    const avgConfidence = (aConfidence + bConfidence) / 2;
    if (aOutroVocal && bIntroVocal) {
      return 18 * avgConfidence;
    }
    if (aOutroVocal || bIntroVocal) {
      return 5 * (aOutroVocal ? aConfidence : bConfidence);
    }
    return 0;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Swap Optimization (limited 2-opt — same window as iOS)
  // ──────────────────────────────────────────────────────────────────────

  private static optimizeSequence(songs: AnalyzedSong[]): AnalyzedSong[] {
    const result = [...songs];
    const n = result.length;
    let improved = true;
    let passes = 0;

    // Pinned: index 0 (starting song) y n-1 (closing song) no se mueven.
    const lo = 1;
    const hi = n - 2;

    while (improved && passes < 3) {
      improved = false;
      for (let i = lo; i <= hi; i++) {
        const jStart = i + 1;
        const jEnd = Math.min(hi, i + 20);
        if (jStart > jEnd) continue;

        for (let j = jStart; j <= jEnd; j++) {
          const a = result[i]!;
          const c = result[j]!;
          let currentCost: number;
          let newCost: number;

          if (j === i + 1) {
            currentCost =
              SmartMixManagerImpl.pairCost(result[i - 1]!, a) +
              SmartMixManagerImpl.pairCost(a, c) +
              SmartMixManagerImpl.pairCost(c, result[j + 1]!);
            newCost =
              SmartMixManagerImpl.pairCost(result[i - 1]!, c) +
              SmartMixManagerImpl.pairCost(c, a) +
              SmartMixManagerImpl.pairCost(a, result[j + 1]!);
          } else {
            currentCost =
              SmartMixManagerImpl.pairCost(result[i - 1]!, a) +
              SmartMixManagerImpl.pairCost(a, result[i + 1]!) +
              SmartMixManagerImpl.pairCost(result[j - 1]!, c) +
              SmartMixManagerImpl.pairCost(c, result[j + 1]!);
            newCost =
              SmartMixManagerImpl.pairCost(result[i - 1]!, c) +
              SmartMixManagerImpl.pairCost(c, result[i + 1]!) +
              SmartMixManagerImpl.pairCost(result[j - 1]!, a) +
              SmartMixManagerImpl.pairCost(a, result[j + 1]!);
          }

          // Energy + BPM arc influence (deltas se cancelan, mirror exacto Swift).
          const arcDelta =
            SmartMixManagerImpl.arcPenalty(c, j, n) +
            SmartMixManagerImpl.arcPenalty(a, i, n) -
            (SmartMixManagerImpl.arcPenalty(a, i, n) + SmartMixManagerImpl.arcPenalty(c, j, n));
          const bpmArcDelta =
            SmartMixManagerImpl.bpmArcPenaltyStatic(c, j, n) +
            SmartMixManagerImpl.bpmArcPenaltyStatic(a, i, n) -
            (SmartMixManagerImpl.bpmArcPenaltyStatic(a, i, n) +
              SmartMixManagerImpl.bpmArcPenaltyStatic(c, j, n));

          if (newCost + (arcDelta + bpmArcDelta) * 1.5 < currentCost) {
            result[i] = c;
            result[j] = a;
            improved = true;
          }
        }
      }
      passes += 1;
    }
    return result;
  }

  /** Pair cost simplificado para optimization pass (sin history context). */
  private static pairCost(a: AnalyzedSong, b: AnalyzedSong): number {
    return SmartMixManagerImpl.compatibility(a, b, []);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Energy + BPM Arc penalties
  // ──────────────────────────────────────────────────────────────────────

  private static arcPenalty(song: AnalyzedSong, index: number, total: number): number {
    const energy = song.energy;
    const progress = index / total;
    let penalty = 0;
    if (progress < 0.15) {
      if (energy > 0.75) penalty += 15;
    } else if (progress < 0.7) {
      if (energy < 0.3) penalty += 12;
    } else {
      if (energy > 0.8) penalty += 15;
      if (energy < 0.45) penalty -= 3;
    }
    return penalty;
  }

  private static bpmArcPenaltyStatic(song: AnalyzedSong, index: number, total: number): number {
    const bpm = song.perceivedBPM;
    const progress = index / total;
    let penalty = 0;
    if (progress < 0.15) {
      if (bpm > 140) penalty += 8;
    } else if (progress > 0.8) {
      if (bpm > 135) penalty += 10;
    }
    return penalty;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cache Signature (hash of all song IDs)
  // ──────────────────────────────────────────────────────────────────────

  private static signature(songs: NavidromeSong[]): string {
    if (songs.length === 0) return 'empty';
    const combined = songs.map((s) => s.id).join(',');
    return md5(combined);
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const smartMixManager = new SmartMixManagerImpl();
