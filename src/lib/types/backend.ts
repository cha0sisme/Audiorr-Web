import { z } from 'zod';

export const CanvasEntrySchema = z.object({
  songId: z.string(),
  spotifyTrackId: z.string().nullable(),
  canvasUrl: z.string().nullable(),
  localPath: z.string().nullable(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  cachedAt: z.string()
});
export type CanvasEntry = z.infer<typeof CanvasEntrySchema>;

// ============================================================================
// Stats — /api/stats
// ============================================================================

/**
 * Item del endpoint `/api/stats/recent-contexts` (Jump Back In).
 *
 * El backend devuelve los últimos contextos únicos (álbumes, playlists,
 * smart mixes, artistas) que el usuario ha escuchado, ordenados por
 * `lastPlayedAt` desc. Limitado a 8 entradas.
 *
 * Notas:
 * - `coverArtId` es el id Subsonic de la portada (sirve via NavidromeService.
 *   getCoverArtUrl). Para algunos tipos (playlists generadas por backend,
 *   smart mixes) puede ser null y se usa el cover del backend en su lugar.
 * - Para `type === 'artist'`, el backend guarda el NOMBRE en `id` (no el id
 *   Subsonic — limitación histórica del scrobble que entró en producción
 *   antes de tener el ID resuelto). Se navega a /search?q=<name> hasta que
 *   el backend exponga el id real.
 */
export const RecentContextItemSchema = z.object({
  contextUri: z.string(),
  type: z.enum(['album', 'playlist', 'smartmix', 'artist', 'other']),
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  coverArtId: z.string().nullable(),
  lastPlayedAt: z.string()
});
export type RecentContextItem = z.infer<typeof RecentContextItemSchema>;
export const RecentContextsSchema = z.array(RecentContextItemSchema);

// ============================================================================
// Daily Mixes — /api/daily-mixes
// ============================================================================

/**
 * Daily Mix generado por el cron del backend (3 AM).
 *
 * `navidromeId` es null cuando el mix existe en wrapped.db pero aún no se
 * sincronizó como playlist en Navidrome (transitorio entre runs del cron).
 * En ese caso el cliente no puede navegar al detalle.
 *
 * `coverContentHash` y `coverVersion` son cache-busters para la URL de la
 * cover del backend (`/api/playlists/<navidromeId>/cover.png?v=<hash>`).
 */
export const DailyMixSchema = z.object({
  mixNumber: z.number(),
  username: z.string(),
  navidromeId: z.string().nullable(),
  name: z.string(),
  clusterSeed: z.string().nullable(),
  trackCount: z.number(),
  lastGenerated: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  coverContentHash: z.string().nullable().optional(),
  coverVersion: z.number().nullable().optional()
});
export type DailyMix = z.infer<typeof DailyMixSchema>;
export const DailyMixesResponseSchema = z.object({
  mixes: z.array(DailyMixSchema)
});

// ============================================================================
// Smart Playlists — /api/smart-playlists
// ============================================================================

/**
 * Smart Playlist generada por el cron del backend.
 *
 * Keys conocidas: 'en_bucle' (daily), 'tiempo_atras' (semanal domingo),
 * 'radar_novedades' (semanal viernes).
 */
export const SmartPlaylistSchema = z.object({
  playlistKey: z.string(),
  username: z.string(),
  navidromeId: z.string().nullable(),
  name: z.string(),
  coverVariant: z.string(),
  homePosition: z.number().nullable(),
  trackCount: z.number(),
  lastGenerated: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  coverContentHash: z.string().nullable().optional(),
  coverVersion: z.number().nullable().optional()
});
export type SmartPlaylist = z.infer<typeof SmartPlaylistSchema>;
export const SmartPlaylistsResponseSchema = z.object({
  playlists: z.array(SmartPlaylistSchema)
});

// ============================================================================
// User Stats (Wrapped-lite) — /api/stats/user-stats?username=&period=week|month
// ============================================================================

export const UserStatsTopSongSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  album_id: z.string().optional(),
  cover_art: z.string().nullable().optional(),
  plays: z.number()
});

export const UserStatsTopArtistSchema = z.object({
  artist: z.string(),
  plays: z.number()
});

export const UserStatsTopGenreSchema = z.object({
  genre: z.string(),
  plays: z.number()
});

export const UserStatsSchema = z.object({
  total_plays: z.number(),
  weighted_average_release_year: z.number().nullable(),
  weighted_average_BPM: z.number().nullable(),
  weighted_average_Energy: z.number().nullable(),
  top_songs: z.array(UserStatsTopSongSchema),
  top_artists: z.array(UserStatsTopArtistSchema),
  top_genres: z.array(UserStatsTopGenreSchema),
  period: z.string(),
  startDate: z.string(),
  endDate: z.string()
});
export type UserStats = z.infer<typeof UserStatsSchema>;
export type UserStatsTopSong = z.infer<typeof UserStatsTopSongSchema>;
export type UserStatsTopArtist = z.infer<typeof UserStatsTopArtistSchema>;
export type UserStatsTopGenre = z.infer<typeof UserStatsTopGenreSchema>;
export type StatsPeriod = 'week' | 'month';

// ============================================================================
// User Preferences — /api/user/:username/*
// ============================================================================

/**
 * Pinned playlist guardada en preferencias de usuario. El backend no exige
 * shape estricto (id+name son obligatorios; el resto es opcional según
 * cómo se haya pinneado en su momento).
 */
export const PinnedPlaylistSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    songCount: z.number().optional(),
    coverArt: z.string().optional(),
    owner: z.string().optional(),
    pinnedAt: z.string().optional()
  })
  .passthrough();
export type PinnedPlaylist = z.infer<typeof PinnedPlaylistSchema>;
export const PinnedPlaylistsResponseSchema = z.object({
  pinnedPlaylists: z.array(PinnedPlaylistSchema)
});

export const UserPreferencesSchema = z
  .object({
    username: z.string(),
    avatarUrl: z.string().nullable().optional(),
    pinnedPlaylists: z.array(PinnedPlaylistSchema).default([]),
    preferences: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  })
  .passthrough();
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
