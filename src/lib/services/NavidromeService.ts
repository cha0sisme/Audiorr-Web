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
  type NavidromeAlbum,
  type NavidromeArtist,
  type NavidromePlaylist,
  type NavidromeAlbumInfo,
  type NavidromeArtistInfo,
  type NavidromeSong,
  type Search3Result
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

export async function ping(): Promise<{ ok: boolean; version: string }> {
  const creds = requireCreds();
  const env = await call(creds, 'ping');
  const envelope = SubsonicEnvelopeSchema.parse(env);
  return { ok: envelope.status === 'ok', version: envelope.version };
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
    año en curso. Subsonic acepta from > to para invertir el orden. */
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
  return data.albumList2.album ?? [];
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
 * Mirrors `getArtistCollaborations` de iOS NavidromeService.swift:515-535:
 *
 *   1. search3 con query=artistName, albumCount=1000.
 *   2. Filtra: descarta álbumes donde el artista es el `albumArtist` principal
 *      (matches exactos o que empiezan con "{name}{,&and feat ft featuring}").
 *   3. Mantiene solo los que CONTIENEN el nombre en el campo `artist` del
 *      álbum (para que sea una colaboración real, no falso positivo).
 *   4. Ordena por año desc.
 *
 * iOS usa search2; aquí search3 (estructuralmente equivalente para álbumes).
 */
export async function getArtistCollaborations(
  artistName: string
): Promise<NavidromeAlbum[]> {
  if (!artistName) return [];
  const result = await search3(artistName, {
    artistCount: 0,
    albumCount: 1000,
    songCount: 0
  });
  const lower = artistName.toLowerCase().trim();
  const mainPrefixes = [',', ' &', ' and', ' ', ' feat', ' ft', ' featuring'];
  return result.albums
    .filter((album) => {
      const a = (album.artist ?? '').toLowerCase();
      const isMain = a === lower || mainPrefixes.some((p) => a.startsWith(lower + p));
      return !isMain && a.includes(lower);
    })
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
