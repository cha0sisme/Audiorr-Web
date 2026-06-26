/**
 * PlayerStore — estado del reproductor (mini player + Now Playing).
 * Mirrors iOS PlayerStore.swift en estructura mental.
 *
 * Phase 1: delega playback real al AudioEngine. Las propiedades
 * (isPlaying, progress, positionSec) reflejan el estado real del engine,
 * actualizadas via eventos. La metadata visible (currentSong, context)
 * sigue viviendo acá porque es UI state, no audio state.
 *
 * Componentes lo importan así:
 *   import { player } from '$stores/player.svelte';
 *   <button onclick={() => player.toggle()}>...
 */

import { browser } from '$app/environment';
import { audioEngine } from '$lib/audio/AudioEngine.svelte';
import { getStreamUrl } from '$services/NavidromeService';
import { audioSettings } from '$stores/audio-settings.svelte';
import type { NavidromeItemArtist } from '$types/navidrome';

/** Clave de localStorage para el volumen — misma key que iOS UserDefaults
    (`PersistenceService.swift:20`) por coherencia entre clientes, aunque cada
    device guarda su propio valor (no se sincroniza vía backend a propósito:
    el volumen depende del altavoz/auricular físico de cada dispositivo). */
const VOLUME_STORAGE_KEY = 'audiorr_volume';
/** Default cuando no hay valor persistido. Mismo que iOS
    (`PersistenceService.swift:95`). */
const DEFAULT_VOLUME = 0.75;

function loadPersistedVolume(): number {
  if (!browser) return DEFAULT_VOLUME;
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, n));
  } catch {
    // SecurityError en private mode con storage deshabilitado.
    return DEFAULT_VOLUME;
  }
}

function persistVolume(v: number): void {
  if (!browser) return;
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, v.toString());
  } catch {
    // Quota / private mode — silencioso.
  }
}

export type Song = {
  id: string;
  title: string;
  artist: string;
  /** Id de Subsonic del artista — opcional porque algunas fuentes legacy
      (Connect remoto, restore) no lo propagan. Cuando existe, el MiniPlayer
      y Now Playing renderizan el nombre como link a `/artist/<id>`. */
  artistId?: string | undefined;
  /** Lista completa de artistas (OpenSubsonic `song.artists[]`). Cuando trae
      >1 entrada, el MiniPlayer pinta "A feat. B & C" con cada nombre como link
      individual. Se persiste en lastPlayback y se propaga por Connect para que
      los links sobrevivan a un refresh / control remoto. */
  artists?: NavidromeItemArtist[] | undefined;
  album?: string | undefined;
  coverUrl?: string | undefined;
  durationSec?: number | undefined;
  /** True si la canción tiene contenido explícito. Renderiza el badge "E"
      en MiniPlayer / Now Playing. */
  explicit?: boolean | undefined;
  /** Multiplier ReplayGain lineal ya computado (incluido cap por peak).
      `player.load` lo pasa al AudioEngine como replayGainLinear si el
      setting `useReplayGain` está activo. 1.0 = neutral. */
  replayGainLinear?: number | undefined;
};

/** El "from where" del playback actual. Permite que cards y listas muestren
    el indicador de equalizer cuando representan el contexto en reproducción. */
export type PlaybackContext = {
  type: 'album' | 'playlist' | 'artist' | 'queue' | 'mix';
  id: string;
} | null;

class PlayerStore {
  currentSong = $state<Song | null>(null);
  isPlaying = $state(false);
  /** Progreso normalizado 0..1. Derivado de positionSec / duration. */
  progress = $state(0);
  /** Posición actual en segundos. */
  positionSec = $state(0);
  /** Volumen 0..1 — el setter propaga al AudioEngine.setVolume() para que el
      slider del MiniPlayer funcione realmente. Sin ese bridge, mover el
      slider solo cambia el state visual sin tocar el masterGain.

      En modo remoto: el setter manda `setVolume` al hub en vez de tocar el
      audio local (no estamos reproduciendo aquí — el audio sale del otro
      device). El slider sigue actualizándose visualmente para feedback.

      Persistencia: cada cambio se escribe en localStorage (key compartida
      con iOS: `audiorr_volume`). Al recargar la pestaña se restaura el
      último valor. Device-local intencional — el volumen no se sincroniza
      cross-device porque depende del altavoz/auricular físico. */
  private _volume = $state(loadPersistedVolume());
  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    this._volume = clamped;
    if (!browser) return;
    persistVolume(clamped);
    if (this.isRemote) {
      void this.sendRemote('setVolume', clamped);
    } else {
      audioEngine.setVolume(clamped);
    }
  }
  /** De dónde se inició el playback (album X, playlist Y, etc). */
  context = $state<PlaybackContext>(null);

  /** Modo de playback global. Mirror del iOS PlaybackMode:
      - `normal`: reproducción tal cual, crossfade equal-power genérico.
      - `dj`: contenedor SmartMix activo. Activado cuando el caller llama a
        `player.load(song, ctx, { playbackMode: 'dj', contextUri: 'smartmix:<id>' })`.
      Cuando el DJ Mixing algorithm esté portado, será el AudioEngine quien
      observe este flag y aplique el crossfade DJ-grade. Hoy es UI-only. */
  playbackMode = $state<'normal' | 'dj'>('normal');

  /** Identificador canónico del contexto activo. Mirror del iOS
      NowPlayingState.contextUri. Esquemas válidos:
      - `playlist:<id>`, `album:<id>`, `artist:<id>`: playback normal.
      - `smartmix:<id>`: cola SmartMix de la playlist `<id>`. Distingue el
        SmartMix de esa playlist del playback normal de la misma. */
  contextUri = $state<string | null>(null);

  /** True cuando el player está reflejando el estado de OTRO device (Audiorr
      Connect). Mirror del iOS `NowPlayingState.isRemote`. Mientras esté true:
      - los controles del MiniPlayer envían `remote_command` al hub en vez de
        actuar local;
      - el `broadcastPlaybackState` se suprime para no echo;
      - al desaparecer el device origen, ConnectService restaura local con
        `restoreLastPlayback`. */
  isRemote = $state(false);
  /** Nombre del device cuyo playback estamos espejando (ej. "iPhone de Lean"). */
  remoteDeviceName = $state<string | null>(null);
  /** Subtítulo opcional para el MiniPlayer — "Reproduciendo en {device}".
      Cuando es null, el MiniPlayer renderiza solo título + artista. */
  subtitle = $state<string | null>(null);

  /** True si hay algo cargado y el mini player debe mostrarse. */
  hasSong = $derived(this.currentSong !== null);

  private wired = false;
  /** True una vez que `load()` ha pasado por aquí — es decir, el AudioEngine
      tiene media cargado. Si false y `play()` se invoca, delegamos al
      QueueManager para que arranque desde el restoredCurrent. Mirror del
      gap que iOS no tiene (allí MPRemoteCommandCenter siempre va via
      QueueManager). */
  private hasLoadedOnce = false;

  constructor() {
    // En SSR no hay engine — wiring solo en browser.
    if (browser) this.wireEngine();
  }

  private wireEngine() {
    if (this.wired) return;
    this.wired = true;

    // Hidrata el masterGain del engine con el volumen persistido. El engine
    // arranca por defecto a 1.0; sin esto, la primera canción suena al máximo
    // hasta que el user toque el slider, ignorando el último valor guardado.
    audioEngine.setVolume(this._volume);

    audioEngine.on('progress', (e) => {
      if (e.type !== 'progress') return;
      this.positionSec = e.currentTime;
      const dur = e.duration || this.currentSong?.durationSec || 0;
      this.progress = dur > 0 ? Math.min(1, e.currentTime / dur) : 0;
      // QueueManager se importa lazy para evitar el ciclo (queue → player → queue).
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.onProgressUpdate(e.currentTime, dur);
      });
    });

    audioEngine.on('playstate', (e) => {
      if (e.type !== 'playstate') return;
      this.isPlaying = e.isPlaying;
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.onPlaybackStateChanged(e.isPlaying, e.currentTime);
      });
    });

    audioEngine.on('seek', (e) => {
      if (e.type !== 'seek') return;
      this.positionSec = e.to;
      const dur = this.currentSong?.durationSec || audioEngine.duration || 0;
      this.progress = dur > 0 ? Math.min(1, e.to / dur) : 0;
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.onSeek(e.to);
      });
    });

    audioEngine.on('ended', () => {
      this.isPlaying = false;
      // QueueManager decide si avanzar (next), wrappear, o stoppear según
      // repeatMode y si quedan tracks.
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.onSongFinished();
      });
    });

    audioEngine.on('crossfadeend', (e) => {
      if (e.type !== 'crossfadeend') return;
      // El AudioEngine ya hizo el swap A↔B. QueueManager avanza currentIndex
      // y sincroniza `player.currentSong` con el nuevo A. Sin este cableo,
      // `djCrossfadeFiring` queda pegado a true tras el primer fade DJ y
      // bloquea todos los crossfades posteriores.
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.onCrossfadeCompleted(e.startOffset);
      });
    });

    audioEngine.on('error', (e) => {
      if (e.type !== 'error') return;
      console.error('[player] AudioEngine error:', e.message, e.code);
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.onError();
      });
    });
  }

  /**
   * Carga una canción y empieza a reproducir. La URL del stream se resuelve
   * desde NavidromeService usando song.id.
   *
   * `options.playbackMode` (default `'normal'`) y `options.contextUri` se
   * publican al store para que los Detail views distingan el SmartMix de
   * la misma playlist en modo normal — mirror del iOS NowPlayingState.
   *
   * `options.startAt`: posición inicial en segundos. Usado por
   * QueueManager al consumir `pendingResumePosition` tras un restore
   * (lastPlayback o IndexedDB cold-start). Se propaga a
   * `audioEngine.load`, que lo aplica como `currentTime` ANTES de
   * marcar el media como `hasMedia` — sin race-condition con metadata
   * loading. También se publica inmediatamente en `positionSec`/`progress`
   * para evitar el flicker "posición correcta → 0 → resume" que se veía
   * con el seekTo post-load anterior.
   */
  load(
    song: Song,
    context: PlaybackContext = null,
    options: {
      playbackMode?: 'normal' | 'dj';
      contextUri?: string | null;
      startAt?: number;
    } = {}
  ) {
    this.currentSong = song;
    this.context = context;
    this.playbackMode = options.playbackMode ?? 'normal';
    this.contextUri = options.contextUri ?? null;

    const startAt = options.startAt ?? 0;
    this.positionSec = startAt;
    this.progress =
      song.durationSec && song.durationSec > 0
        ? Math.max(0, Math.min(1, startAt / song.durationSec))
        : 0;
    // Optimismo: marcamos isPlaying=true para que el mini player aparezca al
    // toque; el engine confirmará/corregirá via eventos.
    this.isPlaying = true;

    if (!browser) return;
    const url = getStreamUrl(song.id);
    if (!url) {
      console.warn('[player] no stream URL — credentials missing?');
      this.isPlaying = false;
      return;
    }
    this.hasLoadedOnce = true;
    const loadOpts: {
      duration?: number;
      startAt?: number;
      replayGainLinear?: number;
    } = {};
    if (song.durationSec !== undefined) loadOpts.duration = song.durationSec;
    if (startAt > 0) loadOpts.startAt = startAt;
    // ReplayGain: solo si el setting está ON. Mirror QueueManager.swift:80-83
    // (`useReplayGain`) + `effectiveReplayGain` línea 102-104. Cuando OFF
    // pasamos 1.0 explícito; sin esto el engine caería a su default -8 dB
    // que silenciaría todo el catálogo.
    if (audioSettings.useReplayGain && song.replayGainLinear !== undefined) {
      loadOpts.replayGainLinear = song.replayGainLinear;
    } else if (!audioSettings.useReplayGain) {
      loadOpts.replayGainLinear = 1.0;
    }
    void audioEngine
      .load(url, loadOpts)
      .then(() => audioEngine.play())
      .catch((err) => {
        console.error('[player] load/play failed', err);
        this.isPlaying = false;
      });
  }

  /** ¿El playback actual viene de este contexto? Lo usan AlbumCard, PlaylistCard,
      ArtistCard, QuickAccessCard para decidir si renderizan el equalizer.

      Defensa SmartMix: la cola SmartMix de una playlist tambien debe marcar
      la PlaylistCard base como "playing from". El contextUri es
      `smartmix:<id>` y el `player.context` se setea a `{type:'playlist', id}`
      desde SmartMixButton; este branch cubre tambien restores cross-device
      donde el `context` puede no estar repoblado pero el contextUri si. */
  isPlayingFrom(type: NonNullable<PlaybackContext>['type'], id: string): boolean {
    if (this.context?.type === type && this.context?.id === id) return true;
    if (type === 'playlist' && this.contextUri === `smartmix:${id}`) return true;
    return false;
  }

  /** ¿La cola activa es el SmartMix de esta playlist concreta? Mirror exacto
      del iOS `nowPlaying.contextUri == "smartmix:<id>"`. Lo usa SmartMixButton
      para decidir si toggle play/pause vs disparar generate/playSmartMix. */
  isSmartMixContext(playlistId: string): boolean {
    return this.contextUri === `smartmix:${playlistId}`;
  }

  /** Helper privado — manda un remote_command al hub vía ConnectService.
      Lazy import para evitar el ciclo player ↔ connectService. */
  private async sendRemote(action: string, value?: unknown): Promise<void> {
    const { connectService } = await import('$services/ConnectService.svelte');
    connectService.sendRemoteCommand(action, value);
  }

  toggle() {
    if (this.isRemote) {
      // Optimismo: actualizamos el state local para que el botón cambie al
      // toque; el playback_state_update echo desde el remoto reconcilia.
      this.isPlaying = !this.isPlaying;
      void this.sendRemote('togglePlayPause');
      return;
    }
    if (!this.currentSong) return;
    if (this.isPlaying) this.pause();
    else this.play();
  }

  play() {
    if (this.isRemote) {
      this.isPlaying = true;
      void this.sendRemote('play');
      return;
    }
    if (!this.currentSong) return;
    // Cold-restore path: tenemos metadata pero el AudioEngine nunca recibió
    // un load(). audioEngine.play() retornaría silencioso (chainA.hasMedia
    // === false), así que delegamos al QueueManager para que cargue +
    // reproduzca el current song con la posición pendiente.
    if (browser && !this.hasLoadedOnce) {
      void import('$services/QueueManager.svelte').then(({ queueManager }) => {
        queueManager.resumeFromRestore();
      });
      return;
    }
    this.isPlaying = true;
    if (browser) void audioEngine.play().catch(() => (this.isPlaying = false));
  }

  pause() {
    if (this.isRemote) {
      this.isPlaying = false;
      void this.sendRemote('pause');
      return;
    }
    this.isPlaying = false;
    if (browser) audioEngine.pause();
  }

  next() {
    if (this.isRemote) {
      void this.sendRemote('next');
      return;
    }
    void import('$services/QueueManager.svelte').then(({ queueManager }) => {
      queueManager.skipNext();
    });
  }

  previous() {
    if (this.isRemote) {
      void this.sendRemote('previous');
      return;
    }
    void import('$services/QueueManager.svelte').then(({ queueManager }) => {
      queueManager.skipPrevious();
    });
  }

  /** `normalizedProgress` ∈ [0, 1]. Convierte a segundos contra la duración. */
  seek(normalizedProgress: number) {
    // Guard: si hay un crossfade activo, no movemos progress/positionSec
    // ni delegamos al engine -- el slider del MiniPlayer / NowPlaying y los
    // taps en lineas de lyrics se descartan silenciosamente durante el
    // fade. El audioEngine.seek tiene el mismo guard como red de seguridad
    // final; el de aqui evita el "saltito" visual donde la barra se mueve
    // y luego rebota al siguiente progress tick.
    if (audioEngine.isCrossfading) return;
    const p = Math.max(0, Math.min(1, normalizedProgress));
    this.progress = p;
    const dur = this.currentSong?.durationSec ?? audioEngine.duration ?? 0;
    if (dur <= 0) return;
    const sec = p * dur;
    this.positionSec = sec;
    if (this.isRemote) {
      void this.sendRemote('seekTo', sec);
      return;
    }
    if (browser) audioEngine.seek(sec);
  }
}

export const player = new PlayerStore();
