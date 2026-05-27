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
import { getCoverArtUrl, songReplayGainMultiplier } from '$services/NavidromeService';
import { credentials } from '$stores/credentials.svelte';
import {
  getLastPlayback,
  saveLastPlayback,
  saveLastPlaybackBeacon,
  type LastPlaybackPayload
} from '$services/lastPlayback';
import type { LastPlaybackQueueItem } from '$types/backend';

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
/** Backend save tiene su propio debounce más largo: la red pesa más que disco
    y el contenido cambia con poca granularidad (canción + índice + posición
    cada 10s+). Mirror del iOS `saveToBackend` debounce. */
const BACKEND_SAVE_DEBOUNCE_MS = 2000;

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
    // Computado real desde los tags Subsonic (track preferido, album fallback,
    // -8 dB default, cap por peak). Mirror NavidromeModels.swift:58-62.
    replayGainMultiplier: songReplayGainMultiplier(s),
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
    // SongListItem no carga tags ReplayGain (vienen del shape Subsonic
    // crudo, no de este DTO). Usamos el helper con objeto vacío → cae al
    // default -8 dB, coherente con iOS NavidromeModels.swift:58-62 cuando
    // un track no expone tags RG.
    replayGainMultiplier: songReplayGainMultiplier({}),
    ...(item.explicit ? { explicitStatus: 'explicit' as const } : {})
  };
}

function persistableToPlayerSong(s: PersistableSong): {
  id: string;
  title: string;
  artist: string;
  artistId?: string | undefined;
  album?: string | undefined;
  coverUrl?: string | undefined;
  durationSec?: number | undefined;
  explicit?: boolean | undefined;
  replayGainLinear?: number | undefined;
} {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist,
    ...(s.artistId !== undefined ? { artistId: s.artistId } : {}),
    ...(s.album !== undefined ? { album: s.album } : {}),
    ...(s.coverArt ? { coverUrl: getCoverArtUrl(s.coverArt, 300) } : {}),
    durationSec: s.duration > 0 ? s.duration : undefined,
    explicit: s.explicitStatus === 'explicit',
    // El multiplier ya incluye cap por peak (computado en
    // navidromeSongToPersistable mediante computeReplayGainMultiplier).
    // Siempre lo propagamos; el setting `useReplayGain` decide en el player
    // si aplicarlo o sustituirlo por 1.0 (neutral).
    replayGainLinear: s.replayGainMultiplier
  };
}

/** Mapea el `contextUri` del lastPlayback a un `PlaybackContext` reactivo
    cuando el scheme es uno de los reconocidos (album/playlist/artist).
    Retorna null para `smartmix:` u otros — no son contextos navegables y
    el contextUri original sigue accesible via `player.contextUri`. */
function parseContextUri(uri: string | null): PlaybackContext {
  if (!uri) return null;
  const idx = uri.indexOf(':');
  if (idx <= 0) return null;
  const scheme = uri.slice(0, idx);
  const id = uri.slice(idx + 1);
  if (!id) return null;
  if (scheme === 'album' || scheme === 'playlist' || scheme === 'artist') {
    return { type: scheme, id };
  }
  return null;
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
  /** Timer del save backend (debounce 2s). Cancelable cuando llega un cambio
      antes de que dispare. Mirror del iOS `saveToBackendWork`. */
  private backendSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Crossfade DJ preparado: análisis A+B fetched, CrossfadeResult listo
      para disparar al alcanzar el trigger time. Sólo se popula cuando
      `playbackMode === 'dj'` (mirror iOS: el algoritmo DJ solo se
      invoca via SmartMix). `nextSongId` se compara contra el index
      actual al disparar — si el queue cambió, se descarta. */
  private preparedCrossfade:
    | { config: import('$lib/audio/dj-types').CrossfadeResult; nextSongId: string }
    | undefined = undefined;
  /** True mientras el crossfade DJ está ejecutándose -- desde el trigger
      (t >= duration - totalTime) hasta `onCrossfadeCompleted`. Doble función:
      evita doble-disparo desde `onPlaybackProgress` ticks consecutivos, y
      es la fuente de verdad para que el MiniPlayer muestre "AutoMix" SOLO
      dentro del marco del crossfade (no durante toda la sesión SmartMix).
      Reactivo via `$state` para que el layout reaccione al cambio. */
  djCrossfadeFiring = $state(false);
  /** True cuando la fetch de análisis para el siguiente trío está en
      flight. Evita reentry en `prepareCrossfadeIfDJ()`. */
  private djPreparing = false;
  /** Si true, los próximos save al backend se suprimen — usado durante el
      restore para evitar el loop "lo que acabamos de leer del backend lo
      volvemos a escribir". El flag se limpia tras el primer save real
      iniciado por el usuario. */
  private suppressBackendSaveOnce = false;

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
   *
   * Routing remote-aware: si estamos viendo un device remoto (`player.isRemote`)
   * cuando el usuario pulsa play, mandamos la nueva cola al device origen vía
   * `playPlaylist` remote_command — el receiver recoge la cola, reproduce el
   * track elegido y nos lo retransmite por broadcast. Sin esto, el play del
   * SongList rompía el modo remoto silenciosamente (audio local + sin update
   * en el otro device).
   *
   * Caso casteando (activeDeviceId set, !isRemote): no rutea aquí — el
   * `broadcastPlaybackState` ya replica el cambio de cola al receiver.
   */
  play(
    songs: NavidromeSong[],
    startIndex = 0,
    options: { playbackMode?: 'normal' | 'dj'; contextUri?: string | null } = {}
  ): void {
    if (songs.length === 0) return;
    const persistable = songs.map(navidromeSongToPersistable);

    // Fast path: caso 100% local (cero overhead de microtask).
    if (!player.isRemote) {
      this.playPersistable(persistable, startIndex, options);
      return;
    }

    // Viendo remoto: mandar la nueva cola al device origen vía playPlaylist.
    // Reflejamos también la cola localmente para que MiniPlayer/QueuePanel
    // muestren lo que está sonando — el playback_state_update echo terminará
    // de sincronizar (positionSec, isPlaying).
    const target = startIndex >= 0 && startIndex < persistable.length
      ? persistable[startIndex]
      : persistable[0];
    if (!target) return;

    this.queue = [...persistable];
    this.originalQueue = [...persistable];
    this.currentIndex = startIndex;
    this.playbackMode = options.playbackMode ?? 'normal';
    this.contextUri = options.contextUri ?? null;
    this.persistState();

    // Optimismo UI: reflejar la canción en el player store para que el
    // MiniPlayer cambie al instante (el cover blur in/out ahora dispara).
    player.currentSong = {
      id: target.id,
      title: target.title,
      artist: target.artist,
      ...(target.album !== undefined && { album: target.album }),
      ...(target.coverArt && { coverUrl: getCoverArtUrl(target.coverArt, 300) }),
      durationSec: target.duration,
      explicit: target.explicitStatus === 'explicit'
    };

    void import('$services/ConnectService.svelte').then(({ connectService }) => {
      const remoteSongs = persistable.map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album ?? '',
        ...(s.albumId ? { albumId: s.albumId } : {}),
        coverArt: s.coverArt ?? '',
        duration: s.duration ?? 0
      }));
      // Sin targetDeviceId → broadcast a todos los devices del usuario;
      // el handler del device origen ejecuta `playPlaylist` y el resto
      // (incluido nosotros como controller) lo ignora gracias al filtro
      // `if (player.isRemote) return` del handleRemoteCommand.
      connectService.sendRemotePlaylist(remoteSongs, startIndex);
    });
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
    // CRÍTICO: limpia los flags pendientes del restore (lastPlayback /
    // Dexie) ANTES de cualquier setup. Sin esto, si hay un restore activo
    // (suppressLoadOnce=true, pendingResumePosition>0), iniciar una nueva
    // queue (Reproducir / Shuffle / SmartMix) hace que `playCurrentSong`
    // skip el load por el suppress y/o seek la nueva canción a la
    // posición de la canción restored. Bug clásico de iOS — aquí lo
    // prevenimos en origen.
    this.clearRestoreState();
    const idx = Math.max(0, Math.min(startIndex, songs.length - 1));
    this.queue = [...songs];
    this.originalQueue = [...songs];
    this.currentIndex = idx;
    this.playbackMode = options.playbackMode ?? 'normal';
    this.contextUri = options.contextUri ?? null;
    if (this.playbackMode === 'dj') {
      console.info('[DJ] queue armed — mode=dj contextUri=%s tracks=%d', this.contextUri, songs.length);
    }

    if (this.shuffleMode) this.applyShuffle(true);

    this.persistState();
    this.playCurrentSong();
  }

  /**
   * Limpia los flags pendientes de un restore previo (lastPlayback /
   * Dexie cold-start). Se llama al inicio de cada acción user-initiated
   * que CAMBIA el contexto de reproducción (nueva queue, skip, jumpTo,
   * insertNext sobre queue vacía). Tras el clear:
   *   - `suppressLoadOnce` y `suppressBackendSaveOnce` quedan limpios:
   *     `playCurrentSong` cargará el audio normalmente.
   *   - `pendingResumePosition = 0`: la nueva canción arranca desde el
   *     principio, no desde la posición de la canción restored.
   *
   * NO se llama desde `next()` (engine fired): el primer track del
   * restore ya tuvo que cargarse via `play()` para llegar a `ended`,
   * lo que ya consumió los flags.
   */
  private clearRestoreState(): void {
    this.suppressLoadOnce = false;
    this.suppressBackendSaveOnce = false;
    this.pendingResumePosition = 0;
    this.resetDjCrossfadePrep();
  }

  /** Cancela el crossfade DJ preparado / en curso. Llamar en skips
      manuales para evitar disparar un fade contra un track que ya
      cambió. NO cancela el `<audio>` element B en flight — el siguiente
      `player.load()` lo pisa. */
  private resetDjCrossfadePrep(): void {
    this.preparedCrossfade = undefined;
    this.djCrossfadeFiring = false;
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

    this.clearRestoreState();
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

    this.clearRestoreState();
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

    this.clearRestoreState();
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
    if (this.queue.length === 1) {
      this.clearRestoreState();
      this.playCurrentSong();
    }
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
    if (this.queue.length === songs.length) {
      this.clearRestoreState();
      this.playCurrentSong();
    }
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
    if (this.queue.length === 1) {
      this.clearRestoreState();
      this.playCurrentSong();
    }
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
    // Si se hace clear() mid-crossfade DJ, el flag de "fade en curso" quedaría
    // colgado hasta el proximo onCrossfadeCompleted -- que ya no llegara porque
    // borramos la queue. Sin esto, el indicador "AutoMix" del MiniPlayer
    // seguiria visible tras un wipe durante el fade.
    this.resetDjCrossfadePrep();
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

  /** Seek absoluto. Delega al engine via player. El guard contra seek
      durante crossfade vive en `player.seek` y `audioEngine.seek` (defensa
      en profundidad) -- aqui solo normalizamos. */
  seekTo(timeSec: number): void {
    if (!browser) return;
    const dur = player.currentSong?.durationSec ?? 0;
    if (dur > 0) {
      const normalized = Math.max(0, Math.min(1, timeSec / dur));
      player.seek(normalized);
    }
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

  /**
   * Cold start: si no hay queue local, pide al backend la última playback
   * y la rehidrata. NO autoplay (iOS tampoco). Mirror exacto del Swift
   * `QueueManager.restoreLastPlayback()` (line 1661+).
   *
   * Llamada idempotente:
   *   - Si ya hay queue local → no-op (no pisamos lo que el user tenía).
   *   - Si no hay credenciales → no-op (cold-start pre-login).
   *   - Si el backend devuelve null → no-op silencioso (cuenta nueva).
   *
   * Aplica las mismas invariantes iOS para `playbackMode='dj'`:
   *   - solo se respeta si `contextUri` empieza por `smartmix:` (cualquier
   *     otra cosa es payload corrupto y caemos a `normal`).
   *   - mensaje en consola si las invariantes fallan, igual que el Swift.
   */
  async restoreLastPlayback(): Promise<void> {
    if (!browser) return;
    if (this.queue.length > 0) return;
    const username = credentials.current?.username;
    if (!username) return;

    const last = await getLastPlayback(username);
    if (!last) return;

    let restored: PersistableSong[];
    let nextIndex: number;

    if (last.queue && last.queue.length > 0) {
      restored = last.queue.map((item) => ({
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album,
        albumId: item.albumId ?? '',
        // Restauramos artistId persistido — antes se hardcodeaba '' (legacy
        // iOS), lo que rompía el link al artista del MiniPlayer tras restore.
        artistId: item.artistId ?? '',
        coverArt: item.coverArt ?? '',
        duration: item.duration,
        replayGainMultiplier: 1.0
      }));
      const explicitIdx =
        typeof last.currentIndex === 'number' && last.currentIndex >= 0
          ? last.currentIndex
          : -1;
      nextIndex =
        explicitIdx >= 0
          ? Math.min(explicitIdx, restored.length - 1)
          : Math.max(
              0,
              restored.findIndex((s) => s.id === last.songId)
            );
    } else {
      // Solo single song persistida — typical después del primer scrobble.
      restored = [
        {
          id: last.songId,
          title: last.title,
          artist: last.artist,
          album: last.album,
          albumId: last.albumId ?? '',
          artistId: last.artistId ?? '',
          coverArt: last.coverArt ?? '',
          duration: last.duration,
          replayGainMultiplier: 1.0
        }
      ];
      nextIndex = 0;
    }

    this.queue = restored;
    this.originalQueue = [...restored];
    this.currentIndex = Math.max(0, Math.min(nextIndex, restored.length - 1));
    this.pendingResumePosition = last.position;

    // Restore mode + contextUri con invariantes (mirror Swift line 1703-1721).
    const restoredContextUri = last.contextUri ?? '';
    const restoredMode: 'normal' | 'dj' =
      last.playbackMode === 'dj' ? 'dj' : 'normal';
    if (restoredMode === 'dj' && restoredContextUri.startsWith('smartmix:')) {
      this.playbackMode = 'dj';
    } else {
      if (restoredMode === 'dj') {
        console.warn(
          '[QueueManager] backend-restore `.dj` invariants failed — falling back to .normal'
        );
      }
      this.playbackMode = 'normal';
    }
    this.contextUri = restoredContextUri.length > 0 ? restoredContextUri : null;

    // Sync UI sin disparar load (NO autoplay). El user pulsa play y
    // playCurrentSong() consume `pendingResumePosition` para hacer seek.
    this.suppressLoadOnce = true;
    this.suppressBackendSaveOnce = true;
    this.syncNowPlayingState();
    // Persistencia local del nuevo estado restaurado, sin re-saves backend.
    void saveSnapshot(this.snapshot());
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
    // ConnectService aplica su propio throttle 1Hz internamente — aquí
    // pasamos el evento sin filtrar; es el servicio quien decide si emitir.
    void import('$services/ConnectService.svelte').then(({ connectService }) => {
      connectService.broadcastStateIfNeeded(false);
    });
    // ScrobbleService espera al threshold (50% duration o 4min wall-clock).
    const cur = this.currentSong;
    if (cur) {
      void import('$services/ScrobbleService.svelte').then(
        ({ scrobbleService }) => {
          scrobbleService.progressUpdate(cur.id, _currentTime, _duration);
        }
      );
    }
    // ── DJ mode crossfade preparation + trigger ──
    // Mirror iOS: el algoritmo DJ solo se invoca cuando playbackMode==='dj'
    // (activado via SmartMix button). En modo normal, el engine deja que
    // la pista termine y `onSongFinished` → `next()` hace el avance simple.
    if (this.playbackMode === 'dj' && _duration > 0) {
      // Prepara con generoso lead (35 s antes del final) para que la
      // fetch de análisis backend de A y B termine antes del trigger.
      const PREPARE_LEAD = 35;
      const remaining = _duration - _currentTime;
      if (
        !this.djPreparing &&
        this.preparedCrossfade === undefined &&
        remaining > 0 &&
        remaining <= PREPARE_LEAD
      ) {
        console.info('[DJ] prepare window — remaining=%ss duration=%ss', remaining.toFixed(1), _duration.toFixed(1));
        void this.prepareCrossfadeIfDJ(_duration);
      }
      // Trigger cuando estamos dentro de `totalTime` del final. Doble
      // guard contra disparos repetidos.
      if (
        !this.djCrossfadeFiring &&
        this.preparedCrossfade !== undefined &&
        remaining > 0 &&
        remaining <= this.preparedCrossfade.config.totalTime
      ) {
        console.info('[DJ] trigger — remaining=%ss totalTime=%ss', remaining.toFixed(2), this.preparedCrossfade.config.totalTime.toFixed(2));
        void this.triggerDjCrossfade();
      }
    }
  }

  /**
   * Pre-fetch análisis A + B del backend, mapea a `SongAnalysis`,
   * llama `calculateCrossfadeConfig` con `mode: 'dj'` y deja todo listo
   * para el trigger en `onPlaybackProgress`. Idempotente vía
   * `djPreparing` lock.
   *
   * No-op si:
   *   - No hay próxima canción en la queue (último track).
   *   - No hay credenciales (no podemos stream-fetch).
   *   - La fetch de análisis falla — caemos al avance natural.
   */
  private async prepareCrossfadeIfDJ(durationA: number): Promise<void> {
    if (this.djPreparing) return;
    const current = this.currentSong;
    const nextIdx = this.peekNextIndex();
    if (current === null || nextIdx === null) {
      console.info('[DJ] prep skip — no current or no next (last track / queue empty)');
      return;
    }
    const next = this.queue[nextIdx];
    if (next === undefined) return;
    this.djPreparing = true;
    console.info('[DJ] prep start — A=%s B=%s', current.id, next.id);
    try {
      const [{ analyzeSong }, { getStreamUrl }, { analysisResultToSongAnalysis }, { calculateCrossfadeConfig }] =
        await Promise.all([
          import('$services/AnalysisService'),
          import('$services/NavidromeService'),
          import('$lib/audio/analysis-mapper'),
          import('$lib/audio/DJMixingService')
        ]);
      const streamA = getStreamUrl(current.id);
      const streamB = getStreamUrl(next.id);
      if (!streamA || !streamB) {
        console.warn('[DJ] prep abort — streamA=%s streamB=%s', !!streamA, !!streamB);
        return;
      }
      const [analysisA, analysisB] = await Promise.all([
        analyzeSong({ songId: current.id, streamUrl: streamA, duration: durationA }),
        analyzeSong({ songId: next.id, streamUrl: streamB, duration: next.duration })
      ]);
      const songA = analysisResultToSongAnalysis(analysisA, durationA);
      const songB = analysisResultToSongAnalysis(analysisB, next.duration);
      const config = calculateCrossfadeConfig({
        currentAnalysis: songA,
        nextAnalysis: songB,
        bufferADuration: durationA,
        bufferBDuration: next.duration,
        mode: 'dj'
      });
      // Pre-cargar B en el AudioEngine (cuando el trigger dispare,
      // `runCrossfadeConfig` programa B con `currentTime=startOffset`).
      const { audioEngine } = await import('$lib/audio/AudioEngine.svelte');
      audioEngine.prepareNext(streamB, {
        ...(next.replayGainMultiplier !== undefined && {
          replayGainLinear: next.replayGainMultiplier
        })
      });
      this.preparedCrossfade = { config, nextSongId: next.id };
      console.info('[DJ] prep ready — type=%s fadeDur=%ss totalTime=%ss entry=%ss',
        config.transitionType, config.fadeDuration.toFixed(2),
        config.totalTime.toFixed(2), config.entryPoint.toFixed(2));
    } catch (err) {
      console.warn('[DJ] prep failed — fallback al avance natural', err);
    } finally {
      this.djPreparing = false;
    }
  }

  /** Lanza `runCrossfadeConfig` con la config preparada. Marca
      `djCrossfadeFiring` para que `onCrossfadeCompleted` reaccione. */
  private async triggerDjCrossfade(): Promise<void> {
    if (this.djCrossfadeFiring) return;
    const prepared = this.preparedCrossfade;
    if (prepared === undefined) return;
    // Si la cola cambió entre prepare y trigger (skip manual del user),
    // el `nextSongId` ya no es válido — descartamos.
    const nextIdx = this.peekNextIndex();
    if (nextIdx === null || this.queue[nextIdx]?.id !== prepared.nextSongId) {
      this.preparedCrossfade = undefined;
      return;
    }
    this.djCrossfadeFiring = true;
    try {
      const { audioEngine } = await import('$lib/audio/AudioEngine.svelte');
      await audioEngine.runCrossfadeConfig(prepared.config);
      // `onCrossfadeCompleted` ya hizo el avance de index — el engine
      // dispara via el evento 'crossfadeend' que el player propaga.
    } catch (err) {
      console.error('[QueueManager] runCrossfadeConfig failed', err);
      this.djCrossfadeFiring = false;
      this.preparedCrossfade = undefined;
    }
  }

  /** Devuelve el index del siguiente track tras `currentIndex` respetando
      shuffle + repeat. `null` cuando no hay siguiente (último track sin
      repeat). Helper para `prepareCrossfadeIfDJ` que necesita conocer
      la siguiente sin avanzar el index. */
  private peekNextIndex(): number | null {
    if (this.queue.length === 0) return null;
    if (this.currentIndex + 1 < this.queue.length) return this.currentIndex + 1;
    if (this.repeatMode === 'all') return 0;
    return null;
  }

  onPlaybackStateChanged(_isPlaying: boolean, _currentTime: number): void {
    // El player store ya espeja `isPlaying`; aquí broadcastemos al hub.
    void import('$services/ConnectService.svelte').then(({ connectService }) => {
      connectService.broadcastStateIfNeeded(true);
    });
  }

  /** El engine terminó el track actual (evento 'ended'). Equivale a next(). */
  onSongFinished(): void {
    this.next();
  }

  onSeek(_to: number): void {
    // Guards DJ tras seek -- ver `seekTo` para el bloqueo durante fade
    // activo. Aqui, en flow normal (no firing):
    //  - `preparedCrossfade` se MANTIENE: el config DJ no depende del
    //    currentTime de A. Solo usa `bufferADuration` (duracion total),
    //    el analisis estructural de A, y B's analysis + entryPoint. Un
    //    seek HACIA ATRAS lejos del outro mantiene el prep listo para
    //    cuando vuelvas a la zona de trigger. Seek HACIA ADELANTE entra
    //    en la ventana de prepare o trigger -- el siguiente
    //    onProgressUpdate dispara naturalmente.
    //  - `prepareNext` (chain B cargado en el AudioEngine) tambien se
    //    mantiene: misma URL, mismo startOffset.
    //  - Edge case asumido: seek a remaining < totalTime sin preparedCrossfade
    //    listo => prep async no llega a tiempo, se pierde el fade DJ y
    //    onSongFinished hace next() normal. iOS cubre esto con analisis
    //    pre-cargado al cargar la queue; web acepta el degradacion.
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
    // Nothing to bump on web — el AudioEngine ya marca isCrossfading.
  }

  /**
   * El AudioEngine completó el crossfade DJ — el chain B es ahora el A
   * activo. Tenemos que avanzar el index del queue manager para que
   * coincida con lo que el listener ya está oyendo.
   *
   * `_startOffset` es la `currentTime` del nuevo A justo después del
   * swap (= entryPoint del CrossfadeResult original). El player store
   * ya lo refleja vía el evento del AudioEngine.
   */
  onCrossfadeCompleted(_startOffset: number): void {
    if (!this.djCrossfadeFiring) {
      // Crossfade no-DJ (equal-power simple) — no avance automático.
      return;
    }
    const nextIdx = this.peekNextIndex();
    if (nextIdx !== null) {
      this.currentIndex = nextIdx;
      this.persistState();
      // Sincroniza el player store con la canción nueva (= chain A
      // post-swap). Optimismo UI: el MiniPlayer cambia al instante.
      const newSong = this.queue[nextIdx];
      if (newSong !== undefined) {
        player.currentSong = persistableToPlayerSong(newSong);
      }
    }
    this.djCrossfadeFiring = false;
    this.preparedCrossfade = undefined;
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

    // `startAt` se propaga al audioEngine via player.load → audioEngine.load
    // (que lo aplica como `currentTime` ANTES de marcar hasMedia + esperar
    // metadata). Sin race conditions con el seek post-load anterior, y sin
    // flicker "posición correcta → 0 → resume" en el MiniPlayer.
    //
    // Validamos `startAt < duration - 5` para no arrancar a 5s del final
    // (probable fin de canción guardado por error) — empieza desde 0.
    const safeStart =
      startAt > 0 && cur.duration > 0 && startAt < cur.duration - 5
        ? startAt
        : 0;
    player.load(persistableToPlayerSong(cur), ctx, {
      playbackMode: this.playbackMode,
      contextUri: this.contextUri,
      startAt: safeStart
    });

    // Broadcast significant change al hub Connect (mirror Swift line 199-254).
    // Lo hacemos tras `player.load` para que `player.currentSong` esté ya
    // actualizado al construir el payload.
    void import('$services/ConnectService.svelte').then(({ connectService }) => {
      connectService.broadcastStateIfNeeded(true);
    });

    // ScrobbleService.songDidStart marca la canción + manda "now playing"
    // a Navidrome. El scrobble real lo dispara progressUpdate al alcanzar
    // el threshold. NOTA anti-smartmix: si playbackMode==='dj', el
    // ScrobbleService internamente NO enviará contextUri al backend
    // (regla director 2026-05-09). El home filtra defensivo igualmente.
    void import('$services/ScrobbleService.svelte').then(
      ({ scrobbleService }) => {
        scrobbleService.songDidStart(cur);
      }
    );

    // TODO Phase 2 (DJ Mixing port): cuando `startAt` cae en la zona outro
    // de la canción (últimos N segundos definidos por outroStartTime del
    // análisis), arrancar con DOS chains activos — la canción actual desde
    // `startAt` mezclando contra la siguiente desde 0. iOS hace esto en
    // QueueManager.restoreLastPlayback cuando playbackMode='dj' y la
    // posición está en outro: el restore reanuda el mid-crossfade.
    // Hoy: el AudioEngine solo tiene chainA expuesto al exterior, sin
    // capacidad de iniciar mid-crossfade. Cuando se porte DJMixingService
    // y AudioEngine.startMidCrossfade(songA, posA, songB), este bloque
    // detecta la condición y delega.
    //
    // TODO Phase 2: ScrobbleService.songDidStart(song)
    // ⚠️ Cuando se implemente ScrobbleService: NO enviar contextUri al backend
    // si this.playbackMode === 'dj' (URI scheme `smartmix:<id>`). Si entra al
    // wrapped.db scrobbles, contamina recentContexts → home muestra cards
    // smartmix que se intentan navegar como playlist y dan 404. Decisión
    // director 2026-05-09. El home filtra defensivo igualmente.
    // TODO Phase 2: OfflineStorageManager.markPlayed(songId)
  }

  private stopPlayback(): void {
    if (browser) {
      player.pause();
    }
  }

  /** Mantiene el `player` store en sync con la canción actual de la queue.
      Mirrors NowPlayingState.shared en iOS — actualiza metadata visible
      SIN disparar audioEngine.load (eso lo hace playCurrentSong cuando el
      user pulse play). El MiniPlayer se gatea con `player.hasSong`, así
      que sin este sync el player parece "vacio" tras restoreLastPlayback
      aunque la queue interna tenga contenido.

      Llamado desde restoreLastPlayback() y loadRemoteQueue(). NO se llama
      desde playCurrentSong (allí player.load ya hace el sync completo). */
  private syncNowPlayingState(): void {
    const cur = this.currentSong;
    if (!cur) return;

    player.currentSong = persistableToPlayerSong(cur);
    // Context: solo sobrescribimos si tenemos un `contextUri` válido en el
    // queueManager. Cuando es null (la mayoría de callers actuales —
    // AlbumDetail, PlaylistDetail, ArtistDetail, *Card.handlePlay — setean
    // `player.context = {...}` directamente ANTES de queueManager.play() sin
    // pasar `options.contextUri`), preservamos ese contexto manual. Sin
    // este guard, el `parseContextUri(null) === null` los machacaba y rompía
    // el EqualizerIcon en cards / heroes que dependen de `isPlayingFrom`.
    // Migrar callers a options.contextUri es task futura — este guard
    // mantiene compat hasta entonces.
    if (this.contextUri !== null) {
      player.context = parseContextUri(this.contextUri);
    }
    player.playbackMode = this.playbackMode;
    player.contextUri = this.contextUri;
    player.isPlaying = false; // restore es siempre paused — user pulsa play

    // Slider del MiniPlayer muestra la posición restaurada hasta que el
    // engine empiece a emitir progress real (post-play).
    const pos = this.pendingResumePosition;
    player.positionSec = pos;
    const dur = cur.duration;
    player.progress = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
  }

  /**
   * Llamado por `player.play()` cuando el user pulsa play tras un restore
   * (cold-start con queue rehidratada pero audioEngine sin media cargado).
   * Limpia el suppressLoadOnce que `restoreLastPlayback` puso defensivo y
   * dispara `playCurrentSong`, que carga el audio + seek a la posición
   * pendiente + arranca playback.
   */
  resumeFromRestore(): void {
    if (this.queue.length === 0) return;
    if (this.currentIndex < 0) return;
    this.suppressLoadOnce = false;
    this.playCurrentSong();
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

  /**
   * Save throttled del lastPlayback al backend. Debounce 2s — re-llamadas
   * dentro de la ventana cancelan el anterior y reagendan.
   *
   *   - Skip si no hay credenciales (cold-start pre-login).
   *   - Skip si la queue está vacía (nada útil que guardar).
   *   - Skip si `suppressBackendSaveOnce` (evita el loop post-restore).
   *
   * Errores en `saveLastPlayback` ya están tragados al servicio (best
   * effort). Aquí no propagamos.
   */
  private saveToBackend(): void {
    if (!browser) return;
    if (this.suppressBackendSaveOnce) {
      this.suppressBackendSaveOnce = false;
      return;
    }

    const username = credentials.current?.username;
    if (!username) return;
    if (this.queue.length === 0) return;

    if (this.backendSaveTimer) clearTimeout(this.backendSaveTimer);
    this.backendSaveTimer = setTimeout(() => {
      this.backendSaveTimer = null;
      const payload = this.buildLastPlaybackPayload();
      if (!payload) return;
      void saveLastPlayback(username, payload);
    }, BACKEND_SAVE_DEBOUNCE_MS);
  }

  /** Construye el payload del PUT a partir del estado actual. Devuelve null
      si no hay current song (queue vacía / index inválido).

      Anti-smartmix (regla 2026-05-09, espejo del ScrobbleService
      `scrobbleContextUri`): si la cola activa es SmartMix
      (`playbackMode==='dj'` y/o `contextUri.startsWith('smartmix:')`), NO
      enviamos el `contextUri` ni el `playbackMode='dj'` al backend. Si lo
      hicieramos, el endpoint `/api/stats/recent-contexts` contamina el
      Jump Back In con entradas SmartMix que al hacer click rompen
      (cover de playlist + título de la canción que sonaba, vs el nombre
      de la playlist real). El SmartMix queda persistido sólo localmente
      via Dexie — para restauración cross-device cae a cola normal. */
  private buildLastPlaybackPayload(): LastPlaybackPayload | null {
    const cur = this.currentSong;
    if (!cur) return null;
    const queueItems: LastPlaybackQueueItem[] = $state
      .snapshot(this.queue)
      .map((s) => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album ?? '',
        albumId: s.albumId ?? null,
        // artistId opcional — persistido para que el MiniPlayer y otros
        // surfaces que dependen del link al artista (artist-link) sigan
        // funcionando tras un restore de lastPlayback.
        artistId: s.artistId ?? null,
        coverArt: s.coverArt ?? null,
        duration: s.duration
      }));
    const isSmartMix =
      this.playbackMode === 'dj' ||
      (this.contextUri !== null && this.contextUri.startsWith('smartmix:'));
    const payload: LastPlaybackPayload = {
      songId: cur.id,
      title: cur.title,
      artist: cur.artist,
      album: cur.album ?? '',
      albumId: cur.albumId ?? null,
      artistId: cur.artistId ?? null,
      coverArt: cur.coverArt ?? null,
      path: '',
      duration: cur.duration,
      position: browser ? player.positionSec : 0,
      queue: queueItems,
      currentIndex: this.currentIndex,
      playbackMode: isSmartMix ? 'normal' : this.playbackMode
    };
    if (!isSmartMix && this.contextUri) payload.contextUri = this.contextUri;
    return payload;
  }

  /**
   * Flush sincrono via `navigator.sendBeacon`. Único método válido en
   * `pagehide` / `beforeunload` — fetch normal se aborta. Garantiza que la
   * última posición queda persistida al cerrar pestaña.
   */
  flushBackendBeacon(): boolean {
    if (!browser) return false;
    const username = credentials.current?.username;
    if (!username) return false;
    if (this.queue.length === 0) return false;
    const payload = this.buildLastPlaybackPayload();
    if (!payload) return false;
    return saveLastPlaybackBeacon(username, payload);
  }

  /** Cold start: lee Dexie y rehidrata estado. NO auto-play (iOS tampoco).
      Si Dexie está vacío (instalación nueva o cache cleared), encadena con
      `restoreLastPlayback()` del backend para no quedar sin estado. */
  private async restoreState(): Promise<void> {
    if (this.restored) return;
    this.restored = true;

    const snap = await loadSnapshot();
    if (snap && snap.queue.length > 0) {
      this.queue = snap.queue;
      this.originalQueue =
        snap.originalQueue.length > 0 ? snap.originalQueue : [...snap.queue];
      this.currentIndex = Math.max(
        0,
        Math.min(snap.currentIndex, snap.queue.length - 1)
      );
      this.shuffleMode = snap.shuffleMode;
      this.repeatMode = snap.repeatMode;
      this.pendingResumePosition = snap.position;
      // No re-disparamos load — iOS tampoco lo hace. Pero SÍ sincronizamos
      // el `player` store con la metadata para que el MiniPlayer aparezca.
      // El primer click del usuario en play delega a `resumeFromRestore`.
      this.suppressLoadOnce = true;
      this.syncNowPlayingState();
      return;
    }

    // Dexie vacío o snapshot sin queue → fallback al backend (lastPlayback).
    // Este path cubre instalación nueva en este browser pero cuenta con
    // historial en otros devices, o cache local borrado por el usuario.
    await this.restoreLastPlayback();
  }
}

export const queueManager = new QueueManager();
