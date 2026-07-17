/**
 * ScrobbleService — port web del iOS ScrobbleService.swift (241 LOC).
 *
 * Doble destino:
 *   1. Navidrome `/rest/scrobble.view` — cuenta para el play count del
 *      server (y Last.fm si tiene plugin habilitado).
 *   2. Backend Audiorr — alimenta `wrapped.db` (estadísticas + recentContexts
 *      del home). Vía socket si hubConnected, fallback REST `/api/scrobble`.
 *
 * Threshold (Scrobbling Fase 2): scrobble cuando
 * el tiempo de ESCUCHA ACTIVA (no wall-clock — la pausa no cuenta, C2)
 * alcanza `min(playable * 0.5, 240s)`, donde `playable = duration -
 * startPosition` (C1). La fórmula y el reloj viven en
 * `scrobbleThreshold.ts` (puro, sin dependencias de plataforma — es la
 * spec ejecutable del port a iOS/Android, ver ese archivo y su test).
 *
 * Pending queue offline: si Navidrome falla, persist en localStorage.
 * Listener `online` re-intenta cuando vuelve la red.
 *
 * Anti-smartmix: si `playbackMode==='dj'` o `contextUri.startsWith('smartmix:')`
 * → no enviar contextUri al backend (regla del director 2026-05-09 ya
 * documentada en QueueManager.playCurrentSong:899). Sin esto, los
 * recentContexts del home se contaminan con `smartmix:<id>` y al hacer click
 * la web intenta navegar a `/playlist/<smartmix-id>` y da 404.
 */

import { browser } from '$app/environment';

import { credentials } from '$stores/credentials.svelte';
import { player } from '$stores/player.svelte';
import { scrobble as scrobbleNavidrome } from '$services/NavidromeService';
import { recordScrobble, type ScrobblePayload } from '$services/scrobble';
import { connectService } from '$services/ConnectService.svelte';
import { invalidateRecentContexts } from '$services/query-bus';
import { ActiveListenClock, computeScrobbleWindow } from '$services/scrobbleThreshold';
import type { PersistableSong } from '$services/QueueManager.svelte';

// ============================================================================
// Pending queue (offline retry) — solo Navidrome retries; el backend tiene
// dedupe 600s, los duplicados se descartan ahí.
// ============================================================================

type PendingScrobble = {
  songId: string;
  /** Unix seconds (mirror del Swift `Int(timeIntervalSince1970)`). */
  timestamp: number;
};

const PENDING_KEY = 'audiorr_pending_scrobbles';
const ENABLED_KEY = 'audiorr_scrobble_enabled';

function loadPending(): PendingScrobble[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PendingScrobble =>
        p && typeof p.songId === 'string' && typeof p.timestamp === 'number'
    );
  } catch {
    return [];
  }
}

function savePending(items: PendingScrobble[]): void {
  if (!browser) return;
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode — ignore */
  }
}

function loadEnabled(): boolean {
  if (!browser) return true;
  return localStorage.getItem(ENABLED_KEY) !== 'false';
}

function saveEnabled(enabled: boolean): void {
  if (!browser) return;
  localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false');
}

// ============================================================================
// ScrobbleService
// ============================================================================

class ScrobbleService {
  isEnabled = $state(loadEnabled());
  lastScrobbledSongId = $state<string | null>(null);

  private currentSongId: string | null = null;
  /** La canción que `songDidStart` recibió por parámetro. Fuente única para el
      payload del backend: antes se releía del QueueManager vía import dinámico,
      que devolvía `null` en su primera invocación (el módulo aún cargaba) —
      y como `progressUpdate` solo la pide UNA vez por canción, ya con
      `hasScrobbled=true`, el primer scrobble de cada carga de página se perdía
      entero (Navidrome sí lo recibía; el backend no). Guardar lo que ya nos
      dan evita el ciclo de imports y ancla por identidad, sin releer un estado
      que puede haber cambiado. */
  private currentSong: PersistableSong | null = null;
  private startTime: number | null = null;
  /** Posición REAL (segundos) en la que la canción actual entró en juego —
      0 en modo normal; el aterrizaje empírico del crossfade DJ cuando
      `songDidStart` se llama desde `onCrossfadeCompleted`. Denominador de
      C1 (`playable = duration - startPosition`), NUNCA `config.entryPoint`
      — ver el comment de `computeScrobbleWindow` en `scrobbleThreshold.ts`. */
  private startPosition = 0;
  /** Reloj de audio activo (C2) — acumula solo mientras suena, congela en
      pausa. Se reinicia en cada `songDidStart`; `setPlaying` lo
      pausa/reanuda en cada cambio de estado del engine. */
  private readonly activeClock = new ActiveListenClock();
  private hasScrobbled = false;
  private pending: PendingScrobble[] = loadPending();
  private onlineListenerBound = false;

  constructor() {
    if (browser) this.bindOnlineListener();
  }

  /**
   * QueueManager llama esto cuando arranca una canción nueva. Resetea el
   * tracker y lanza un "now playing" no-submission a Navidrome.
   *
   * `startPosition` (segundos, default 0): posición REAL en la que la
   * canción entra en juego. En modo normal se omite (0 — nadie recorta
   * nada). En modo DJ, `QueueManager.onCrossfadeCompleted` pasa el
   * aterrizaje empírico del engine (`AudioEngine`'s `currentTime` justo
   * tras el swap) — ver C1 en `scrobbleThreshold.ts`.
   */
  songDidStart(song: PersistableSong, startPosition = 0): void {
    // Si quedaba un scrobble pendiente para la anterior, no hacemos nada
    // especial — el threshold ya falló o pasó. El Swift hace lo mismo
    // (flushCurrentIfNeeded line 113-117 es no-op).
    this.currentSongId = song.id;
    this.currentSong = song;
    this.startTime = Date.now();
    this.startPosition = startPosition;
    this.activeClock.reset();
    this.hasScrobbled = false;

    if (!this.isEnabled) return;

    // "Now playing" Navidrome — fire-and-forget, fallos no bloquean.
    void scrobbleNavidrome(song.id, { submission: false }).catch(() => {
      /* now-playing no es crítico; no enqueueamos */
    });
  }

  /**
   * QueueManager llama esto en cada cambio de estado play/pause del
   * engine (`onPlaybackStateChanged`). Congela/reanuda el reloj de audio
   * activo (C2) — la pausa no debe contar como escucha. Ver
   * `ActiveListenClock` en `scrobbleThreshold.ts`.
   */
  setPlaying(isPlaying: boolean): void {
    if (isPlaying) this.activeClock.resume();
    else this.activeClock.pause();
  }

  /**
   * Llamado periódicamente por QueueManager con currentTime + duration.
   * Cuando el tiempo de escucha activa (C2) alcanza el threshold sobre
   * `playable` (C1), dispara el scrobble único de la canción.
   */
  progressUpdate(songId: string, _currentTime: number, duration: number): void {
    if (!this.isEnabled) return;
    if (songId !== this.currentSongId) return;
    if (this.hasScrobbled) return;
    if (duration <= 0) return;
    if (this.startTime === null) return;

    const window = computeScrobbleWindow({ duration, startPosition: this.startPosition });
    if (!window.passesGuard) return;
    const elapsed = this.activeClock.elapsedSeconds();
    const threshold = window.threshold;
    if (elapsed < threshold) return;

    // Mark inmediato — previene duplicados si el siguiente progress llega antes
    // de que las promesas de scrobble resuelvan.
    this.hasScrobbled = true;
    this.lastScrobbledSongId = songId;

    const timestamp = Math.floor(this.startTime / 1000);

    // 1) Navidrome scrobble REST — si falla, encolamos para retry online.
    void scrobbleNavidrome(songId, { time: timestamp, submission: true }).catch(
      () => {
        this.enqueuePending({ songId, timestamp });
      }
    );

    // 2) Backend (wrapped.db) — preferir socket si está conectado.
    const song = this.currentSong;
    if (song) {
      const playedAt = new Date(this.startTime);
      const contextUri = this.scrobbleContextUri();
      // El scrobble acaba de actualizar recentContexts en el backend. Invalidar
      // la query TanStack para que Jump Back In refleje el nuevo item al
      // siguiente acceso al home (o inmediato si el home esta montado).
      // No invalidamos cuando no hay contextUri (scrobbles SmartMix / DJ mode
      // tienen contextUri=null por scrobbleContextUri() y no generan
      // recentContext en el backend, asi que no hay nada que refrescar).
      if (contextUri) invalidateRecentContexts();
      if (connectService.hubConnected) {
        connectService.emitScrobble({
          songId: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album ?? '',
          ...(song.albumId ? { albumId: song.albumId } : {}),
          duration: song.duration,
          playedAt,
          ...(contextUri ? { contextUri } : {})
        });
      } else {
        const username = credentials.current?.username;
        if (username) {
          const payload: ScrobblePayload = {
            username,
            songId: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album ?? '',
            duration: song.duration,
            playedAt: playedAt.toISOString()
          };
          if (song.albumId) payload.albumId = song.albumId;
          if (contextUri) payload.contextUri = contextUri;
          void recordScrobble(payload);
        }
      }
    }

    console.log(
      `[Scrobble] ${songId} after ${Math.round(elapsed)}s (threshold ${Math.round(threshold)}s)`
    );
  }

  /** Toggle persistido. Settings UI futura llamará a esto. */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    saveEnabled(enabled);
  }

  /** Reintenta los scrobbles Navidrome encolados. Se llama auto en `online`
      event y puede llamarse manualmente desde Settings. */
  async retryPending(): Promise<void> {
    if (!browser) return;
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    savePending(this.pending);

    for (const item of batch) {
      try {
        await scrobbleNavidrome(item.songId, {
          time: item.timestamp,
          submission: true
        });
      } catch {
        this.enqueuePending(item);
      }
    }
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  /** Aplica la regla anti-smartmix: si la cola actual es SmartMix, no
      reportamos el contextUri al backend (contamina recentContexts). */
  private scrobbleContextUri(): string | null {
    const uri = player.contextUri;
    if (!uri) return null;
    if (player.playbackMode === 'dj') return null;
    if (uri.startsWith('smartmix:')) return null;
    return uri;
  }

  private enqueuePending(item: PendingScrobble): void {
    this.pending.push(item);
    savePending(this.pending);
  }

  private bindOnlineListener(): void {
    if (this.onlineListenerBound) return;
    if (typeof window === 'undefined') return;
    this.onlineListenerBound = true;
    window.addEventListener('online', () => {
      void this.retryPending();
    });
  }
}

export const scrobbleService = new ScrobbleService();
