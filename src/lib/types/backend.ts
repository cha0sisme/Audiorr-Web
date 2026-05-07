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
