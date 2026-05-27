/**
 * AudioEngine — Mirrors AudioEngineManager.swift.
 *
 * Phase 1 scope: dual-chain A/B graph, lazy AudioContext init (waits for
 * user gesture — first play() call), basic equal-power crossfade. Per-stage
 * biquad coefficient updates are exposed (setBiquadCoeffs) but not driven
 * yet — Phase 2 will wire CrossfadeExecutor → DJMixingService into them.
 *
 * Audio graph per chain:
 *   <audio> → MediaElementAudioSourceNode → AudioWorkletNode(4 biquads)
 *           → GainNode (replayGain + crossfade fader) → masterMixer
 *
 *   masterMixer → DynamicsCompressorNode (limiter) → destination
 *
 * Chain "A" is the playing one; chain "B" is the next one queued for
 * crossfade. After a crossfade completes we swap labels (A ↔ B).
 *
 * IMPORTANT — CORS: para que MediaElementAudioSourceNode entregue PCM (en
 * vez de silencio), el server DEBE responder con `Access-Control-Allow-
 * Origin` adecuado. Si el navidrome está en otro origin y no tiene CORS,
 * el `<audio>` tag suena pero el grafo Web Audio ve silencio. Workaround
 * server-side (no client-side).
 */

import {
  PASSTHROUGH,
  type BiquadCoefficients
} from '$lib/audio/BiquadCoefficients';
import type { CrossfadeResult } from '$lib/audio/dj-types';

// Vite resuelve esta URL al asset publicado del worklet — funciona en dev y build.
import workletUrl from '$lib/audio/worklets/biquad-processor.js?url';

// ============================================================================
// Types
// ============================================================================

// `| undefined` explícito porque el proyecto usa exactOptionalPropertyTypes:true
// — sin esto, pasar `{ duration: maybeNumber }` falla typecheck.
export type LoadOptions = {
  startAt?: number | undefined;
  /** ReplayGain track gain en dB. Si undefined, default -8 dB (matches iOS). */
  replayGainDb?: number | undefined;
  /** ReplayGain multiplier ya computado (incluido cap por peak). Tiene
      prioridad sobre `replayGainDb` — esta es la vía preferida cuando el
      caller (player/QueueManager) ya pasó por `computeReplayGainMultiplier`,
      porque el cap por peak no se puede reconstruir desde solo dB. */
  replayGainLinear?: number | undefined;
  /** Override de duración (sec). Si undefined, se lee del media element. */
  duration?: number | undefined;
};

export type PrepareNextOptions = {
  replayGainDb?: number | undefined;
  /** Mismo significado que en LoadOptions — prioridad sobre `replayGainDb`. */
  replayGainLinear?: number | undefined;
};

/** Resuelve el multiplier final a aplicar al chain.gain, dado un par
    (replayGainLinear, replayGainDb). Linear gana; dB es fallback; si no hay
    nada, default -8 dB (paridad iOS). Centralizado aquí para que `load` y
    `prepareNext` no dupliquen la lógica. */
function resolveRGLinear(opts: {
  replayGainLinear?: number | undefined;
  replayGainDb?: number | undefined;
}): number {
  if (opts.replayGainLinear !== undefined && Number.isFinite(opts.replayGainLinear)) {
    // Clamp a no-negativos: un multiplier <0 invertiría la fase y produciría
    // un GainNode inválido. Nunca debería ocurrir (computeReplayGainMultiplier
    // siempre devuelve ≥0), defensa contra valores corruptos en restore.
    return Math.max(0, opts.replayGainLinear);
  }
  const db = opts.replayGainDb ?? DEFAULT_REPLAY_GAIN_DB;
  return dbToLinear(db);
}

export type AudioEngineEventType =
  | 'ended'
  | 'progress'
  | 'playstate'
  | 'crossfadestart'
  | 'crossfadeend'
  | 'seek'
  | 'error';

export type AudioEngineEvent =
  | { type: 'ended' }
  | { type: 'progress'; currentTime: number; duration: number }
  | { type: 'playstate'; isPlaying: boolean; currentTime: number }
  | { type: 'crossfadestart' }
  | { type: 'crossfadeend'; startOffset: number }
  | { type: 'seek'; to: number }
  | { type: 'error'; message: string; code?: string };

type Listener = (e: AudioEngineEvent) => void;

// ============================================================================
// Internals
// ============================================================================

const DEFAULT_REPLAY_GAIN_DB = -8;
const DEFAULT_VOLUME = 0.75;
const PROGRESS_TICK_MS = 250;
const END_DETECT_THRESHOLD = 0.1; // sec
const NUM_STAGES = 4;

type Chain = {
  label: 'A' | 'B';
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  gain: GainNode;
  /** Replay gain factor aplicado además del fader de crossfade. */
  replayGainLinear: number;
  /** True cuando el chain tiene una src cargada y lista (no necesariamente
      sonando). prepareNext() lo deja en true sin reproducir. */
  hasMedia: boolean;
  /** Estado actual de los 4 stages — necesario para que setBiquadCoeffs(stage)
      no pise los demás stages al postMessage al worklet (que reemplaza set entero). */
  currentCoeffs: BiquadCoefficients[];
  /** URL cargada — usado para fallback cuando format=raw no decodifica. */
  lastSrc: string | null;
  /** True si ya intentamos fallback (sin format=raw) para esta src. */
  triedRawFallback: boolean;
};

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

// ============================================================================
// AudioEngine
// ============================================================================

class AudioEngine {
  // Reactive state — los componentes leen estos directamente.
  isPlaying = $state(false);
  currentTime = $state(0);
  duration = $state(0);
  isCrossfading = $state(false);

  private ctx: AudioContext | null = null;
  /** Trackeamos el ctx específico que registró el worklet — si dispose() crea
      un ctx nuevo, addModule() debe correr de nuevo. */
  private workletReadyForCtx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  /** AnalyserNode lazy — creado por `getAnalyser()` la primera vez que un
      consumidor (visualizer) lo pide. Conectado en paralelo a masterGain:
      ve el audio post-EQ post-volumen pre-limiter (≈ lo que el usuario oye)
      sin propagar a destination (es un sink). */
  private analyser: AnalyserNode | null = null;

  private chainA: Chain | null = null;
  private chainB: Chain | null = null;

  private masterVolume = DEFAULT_VOLUME;
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  private endedHandled = false;
  private listeners = new Map<AudioEngineEventType, Set<Listener>>();
  // Race guards — load()/prepareNext() concurrentes pisan estado y producen
  // listeners huérfanos. Cada llamada incrementa el token; los awaits chequean
  // el token y abortan silenciosamente si ya hay otra llamada más nueva.
  private loadTokenA = 0;
  private loadTokenB = 0;

  // ----------------------------------------------------------------------
  // Event API
  // ----------------------------------------------------------------------

  on(type: AudioEngineEventType, fn: Listener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit(event: AudioEngineEvent) {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(event);
      } catch (err) {
        console.error('[AudioEngine] listener threw', err);
      }
    }
  }

  // ----------------------------------------------------------------------
  // Lazy init — ctor barato, real init en primer play() (necesita gesto)
  // ----------------------------------------------------------------------

  private async ensureInit(): Promise<void> {
    if (this.ctx && this.workletReadyForCtx === this.ctx && this.chainA && this.chainB) return;

    if (!this.ctx) {
      const Ctx = window.AudioContext;
      if (!Ctx) throw new Error('Web Audio API not supported');
      this.ctx = new Ctx();
    }

    if (this.workletReadyForCtx !== this.ctx) {
      await this.ctx.audioWorklet.addModule(workletUrl);
      this.workletReadyForCtx = this.ctx;
    }

    if (!this.limiter) {
      this.limiter = this.ctx.createDynamicsCompressor();
      // Mirrors AudioEngineManager.swift master limiter — attack 3ms, release 60ms.
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.06;
      this.limiter.connect(this.ctx.destination);
    }

    if (!this.masterGain) {
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.limiter);
    }

    if (!this.chainA) this.chainA = this.createChain('A');
    if (!this.chainB) this.chainB = this.createChain('B');
  }

  private createChain(label: 'A' | 'B'): Chain {
    if (!this.ctx || !this.masterGain) {
      throw new Error('AudioEngine not initialized');
    }
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous'; // requerido para MediaElementAudioSourceNode
    audio.preservesPitch = true;

    const gain = this.ctx.createGain();
    gain.gain.value = label === 'A' ? 1 : 0; // B silencioso hasta crossfade
    gain.connect(this.masterGain);

    return {
      label,
      audio,
      source: null,
      worklet: null,
      gain,
      replayGainLinear: dbToLinear(DEFAULT_REPLAY_GAIN_DB),
      hasMedia: false,
      currentCoeffs: [{ ...PASSTHROUGH }, { ...PASSTHROUGH }, { ...PASSTHROUGH }, { ...PASSTHROUGH }],
      lastSrc: null,
      triedRawFallback: false
    };
  }

  /** Lazy: el MediaElementSourceNode solo puede crearse una vez por <audio>.
      Si el chain ya tiene source, se reusa. */
  private wireChainNodes(chain: Chain): void {
    if (!this.ctx || chain.source) return;

    chain.source = this.ctx.createMediaElementSource(chain.audio);
    chain.worklet = new AudioWorkletNode(this.ctx, 'biquad-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    chain.source.connect(chain.worklet);
    chain.worklet.connect(chain.gain);
  }

  // ----------------------------------------------------------------------
  // Public API — mirrors AudioEngineManager.swift subset
  // ----------------------------------------------------------------------

  async load(songUrl: string, options: LoadOptions = {}): Promise<void> {
    const myToken = ++this.loadTokenA;
    await this.ensureInit();
    if (this.loadTokenA !== myToken) return;
    const chain = this.chainA;
    if (!chain) throw new Error('chainA missing');

    this.endedHandled = false;
    this.isCrossfading = false;

    // Reset replay gain. Acepta linear (con cap por peak ya aplicado por el
    // caller) o dB; si no viene nada, default -8 dB paridad iOS.
    chain.replayGainLinear = resolveRGLinear(options);
    chain.gain.gain.value = chain.replayGainLinear;

    // Worklet/source se conectan la primera vez que se carga este chain.
    this.wireChainNodes(chain);
    this.attachAudioElementListeners(chain);

    // ── Clean-state guard: cada load() empieza con worklet en passthrough
    //    y playbackRate=1.0. Sin esto, un chain contaminado de un
    //    crossfade DJ previo (biquads en estado intermedio, playbackRate
    //    time-stretched) seguiría aplicando esos efectos a la nueva
    //    pista — el "AutoMix" se notaría desde el primer play. Mirror
    //    iOS setupInitialEQ implícito al cargar.
    chain.audio.playbackRate = 1.0;
    chain.audio.preservesPitch = true;
    if (chain.worklet) this.resetWorkletState(chain);

    chain.audio.src = songUrl;
    chain.lastSrc = songUrl;
    chain.triedRawFallback = false;
    chain.audio.currentTime = options.startAt ?? 0;
    chain.hasMedia = true;

    // Espera a metadata para tener duración; tolerante a fallos.
    await this.waitForMetadata(chain.audio).catch(() => undefined);
    if (this.loadTokenA !== myToken) return;

    this.duration = options.duration ?? chain.audio.duration ?? 0;
    this.currentTime = chain.audio.currentTime;
  }

  async play(): Promise<void> {
    await this.ensureInit();
    if (!this.ctx || !this.chainA) return;

    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.chainA.hasMedia) return;

    try {
      await this.chainA.audio.play();
      this.isPlaying = true;
      this.startProgressTimer();
      this.emit({ type: 'playstate', isPlaying: true, currentTime: this.currentTime });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: msg, code: 'play_failed' });
      throw err;
    }
  }

  pause(): void {
    if (!this.chainA) return;
    this.chainA.audio.pause();
    this.isPlaying = false;
    this.stopProgressTimer();
    this.emit({ type: 'playstate', isPlaying: false, currentTime: this.currentTime });
  }

  seek(timeSec: number): void {
    if (!this.chainA) return;
    const clamped = Math.max(0, Math.min(timeSec, this.duration || timeSec));
    this.chainA.audio.currentTime = clamped;
    this.currentTime = clamped;
    this.endedHandled = false;
    this.emit({ type: 'seek', to: clamped });
  }

  stop(): void {
    if (this.chainA) {
      this.chainA.audio.pause();
      this.chainA.audio.removeAttribute('src');
      this.chainA.audio.load();
      this.chainA.hasMedia = false;
      this.chainA.lastSrc = null;
      this.chainA.triedRawFallback = false;
    }
    if (this.chainB) {
      this.chainB.audio.pause();
      this.chainB.audio.removeAttribute('src');
      this.chainB.audio.load();
      this.chainB.hasMedia = false;
      this.chainB.lastSrc = null;
      this.chainB.triedRawFallback = false;
    }
    this.isPlaying = false;
    this.isCrossfading = false;
    this.currentTime = 0;
    this.duration = 0;
    this.stopProgressTimer();
    this.emit({ type: 'playstate', isPlaying: false, currentTime: 0 });
  }

  /** Devuelve un AnalyserNode conectado al masterGain. Lazy: se crea en la
      primera llamada (cuando el visualizer se suscribe la primera vez).
      Retorna null si el AudioContext aún no se inicializó — el visualizer
      en ese caso queda en su animación CSS idle hasta que arranque el
      playback. `fftSize=256` da 128 bins (~187 Hz/bin a 48 kHz), suficiente
      para 3-5 bandas perceptuales. `smoothingTimeConstant=0.8` aplica un
      EMA en el propio AnalyserNode (ahorra trabajo JS). */
  getAnalyser(): AnalyserNode | null {
    if (!this.ctx || !this.masterGain) return null;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.masterGain.connect(this.analyser);
    }
    return this.analyser;
  }

  setVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.01);
    }
  }

  prepareNext(songUrl: string, options: PrepareNextOptions = {}): void {
    const myToken = ++this.loadTokenB;
    if (!this.ctx) {
      // Sin init aún — hacemos init asincrónico, pero nadie lo espera.
      void this.ensureInit().then(() => {
        if (this.loadTokenB !== myToken) return;
        this.prepareNext(songUrl, options);
      });
      return;
    }
    const chain = this.chainB;
    if (!chain) return;

    chain.replayGainLinear = resolveRGLinear(options);
    chain.gain.gain.value = 0; // entra en silencio, lo sube el crossfade

    this.wireChainNodes(chain);
    this.attachAudioElementListeners(chain);

    // Clean-state guard (idéntico a load() para chainA): biquads en
    // passthrough + playbackRate=1.0. Garantiza que B arranca sin
    // residuos del crossfade anterior.
    chain.audio.playbackRate = 1.0;
    chain.audio.preservesPitch = true;
    if (chain.worklet) this.resetWorkletState(chain);

    chain.audio.src = songUrl;
    chain.lastSrc = songUrl;
    chain.triedRawFallback = false;
    chain.audio.currentTime = 0;
    chain.hasMedia = true;
  }

  // ----------------------------------------------------------------------
  // Runtime helpers — consumidos por CrossfadeRuntime via deps. Estos
  // métodos exponen el AudioContext + chains sin que el runtime los
  // conozca directamente (testeable con mocks).
  // ----------------------------------------------------------------------

  /** AudioContext.currentTime — anchor para CrossfadeRuntime ticks. */
  getAudioContextTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** AudioContext.sampleRate — para que CrossfadeRuntime compute coefs
      contra la sample rate real (necesita ser exacto para los biquads). */
  getSampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Setea el gain master de un chain (A o B). Multiplica internamente
      por `replayGainLinear` del chain — el caller pasa el valor del fade
      (0..1) y este método aplica el replay gain encima. */
  setChainGain(label: 'A' | 'B', fadeValue: number): void {
    const chain = label === 'A' ? this.chainA : this.chainB;
    if (!chain) return;
    chain.gain.gain.value = fadeValue * chain.replayGainLinear;
  }

  /** Setea `<audio>.playbackRate` con `preservesPitch=true` para
      time-stretch. */
  setChainPlaybackRate(label: 'A' | 'B', rate: number): void {
    const chain = label === 'A' ? this.chainA : this.chainB;
    if (!chain) return;
    chain.audio.preservesPitch = true;
    chain.audio.playbackRate = rate;
  }

  /** Programa el play de B desde `startOffset` segundos del file, lo
      antes posible (`atTime` se ignora en web; iOS programa con
      sample-accuracy). Llama `audio.play()` directo. */
  schedulePlayChainB(startOffset: number, _atTime: number): void {
    if (!this.chainB) return;
    this.chainB.audio.currentTime = Math.max(0, startOffset);
    void this.chainB.audio.play().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: msg, code: 'crossfade_play_failed' });
    });
  }

  /** Pausa B + libera src. Para `CrossfadeRuntime.cancel()`. */
  stopChainB(): void {
    if (!this.chainB) return;
    this.chainB.audio.pause();
  }

  /**
   * Runs a full DJ crossfade using a `CrossfadeResult` from the
   * `DJMixingService` algorithm. Mirrors what `crossfade(durationSec)`
   * does at a higher level — but with EQ automation, bass swap,
   * time-stretch ramp, and all the curves portados en Fase 2A-2E.
   *
   * Returns a `Promise` that resolves when the crossfade completes
   * (natural or cancelled). The promise rejects if the audio engine
   * isn't initialized or B has no media loaded.
   */
  async runCrossfadeConfig(config: CrossfadeResult): Promise<void> {
    await this.ensureInit();
    if (!this.ctx || !this.chainA || !this.chainB) {
      throw new Error('AudioEngine not initialized');
    }
    if (!this.chainB.hasMedia) {
      throw new Error('chain B has no media — call prepareNext() first');
    }
    if (this.isCrossfading) return;
    this.isCrossfading = true;
    this.emit({ type: 'crossfadestart' });

    const { CrossfadeRuntime } = await import('./crossfade-runtime');

    // Lock A on its replay gain (writes to fadeValue=1.0 will pass
    // through the * replayGain in setChainGain).
    const maxVolumeA = 1.0;
    const maxVolumeB = 1.0;

    return new Promise<void>((resolve) => {
      const startFileTimeA = this.chainA!.audio.currentTime;
      const runtime = new CrossfadeRuntime({
        config,
        maxVolumeA,
        maxVolumeB,
        startFileTimeA,
        deps: {
          getCurrentTime: () => this.getAudioContextTime(),
          setGainA: (v) => this.setChainGain('A', v),
          setGainB: (v) => this.setChainGain('B', v),
          setBiquadCoeffsAll: (label, stages) =>
            this.setAllBiquadCoeffs(label, stages as BiquadCoefficients[]),
          schedulePlayB: (startOffset, atTime) => this.schedulePlayChainB(startOffset, atTime),
          stopB: () => this.stopChainB(),
          setPlaybackRateB: (rate) => this.setChainPlaybackRate('B', rate),
          onComplete: () => {
            this.swapChainsAfterCrossfade();
            this.isCrossfading = false;
            this.emit({ type: 'crossfadeend', startOffset: this.currentTime });
            resolve();
          }
        }
      });
      runtime.setSampleRate(this.getSampleRate());
      runtime.start();
    });
  }

  /** Swap A↔B labels after a crossfade. B becomes the now-playing A;
      A is released. Helper shared between `crossfade()` and
      `runCrossfadeConfig()`. */
  private swapChainsAfterCrossfade(): void {
    if (!this.ctx || !this.chainA || !this.chainB) return;
    const a = this.chainA;
    const b = this.chainB;
    const tEnd = this.ctx.currentTime;
    a.audio.pause();
    a.audio.removeAttribute('src');
    a.audio.load();
    a.hasMedia = false;
    a.lastSrc = null;
    a.triedRawFallback = false;
    a.gain.gain.cancelScheduledValues(tEnd);
    a.gain.gain.setValueAtTime(0, tEnd);
    b.gain.gain.cancelScheduledValues(tEnd);
    b.gain.gain.setValueAtTime(b.replayGainLinear, tEnd);
    this.resetWorkletState(a);

    this.chainA = b;
    this.chainB = a;
    this.chainA.label = 'A';
    this.chainB.label = 'B';
    this.attachAudioElementListeners(this.chainA);
    this.duration = this.chainA.audio.duration || 0;
    this.currentTime = this.chainA.audio.currentTime;
    this.endedHandled = false;
    this.isPlaying = !this.chainA.audio.paused;

    // ── Reset del NUEVO chainA — restablece el "AutoMix scope" ──
    // El nuevo chainA (= old chainB) viene del crossfade con
    // `playbackRate = config.rateB` (time-stretch) y biquads en el
    // estado final del fade (highpass abierto, lowshelf en endGain,
    // notch peak, etc.). Sin reset, esos efectos seguirían aplicándose
    // a todo el resto del track post-crossfade — el "AutoMix" se
    // saldría del marco del crossfade. Mirror iOS resetTimeStretch +
    // setupInitialEQ implícito al final del swap.
    this.chainA.audio.playbackRate = 1.0;
    this.chainA.audio.preservesPitch = true;
    this.resetWorkletState(this.chainA);
  }

  /**
   * Equal-power crossfade: A→B con curvas cos²/sin² aplicadas via
   * setValueCurveAtTime. Después del fade, swap labels (B pasa a ser A).
   * SIN filter automation, SIN bass swap, SIN DJ effects — Phase 2 los añade.
   *
   * Para usar el algoritmo DJ completo (filters, bass swap, time-stretch,
   * etc.) consume `runCrossfadeConfig(config: CrossfadeResult)` con la
   * salida de `calculateCrossfadeConfig` del módulo `DJMixingService`.
   */
  async crossfade(durationSec = 4): Promise<void> {
    if (!this.ctx || !this.chainA || !this.chainB) return;
    if (!this.chainB.hasMedia) {
      this.emit({ type: 'error', message: 'crossfade: chain B has no media', code: 'no_next' });
      return;
    }
    if (this.isCrossfading) return;

    this.isCrossfading = true;
    this.emit({ type: 'crossfadestart' });

    const a = this.chainA;
    const b = this.chainB;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = Math.max(0.1, durationSec);

    // Construir curvas equal-power. POINTS escala con duración para evitar
    // facetas audibles en crossfades largos (M-9 inline).
    const POINTS = Math.max(128, Math.ceil(dur * 64));
    const aCurve = new Float32Array(POINTS);
    const bCurve = new Float32Array(POINTS);
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1); // 0..1
      const cos = Math.cos((t * Math.PI) / 2);
      const sin = Math.sin((t * Math.PI) / 2);
      aCurve[i] = cos * cos * a.replayGainLinear;
      bCurve[i] = sin * sin * b.replayGainLinear;
    }

    // cancelScheduledValues + setValueCurveAtTime único schedule — sin
    // setValueAtTime previo en el mismo timestamp (race entre browsers).
    a.gain.gain.cancelScheduledValues(t0);
    b.gain.gain.cancelScheduledValues(t0);
    a.gain.gain.setValueCurveAtTime(aCurve, t0, dur);
    b.gain.gain.setValueCurveAtTime(bCurve, t0, dur);

    // Detacheamos listeners del A saliente ANTES de desestabilizar la cadena —
    // así no quedan handlers colgando del audio element cuando se libera.
    this.detachAudioElementListeners(a);

    // Detacheamos también el B entrante porque attach es idempotente y vamos
    // a re-attachearlo después del swap (igual hay que rebindearlo a la
    // identidad nueva de chainA).
    this.detachAudioElementListeners(b);

    try {
      await b.audio.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: msg, code: 'crossfade_play_failed' });
      this.isCrossfading = false;
      // Re-attach al A original — el crossfade no procedió.
      this.attachAudioElementListeners(a);
      return;
    }

    // Esperamos por reloj de AudioContext, no setTimeout — los timers se
    // throttlean a 1Hz en background tabs y producen drift contra el ctx.
    await new Promise<void>((resolve) => {
      const startedAt = ctx.currentTime;
      const check = () => {
        if (ctx.currentTime - startedAt >= dur) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });

    // Swap: B pasa a ser el "now playing", A se libera.
    const tEnd = ctx.currentTime;
    a.audio.pause();
    a.audio.removeAttribute('src');
    a.audio.load();
    a.hasMedia = false;
    a.lastSrc = null;
    a.triedRawFallback = false;
    a.gain.gain.cancelScheduledValues(tEnd);
    a.gain.gain.setValueAtTime(0, tEnd);
    // Asegurar B en su valor final (replayGainLinear) post-curve.
    b.gain.gain.cancelScheduledValues(tEnd);
    b.gain.gain.setValueAtTime(b.replayGainLinear, tEnd);

    // Reset biquad state del chain saliente para próxima reutilización.
    this.resetWorkletState(a);

    this.chainA = b;
    this.chainB = a;
    this.chainA.label = 'A';
    this.chainB.label = 'B';

    this.attachAudioElementListeners(this.chainA);
    this.duration = this.chainA.audio.duration || 0;
    this.currentTime = this.chainA.audio.currentTime;
    this.endedHandled = false;
    this.isCrossfading = false;
    this.isPlaying = !this.chainA.audio.paused;

    this.emit({ type: 'crossfadeend', startOffset: this.currentTime });
  }

  // ----------------------------------------------------------------------
  // Worklet / DSP coefficient API — Phase 2 lo usará desde CrossfadeExecutor
  // ----------------------------------------------------------------------

  setBiquadCoeffs(chainLabel: 'A' | 'B', stage: 0 | 1 | 2 | 3, coeffs: BiquadCoefficients): void {
    const chain = chainLabel === 'A' ? this.chainA : this.chainB;
    if (!chain || !chain.worklet) return;
    // Mutamos el slot del stage manteniendo los otros 3 — el worklet reemplaza
    // el set entero en cada mensaje, por eso hay que mandar los 4 actuales.
    chain.currentCoeffs[stage] = { ...coeffs };
    this.postCoeffs(chain);
  }

  /** Envía un set completo de 4 stages. Preferido en Phase 2 cuando el
      caller mantiene el estado de los 4 biquads. */
  setAllBiquadCoeffs(chainLabel: 'A' | 'B', coeffs: BiquadCoefficients[]): void {
    const chain = chainLabel === 'A' ? this.chainA : this.chainB;
    if (!chain || !chain.worklet) return;
    if (coeffs.length !== NUM_STAGES) return;
    for (let s = 0; s < NUM_STAGES; s++) {
      const c = coeffs[s];
      if (!c) return;
      chain.currentCoeffs[s] = { ...c };
    }
    this.postCoeffs(chain);
  }

  setAllPassthrough(chainLabel: 'A' | 'B'): void {
    const chain = chainLabel === 'A' ? this.chainA : this.chainB;
    if (!chain || !chain.worklet) return;
    for (let s = 0; s < NUM_STAGES; s++) {
      chain.currentCoeffs[s] = { ...PASSTHROUGH };
    }
    this.postCoeffs(chain);
  }

  /** Valida finitud y manda el set actual de coeffs al worklet. Si algún
      coef es NaN/Inf, sustituye ese stage por passthrough en el payload. */
  private postCoeffs(chain: Chain): void {
    if (!chain.worklet) return;
    const payload: BiquadCoefficients[] = new Array(NUM_STAGES);
    for (let s = 0; s < NUM_STAGES; s++) {
      const c = chain.currentCoeffs[s] ?? PASSTHROUGH;
      if (
        Number.isFinite(c.b0) &&
        Number.isFinite(c.b1) &&
        Number.isFinite(c.b2) &&
        Number.isFinite(c.a1) &&
        Number.isFinite(c.a2)
      ) {
        payload[s] = c;
      } else {
        payload[s] = PASSTHROUGH;
      }
    }
    chain.worklet.port.postMessage({ type: 'coeffs', coeffs: payload });
  }

  private resetWorkletState(chain: Chain): void {
    if (!chain.worklet) return;
    chain.worklet.port.postMessage({ type: 'reset' });
    for (let s = 0; s < NUM_STAGES; s++) {
      chain.currentCoeffs[s] = { ...PASSTHROUGH };
    }
    this.postCoeffs(chain);
  }

  // ----------------------------------------------------------------------
  // Internals — listeners, progress, end detection
  // ----------------------------------------------------------------------

  private waitForMetadata(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= 1 /* HAVE_METADATA */) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onMeta = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        reject(new Error('audio metadata error'));
      };
      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onMeta);
        audio.removeEventListener('error', onErr);
      };
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('error', onErr);
    });
  }

  private attachAudioElementListeners(chain: Chain): void {
    const a = chain.audio;
    // Idempotente: removemos antes de añadir.
    a.removeEventListener('ended', this.onAudioEnded);
    a.removeEventListener('durationchange', this.onAudioDurationChange);
    a.removeEventListener('error', this.onAudioError);
    a.addEventListener('ended', this.onAudioEnded);
    a.addEventListener('durationchange', this.onAudioDurationChange);
    a.addEventListener('error', this.onAudioError);
  }

  private detachAudioElementListeners(chain: Chain): void {
    const a = chain.audio;
    a.removeEventListener('ended', this.onAudioEnded);
    a.removeEventListener('durationchange', this.onAudioDurationChange);
    a.removeEventListener('error', this.onAudioError);
  }

  private onAudioEnded = () => {
    if (this.endedHandled) return;
    // Durante un crossfade DJ el <audio> del chain saliente alcanza su
    // duracion natural y dispara `ended` mientras el fade aun esta en curso.
    // En ese caso: NO emitir 'ended' (impediria que QueueManager hiciera
    // next() antes del onCrossfadeCompleted -- index quedaria desfasado),
    // NO parar el progressTimer ni isPlaying (el chain B sigue sonando y
    // tras el swap pasara a ser chain A; el tick() necesita seguir leyendo
    // para que la barra de progreso y el tiempo del MiniPlayer se actualicen
    // con la cancion entrante). Solo marcamos endedHandled para que no se
    // re-procese -- swapChainsAfterCrossfade lo resetea para el nuevo chainA.
    if (this.isCrossfading) {
      this.endedHandled = true;
      return;
    }
    this.endedHandled = true;
    this.isPlaying = false;
    this.stopProgressTimer();
    this.emit({ type: 'ended' });
  };

  private onAudioDurationChange = () => {
    if (!this.chainA) return;
    const d = this.chainA.audio.duration;
    if (isFinite(d) && d > 0) this.duration = d;
  };

  private onAudioError = () => {
    if (!this.chainA) return;
    const err = this.chainA.audio.error;
    // SRC_NOT_SUPPORTED suele ser ALAC u otro codec exótico cargado con
    // format=raw — reintentamos UNA vez sin format=raw para que Navidrome
    // transcodee.
    if (err && err.code === 4 && this.tryFallback(this.chainA)) return;
    const msg = err ? `MediaError code ${err.code}` : 'unknown audio error';
    this.emit({ type: 'error', message: msg, code: 'media_error' });
  };

  /** Si la URL actual incluía format=raw, la elimina y reintenta. Retorna
      true si reemplazó la src. Solo dispara una vez por src. */
  private tryFallback(chain: Chain): boolean {
    if (chain.triedRawFallback || !chain.lastSrc) return false;
    if (!/[?&]format=raw(?:&|$)/.test(chain.lastSrc)) return false;
    const stripped = chain.lastSrc
      .replace(/([?&])format=raw(&|$)/, (_m, pre: string, post: string) =>
        post === '&' ? pre : pre === '?' ? '' : ''
      )
      .replace(/\?$/, '');
    chain.triedRawFallback = true;
    chain.lastSrc = stripped;
    const wasPlaying = !chain.audio.paused;
    const at = chain.audio.currentTime;
    chain.audio.src = stripped;
    if (Number.isFinite(at) && at > 0) {
      try { chain.audio.currentTime = at; } catch { /* pre-metadata seek */ }
    }
    if (wasPlaying) void chain.audio.play().catch(() => undefined);
    return true;
  }

  private startProgressTimer(): void {
    if (this.progressTimer) return;
    this.progressTimer = setInterval(() => this.tick(), PROGRESS_TICK_MS);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  private tick(): void {
    if (!this.chainA) return;
    // VBR sin headers / streams Infinity pueden devolver NaN — sanea a 0.
    const t = this.chainA.audio.currentTime;
    this.currentTime = Number.isFinite(t) ? t : 0;
    const d = this.chainA.audio.duration;
    if (this.duration <= 0 && Number.isFinite(d) && d > 0) {
      this.duration = d;
    }
    this.emit({ type: 'progress', currentTime: this.currentTime, duration: this.duration });

    // Auto-end fallback. El evento 'ended' del <audio> es la fuente canónica,
    // pero algunos browsers son lentos en disparar — paranoia.
    if (
      !this.endedHandled &&
      this.duration > 0 &&
      this.currentTime >= this.duration - END_DETECT_THRESHOLD &&
      !this.isCrossfading
    ) {
      this.endedHandled = true;
      this.isPlaying = false;
      this.stopProgressTimer();
      this.emit({ type: 'ended' });
    }
  }

  // ----------------------------------------------------------------------
  // Cleanup
  // ----------------------------------------------------------------------

  async dispose(): Promise<void> {
    this.stopProgressTimer();
    this.listeners.clear();
    if (this.chainA) {
      this.detachAudioElementListeners(this.chainA);
      this.chainA.audio.pause();
      this.chainA.audio.removeAttribute('src');
    }
    if (this.chainB) {
      this.detachAudioElementListeners(this.chainB);
      this.chainB.audio.pause();
      this.chainB.audio.removeAttribute('src');
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* ignore */ }
      this.analyser = null;
    }
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
      this.ctx = null;
    }
    this.workletReadyForCtx = null;
    this.chainA = null;
    this.chainB = null;
    this.masterGain = null;
    this.limiter = null;
  }
}

export const audioEngine = new AudioEngine();
