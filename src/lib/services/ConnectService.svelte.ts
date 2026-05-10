/**
 * ConnectService — port web del iOS ConnectService.swift.
 *
 * Cliente del Audiorr Hub (Socket.IO server montado en el backend Node.js).
 * Habilita control remoto cross-device: la pestaña web ve el playback de
 * iOS / otra pestaña, y a la inversa.
 *
 * Divergencia justificada vs iOS: el iOS implementa Engine.IO v4 manual
 * sobre URLSessionWebSocketTask para evitar la dependencia. En web usamos
 * `socket.io-client` oficial — autorizado por CEO en el roadmap 2026-05-10.
 * El protocolo (rooms, auth, ping/pong, reconexión) es el mismo, lo único
 * que cambia es la transporte.
 *
 * Singleton de runes — `connectService` exportado abajo. La UI consume
 * `connectedDevices`, `lanDevices`, `hubConnected`, `activeDeviceId`
 * directamente como `$state`.
 */

import { browser } from '$app/environment';
import { io, type Socket } from 'socket.io-client';

import { credentials } from '$stores/credentials.svelte';
import { backendService } from '$services/BackendService.svelte';
import { player, type Song } from '$stores/player.svelte';
import { audioEngine } from '$lib/audio/AudioEngine.svelte';
import { getCoverArtUrl } from '$services/NavidromeService';

// ============================================================================
// Types
// ============================================================================

export type ConnectDeviceType =
  | 'controller'
  | 'receiver'
  | 'hybrid'
  | 'lan_device'
  | 'local';

export type ConnectDevice = {
  id: string;
  name: string;
  type: ConnectDeviceType;
  isThisDevice?: boolean;
};

type RemoteSong = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  coverArt?: string;
  duration: number;
};

type RemotePlaybackPayload = {
  trackId?: string;
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    coverArt?: string;
    duration?: number;
  } | null;
  position?: number;
  startedAt?: number;
  playing?: boolean;
  volume?: number;
  queue?: unknown[];
  source?: string | null;
  deviceId?: string;
  contextUri?: string;
  serverTime?: number;
};

type RemoteCommandPayload = {
  action: string;
  value?: unknown;
  targetDeviceId?: string;
  serverTime?: number;
};

type LoginResponse = { token: string; username: string; expiresIn?: number };

// ============================================================================
// DeviceId — sessionStorage por pestaña (cada pestaña es un device propio).
// iOS usa `identifierForVendor` (estable por instalación). Aquí
// `localStorage` haría que dos pestañas del mismo browser sean indistinguibles
// para el hub — bug clásico del modelo "pestaña-como-sesión".
// ============================================================================

const DEVICE_ID_KEY = 'audiorr-connect-device-id';

function loadOrCreateDeviceId(): string {
  if (!browser) return 'web-ssr';
  let id = sessionStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function deriveDeviceName(): string {
  if (!browser) return 'Audiorr Web';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Audiorr Web (iOS)';
  if (/Android/i.test(ua)) return 'Audiorr Web (Android)';
  if (/Mac/i.test(ua)) return 'Audiorr Web (Mac)';
  if (/Windows/i.test(ua)) return 'Audiorr Web (PC)';
  if (/Linux/i.test(ua)) return 'Audiorr Web (Linux)';
  return 'Audiorr Web';
}

// ============================================================================
// Helpers
// ============================================================================

function buildStreamUrl(songId: string): string | null {
  const c = credentials.current;
  if (!c) return null;
  return `${c.serverUrl}/rest/stream.view?u=${encodeURIComponent(c.username)}&t=${c.token}&s=${c.salt}&v=1.16.0&c=audiorr&f=json&id=${encodeURIComponent(songId)}`;
}

function parseRemoteSongs(arr: unknown[]): RemoteSong[] {
  const out: RemoteSong[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const meta = (item.metadata && typeof item.metadata === 'object'
      ? (item.metadata as Record<string, unknown>)
      : {});
    const id =
      typeof item.id === 'string'
        ? item.id
        : typeof item.trackId === 'string'
          ? item.trackId
          : '';
    if (!id) continue;
    const pickStr = (key: string): string | undefined => {
      const m = meta[key];
      if (typeof m === 'string') return m;
      const i = item[key];
      return typeof i === 'string' ? i : undefined;
    };
    const pickNum = (key: string): number => {
      const m = meta[key];
      if (typeof m === 'number') return m;
      const i = item[key];
      return typeof i === 'number' ? i : 0;
    };
    out.push({
      id,
      title: pickStr('title') ?? '',
      artist: pickStr('artist') ?? '',
      album: pickStr('album') ?? '',
      albumId: typeof item.albumId === 'string' ? item.albumId : '',
      coverArt: pickStr('coverArt') ?? '',
      duration: pickNum('duration')
    });
  }
  return out;
}

// ============================================================================
// ConnectService
// ============================================================================

class ConnectService {
  // observable state
  connectedDevices = $state<ConnectDevice[]>([]);
  lanDevices = $state<ConnectDevice[]>([]);
  hubConnected = $state(false);
  /** id del device LAN al que estamos casteando, null = playback local. */
  activeDeviceId = $state<string | null>(null);

  readonly deviceId = loadOrCreateDeviceId();
  private readonly deviceName = deriveDeviceName();

  private socket: Socket | null = null;
  private sessionToken: string | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  /** Mapeo deviceId → friendly name desde devices_list. Lo usamos para mostrar
      "Reproduciendo en {nombre}" al recibir playback_state_update remoto. */
  private knownDevices = new Map<string, string>();
  /** Device cuyo playback estamos espejando ahora mismo. */
  private remoteSourceDeviceId: string | null = null;
  /** Watchdog 30s — si el remote no manda update, asumimos device offline. */
  private staleRemoteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Throttle del broadcast progress-only — emitimos máximo 1Hz. */
  private lastBroadcastTime = 0;
  /** Listener de cambios de red (online/offline). */
  private networkListenersBound = false;

  // ==========================================================================
  // Public API — mirror del Swift ConnectService
  // ==========================================================================

  /**
   * Conecta al hub. Llamado desde +layout.svelte cuando creds están listas.
   * Idempotente — si ya está conectado o conectando, no-op.
   *
   * Hard gate: sin credenciales Navidrome no hay nada que autenticar contra
   * el backend. Mirror Swift line 82-85.
   */
  async connect(): Promise<void> {
    if (!browser) return;
    if (this.socket?.connected) return;
    if (this.isConnecting) return;
    if (!credentials.current) return;

    this.shouldReconnect = true;
    this.bindNetworkListeners();

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      console.log('[Connect] Offline — esperando red antes de conectar');
      return;
    }

    this.isConnecting = true;
    try {
      const token = await this.authenticate();
      this.sessionToken = token;
      this.openSocket(token);
    } catch (err) {
      console.error('[Connect] Auth/connect failed:', err);
      // socket.io-client gestionará el reintento si llegamos a abrir el socket;
      // si fallamos en `authenticate`, se reintentará al próximo trigger
      // (online event, nuevo `connect()` desde +layout effect).
    } finally {
      this.isConnecting = false;
    }
  }

  /** Cierra la conexión y restaura estado local. */
  disconnect(): void {
    this.shouldReconnect = false;
    this.remoteSourceDeviceId = null;
    this.tearDown();
    if (player.isRemote) this.restoreAfterRemoteDisconnect();
  }

  /** Pide sync inicial al hub — el server responde con el último playback_state
      conocido del usuario (otro device del mismo user). */
  requestSync(): void {
    this.socket?.emit('request_sync');
  }

  /** Cast a un device LAN (Chromecast, AirPlay). El backend hace la pasarela
      vía castingService. */
  castToDevice(device: ConnectDevice): void {
    if (!this.socket?.connected) return;
    if (!player.currentSong) return;

    const url = buildStreamUrl(player.currentSong.id);
    if (!url) return;

    // Mismo criterio que `broadcastPlaybackState`: el receptor LAN espera
    // un id Subsonic, no una URL completa con nuestras credenciales.
    const metadata = {
      title: player.currentSong.title,
      artist: player.currentSong.artist,
      album: player.currentSong.album ?? '',
      coverArt: this.currentSongCoverArtId(),
      duration: player.currentSong.durationSec ?? 0
    };

    this.socket.emit('cast_to_device', {
      deviceId: device.id,
      url,
      metadata
    });
    this.activeDeviceId = device.id;
  }

  stopCasting(): void {
    if (!this.socket?.connected) return;
    this.socket.emit('cast_control', { action: 'stop' });
    this.activeDeviceId = null;
  }

  switchToLocal(): void {
    this.stopCasting();
    this.activeDeviceId = null;
    this.remoteSourceDeviceId = null;

    player.isRemote = false;
    player.remoteDeviceName = null;
    player.subtitle = null;

    // Restaurar último playback local — mismo mirror que iOS line 171.
    void this.queueManagerLazy().then((qm) => {
      void qm.restoreLastPlayback();
    });
  }

  /** Comando remoto a otro device (puede ser broadcast a todos los del user). */
  sendRemoteCommand(action: string, value?: unknown, targetDeviceId?: string): void {
    if (!this.socket?.connected) return;
    const payload: RemoteCommandPayload = { action };
    if (value !== undefined) payload.value = value;
    if (targetDeviceId) payload.targetDeviceId = targetDeviceId;
    this.socket.emit('remote_command', payload);
  }

  /** Reemplaza la cola del device remoto y arranca playback. */
  sendRemotePlaylist(songs: RemoteSong[], startIndex: number, targetDeviceId?: string): void {
    this.sendRemoteCommand(
      'playPlaylist',
      { queue: songs, startIndex },
      targetDeviceId
    );
  }

  /**
   * Broadcast del estado de playback a otros devices del user. Llamado por
   * QueueManager en cada cambio significativo (song change, play/pause) y
   * en cada progress tick (throttled a 1Hz).
   */
  broadcastPlaybackState(includeQueue: boolean = true): void {
    if (!this.socket?.connected) return;
    if (player.isRemote) return; // no echo de estado remoto
    const cur = player.currentSong;
    if (!cur) return;

    // CRITICO: el broadcast lleva el `coverArt` como id Subsonic crudo (ej.
    // "al-1234"), NO la URL completa. El receptor (iOS / otra pestaña web)
    // construye la URL con sus propias credenciales — mandar la nuestra
    // (con token+salt + dominio Navidrome) leakea auth y rompe en clientes
    // que tienen otro Navidrome configurado. `player.currentSong.coverUrl`
    // ya es la URL final, así que tomamos el id desde el QueueManager
    // (PersistableSong.coverArt). Si el módulo aún no está cargado en cache,
    // fallback a string vacío y el próximo broadcast lo tendrá.
    const coverArtId = this.currentSongCoverArtId();
    const metadata = {
      title: cur.title,
      artist: cur.artist,
      album: cur.album ?? '',
      coverArt: coverArtId,
      duration: cur.durationSec ?? 0
    };

    let queueData: unknown[] = [];
    if (includeQueue) {
      // Lazy import porque QueueManager → ConnectService → QueueManager seria
      // ciclo. La snapshot de la queue solo es necesaria en significant-change
      // broadcasts (no en cada tick), así que la latencia del import no afecta.
      queueData = this.snapshotQueueForBroadcast();
    }

    this.socket.emit('playback_state_update', {
      trackId: cur.id,
      metadata,
      position: player.positionSec,
      startedAt: Date.now(),
      playing: player.isPlaying,
      volume: player.volume,
      queue: queueData,
      deviceId: this.deviceId,
      contextUri: player.contextUri ?? ''
    });
  }

  /** Variante throttled. `significantChange=true` siempre emite; los progress
      ticks se cap a 1Hz para no saturar el socket. Mirror Swift line 281-294. */
  broadcastStateIfNeeded(significantChange: boolean = false): void {
    if (!this.socket?.connected) return;
    if (significantChange) {
      this.lastBroadcastTime = Date.now();
      this.broadcastPlaybackState(true);
      return;
    }
    const now = Date.now();
    if (now - this.lastBroadcastTime >= 1000) {
      this.lastBroadcastTime = now;
      this.broadcastPlaybackState(false);
    }
  }

  // ==========================================================================
  // Auth + WebSocket
  // ==========================================================================

  /** POST /api/auth/login → sessionToken para el handshake socket.io.
      El login en NavidromeService (commit c0e74c7) tira un POST gemelo para
      persistir creds en el backend pero no expone el token al caller — aquí
      hacemos otro request explícito que sí lo lee. */
  private async authenticate(): Promise<string> {
    const c = credentials.current;
    if (!c) throw new Error('No hay credenciales Navidrome');

    const url = `${backendService.baseUrl}/api/auth/login`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: c.serverUrl,
        username: c.username,
        token: c.token,
        salt: c.salt
      })
    });

    if (!res.ok) {
      throw new Error(`Login failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as LoginResponse;
    if (!data?.token) throw new Error('Login response missing token');
    return data.token;
  }

  private openSocket(token: string): void {
    // baseUrl puede ser cadena vacía en dev (Vite proxy). socket.io-client
    // resuelve `''` a same-origin, que es lo que queremos.
    const base = backendService.baseUrl || (browser ? window.location.origin : '');

    const socket = io(base, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      // Mirror del backoff iOS: 5s → 60s, factor 2.
      reconnectionDelay: 5000,
      reconnectionDelayMax: 60000,
      randomizationFactor: 0.5,
      autoConnect: true,
      withCredentials: false
    });

    this.socket = socket;
    this.bindSocketHandlers(socket);
  }

  private bindSocketHandlers(socket: Socket): void {
    socket.on('connect', () => {
      this.hubConnected = true;
      console.log(`[Connect] Conectado al hub (sid: ${socket.id})`);

      // 1) Registrar este device.
      socket.emit('register_device', {
        id: this.deviceId,
        name: this.deviceName,
        type: 'hybrid'
      });

      // 2) Pedir estado actual del hub.
      socket.emit('request_sync');
    });

    socket.on('connect_error', (err) => {
      console.warn('[Connect] connect_error:', err.message);
      this.hubConnected = false;
    });

    socket.on('disconnect', (reason) => {
      const wasShowingRemote = player.isRemote;
      this.hubConnected = false;
      this.remoteSourceDeviceId = null;
      this.connectedDevices = [];
      this.lanDevices = [];
      this.clearStaleRemoteTimer();

      if (wasShowingRemote) this.restoreAfterRemoteDisconnect();

      console.log(`[Connect] Desconectado: ${reason}`);
      // socket.io-client reintenta solo cuando shouldReconnect=true. Si el
      // disconnect viene de this.disconnect(), shouldReconnect=false y el
      // tearDown ya cerró el socket — no hace falta más.
    });

    // ----- Eventos del backend -----

    socket.on('devices_list', (devices: unknown) => {
      if (!Array.isArray(devices)) return;
      const parsed: ConnectDevice[] = [];
      for (const d of devices) {
        if (!d || typeof d !== 'object') continue;
        const dev = d as Record<string, unknown>;
        const id = typeof dev.id === 'string' ? dev.id : null;
        const name = typeof dev.name === 'string' ? dev.name : null;
        const typeRaw = typeof dev.type === 'string' ? dev.type : 'hybrid';
        if (!id || !name) continue;
        const type: ConnectDeviceType = (
          ['controller', 'receiver', 'hybrid', 'lan_device', 'local'] as const
        ).includes(typeRaw as ConnectDeviceType)
          ? (typeRaw as ConnectDeviceType)
          : 'hybrid';
        this.knownDevices.set(id, name);
        parsed.push({ id, name, type, isThisDevice: id === this.deviceId });
      }
      this.connectedDevices = parsed;

      // Si el device origen del remote desaparece, vuelta a local.
      if (
        this.remoteSourceDeviceId &&
        player.isRemote &&
        !parsed.some((d) => d.id === this.remoteSourceDeviceId)
      ) {
        console.log(
          `[Connect] Source device ${this.remoteSourceDeviceId} desconectado`
        );
        this.remoteSourceDeviceId = null;
        this.restoreAfterRemoteDisconnect();
      }
    });

    socket.on('lan_devices_discovered', (devices: unknown) => {
      if (!Array.isArray(devices)) return;
      const parsed: ConnectDevice[] = [];
      for (const d of devices) {
        if (!d || typeof d !== 'object') continue;
        const dev = d as Record<string, unknown>;
        if (typeof dev.id !== 'string' || typeof dev.name !== 'string') continue;
        parsed.push({ id: dev.id, name: dev.name, type: 'lan_device' });
      }
      this.lanDevices = parsed;
    });

    socket.on('playback_state_update', (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      this.handlePlaybackStateUpdate(data as RemotePlaybackPayload);
    });

    socket.on('remote_command', (data: unknown) => {
      if (!data || typeof data !== 'object') return;
      void this.handleRemoteCommand(data as RemoteCommandPayload);
    });

    socket.on('cast_session_update', () => {
      // No-op por ahora — la UI de cast vendrá con DevicePicker (#8).
    });
  }

  // ==========================================================================
  // Inbound: playback_state_update
  // ==========================================================================

  private handlePlaybackStateUpdate(dict: RemotePlaybackPayload): void {
    const remoteDeviceId = dict.deviceId ?? '';
    if (!remoteDeviceId || remoteDeviceId === this.deviceId) return;

    // Ignorar updates de devices que no están en la lista actual — defensivo
    // contra ghost devices (otra pestaña que crasheó sin disconnect limpio).
    if (!this.connectedDevices.some((d) => d.id === remoteDeviceId)) {
      return;
    }

    const trackId = dict.trackId;
    if (!trackId) {
      // El otro device paró completamente (queue vacía). Si estabamos en remote,
      // recuperamos local.
      if (player.isRemote) {
        this.remoteSourceDeviceId = null;
        this.restoreAfterRemoteDisconnect();
      }
      return;
    }

    // No pisar playback local activo. Si el user está reproduciendo aquí, el
    // remote queda en la lista pero no se proyecta al player.
    if (player.currentSong && player.isPlaying && !player.isRemote) {
      return;
    }

    const meta = dict.metadata ?? {};
    const remoteName = this.knownDevices.get(remoteDeviceId) ?? remoteDeviceId;

    // El emisor manda el coverArt como id Subsonic crudo. Lo resolvemos a
    // URL completa con NUESTRAS credenciales — Navidrome es el mismo backend
    // (LAN homelab) pero los tokens son per-user. Si nos llega ya como URL
    // (cliente legacy), la usamos tal cual.
    const coverArtRaw = meta.coverArt ?? '';
    const coverUrl = coverArtRaw
      ? coverArtRaw.includes('://')
        ? coverArtRaw
        : getCoverArtUrl(coverArtRaw, 600)
      : undefined;

    const remoteSong: Song = {
      id: trackId,
      title: meta.title ?? '',
      artist: meta.artist ?? '',
      album: meta.album ?? '',
      coverUrl,
      durationSec: meta.duration ?? 0
    };

    player.currentSong = remoteSong;
    player.positionSec = dict.position ?? 0;
    const dur = remoteSong.durationSec ?? 0;
    player.progress = dur > 0 ? Math.min(1, (dict.position ?? 0) / dur) : 0;
    player.isPlaying = !!dict.playing;
    player.contextUri = dict.contextUri ?? null;
    player.isRemote = true;
    player.remoteDeviceName = remoteName;
    player.subtitle = `Reproduciendo en ${remoteName}`;

    this.remoteSourceDeviceId = remoteDeviceId;
    this.resetStaleRemoteTimer();

    // Cargar la queue remota en QueueManager — pero solo si local no está
    // reproduciendo (mirror Swift line 597-602). Esto deja el device listo
    // para "switchToLocal" sin perder contexto.
    if (Array.isArray(dict.queue) && dict.queue.length > 0) {
      const songs = parseRemoteSongs(dict.queue);
      void this.queueManagerLazy().then((qm) => {
        // En web `isPlaying` vive en el `player` store — el QueueManager iOS
        // tenía la propiedad por sí mismo, en web no. Esta es la divergencia
        // mínima necesaria para mantener la invariante "no pisar playback
        // local activo".
        if (player.isPlaying) return;
        const targetIndex = Math.max(
          0,
          songs.findIndex((s) => s.id === trackId)
        );
        // QueueManager.loadRemoteQueue espera NavidromeSong[]; pasamos un cast
        // permisivo — los campos extra (genre, etc.) son opcionales en el
        // schema y los que sí necesita (id/title/artist/duration) están.
        qm.loadRemoteQueue(
          songs as unknown as Parameters<typeof qm.loadRemoteQueue>[0],
          targetIndex,
          dict.position ?? 0
        );
      });
    }
  }

  // ==========================================================================
  // Inbound: remote_command — somos el device controlado
  // ==========================================================================

  private async handleRemoteCommand(dict: RemoteCommandPayload): Promise<void> {
    if (!dict.action) return;

    // Si somos los que controlamos a otro, ignoramos echoes — el otro device
    // ejecuta la acción.
    if (player.isRemote) return;

    // Solo si el comando va dirigido a nosotros (o es broadcast).
    if (dict.targetDeviceId && dict.targetDeviceId !== this.deviceId) return;

    const value = dict.value;
    const qm = await this.queueManagerLazy();

    switch (dict.action) {
      case 'play':
        player.play();
        break;
      case 'pause':
        player.pause();
        break;
      case 'togglePlayPause':
        player.toggle();
        break;
      case 'next':
        qm.skipNext();
        break;
      case 'previous':
        qm.skipPrevious();
        break;
      case 'seekTo':
        if (typeof value === 'number') qm.seekTo(value);
        break;
      case 'setVolume':
        if (typeof value === 'number') {
          const v = Math.max(0, Math.min(1, value));
          player.volume = v;
        } else {
          // Algunos clientes mandan setVolume con value en 0..100.
          if (typeof value === 'number') {
            audioEngine.setVolume(Math.max(0, Math.min(1, value / 100)));
          }
        }
        break;
      case 'playFromQueue': {
        if (typeof value !== 'string') break;
        const idx = qm.queue.findIndex((s) => s.id === value);
        if (idx >= 0) qm.jumpTo(idx);
        break;
      }
      case 'playPlaylist': {
        if (!value || typeof value !== 'object') break;
        const v = value as { queue?: unknown; startIndex?: unknown };
        if (!Array.isArray(v.queue)) break;
        const songs = parseRemoteSongs(v.queue);
        if (songs.length === 0) break;
        const startIndex =
          typeof v.startIndex === 'number'
            ? Math.max(0, Math.min(v.startIndex, songs.length - 1))
            : 0;
        qm.play(
          songs as unknown as Parameters<typeof qm.play>[0],
          startIndex
        );
        break;
      }
      case 'insertNext': {
        if (!value || typeof value !== 'object') break;
        const songs = parseRemoteSongs([value]);
        const first = songs[0];
        if (!first) break;
        qm.insertNext(first as unknown as Parameters<typeof qm.insertNext>[0]);
        break;
      }
      case 'addToQueue': {
        if (!value || typeof value !== 'object') break;
        const songs = parseRemoteSongs([value]);
        const first = songs[0];
        if (!first) break;
        qm.addToQueue(
          first as unknown as Parameters<typeof qm.addToQueue>[0]
        );
        break;
      }
      default:
        console.log(`[Connect] Comando remoto desconocido: ${dict.action}`);
    }

    // Confirma al controlador el nuevo estado (mirror Swift line 663-667).
    setTimeout(() => this.broadcastPlaybackState(true), 200);
  }

  // ==========================================================================
  // Stale remote watchdog — restaura local si el remote dejó de mandar updates
  // ==========================================================================

  private resetStaleRemoteTimer(): void {
    this.clearStaleRemoteTimer();
    this.staleRemoteTimer = setTimeout(() => {
      if (!player.isRemote) return;
      console.log('[Connect] Stale remote: 30s sin update — restaurando local');
      this.remoteSourceDeviceId = null;
      this.restoreAfterRemoteDisconnect();
    }, 30_000);
  }

  private clearStaleRemoteTimer(): void {
    if (this.staleRemoteTimer) {
      clearTimeout(this.staleRemoteTimer);
      this.staleRemoteTimer = null;
    }
  }

  private restoreAfterRemoteDisconnect(): void {
    this.clearStaleRemoteTimer();

    player.isRemote = false;
    player.remoteDeviceName = null;
    player.subtitle = null;

    void this.queueManagerLazy().then((qm) => {
      void qm.restoreLastPlayback();
    });
  }

  // ==========================================================================
  // Network listeners — pausa intentos de connect cuando el browser está offline
  // ==========================================================================

  private bindNetworkListeners(): void {
    if (this.networkListenersBound) return;
    if (typeof window === 'undefined') return;
    this.networkListenersBound = true;

    window.addEventListener('online', () => {
      if (this.shouldReconnect && !this.socket?.connected) {
        console.log('[Connect] Red restaurada — reintentando');
        void this.connect();
      }
    });

    window.addEventListener('offline', () => {
      console.log('[Connect] Offline — el socket pausará reintentos');
    });
  }

  // ==========================================================================
  // Lazy QueueManager — evita ciclo de import (queue → connect → queue)
  // ==========================================================================

  private async queueManagerLazy() {
    const mod = await import('$services/QueueManager.svelte');
    return mod.queueManager;
  }

  /** Snapshot sincrónico de la queue para broadcast. Usa import dinámico
      cacheado en una promesa — el primer broadcast tras connect tarda un
      tick en resolver, después es instantáneo. */
  private cachedQueueModule: typeof import('$services/QueueManager.svelte') | null =
    null;

  /** Lee el coverArt id (Subsonic raw, ej. "al-1234") de la canción actual.
      Si el módulo aún no se cargó, devuelve '' y el próximo broadcast lo
      tendrá. Mismo lifecycle que `snapshotQueueForBroadcast`. */
  private currentSongCoverArtId(): string {
    if (!this.cachedQueueModule) {
      void import('$services/QueueManager.svelte').then((m) => {
        this.cachedQueueModule = m;
      });
      return '';
    }
    return this.cachedQueueModule.queueManager.currentSong?.coverArt ?? '';
  }

  private snapshotQueueForBroadcast(): unknown[] {
    // Si todavía no resolvimos el módulo, kickoff y devolvemos []. El próximo
    // broadcast significant change ya tendrá el módulo listo.
    if (!this.cachedQueueModule) {
      void import('$services/QueueManager.svelte').then((m) => {
        this.cachedQueueModule = m;
      });
      return [];
    }
    const qm = this.cachedQueueModule.queueManager;
    return qm.queue.map((s) => ({
      id: s.id,
      trackId: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album ?? '',
      albumId: s.albumId ?? '',
      coverArt: s.coverArt ?? '',
      duration: s.duration,
      metadata: {
        title: s.title,
        artist: s.artist,
        album: s.album ?? '',
        coverArt: s.coverArt ?? '',
        duration: s.duration
      }
    }));
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  private tearDown(): void {
    this.clearStaleRemoteTimer();
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.hubConnected = false;
    this.connectedDevices = [];
    this.lanDevices = [];
  }
}

export const connectService = new ConnectService();
