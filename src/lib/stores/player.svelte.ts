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

export type Song = {
  id: string;
  title: string;
  artist: string;
  album?: string | undefined;
  coverUrl?: string | undefined;
  durationSec?: number | undefined;
  /** True si la canción tiene contenido explícito. Renderiza el badge "E"
      en MiniPlayer / Now Playing. */
  explicit?: boolean | undefined;
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
      slider solo cambia el state visual sin tocar el masterGain. */
  private _volume = $state(1);
  get volume() {
    return this._volume;
  }
  set volume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    this._volume = clamped;
    if (browser) audioEngine.setVolume(clamped);
  }
  /** De dónde se inició el playback (album X, playlist Y, etc). */
  context = $state<PlaybackContext>(null);

  /** True si hay algo cargado y el mini player debe mostrarse. */
  hasSong = $derived(this.currentSong !== null);

  private wired = false;

  constructor() {
    // En SSR no hay engine — wiring solo en browser.
    if (browser) this.wireEngine();
  }

  private wireEngine() {
    if (this.wired) return;
    this.wired = true;

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
   */
  load(song: Song, context: PlaybackContext = null) {
    this.currentSong = song;
    this.context = context;
    this.progress = 0;
    this.positionSec = 0;
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
    void audioEngine
      .load(url, { duration: song.durationSec })
      .then(() => audioEngine.play())
      .catch((err) => {
        console.error('[player] load/play failed', err);
        this.isPlaying = false;
      });
  }

  /** ¿El playback actual viene de este contexto? Lo usan AlbumCard, PlaylistCard,
      ArtistCard, QuickAccessCard para decidir si renderizan el equalizer. */
  isPlayingFrom(type: NonNullable<PlaybackContext>['type'], id: string): boolean {
    return this.context?.type === type && this.context?.id === id;
  }

  toggle() {
    if (!this.currentSong) return;
    if (this.isPlaying) this.pause();
    else this.play();
  }

  play() {
    if (!this.currentSong) return;
    this.isPlaying = true;
    if (browser) void audioEngine.play().catch(() => (this.isPlaying = false));
  }

  pause() {
    this.isPlaying = false;
    if (browser) audioEngine.pause();
  }

  next() {
    void import('$services/QueueManager.svelte').then(({ queueManager }) => {
      queueManager.skipNext();
    });
  }

  previous() {
    void import('$services/QueueManager.svelte').then(({ queueManager }) => {
      queueManager.skipPrevious();
    });
  }

  /** `normalizedProgress` ∈ [0, 1]. Convierte a segundos contra la duración. */
  seek(normalizedProgress: number) {
    const p = Math.max(0, Math.min(1, normalizedProgress));
    this.progress = p;
    const dur = this.currentSong?.durationSec ?? audioEngine.duration ?? 0;
    if (dur <= 0) return;
    const sec = p * dur;
    this.positionSec = sec;
    if (browser) audioEngine.seek(sec);
  }
}

export const player = new PlayerStore();
