/**
 * QueueManager — port web del iOS QueueManager.swift.
 *
 * Singleton @Observable en iOS → singleton de runes en web. Es la sola fuente
 * de verdad de la queue, shuffle, repeat y avance de track.
 *
 * Capas:
 *   - Estado reactivo (runes) ← consumido por componentes y player.
 *   - Persistencia Dexie ← debounced + flush en savePositionNow().
 *   - Engine outbound ← delegado a `player.svelte.ts` (Phase 1). Cuando el
 *     AudioEngine gane métodos como `setNextStreamURL` / `setAutomixTrigger`,
 *     se cablean acá (TODO Phase 2).
 *
 * Lo que NO se porta ahora (stubs intencionales):
 *   - prepareNextForCrossfade — DJMixingService aún no portado.
 *   - BackendService.saveLastPlayback — BackendService aún no expone este endpoint.
 *   - ScrobbleService — no portado todavía.
 *   - OfflineStorageManager.markPlayed — no portado.
 *   - ConnectService.broadcastStateIfNeeded — no portado.
 *   - NowPlayingState.shared — el `player` store ya cumple su rol; NowPlaying
 *     "lock-screen" UI no existe en web.
 */

import { browser } from '$app/environment';
import { z } from 'zod';
import { player, type PlaybackContext } from '$stores/player.svelte';
import {
  loadSnapshot,
  saveSnapshot,
  clearSnapshot
} from '$services/persistence/queue-db';
import type { NavidromeSong } from '$types/navidrome';
import type { SongListItem } from '$utils/navidrome-mappers';
import { getCoverArtUrl } from '$services/NavidromeService';

// ============================================================================
// Types
// ============================================================================

export const PersistableSongSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  albumId: z.string().optional(),
  artistId: z.string().optional(),
  coverArt: z.string().optional(),
  duration: z.number(),
  /** Lineal multiplier — iOS guarda 1.0 cuando no hay info. */
  replayGainMultiplier: z.number().default(1.0),
  /** OpenSubsonic raw value — 'explicit' | 'clean' | undefined. */
  explicitStatus: z.string().optional()
});

export type PersistableSong = z.infer<typeof PersistableSongSchema>;

export type RepeatMode = 'off' | 'all' | 'one';

const HISTORY_LIMIT = 500;
const POSITION_SAVE_THROTTLE_MS = 15_000;
const PERSIST_DEBOUNCE_MS = 250;

// ============================================================================
// Helpers (pure)
// ============================================================================

export function navidromeSongToPersistable(s: NavidromeSong): PersistableSong {
  return {
    id: s.id,
    title: s.title,
    ...(s.artist !== undefined ? { artist: s.artist } : { artist: 'Unknown' }),
    ...(s.album !== undefined ? { album: s.album } : {}),
    ...(s.albumId !== undefined ? { albumId: s.albumId } : {}),
    ...(s.artistId !== undefined ? { artistId: s.artistId } : {}),
    ...(s.coverArt !== undefined ? { coverArt: s.coverArt } : {}),
    duration: s.duration ?? 0,
    replayGainMultiplier: 1.0,
    ...(s.explicitStatus !== undefined ? { explicitStatus: s.explicitStatus } : {})
  };
}

/** Construye una PersistableSong desde el item normalizado que rinde SongList.
    Útil para context-menu actions donde no tenemos el NavidromeSong crudo. */
export function songListItemToPersistable(
  item: SongListItem,
  fallbackArtist?: string
): PersistableSong {
  const artist = item.artist ?? fallbackArtist ?? 'Unknown';
  return {
    id: item.id,
    title: item.title,
    artist,
    ...(item.album !== undefined ? { album: item.album } : {}),
    ...(item.albumId !== undefined ? { albumId: item.albumId } : {}),
    ...(item.artistId !== undefined ? { artistId: item.artistId } : {}),
    duration: item.durationSec,
    replayGainMultiplier: 1.0,
    ...(item.explicit ? { explicitStatus: 'explicit' as const } : {})
  };
}

function persistableToPlayerSong(s: PersistableSong): {
  id: string;
  title: string;
  artist: string;
  album?: string | undefined;
  coverUrl?: string | undefined;
  durationSec?: number | undefined;
  explicit?: boolean | undefined;
} {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    ...(s.album !== undefined ? { album: s.album } : {}),
    ...(s.coverArt ? { coverUrl: getCoverArtUrl(s.coverArt, 300) } : {}),
    durationSec: s.duration > 0 ? s.duration : undefined,
    explicit: s.explicitStatus === 'explicit'
  };
}

/** Fisher-Yates shuffle in-place. */
function fisherYates<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

// ============================================================================
// QueueManager
// ============================================================================

class QueueManager {
  // ---------- public reactive state (private(set) en iOS) ----------
  queue = $state<PersistableSong[]>([]);
  currentIndex = $state(-1);
  history = $state<PersistableSong[]>([]);
  shuffleMode = $state(false);
  repeatMode = $state<RepeatMode>('off');

  // ---------- derived ----------
  currentSong = $derived<PersistableSong | null>(
    this.currentIndex >= 0 && this.currentIndex < this.queue.length
      ? (this.queue[this.currentIndex] ?? null)
      : null
  );
  isEmpty = $derived(this.queue.length === 0);

  // ---------- private state ----------
  private originalQueue: PersistableSong[] = [];
  private pendingResumePosition = 0;
  private lastLocalPositionSave = 0;
  private isAdvancingTrack = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;
  /** Inhibe la próxima llamada a player.load() — usado cuando solo queremos
      sincronizar estado UI sin disparar playback (ej. restoreState/loadRemoteQueue). */
  private suppressLoadOnce = false;
  /** Modo de la cola activa. Mirror del iOS PlaybackMode. Se propaga a
      `player.load()` en cada `playCurrentSong()`. Para SmartMix: `'dj'`. */
  private playbackMode: 'normal' | 'dj' = 'normal';
  /** URI canónico del contexto de la cola. Esquemas: `playlist:<id>`,
      `album:<id>`, `artist:<id>`, `smartmix:<id>`, `null` para cola libre.
      Se propaga al player para que SmartMixButton distinga el SmartMix de
      la misma playlist en modo normal. */
  private contextUri: string | null = null;

  constructor() {
    if (browser) {
      // No-await — el restore puede ser asíncrono y los componentes no deberían
      // bloquearse esperando la queue persistida. El primer ciclo verá la queue
      // vacía y luego se rehidratará.
      void this.restoreState();
    }
  }

  // ==========================================================================
  // Public API — mirrors iOS QueueManager
  // ==========================================================================

  /**
   * Reemplaza la queue actual con `songs`, comienza en `startIndex` y arranca
   * playback. Si shuffle está activo, pinea el track de startIndex al slot
   * startIndex y baraja el resto.
   */
  play(
    songs: NavidromeSong[],
    startIndex = 0,
    options: { playbackMode?: 'normal' | 'dj'; contextUri?: string | null } = {}
  ): void {
    if (songs.length === 0) return;
    const persistable = songs.map(navidromeSongToPersistable);
    this.playPersistable(persistable, startIndex, options);
  }

  /** Variante que acepta PersistableSong (ej. cuando ya las construimos a
      partir de SongListItem). `options.playbackMode` y `options.contextUri`
      se memorizan en el manager y se propagan a `player.load()` en cada
      `playCurrentSong()` — así el modo (normal / dj) y el URI canónico
      (`smartmix:<id>`) sobreviven a skips entre tracks. */
  playPersistable(
    songs: PersistableSong[],
    startIndex = 0,
    options: { playbackMode?: 'normal' | 'dj'; contextUri?: string | null } = {}
  ): void {
    if (songs.length === 0) return;
    const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
    this.queue = [...songs];
    this.originalQueue = [...songs];
    this.currentIndex = idx;
    this.pendingResumePosition = 0;
    this.playbackMode = options.playbackMode ?? 'normal';
    this.contextUri = options.contextUri ?? null;

    if (this.shuffleMode) this.applyShuffle(true);

    this.persistState();
    this.playCurrentSong();
  }

  /**
   * Avance automático (engine fired). Respeta repeat-one (re-juega la actual).
   * Si estabamos crossfadeando, el engine ya movió a N+1 — saltamos DOS.
   */
  next(): void {
    if (this.isAdvancingTrack) return;
    if (this.queue.length === 0) return;

    if (this.repeatMode === 'one') {
      this.playCurrentSong();
      return;
    }

    this.isAdvancingTrack = true;
    try {
      const cur = this.currentSong;
      if (cur) this.pushToHistory(cur);

      // Phase 2: si isCrossfading, advance += 2. Phase 1: solo +1.
      const advance = 1;
      const next = this.currentIndex + advance;

      if (next >= this.queue.length) {
        if (this.repeatMode === 'all') {
          this.currentIndex = 0;
          this.persistState();
          this.playCurrentSong();
        } else {
          this.stopPlayback();
        }
      } else {
        this.currentIndex = next;
        this.persistState();
        this.playCurrentSong();
      }
    } finally {
      this.isAdvancingTrack = false;
    }
  }

  /**
   * Skip iniciado por el usuario (botón). Avanza siempre (ignora repeat-one).
   */
  skipNext(): void {
    if (this.isAdvancingTrack) return;
    if (this.queue.length === 0) return;

    this.isAdvancingTrack = true;
    try {
      const cur = this.currentSong;
      if (cur) this.pushToHistory(cur);

      const next = this.currentIndex + 1;
      if (next >= this.queue.length) {
        if (this.repeatMode === 'all') {
          this.currentIndex = 0;
          this.persistState();
          this.playCurrentSong();
        } else {
          this.stopPlayback();
        }
      } else {
        this.currentIndex = next;
        this.persistState();
        this.playCurrentSong();
      }
    } finally {
      this.isAdvancingTrack = false;
    }
  }

  /**
   * Previous engine-side. Si > 3s, seek to 0; si no, decrement.
   */
  previous(): void {
    if (this.queue.length === 0) return;

    // Phase 2: si isCrossfading, replay current sin decrement.
    if (player.positionSec > 3) {
      this.seekTo(0);
      return;
    }

    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.persistState();
      this.playCurrentSong();
    } else if (this.repeatMode === 'all') {
      this.currentIndex = this.queue.length - 1;
      this.persistState();
      this.playCurrentSong();
    } else {
      this.seekTo(0);
    }
  }

  /**
   * Skip previous iniciado por el usuario. Idéntico a previous() — la única
   * diferencia en iOS es la rama crossfade-replay, que en Phase 1 no aplica.
   */
  skipPrevious(): void {
    this.previous();
  }

  /** Salto directo a un índice arbitrario de la queue (click en una row del
      QueuePanel). Empuja la canción actual al historial igual que skipNext.
      No-op si el índice es el mismo o está fuera de rango. */
  jumpTo(index: number): void {
    if (this.queue.length === 0) return;
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.currentIndex) return;

    const cur = this.currentSong;
    if (cur) this.pushToHistory(cur);

    this.currentIndex = index;
    this.persistState();
    this.playCurrentSong();
  }

  /** Inserta como "next up" (currentIndex + 1) en queue y originalQueue. */
  insertNext(song: NavidromeSong): void {
    this.insertNextPersistable(navidromeSongToPersistable(song));
  }

  /** Variante para cuando el caller ya tiene una PersistableSong (SongRow). */
  insertNextPersistable(song: PersistableSong): void {
    const insertAt = this.queue.length === 0 ? 0 : this.currentIndex + 1;
    const q = [...this.queue];
    q.splice(insertAt, 0, song);
    this.queue = q;

    const oq = [...this.originalQueue];
    const oqInsertAt = this.originalQueue.length === 0 ? 0 : insertAt;
    oq.splice(oqInsertAt, 0, song);
    this.originalQueue = oq;

    // Si la queue estaba vacía, esta canción se vuelve la actual.
    if (this.currentIndex < 0) this.currentIndex = 0;

    this.persistState();
    // Caso "queue vacía → primer insert" debe arrancar playback inmediato.
    if (this.queue.length === 1) this.playCurrentSong();
  }

  /** Conveniencia: insertNext desde el SongListItem que rinde SongRow. */
  insertNextItem(item: SongListItem, fallbackArtist?: string): void {
    this.insertNextPersistable(songListItemToPersistable(item, fallbackArtist));
  }

  /** Inserta múltiples tracks tras la actual, manteniendo el orden recibido.
      Mirrors el "Añadir a continuación" del menú hero (Apple Music style). */
  insertNextMany(songs: NavidromeSong[]): void {
    if (songs.length === 0) return;
    const persistable = songs.map(navidromeSongToPersistable);
    this.insertNextManyPersistable(persistable);
  }

  insertNextManyPersistable(songs: PersistableSong[]): void {
    if (songs.length === 0) return;
    const insertAt = this.queue.length === 0 ? 0 : this.currentIndex + 1;
    const q = [...this.queue];
    q.splice(insertAt, 0, ...songs);
    this.queue = q;

    const oq = [...this.originalQueue];
    const oqInsertAt = this.originalQueue.length === 0 ? 0 : insertAt;
    oq.splice(oqInsertAt, 0, ...songs);
    this.originalQueue = oq;

    if (this.currentIndex < 0) this.currentIndex = 0;

    this.persistState();
    if (this.queue.length === songs.length) this.playCurrentSong();
  }

  /** Append al final, en queue y originalQueue. */
  addToQueue(song: NavidromeSong): void {
    this.addToQueuePersistable(navidromeSongToPersistable(song));
  }

  addToQueuePersistable(song: PersistableSong): void {
    this.queue = [...this.queue, song];
    this.originalQueue = [...this.originalQueue, song];
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.persistState();
    if (this.queue.length === 1) this.playCurrentSong();
  }

  /**
   * Quita el track en `index`. Maneja edge cases:
   *   - antes del actual → currentIndex--
   *   - es el actual y queda vacía → stop
   *   - es el actual y queda algo → clamp y reproduce el nuevo del slot
   */
  remove(index: number): void {
    if (index < 0 || index >= this.queue.length) return;
    const removed = this.queue[index];
    if (!removed) return;

    const q = [...this.queue];
    q.splice(index, 1);
    this.queue = q;

    // Sync originalQueue por id.
    const oqIdx = this.originalQueue.findIndex((s) => s.id === removed.id);
    if (oqIdx >= 0) {
      const oq = [...this.originalQueue];
      oq.splice(oqIdx, 1);
      this.originalQueue = oq;
    }

    if (index < this.currentIndex) {
      this.currentIndex -= 1;
    } else if (index === this.currentIndex) {
      if (this.queue.length === 0) {
        this.currentIndex = -1;
        this.stopPlayback();
      } else {
        // Clamp al rango [0, length-1] y reproduce el track que ahora ocupa el slot.
        this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
        this.playCurrentSong();
      }
    }

    this.persistState();
  }

  /** Reordenar drag-and-drop. `from` son los offsets a mover (al estilo
      SwiftUI IndexSet); `to` es el destino. */
  move(from: number[], to: number[] | number): void {
    if (from.length === 0 || this.queue.length === 0) return;

    // Validamos primero — todo o nada.
    const sortedFrom = [...from].sort((a, b) => a - b);
    if (sortedFrom.some((i) => i < 0 || i >= this.queue.length)) return;
    const target = typeof to === 'number' ? to : (to[0] ?? this.queue.length);
    if (target < 0 || target > this.queue.length) return;

    // Swift-style: extract elementos manteniendo orden, insert at target ajustado.
    const items = sortedFrom.map((i) => this.queue[i]).filter((v): v is PersistableSong => !!v);
    const q = this.queue.filter((_, i) => !sortedFrom.includes(i));
    const adjustedTarget = sortedFrom.filter((i) => i < target).length;
    q.splice(target - adjustedTarget, 0, ...items);
    this.queue = q;

    // Tracking del currentIndex — primer source offset relativo al actual.
    // SwiftUI comparte la misma heurística simplificada.
    const firstSource = sortedFrom[0];
    if (firstSource === undefined) return;
    if (firstSource === this.currentIndex) {
      // Movimos el actual.
      const movedTarget = Math.max(0, target - (target > firstSource ? 1 : 0));
      this.currentIndex = movedTarget;
    } else if (firstSource < this.currentIndex && target > this.currentIndex) {
      this.currentIndex -= 1;
    } else if (firstSource > this.currentIndex && target <= this.currentIndex) {
      this.currentIndex += 1;
    }

    this.persistState();
  }

  /** Drop everything past currentIndex. Cancela crossfade (Phase 2). */
  clearUpcoming(): void {
    if (this.currentIndex < 0) return;
    this.queue = this.queue.slice(0, this.currentIndex + 1);
    // originalQueue se sincroniza por ids — quitamos los que ya no están en queue.
    const keptIds = new Set(this.queue.map((s) => s.id));
    this.originalQueue = this.originalQueue.filter((s) => keptIds.has(s.id));
    this.persistState();
  }

  /** Stop total + wipe. NO toca history. */
  clear(): void {
    this.stopPlayback();
    this.queue = [];
    this.originalQueue = [];
    this.currentIndex = -1;
    this.pendingResumePosition = 0;
    void clearSnapshot();
  }

  toggleShuffle(): void {
    this.shuffleMode = !this.shuffleMode;
    if (this.shuffleMode) {
      this.applyShuffle(true);
    } else {
      this.unshuffle();
    }
    this.persistState();
  }

  cycleRepeatMode(): void {
    const next: Record<RepeatMode, RepeatMode> = {
      off: 'all',
      all: 'one',
      one: 'off'
    };
    this.repeatMode = next[this.repeatMode];
    this.persistState();
  }

  /** Seek absoluto. Delega al engine via player. */
  seekTo(timeSec: number): void {
    if (!browser) return;
    const dur = player.currentSong?.durationSec ?? 0;
    if (dur > 0) {
      const normalized = Math.max(0, Math.min(1, timeSec / dur));
      player.seek(normalized);
    }
    // Phase 2: prepareNextForCrossfade tras seek.
  }

  /** Flushea posición a Dexie sin debounce (típicamente onbeforeunload). */
  savePositionNow(): void {
    if (!browser) return;
    this.lastLocalPositionSave = Date.now();
    // Forzamos un persist sincrónico (saveSnapshot es async, pero lanzamos
    // inmediatamente sin esperar el debounce).
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    void saveSnapshot(this.snapshot());
    void this.saveToBackend();
  }

  /** Cold start: si no hay queue local, pedirle al backend la última playback. */
  async restoreLastPlayback(): Promise<void> {
    // TODO Phase 2: integrar con BackendService.getLastPlayback cuando exponga el endpoint.
    // iOS: BackendService.shared.getLastPlayback(username) → { queue, currentIndex, position }.
    return;
  }

  /** Connect remote control inbound — reemplaza queue sin auto-play. */
  loadRemoteQueue(songs: NavidromeSong[], currentIndex: number, position: number): void {
    if (songs.length === 0) {
      this.clear();
      return;
    }
    const persistable = songs.map(navidromeSongToPersistable);
    this.queue = persistable;
    this.originalQueue = [...persistable];
    this.currentIndex = Math.max(0, Math.min(currentIndex, persistable.length - 1));
    this.pendingResumePosition = position;
    this.suppressLoadOnce = true;
    this.syncNowPlayingState();
    this.persistState();
  }

  // ==========================================================================
  // Engine inbound callbacks — invocados desde player/AudioEngine
  // ==========================================================================

  /** El engine reportó progreso. Throttle de save de posición a 15s. */
  onProgressUpdate(_currentTime: number, _duration: number): void {
    const now = Date.now();
    if (now - this.lastLocalPositionSave >= POSITION_SAVE_THROTTLE_MS) {
      this.lastLocalPositionSave = now;
      this.persistState();
    }
    // TODO Phase 2: ScrobbleService.progressUpdate(songId, currentTime, duration)
    // TODO Phase 2: prepareNextForCrossfade (DJMixingService)
    // TODO Phase 2: ConnectService.broadcastStateIfNeeded(false)
  }

  onPlaybackStateChanged(_isPlaying: boolean, _currentTime: number): void {
    // El player store ya espeja `isPlaying`; este hook queda para Connect/Scrobble.
    // TODO Phase 2: ConnectService.broadcastStateIfNeeded(true)
  }

  /** El engine terminó el track actual (evento 'ended'). Equivale a next(). */
  onSongFinished(): void {
    this.next();
  }

  onSeek(_to: number): void {
    // TODO Phase 2: prepareNextForCrossfade tras seek (recomputa trigger time).
  }

  onError(): void {
    // TODO Phase 2: si offline + uncached, advanceToNextCachedSong.
    // Phase 1: avanzamos uno y dejamos que el siguiente intente.
    this.next();
  }

  /** Lock-screen / media keys "next" — bumpa index sin engine.
      En web esto no aplica (Media Session API no llama esto), pero lo dejamos
      por paridad con la API iOS. */
  onNativeNext(): void {
    if (this.currentIndex + 1 < this.queue.length) {
      this.currentIndex += 1;
      this.persistState();
    }
  }

  /** Engine pidió un reload (cold-start). Capturamos posición y re-load. */
  onNeedsReload(): void {
    this.pendingResumePosition = player.positionSec;
    this.playCurrentSong();
  }

  onCrossfadeStarted(): void {
    // TODO Phase 2: bump generation, marcar isCrossfading interno.
  }

  onCrossfadeCompleted(_startOffset: number): void {
    // TODO Phase 2: bump generation, advance index, push to history,
    // ScrobbleService.songDidStart, OfflineStorageManager.markPlayed,
    // prepareNextForCrossfade.
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private applyShuffle(pinCurrentIndex: boolean): void {
    if (this.queue.length <= 1) return;
    const current = pinCurrentIndex ? this.currentSong : null;
    const shuffled = [...this.queue];
    fisherYates(shuffled);

    if (current) {
      const idxInShuffled = shuffled.findIndex((s) => s.id === current.id);
      if (idxInShuffled >= 0 && idxInShuffled !== this.currentIndex) {
        const tmp = shuffled[this.currentIndex];
        const cur = shuffled[idxInShuffled];
        if (tmp !== undefined && cur !== undefined) {
          shuffled[this.currentIndex] = cur;
          shuffled[idxInShuffled] = tmp;
        }
      }
    }

    this.queue = shuffled;
  }

  private unshuffle(): void {
    if (this.originalQueue.length === 0) return;
    const cur = this.currentSong;
    this.queue = [...this.originalQueue];
    if (cur) {
      const idx = this.originalQueue.findIndex((s) => s.id === cur.id);
      this.currentIndex = idx >= 0 ? idx : 0;
    } else {
      this.currentIndex = 0;
    }
  }

  private pushToHistory(song: PersistableSong): void {
    const next = [...this.history, song];
    if (next.length > HISTORY_LIMIT) next.shift();
    this.history = next;
  }

  /** Carga la canción actual al engine y la pone a sonar. Consume
      pendingResumePosition si hay. */
  private playCurrentSong(): void {
    const cur = this.currentSong;
    if (!cur) return;
    this.syncNowPlayingState();

    if (this.suppressLoadOnce) {
      this.suppressLoadOnce = false;
      return;
    }

    const ctx = player.context;
    const startAt = this.pendingResumePosition;
    this.pendingResumePosition = 0;

    // El player.load() actual no acepta startAt — lo aplicamos via seek post-play.
    // Limpia esto cuando AudioEngine exponga loadAtPosition.
    player.load(persistableToPlayerSong(cur), ctx, {
      playbackMode: this.playbackMode,
      contextUri: this.contextUri
    });
    if (startAt > 0 && cur.duration > 0 && startAt < cur.duration - 5) {
      // Espera mínima para que el media element tenga metadata; el seek de
      // AudioEngine es tolerante a llamadas pre-metadata pero queremos asegurar
      // que el progreso reportado sea correcto.
      queueMicrotask(() => this.seekTo(startAt));
    }

    // TODO Phase 2: ScrobbleService.songDidStart(song)
    // TODO Phase 2: OfflineStorageManager.markPlayed(songId)
  }

  private stopPlayback(): void {
    if (browser) {
      player.pause();
    }
  }

  /** Mantiene el `player` store en sync con la canción actual de la queue.
      Mirrors NowPlayingState.shared en iOS. */
  private syncNowPlayingState(): void {
    // El player.load() lo sincroniza al disparar playback. Acá sería para
    // estados sin reproducir (loadRemoteQueue). Phase 1: solo updateamos la
    // metadata visible si hay currentSong y player aún no la tiene cargada.
    const cur = this.currentSong;
    if (!cur) return;
    if (player.currentSong?.id !== cur.id) {
      // Solo metadata, sin engine load (suppressLoadOnce ya marcó el flow).
      // En Phase 1 esto se cubre completamente con player.load() en playCurrentSong.
      // Dejamos noop acá.
    }
  }

  // ---------- persistencia ----------

  private snapshot() {
    // `this.queue` es `$state<PersistableSong[]>` → un Proxy de Svelte 5.
    // IndexedDB usa structured clone, que NO sabe clonar Proxies → tira
    // `DataCloneError: [object Array] could not be cloned`. La API
    // idiomática para des-proxyar es `$state.snapshot()` (deep clone con
    // los $state quitados). Aplicamos también a `originalQueue` por
    // seguridad — aunque arranca como array plano, en algún flow podría
    // ensuciarse con references reactivas.
    return {
      queue: $state.snapshot(this.queue),
      originalQueue: $state.snapshot(this.originalQueue),
      currentIndex: this.currentIndex,
      position: browser ? player.positionSec : 0,
      shuffleMode: this.shuffleMode,
      repeatMode: this.repeatMode
    };
  }

  /** Schedule un write a Dexie tras 250ms de quietud. Cancela el anterior. */
  private persistState(): void {
    if (!browser) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void saveSnapshot(this.snapshot());
      void this.saveToBackend();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Stub — backend persistence (debounced 2s en iOS). */
  private async saveToBackend(): Promise<void> {
    // TODO Phase 2: integrar con BackendService.saveLastPlayback(username, state).
    // iOS skip cuando Connect está conectado — replicar.
    return;
  }

  /** Cold start: lee Dexie y rehidrata estado. NO auto-play (iOS tampoco). */
  private async restoreState(): Promise<void> {
    if (this.restored) return;
    this.restored = true;

    const snap = await loadSnapshot();
    if (!snap) return;

    this.queue = snap.queue;
    this.originalQueue =
      snap.originalQueue.length > 0 ? snap.originalQueue : [...snap.queue];
    this.currentIndex =
      snap.queue.length === 0
        ? -1
        : Math.max(0, Math.min(snap.currentIndex, snap.queue.length - 1));
    this.shuffleMode = snap.shuffleMode;
    this.repeatMode = snap.repeatMode;
    this.pendingResumePosition = snap.position;

    // No re-disparamos load — iOS tampoco lo hace. La UI ya verá la queue
    // restaurada; el primer click del usuario en play hará playCurrentSong.
  }
}

export const queueManager = new QueueManager();
