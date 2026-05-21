/**
 * EqualizerVisualizer — réplica del Now Playing Indicator de iOS 26 Apple
 * Music (Control Center / Lock Screen / Dynamic Island).
 *
 * Arquitectura:
 * 1. **FFT real per-band**: 1 AnalyserNode global, FFT por frame, cada
 *    barra recibe una banda logarítmica distinta (low → high). Cuando
 *    suena un kick drum la barra grave salta; cuando suena un hi-hat
 *    salta la aguda. Reactividad genuina al audio post-EQ + ReplayGain.
 *
 * 2. **Per-bar profile**: cada barra tiene una altura MÁXIMA característica
 *    distinta — es lo que da el look "no-uniforme" de Apple, donde nunca
 *    todas las barras llegan al techo a la vez. Es la diferencia clave
 *    entre "VU meter industrial" y "Apple Now Playing Indicator".
 *
 * 3. **Envelope follower Apple-style**: attack 60% del salto inmediato,
 *    release lento (8% por frame) → las barras suben rápido con cada beat
 *    y bajan suaves, sensación de respiración.
 *
 * 4. **Floor 0.2**: las barras nunca colapsan a 0 (paridad iOS — siempre
 *    hay "presencia mínima" mientras playing).
 *
 * 5. **Center alignment**: el caller (EqualizerIcon) usa transform-origin
 *    center; el scaleY que escribimos hace que las barras crezcan
 *    simétricamente desde el centro vertical, como en la imagen iOS 26.
 *
 * Performance: N componentes en pantalla = 1 FFT, 1 rAF, 1 cálculo. Cero
 * reactividad Svelte en el loop — escritura directa a `bar.style.transform`.
 */

import { audioEngine } from '$lib/audio/AudioEngine.svelte';

type Subscriber = {
  bars: HTMLElement[];
  numBands: number;
};

/** Altura máxima relativa por barra. Perfiles balanceados — mantienen la
    asimetría característica iOS (siempre hay una "líder") pero permiten
    que TODAS las barras alcancen alturas notables. Antes los multiplicadores
    bajos (0.5-0.55) cappeaban las "cortas" a ~50% del icono y se veían
    demasiado aplastadas. */
function getBarProfile(numBands: number): number[] {
  switch (numBands) {
    case 3: return [0.88, 1.0, 0.82];
    case 4: return [0.82, 1.0, 0.95, 0.78];
    case 5: return [0.78, 0.92, 1.0, 0.9, 0.75];
    default: return Array.from({ length: numBands }, () => 1.0);
  }
}

class EqualizerVisualizer {
  private subscribers = new Set<Subscriber>();
  private rafId: number | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  /** Levels smoothed compartidos por numBands. */
  private levelsByBandCount = new Map<number, Float32Array>();
  private bandRangesCache = new Map<number, Array<[number, number]>>();
  private profileCache = new Map<number, number[]>();
  /** Track si ya reconfiguramos el AnalyserNode con nuestros parámetros. */
  private analyserTuned = false;

  subscribe(bars: HTMLElement[], numBands: number): () => void {
    const sub: Subscriber = { bars, numBands };
    this.subscribers.add(sub);
    if (!this.levelsByBandCount.has(numBands)) {
      this.levelsByBandCount.set(numBands, new Float32Array(numBands));
      this.bandRangesCache.set(numBands, this.computeBandRanges(numBands));
      this.profileCache.set(numBands, getBarProfile(numBands));
    }
    this.kick();
    return () => {
      this.subscribers.delete(sub);
      for (const bar of bars) bar.style.transform = '';
    };
  }

  kick(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.rafId = null;
    if (this.subscribers.size === 0) return;

    // No playing → decay y dormir cuando todos los niveles llegan a 0.
    if (!audioEngine.isPlaying) {
      let allIdle = true;
      for (const levels of this.levelsByBandCount.values()) {
        for (let i = 0; i < levels.length; i++) {
          const v = levels[i]! * 0.88;
          levels[i] = v;
          if (v > 0.01) allIdle = false;
        }
      }
      this.applyToSubscribers();
      if (allIdle) {
        for (const levels of this.levelsByBandCount.values()) levels.fill(0);
        for (const sub of this.subscribers) {
          for (const bar of sub.bars) bar.style.transform = '';
        }
        return;
      }
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    const analyser = audioEngine.getAnalyser();
    if (!analyser) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    // Reconfiguramos el AnalyserNode una vez con parámetros optimizados
    // para visualización: menos smoothing interno (queremos reactividad
    // cruda y aplicar nuestro envelope follower nosotros), y rango de
    // dB enfocado en material musical (-85..-10 dB en vez del default
    // -100..-30 que recorta los picos típicos de música a -10 dB).
    if (!this.analyserTuned) {
      analyser.smoothingTimeConstant = 0.55;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -10;
      this.analyserTuned = true;
    }

    if (!this.freqData || this.freqData.length !== analyser.frequencyBinCount) {
      this.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }
    analyser.getByteFrequencyData(this.freqData);

    for (const [numBands, levels] of this.levelsByBandCount) {
      const ranges = this.bandRangesCache.get(numBands)!;
      for (let b = 0; b < numBands; b++) {
        const range = ranges[b]!;
        const b0 = range[0];
        const b1 = range[1];
        let sum = 0;
        for (let i = b0; i < b1; i++) sum += this.freqData[i]!;
        const avg = sum / (b1 - b0) / 255;
        // Enhance: pow(0.45) expande el rango dinámico — material a -20 dB
        // (avg≈0.4 después del rescaling del AnalyserNode) sube a ~0.65,
        // picos cerca del techo a ~0.95. Combinado con el rango -85..-10
        // dB del AnalyserNode, los beats son drásticamente visibles.
        const enhanced = Math.pow(avg, 0.45);
        const prev = levels[b]!;
        // Envelope follower MUY reactivo:
        // - Attack 95% — prácticamente instant, sin lag perceptible.
        // - Release 30% por frame — decay visible en ~3-4 frames (~60 ms),
        //   las barras BAJAN drásticamente entre beats.
        if (enhanced > prev) {
          levels[b] = prev * 0.05 + enhanced * 0.95;
        } else {
          levels[b] = prev * 0.7 + enhanced * 0.3;
        }
      }
    }

    this.applyToSubscribers();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private applyToSubscribers(): void {
    for (const sub of this.subscribers) {
      const levels = this.levelsByBandCount.get(sub.numBands);
      const profile = this.profileCache.get(sub.numBands);
      if (!levels || !profile) continue;
      const n = Math.min(sub.bars.length, sub.numBands);
      for (let i = 0; i < n; i++) {
        const v = levels[i] ?? 0;
        const maxAmp = profile[i] ?? 1.0;
        // Floor 0.1 — barra mínima muy discreta. Rango efectivo 0.1..1.0
        // (90% del icono, máxima dinámica visual).
        // El perfil multiplica la energía: las barras "líderes" (1.0)
        // llegan al techo con audio fuerte; las acompañantes (~0.8) se
        // quedan ~10% más bajas, dando la asimetría característica iOS
        // sin que las "cortas" queden aplastadas a media altura.
        const scale = 0.1 + Math.min(1, v * maxAmp) * 0.9;
        sub.bars[i]!.style.transform = `scaleY(${scale.toFixed(3)})`;
      }
    }
  }

  /** Bandas musicalmente útiles. Asume sampleRate ≈ 44.1-48 kHz con
      fftSize=256 → cada bin ≈ 172-187 Hz.
      Para 4 barras (caso canónico iOS):
        - Barra 0 — BASS+KICK: bins 1-3 (~188-560 Hz). El kick drum vive
          en 60-150 Hz y el bajo eléctrico en 80-250 Hz; ambos caen aquí.
        - Barra 1 — VOZ BAJA / BASS-MID: bins 3-9 (~560-1690 Hz). Voces
          fundamentales (200-1000 Hz armónicos), instrumentos cálidos.
        - Barra 2 — MIDS / VOZ ALTA / SNARE: bins 9-27 (~1690-5060 Hz).
          Snare, claridad de voces, brillantez de guitarras.
        - Barra 3 — HIGHS / CYMBALS / AIRE: bins 27-70 (~5060-13100 Hz).
          Hi-hats, cymbals, "air" y sibilancia.

      Si en el futuro corremos a otros sample rates los rangos en Hz se
      desplazan ligeramente pero siguen siendo perceptualmente sensatos.
      Fallback log-spaced para counts no canónicos. */
  private computeBandRanges(numBands: number): Array<[number, number]> {
    switch (numBands) {
      case 3: return [[1, 4], [4, 16], [16, 70]];
      case 4: return [[1, 3], [3, 9], [9, 27], [27, 70]];
      case 5: return [[1, 3], [3, 7], [7, 16], [16, 36], [36, 70]];
    }
    // Fallback log-spaced para counts no canónicos.
    const minBin = 1;
    const maxBin = 70;
    const logMin = Math.log(minBin);
    const logMax = Math.log(maxBin);
    const ranges: Array<[number, number]> = [];
    for (let i = 0; i < numBands; i++) {
      const t0 = i / numBands;
      const t1 = (i + 1) / numBands;
      const b0 = Math.max(minBin, Math.floor(Math.exp(logMin + (logMax - logMin) * t0)));
      const b1 = Math.max(b0 + 1, Math.floor(Math.exp(logMin + (logMax - logMin) * t1)));
      ranges.push([b0, b1]);
    }
    return ranges;
  }
}

export const equalizerVisualizer = new EqualizerVisualizer();
