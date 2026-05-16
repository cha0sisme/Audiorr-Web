/**
 * NavidromeService — cliente Subsonic-compatible para Navidrome.
 *
 * Mirrors iOS NavidromeService.swift. Usa md5(password + salt) auth (Subsonic
 * standard) y guarda salt+token en CredentialsStore (NO la password, así no
 * es recuperable desde localStorage).
 *
 * API surface intencionalmente acotada — solo endpoints que necesitamos para
 * la UI actual. Se extiende cuando agreguemos features (search, scrobble, etc).
 */

import { md5 } from 'js-md5';
import { z } from 'zod';
import { backendService } from './BackendService.svelte';
import {
  SubsonicEnvelopeSchema,
  AlbumList2ResponseSchema,
  ArtistsResponseSchema,
  PlaylistsResponseSchema,
  AlbumResponseSchema,
  SongResponseSchema,
  UserResponseSchema,
  PlaylistResponseSchema,
  ArtistResponseSchema,
  AlbumInfoResponseSchema,
  ArtistInfoResponseSchema,
  TopSongsResponseSchema,
  Search3ResponseSchema,
  LyricsBySongIdResponseSchema,
  LyricsLegacyResponseSchema,
  type NavidromeAlbum,
  type NavidromeArtist,
  type NavidromePlaylist,
  type NavidromeAlbumInfo,
  type NavidromeArtistInfo,
  type NavidromeSong,
  type Search3Result,
  type StructuredLyrics
} from '$types/navidrome';
import { credentials, type NavidromeCredentials } from '$stores/credentials.svelte';

const CLIENT_NAME = 'Audiorr-Web';
const API_VERSION = '1.16.1';

// ============================================================================
// Errores
// ============================================================================

export class NavidromeError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
    this.name = 'NavidromeError';
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Genera un salt random hex. Mín 6 chars per Subsonic spec, usamos 16. */
function generateSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Construye los query params de auth comunes a todos los endpoints. */
function buildAuthParams(creds: NavidromeCredentials): URLSearchParams {
  return new URLSearchParams({
    u: creds.username,
    t: creds.token,
    s: creds.salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: 'json'
  });
}

/**
 * Llama a un endpoint Subsonic con las creds dadas, parsea la respuesta y
 * tira NavidromeError si el server reporta `status: failed`.
 */
async function call<T>(
  creds: NavidromeCredentials,
  action: string,
  extraParams: Record<string, string | number | boolean> = {},
  schema?: z.ZodSchema<T>,
  signal?: AbortSignal
): Promise<T> {
  const params = buildAuthParams(creds);
  for (const [k, v] of Object.entries(extraParams)) {
    params.set(k, String(v));
  }
  const url = `${creds.serverUrl}/rest/${action}.view?${params}`;

  // signal permite que TanStack Query cancele fetches in-flight cuando el
  // queryKey cambia (e.g. typing rápido en search → "ka" abortado al teclear
  // "kanye"). El AbortController está conectado vía createQuery({ queryFn:
  // ({ signal }) => ... }).
  const init: RequestInit = { credentials: 'omit' };
  if (signal) init.signal = signal;
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new NavidromeError(res.status, `HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const wrapper = json['subsonic-response'];
  const envelope = SubsonicEnvelopeSchema.parse(wrapper);

  if (envelope.status === 'failed' && envelope.error) {
    throw new NavidromeError(envelope.error.code, envelope.error.message);
  }

  // Si no se pasó schema, devolvemos el envelope crudo (caso ping)
  if (!schema) return wrapper as T;
  return schema.parse(wrapper);
}

// ============================================================================
// Connect / disconnect
// ============================================================================

/**
 * Intenta conectar con las credenciales dadas. Genera salt+token, llama ping,
 * y si funciona persiste las creds. Tira NavidromeError si auth falla.
 *
 * NO guarda la password — solo el salt+token derivado. La password se descarta
 * apenas computamos el token.
 */
export async function connect(input: {
  serverUrl: string;
  username: string;
  password: string;
}): Promise<{ version: string; serverVersion?: string | undefined }> {
  const salt = generateSalt();
  const token = md5(input.password + salt);

  const candidate: NavidromeCredentials = {
    serverUrl: input.serverUrl.replace(/\/+$/, ''),
    username: input.username,
    salt,
    token
  };

  // Probamos con ping antes de persistir — si auth falla, no guardamos nada
  const env = await call(candidate, 'ping');
  const envelope = SubsonicEnvelopeSchema.parse(env);

  credentials.set(candidate);

  // Notifica al backend Audiorr para que persista las creds Subsonic del user
  // y los crons (Daily Mixes, Smart Playlists) puedan generar playlists con
  // owner correcto. Non-fatal: el login a Navidrome ya fue válido; si el
  // backend rechaza o está caído, los crons no funcionarán para este user
  // hasta que se reintente login, pero la sesión web sigue operativa.
  try {
    const url = `${backendService.baseUrl}/api/auth/login`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serverUrl: candidate.serverUrl,
        username: candidate.username,
        token: candidate.token,
        salt: candidate.salt
      })
    });
    if (!res.ok) {
      console.warn(
        `[Audiorr] Backend rechazó la persistencia de creds (${res.status}). Los crons no actuarán para "${candidate.username}" hasta el próximo login.`
      );
    }
  } catch (err) {
    console.warn('[Audiorr] No se pudo notificar al backend Audiorr:', err);
  }

  return {
    version: envelope.version,
    serverVersion: envelope.serverVersion
  };
}

export function disconnect(): void {
  credentials.clear();
}

// ============================================================================
// Endpoints — siempre leen credentials.current. Tiran si no hay creds.
// ============================================================================

function requireCreds(): NavidromeCredentials {
  const c = credentials.current;
  if (!c) throw new NavidromeError(401, 'No hay credenciales configuradas');
  return c;
}

/**
 * Computa el multiplier ReplayGain lineal aplicable al masterGain de un track.
 *
 * Mirror exacto de `AudioEngineManager.swift:1589 computeReplayGainMultiplier`
 * en iOS, replicado aquí para que las dos plataformas suenen igual con la
 * misma biblioteca:
 *
 *   - **Track gain preferido**, album gain como fallback. Si ninguno, -8 dB
 *     default (consistencia histórica con el cliente React previo).
 *   - **multiplier = 10^(dB / 20)** — fórmula estándar ReplayGain.
 *   - **Cap por peak**: si hay `trackPeak > 0`, limitar a `0.99 / peak` para
 *     evitar clipping cuando el gain positivo amplifica picos cercanos a 0 dBFS.
 *   - Devuelve `1.0` (neutral) cuando el input está vacío y se prefiere
 *     desactivar ReplayGain por completo — el caller decide cuándo aplicar
 *     este "neutral" (ver setting `useReplayGain`).
 */
export function computeReplayGainMultiplier(rg: {
  trackGain?: number | undefined;
  trackPeak?: number | undefined;
  albumGain?: number | undefined;
  albumPeak?: number | undefined;
}): number {
  const DEFAULT_DB = -8;
  const gainCandidate = rg.trackGain ?? rg.albumGain;
  const db = Number.isFinite(gainCandidate) ? (gainCandidate as number) : DEFAULT_DB;
  const peak = rg.trackPeak ?? rg.albumPeak ?? 0;
  let multiplier = Math.pow(10, db / 20);
  if (peak > 0) {
    multiplier = Math.min(multiplier, 0.99 / peak);
  }
  return multiplier;
}

/** Convenience: computa el multiplier directo desde un NavidromeSong. Devuelve
    el default (-8 dB → ≈0.398) cuando la pista no trae tags de ReplayGain. */
export function songReplayGainMultiplier(song: { replayGain?: {
  trackGain?: number | undefined;
  trackPeak?: number | undefined;
  albumGain?: number | undefined;
  albumPeak?: number | undefined;
} | undefined }): number {
  return computeReplayGainMultiplier(song.replayGain ?? {});
}

export async function ping(): Promise<{ ok: boolean; version: string }> {
  const creds = requireCreds();
  const env = await call(creds, 'ping');
  const envelope = SubsonicEnvelopeSchema.parse(env);
  return { ok: envelope.status === 'ok', version: envelope.version };
}

/**
 * Subsonic scrobble.view. Si `submission=true`, registra el play en
 * Navidrome (cuenta para Last.fm si el server tiene plugin); si false,
 * actúa como "now playing" indicator.
 *
 * `time` en SEGUNDOS — el wrapper lo convierte a ms (Subsonic spec).
 * Tira `NavidromeError` si la respuesta no es status=ok.
 */
export async function scrobble(
  songId: string,
  options: { time?: number; submission?: boolean } = {}
): Promise<void> {
  const creds = requireCreds();
  const params: Record<string, string | number | boolean> = {
    id: songId,
    submission: options.submission ?? true
  };
  if (options.time !== undefined) {
    params.time = options.time * 1000;
  }
  await call(creds, 'scrobble', params);
}

export async function getAlbumList2(
  type: 'newest' | 'recent' | 'frequent' | 'random' | 'starred' | 'alphabeticalByName',
  size = 20,
  offset = 0
): Promise<NavidromeAlbum[]> {
  const creds = requireCreds();
  const data = await call(creds, 'getAlbumList2', { type, size, offset }, AlbumList2ResponseSchema);
  return data.albumList2.album ?? [];
}

/** Variante `byYear` de getAlbumList2 — devuelve los álbumes lanzados entre
    `fromYear` y `toYear` (inclusive). Útil para "Nuevos lanzamientos" del
    año en curso. Subsonic acepta from > to para invertir el orden.

    Ordenamos client-side por (year desc, created desc): cuando `from===to`
    Navidrome no garantiza orden entre álbumes del mismo año, y necesitamos
    "lo más reciente al principio". El tiebreaker por `created` (timestamp
    ISO de cuándo se añadió a la biblioteca) aproxima bien "lanzamientos
    nuevos primero" en un Navidrome al que se va metiendo música al ritmo
    al que sale al mundo. */
export async function getAlbumsByYear(
  fromYear: number,
  toYear: number,
  size = 30
): Promise<NavidromeAlbum[]> {
  const creds = requireCreds();
  const data = await call(
    creds,
    'getAlbumList2',
    { type: 'byYear', fromYear, toYear, size },
    AlbumList2ResponseSchema
  );
  const albums = data.albumList2.album ?? [];
  return [...albums].sort((a, b) => {
    const byYear = (b.year ?? 0) - (a.year ?? 0);
    if (byYear !== 0) return byYear;
    return (b.created ?? '').localeCompare(a.created ?? '');
  });
}

/** Variante `byGenre` — álbumes etiquetados con un género específico.
    Devuelve hasta `size`. Reusable para sacar artistas representativos de
    un género (cruzando con `getArtists()` por nombre). */
export async function getAlbumsByGenre(
  genre: string,
  size = 50
): Promise<NavidromeAlbum[]> {
  const creds = requireCreds();
  const data = await call(
    creds,
    'getAlbumList2',
    { type: 'byGenre', genre, size },
    AlbumList2ResponseSchema
  );
  return data.albumList2.album ?? [];
}

/**
 * Albumes donde el artista APARECE como colaborador (no como artist principal).
 *
 * Approach: search3(artistName, songCount=500) → para cada song, comprobar si
 * el artista buscado está en `song.artists[]` (OpenSubsonic ext, array completo
 * de artistas de la pista incluyendo features) o, fallback, si `song.artistId`
 * matchea. Deduplicar por `albumId`, restar los álbumes principales (los que
 * vienen embedded en `getArtist().album`) y resolver el meta de los álbumes
 * supervivientes con `getAlbum` en paralelo.
 *
 * Reemplaza dos approaches anteriores:
 *   - search3 + string match contra `album.artist` (legacy iOS, frágil): solo
 *     capturaba colabs reflejadas en el albumArtist tag del álbum.
 *   - getAlbumList2?type=byArtist: Navidrome solo lista álbumes donde el
 *     artista es albumArtist principal, no incluye feats canción-a-canción.
 *
 * El campo `artists[]` es la clave: lo expone Navidrome cuando el ID3 trae
 * multi-artist, y permite filtrar por id (robusto a typos/casing/separadores).
 */
export async function getArtistCollaborations(
  artistId: string,
  artistName: string,
  primaryAlbumIds: ReadonlySet<string>
): Promise<NavidromeAlbum[]> {
  if (!artistId || !artistName) return [];
  const result = await search3(artistName, {
    artistCount: 0,
    albumCount: 0,
    songCount: 500
  });

  const candidateAlbumIds = new Set<string>();
  for (const song of result.songs) {
    if (!song.albumId) continue;
    if (primaryAlbumIds.has(song.albumId)) continue;
    const inArtists = song.artists?.some((a) => a.id === artistId) ?? false;
    // Fallback: si el server no expone `artists[]`, comparar por artistId
    // de la pista (cubre el caso donde el queried es el primary de la song
    // pero el álbum padre es de otro).
    const isPrimaryOfSong = song.artistId === artistId;
    if (inArtists || isPrimaryOfSong) {
      candidateAlbumIds.add(song.albumId);
    }
  }

  if (candidateAlbumIds.size === 0) return [];

  const albums = await Promise.all(
    [...candidateAlbumIds].map((id) =>
      getAlbum(id)
        .then((a) => a as NavidromeAlbum)
        .catch(() => null)
    )
  );
  return albums
    .filter((a): a is NavidromeAlbum => a !== null)
    .sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
}

export async function getArtists(): Promise<NavidromeArtist[]> {
  const creds = requireCreds();
  const data = await call(creds, 'getArtists', {}, ArtistsResponseSchema);
  // Navidrome devuelve los artistas indexados alfabéticamente — los aplastamos
  return (data.artists.index ?? []).flatMap((idx) => idx.artist ?? []);
}

export async function getPlaylists(): Promise<NavidromePlaylist[]> {
  const creds = requireCreds();
  const data = await call(creds, 'getPlaylists', {}, PlaylistsResponseSchema);
  return data.playlists.playlist ?? [];
}

export async function getAlbum(id: string) {
  const creds = requireCreds();
  const data = await call(creds, 'getAlbum', { id }, AlbumResponseSchema);
  return data.album;
}

/** GET /rest/getSong — singleton song. Útil para enriquecer items de
    endpoints que solo devuelven metadata mínima (ej. /api/stats/top-weekly
    no incluye `explicitStatus` ni `replayGain`). */
export async function getSong(id: string) {
  const creds = requireCreds();
  const data = await call(creds, 'getSong', { id }, SongResponseSchema);
  return data.song;
}

/** GET /rest/getUser — info del user incluyendo `adminRole`. Subsonic permite
    consultar OWN user sin permisos especiales; consultar OTROS solo si el
    caller es admin. Para nuestro flow (saber si el current user es admin)
    siempre pedimos el username actual. */
export async function getUser(username: string) {
  const creds = requireCreds();
  const data = await call(creds, 'getUser', { username }, UserResponseSchema);
  return data.user;
}

/**
 * Subsonic `updatePlaylist` — cambios de metadata (name/comment/public)
 * y/o mutaciones del contenido (songIdsToAdd / songIndexesToRemove).
 *
 * Requiere admin O ser el owner. Para playlists del usuario actual creadas
 * desde la web (siempre con owner=current), el current user puede mutar
 * sin restricción.
 */
export async function updatePlaylist(
  playlistId: string,
  options: {
    name?: string;
    comment?: string;
    public?: boolean;
    /** IDs de canciones a añadir al final de la playlist. */
    songIdsToAdd?: string[];
    /** Índices de canciones a quitar (Subsonic acepta el parámetro repetido). */
    songIndexesToRemove?: number[];
  }
): Promise<void> {
  const creds = requireCreds();
  const params = buildAuthParams(creds);
  params.set('playlistId', playlistId);
  if (options.name !== undefined) params.set('name', options.name);
  if (options.comment !== undefined) params.set('comment', options.comment);
  if (options.public !== undefined) params.set('public', String(options.public));
  for (const id of options.songIdsToAdd ?? []) params.append('songIdToAdd', id);
  for (const idx of options.songIndexesToRemove ?? []) {
    params.append('songIndexToRemove', String(idx));
  }
  // Subsonic devuelve solo status="ok" sin payload — fetch directo.
  const url = `${creds.serverUrl}/rest/updatePlaylist.view?${params}`;
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) {
    throw new NavidromeError(res.status, `updatePlaylist ${res.status}`);
  }
  const json = (await res.json()) as { 'subsonic-response'?: { status?: string; error?: { message?: string } } };
  const env = json['subsonic-response'];
  if (env?.status === 'failed') {
    throw new NavidromeError(0, env.error?.message ?? 'updatePlaylist failed');
  }
}

/**
 * Subsonic `createPlaylist` — crea una playlist nueva con `name`. Opcionalmente
 * acepta `songIds` para popularla en la creación. La playlist queda asociada
 * al usuario que llama (owner=current). Devuelve la playlist completa con su
 * id ya asignado (lo necesitamos para refrescar el cache local sin re-fetch
 * pesado del server).
 *
 * Subsonic CREATE/REPLACE: si pasas `playlistId` reemplaza; si pasas `name`
 * crea nueva. Aquí solo exponemos el path de creación. Para editar usar
 * `updatePlaylist`.
 */
export async function createPlaylist(
  name: string,
  songIds: string[] = []
): Promise<NavidromePlaylist> {
  const creds = requireCreds();
  const params = buildAuthParams(creds);
  params.set('name', name);
  for (const id of songIds) params.append('songId', id);
  const url = `${creds.serverUrl}/rest/createPlaylist.view?${params}`;
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) {
    throw new NavidromeError(res.status, `createPlaylist ${res.status}`);
  }
  const json = (await res.json()) as {
    'subsonic-response'?: {
      status?: string;
      error?: { message?: string };
      playlist?: NavidromePlaylist;
    };
  };
  const env = json['subsonic-response'];
  if (env?.status === 'failed') {
    throw new NavidromeError(0, env.error?.message ?? 'createPlaylist failed');
  }
  if (!env?.playlist) {
    throw new NavidromeError(0, 'createPlaylist: respuesta sin playlist');
  }
  return env.playlist;
}

export async function getPlaylist(id: string) {
  const creds = requireCreds();
  const data = await call(creds, 'getPlaylist', { id }, PlaylistResponseSchema);
  return data.playlist;
}

export async function getArtist(id: string) {
  const creds = requireCreds();
  const data = await call(creds, 'getArtist', { id }, ArtistResponseSchema);
  return data.artist;
}

/**
 * Notas Last.fm del álbum (review + cover thumbs). Vacío si el server no
 * tiene plugin Last.fm habilitado. `includeNotMissing=true` evita que el
 * server intente regenerar la metadata (más rápido).
 */
export async function getAlbumInfo2(id: string): Promise<NavidromeAlbumInfo> {
  const creds = requireCreds();
  const data = await call(creds, 'getAlbumInfo2', { id }, AlbumInfoResponseSchema);
  return data.albumInfo;
}

/**
 * Bio + similar artists del artista (Last.fm via Subsonic). `count=20` para
 * tener margen tras filtrar similares sin id (los que no están en la
 * biblioteca local). `includeNotPresent=false` los descarta server-side.
 */
export async function getArtistInfo2(
  id: string,
  count = 20,
  includeNotPresent = false
): Promise<NavidromeArtistInfo> {
  const creds = requireCreds();
  const data = await call(
    creds,
    'getArtistInfo2',
    { id, count, includeNotPresent },
    ArtistInfoResponseSchema
  );
  return data.artistInfo2;
}

/**
 * Top tracks del artista por popularidad Last.fm. Subsonic toma `artist` por
 * NOMBRE (no id) — usamos el name del NavidromeArtist. count default 10
 * para cubrir collapsed (5) + expanded (10) en ArtistDetail.
 */
export async function getTopSongs(
  artistName: string,
  count = 10
): Promise<NavidromeSong[]> {
  const creds = requireCreds();
  const data = await call(
    creds,
    'getTopSongs',
    { artist: artistName, count },
    TopSongsResponseSchema
  );
  return data.topSongs.song ?? [];
}

/**
 * Search3 — búsqueda unificada de artistas + álbumes + canciones por una
 * query libre. Subsonic ranks server-side; nosotros pasamos el order tal
 * cual viene (típicamente: matches exactos primero, luego parciales).
 *
 * Cada count cap-ea cuántos resultados pedir por tipo. 0 desactiva el
 * tipo (Subsonic igual lo procesa pero devuelve array vacío). Para search
 * UI default usamos 20/20/20 — suficiente para los tres carruseles del
 * /search sin saturar la red.
 *
 * NO incluye playlists — Subsonic no tiene endpoint para search de
 * playlists. La página /search filtra `getPlaylists()` (ya cacheado por
 * /library) client-side. Cubre el caso porque la cantidad de playlists
 * es chica (~docenas) en una biblioteca típica.
 */
export async function search3(
  query: string,
  options: {
    artistCount?: number;
    albumCount?: number;
    songCount?: number;
    artistOffset?: number;
    albumOffset?: number;
    songOffset?: number;
  } = {},
  signal?: AbortSignal
): Promise<Search3Result> {
  const creds = requireCreds();
  const data = await call(
    creds,
    'search3',
    {
      query,
      artistCount: options.artistCount ?? 20,
      albumCount: options.albumCount ?? 20,
      songCount: options.songCount ?? 20,
      artistOffset: options.artistOffset ?? 0,
      albumOffset: options.albumOffset ?? 0,
      songOffset: options.songOffset ?? 0
    },
    Search3ResponseSchema,
    signal
  );
  return {
    artists: data.searchResult3.artist ?? [],
    albums: data.searchResult3.album ?? [],
    songs: data.searchResult3.song ?? []
  };
}

// ============================================================================
// URL builders — para componentes que necesitan src URLs (img, audio)
// ============================================================================

/**
 * OpenSubsonic getLyricsBySongId — devuelve letras embedded en el archivo
 * (ID3 USLT/SYLT) o letras de un .lrc al lado del archivo, ya parseadas
 * server-side a structuredLyrics. Es el reemplazo moderno de getLyrics
 * (que solo busca por title+artist en plugins externos como Last.fm).
 *
 * Retorna un array de variantes (típicamente 1: la principal). Cada variante
 * tiene `synced: bool` y `line[]` con `start` (ms) si synced. Si el archivo
 * no tiene letras, el array viene vacío.
 *
 * Mirror del path "embedded" del iOS LyricsService — allí AVAsset.metadata
 * lee USLT del archivo cacheado/streaming. En web delegamos al server,
 * que ya tiene acceso al fichero original.
 */
export async function getLyricsBySongId(songId: string): Promise<StructuredLyrics[]> {
  const creds = requireCreds();
  const data = await call(
    creds,
    'getLyricsBySongId',
    { id: songId },
    LyricsBySongIdResponseSchema
  );
  return data.lyricsList?.structuredLyrics ?? [];
}

/**
 * Subsonic legacy getLyrics — busca letras por title+artist en el plugin
 * Last.fm del server. Plain text único, no synced. Último fallback cuando
 * el archivo no tiene letras embedded ni LRCLib responde.
 *
 * Devuelve string vacío si no hay letras (en lugar de tirar) — el caller
 * decide si queda como "no lyrics" o sigue probando.
 */
export async function getLyricsByQuery(artist: string, title: string): Promise<string> {
  const creds = requireCreds();
  try {
    const data = await call(
      creds,
      'getLyrics',
      { artist, title },
      LyricsLegacyResponseSchema
    );
    return data.lyrics?.value ?? '';
  } catch {
    return '';
  }
}

/** URL del cover art (img.src). Tamaño en px. */
export function getCoverArtUrl(coverArtId: string, size = 300): string {
  const creds = credentials.current;
  if (!creds) return '';
  const params = buildAuthParams(creds);
  params.set('id', coverArtId);
  params.set('size', String(size));
  return `${creds.serverUrl}/rest/getCoverArt.view?${params}`;
}

/**
 * URL para streaming de audio. Para uso con AudioEngine.
 *
 * Por defecto pedimos `format=raw` — los browsers modernos decodifican
 * MP3/FLAC/OGG/M4A/AAC nativamente y evita el transcoding del server (que
 * tiraría a Opus 128 o similar y rompe la fidelidad audiophile que es el
 * punto de Audiorr). El AudioEngine corrige solo si raw no decodifica
 * (ej: ALAC en Chrome) — reintenta una vez sin format=raw para forzar
 * transcoding del server. Callers no necesitan pasar `{ raw: false }`.
 */
export function getStreamUrl(songId: string, options: { raw?: boolean } = {}): string {
  const creds = credentials.current;
  if (!creds) return '';
  const params = buildAuthParams(creds);
  params.set('id', songId);
  if (options.raw !== false) params.set('format', 'raw');
  return `${creds.serverUrl}/rest/stream.view?${params}`;
}
