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
