import { z } from 'zod';

export const CanvasEntrySchema = z.object({
  songId: z.string(),
  spotifyTrackId: z.string().nullable(),
  canvasUrl: z.string().nullable(),
  localPath: z.string().nullable(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  // source añadido por backend tras feature canvas-gen (2026-05-11). Optional
  // con default para tolerar un backend pre-rebuild que aún no lo emite.
  source: z.enum(['spotify', 'generated']).optional().default('spotify'),
  cachedAt: z.string()
});
export type CanvasEntry = z.infer<typeof CanvasEntrySchema>;

// ============================================================================
// Canvas generation — POST /api/canvas/generate + GET /jobs/:id
// ============================================================================

export const CanvasGenerateModeSchema = z.enum(['random', 'loop']);
export type CanvasGenerateMode = z.infer<typeof CanvasGenerateModeSchema>;

export const CanvasJobStatusSchema = z.enum([
  'queued',
  'running',
  'done',
  'failed',
  'canceled'
]);
export type CanvasJobStatus = z.infer<typeof CanvasJobStatusSchema>;

export const CanvasGenerationPhaseSchema = z.enum([
  'probing',
  'downloading',
  'evaluating',
  'concatenating',
  'normalizing'
]);
export type CanvasGenerationPhase = z.infer<typeof CanvasGenerationPhaseSchema>;

/** Job de generación. El `log` lo emite el backend cuando hay attempts;
    lo dejamos como passthrough para no acoplarnos a un shape que aún puede
    evolucionar. */
export const CanvasGenerationJobSchema = z.object({
  id: z.string(),
  songId: z.string(),
  songTitle: z.string(),
  songArtist: z.string(),
  songAlbum: z.string().optional(),
  youtubeUrl: z.string(),
  mode: CanvasGenerateModeSchema,
  fragments: z.number(),
  fragmentSec: z.number(),
  durationSec: z.number(),
  force: z.boolean(),
  status: CanvasJobStatusSchema,
  phase: CanvasGenerationPhaseSchema.nullable(),
  phaseDetail: z.string().nullable(),
  outputPath: z.string().nullable(),
  outputUrl: z.string().nullable(),
  error: z.string().nullable(),
  log: z.unknown().nullable(),
  enqueuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable()
});
export type CanvasGenerationJob = z.infer<typeof CanvasGenerationJobSchema>;

export const CanvasGenerateEnqueuedSchema = z.object({
  jobId: z.string(),
  job: CanvasGenerationJobSchema
});
export type CanvasGenerateEnqueued = z.infer<typeof CanvasGenerateEnqueuedSchema>;

export const CanvasGenerationJobListSchema = z.object({
  jobs: z.array(CanvasGenerationJobSchema)
});
export type CanvasGenerationJobList = z.infer<typeof CanvasGenerationJobListSchema>;

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

/**
 * Item del endpoint `/api/stats/top-weekly` (Más escuchado de la semana).
 *
 * Top 10 global de la última semana, comparado con la anterior. El backend
 * devuelve trends ('up' | 'down' | 'same' | 'new') + magnitud del cambio,
 * estilo charts musicales semanales (Billboard, Top 40).
 */
export const TopWeeklySongSchema = z.object({
  song_id: z.string(),
  title: z.string(),
  artist: z.string(),
  artist_id: z.string().nullable().optional(),
  album: z.string(),
  album_id: z.string().nullable(),
  cover_art: z.string().nullable(),
  duration: z.number().optional(),
  plays: z.number(),
  rank: z.number(),
  previousRank: z.number().nullable(),
  trend: z.enum(['up', 'down', 'same', 'new']),
  change: z.number().nullable()
});
export type TopWeeklySong = z.infer<typeof TopWeeklySongSchema>;
export const TopWeeklyResponseSchema = z.array(TopWeeklySongSchema);

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

/** Estado de un cron job interno del backend (smart playlists, daily mixes).
    `lastRun` y `nextRun` llegan serializados como ISO strings. */
export const CronStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'error', 'success']),
  lastRun: z.string().optional(),
  nextRun: z.string().optional(),
  lastError: z.string().optional()
});
export type CronStatus = z.infer<typeof CronStatusSchema>;

/** El smart playlists service mantiene un cron por cada playlist key
    (en_bucle diario, tiempo_atras semanal, radar_novedades semanal). */
export const SmartPlaylistsCronStatusSchema = z.record(z.string(), CronStatusSchema);
export type SmartPlaylistsCronStatus = z.infer<typeof SmartPlaylistsCronStatusSchema>;

/** Respuesta de POST /api/daily-mixes/generate-all — lista de usuarios
    procesados y resumen por usuario + total. */
export const GenerateAllDailyMixesResponseSchema = z.object({
  users: z.array(z.string()),
  results: z.record(
    z.string(),
    z.object({
      generated: z.number(),
      reason: z.string().optional()
    })
  ),
  totalGenerated: z.number()
});
export type GenerateAllDailyMixesResponse = z.infer<typeof GenerateAllDailyMixesResponseSchema>;

/** Respuesta de POST /api/smart-playlists/generate-all — el shape exacto de
    `results` depende del service (puede variar por release del backend),
    así que dejamos `unknown` y el caller decide si lo usa. */
export const GenerateAllSmartPlaylistsResponseSchema = z.object({
  results: z.unknown()
});
export type GenerateAllSmartPlaylistsResponse = z.infer<
  typeof GenerateAllSmartPlaylistsResponseSchema
>;

// ============================================================================
// Spotify Sync — /api/sync/*  (legacy, retrocompat)
// ============================================================================

/** Playlist de Spotify sincronizada hacia Navidrome. */
export const SyncedPlaylistSchema = z.object({
  spotifyId: z.string(),
  navidromeId: z.string().nullable(),
  name: z.string(),
  lastSync: z.string().nullable(),
  trackCount: z.number(),
  matchCount: z.number(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type SyncedPlaylist = z.infer<typeof SyncedPlaylistSchema>;
export const SyncedPlaylistsArraySchema = z.array(SyncedPlaylistSchema);

/** Track de Spotify dentro de un preview. */
export const SpotifyTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  duration_ms: z.number()
});
export type SpotifyTrack = z.infer<typeof SpotifyTrackSchema>;

/** Resultado del preview — % de coincidencias antes de sincronizar de verdad. */
export const SyncPreviewSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  trackCount: z.number(),
  matchCount: z.number(),
  percentage: z.number(),
  tracks: z.array(
    z.object({
      spotify: SpotifyTrackSchema,
      found: z.boolean(),
      navidromeId: z.string().optional(),
      isManual: z.boolean().optional()
    })
  )
});
export type SyncPreview = z.infer<typeof SyncPreviewSchema>;

/** Confirmación genérica del backend (`{ status: 'ok' }`). */
export const StatusOkSchema = z.object({
  status: z.string()
});

// ============================================================================
// Multi-source Sync — /api/sync/* v2 (source-aware, Spotify + Deezer)
// El backend emite `source` + `externalId` a partir del commit adec1dc.
// Los campos legacy (`spotifyId`) siguen presentes como alias → retrocompat.
// ============================================================================

/** Fuentes de sync soportadas por el backend. */
export const SyncSourceSchema = z.enum(['spotify', 'deezer']);
export type SyncSource = z.infer<typeof SyncSourceSchema>;

/**
 * Playlist sincronizada source-aware.
 * - `externalId` / `source`: campos canónicos.
 * - `spotifyId`: alias legacy que el backend sigue emitiendo (= externalId).
 *
 * Se marca `source` como optional con default 'spotify' para tolerar
 * un backend pre-adec1dc en el mismo deploy (migración idempotente).
 */
export const SyncedPlaylistV2Schema = z.object({
  source: SyncSourceSchema.optional().default('spotify'),
  externalId: z.string(),
  /** Alias legacy — el backend lo emite como alias de externalId. */
  spotifyId: z.string().optional(),
  navidromeId: z.string().nullable(),
  name: z.string(),
  lastSync: z.string().nullable(),
  trackCount: z.number(),
  matchCount: z.number(),
  enabled: z.boolean(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type SyncedPlaylistV2 = z.infer<typeof SyncedPlaylistV2Schema>;
export const SyncedPlaylistsV2ArraySchema = z.array(SyncedPlaylistV2Schema);

/**
 * Track de la fuente externa dentro de un preview.
 * El campo se llama `spotify` por naming legacy incluso cuando la fuente es
 * Deezer — así lo devuelve el backend (ver §5 de la issue 2026-05-29).
 */
export const ExternalTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string(),
  album: z.string(),
  duration_ms: z.number()
});
export type ExternalTrack = z.infer<typeof ExternalTrackSchema>;

/** Preview source-aware. `tracks[].spotify` contiene el track de la fuente. */
export const SyncPreviewV2Schema = z.object({
  source: SyncSourceSchema.optional().default('spotify'),
  id: z.string().optional(),
  name: z.string(),
  trackCount: z.number(),
  matchCount: z.number(),
  percentage: z.number(),
  tracks: z.array(
    z.object({
      /** Naming legacy — contiene el track de la fuente, sea Spotify o Deezer. */
      spotify: ExternalTrackSchema,
      found: z.boolean(),
      navidromeId: z.string().optional(),
      isManual: z.boolean().optional()
    })
  )
});
export type SyncPreviewV2 = z.infer<typeof SyncPreviewV2Schema>;

/** Petición de match manual multi-fuente. */
export const ManualMatchRequestSchema = z.object({
  source: SyncSourceSchema,
  externalTrackId: z.string(),
  navidromeSongId: z.string(),
  trackName: z.string().optional(),
  artistName: z.string().optional(),
  navidromeTitle: z.string().optional(),
  navidromeArtist: z.string().optional()
});
export type ManualMatchRequest = z.infer<typeof ManualMatchRequestSchema>;

/** Respuesta de search-songs — lista de canciones Navidrome para match manual. */
export const SearchSongItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string().optional()
});
export type SearchSongItem = z.infer<typeof SearchSongItemSchema>;
export const SearchSongsResponseSchema = z.array(SearchSongItemSchema);

// ============================================================================
// Admin: usuarios del sistema — /api/user/admin/users
// ============================================================================

/** Item de la lista admin de usuarios — incluye el último scrobble si lo
    hay (cross-join con wrapped.db). */
export const AdminUserSchema = z.object({
  username: z.string(),
  avatarUrl: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  lastScrobble: z
    .object({
      title: z.string(),
      artist: z.string(),
      album: z.string().nullable().optional(),
      playedAt: z.string()
    })
    .nullable()
    .optional()
});
export type AdminUser = z.infer<typeof AdminUserSchema>;
export const AdminUsersResponseSchema = z.array(AdminUserSchema);

// ============================================================================
// Canvas — /api/spotify/canvas + /api/canvas
// ============================================================================

/** Item del array `canvasesList` que devuelve `/api/spotify/canvas`. */
export const SpotifyCanvasItemSchema = z.object({
  id: z.string(),
  canvasUrl: z.string(),
  trackUri: z.string(),
  canvasUri: z.string().optional(),
  artist: z
    .object({
      artistUri: z.string().optional(),
      artistName: z.string().optional(),
      artistImgUrl: z.string().optional()
    })
    .optional()
});
export type SpotifyCanvasItem = z.infer<typeof SpotifyCanvasItemSchema>;

export const SpotifyCanvasResponseSchema = z.object({
  canvasesList: z.array(SpotifyCanvasItemSchema)
});
export type SpotifyCanvasResponse = z.infer<typeof SpotifyCanvasResponseSchema>;

// ============================================================================
// Playlist Sections — `homepage_layout` global setting
// ============================================================================

/**
 * Layout configurable de la página /library?tab=playlists. El admin lo edita
 * desde la página /admin del backend; se persiste en `global_settings` con
 * key `homepage_layout` y se sirve via /api/settings/homepage_layout.
 *
 * Tipos:
 * - fixed_daily : "Tus mixes diarios" — leídos de /api/daily-mixes.
 * - fixed_smart : "Hecho especialmente para ti" — leídos de /api/smart-playlists.
 * - fixed_user  : "Mis playlists" — playlists owner=username, no editorial,
 *                 no spotify-synced, no smart, no daily-mix.
 * - dynamic     : sección custom configurable por el admin. `playlists`
 *                 contiene IDs Subsonic específicos (e.g. editoriales,
 *                 spotify-synced, agrupaciones temáticas como "Fiesta Latina").
 */
export const PlaylistSectionTypeSchema = z.enum([
  'fixed_daily',
  'fixed_user',
  'fixed_smart',
  'dynamic'
]);
export const PlaylistSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: PlaylistSectionTypeSchema,
  playlists: z.array(z.string()).optional()
});
export type PlaylistSection = z.infer<typeof PlaylistSectionSchema>;
export const PlaylistSectionsArraySchema = z.array(PlaylistSectionSchema);

/** Wrapper del endpoint /api/settings/:key. */
export const GlobalSettingResponseSchema = z.object({
  key: z.string(),
  value: z.unknown()
});

// ============================================================================
// Ranked Layout — /api/user/:username/ranked-layout
// ============================================================================

/**
 * Layout de playlists reordenado por afinidad. Mismas secciones que
 * `homepage_layout`, pero las de tipo `dynamic` traen las playlists ya
 * reordenadas según el perfil del usuario (scrobbles 90d → score por
 * genre/bpm/energy/longTerm). Las fixed_* vienen con `playlists: []` y un
 * `note` — sus items se resuelven igual que antes (dailyMixes, smartPlaylists,
 * myPlaylists). NO reordenar en cliente.
 *
 * Backend: GET /api/user/:username/ranked-layout?debug=1
 *   - Sin `debug`: ~5.5 KB (clean shape).
 *   - Con `debug=1`: ~62 KB. Solo para Housekeeping admin, NO en home.
 */
export const RankedLayoutPlaylistSchema = z.object({
  playlistId: z.string(),
  playlistName: z.string(),
  pinned: z.boolean(),
  rankOriginal: z.number(),
  rankPredicted: z.number(),
  score: z.number()
});
export type RankedLayoutPlaylist = z.infer<typeof RankedLayoutPlaylistSchema>;

/** `rowType` se tipa como `string` (no enum) para tolerar valores nuevos
    del backend sin romper el cliente; el mapper filtra a tipos conocidos. */
export const RankedLayoutSectionSchema = z.object({
  sectionId: z.string(),
  title: z.string(),
  rowType: z.string(),
  playlists: z.array(RankedLayoutPlaylistSchema),
  note: z.string().optional()
});
export type RankedLayoutSection = z.infer<typeof RankedLayoutSectionSchema>;

export const RankedLayoutResponseSchema = z.object({
  username: z.string(),
  computedAt: z.string(),
  /** passthrough: con `?debug=1` añade topGenres/avgBPM/avgEnergy/topArtists. */
  userProfile: z
    .object({
      scrobbleCount90d: z.number(),
      confidence: z.number()
    })
    .passthrough(),
  weights: z.object({
    genre: z.number(),
    bpm: z.number(),
    energy: z.number(),
    longTerm: z.number()
  }),
  sections: z.array(RankedLayoutSectionSchema)
});
export type RankedLayoutResponse = z.infer<typeof RankedLayoutResponseSchema>;

// ============================================================================
// User Stats (Wrapped-lite) — /api/stats/user-stats?username=&period=week|month
// ============================================================================

/**
 * Shape devuelto por `/api/stats/user-stats` — el backend NO incluye `id`
 * (Subsonic) en top_songs (la query SQLite agrupa por song_id internamente
 * pero solo expone title+album+album_id). Si en el futuro el backend añade
 * el id, se promueve a obligatorio. `album` y `album_id` son nullables porque
 * scrobbles antiguos pueden tener nulls.
 */
export const UserStatsTopSongSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  artist: z.string(),
  album: z.string().nullable().optional(),
  album_id: z.string().nullable().optional(),
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

// ============================================================================
// Album Artwork (Apple Music animated artwork) — /api/album-artwork/:albumId
// ============================================================================

/**
 * Entrada de animated artwork (Apple Music motion artwork) para un álbum.
 *
 * `fileUrl` es la ruta del .mp4 ya transcodificado a H.264 yuv420p 1:1, o
 * `null` si no hay vídeo descargado. Solo hay vídeo cuando `fileUrl != null`
 * (estados `auto` o `manual`).
 *
 * 404 = no hay entrada para el álbum (normal hasta que se haga fetch).
 * Tratar como "sin artwork", no como error.
 */
export const AlbumArtworkMatchStatusSchema = z.enum([
  'auto',
  'manual',
  'no-motion',
  'not-found',
  'error'
]);
export type AlbumArtworkMatchStatus = z.infer<typeof AlbumArtworkMatchStatusSchema>;

export const AlbumArtworkEntrySchema = z.object({
  albumId: z.string(),
  // El backend lo guarda como TEXT y lo devuelve como string (p.ej. "1603164027").
  // Aceptamos number por robustez, pero la realidad del API es string.
  appleCollectionId: z.union([z.string(), z.number()]).nullable().optional(),
  country: z.string().nullable().optional(),
  variant: z.string().nullable().optional(),
  localPath: z.string().nullable().optional(),
  localPathTall: z.string().nullable().optional(),
  matchStatus: AlbumArtworkMatchStatusSchema,
  title: z.string().optional(),
  artist: z.string().optional(),
  cachedAt: z.string().optional(),
  fileUrl: z.string().nullable(),
  /** URL del .mp4 tall (9:16) para iOS. La web usa `fileUrl` (square 1:1). */
  fileUrlTall: z.string().nullable().optional()
});
export type AlbumArtworkEntry = z.infer<typeof AlbumArtworkEntrySchema>;

// ============================================================================
// Album Artwork — fetch job  POST /api/album-artwork/fetch
//                            GET  /api/album-artwork/jobs/:id
// ============================================================================

/** Estado del job de descarga de animated artwork. */
export const ArtworkJobStatusSchema = z.enum(['queued', 'running', 'done', 'failed']);
export type ArtworkJobStatus = z.infer<typeof ArtworkJobStatusSchema>;

/** Respuesta del POST /api/album-artwork/fetch (202). */
export const ArtworkFetchEnqueuedSchema = z.object({
  jobId: z.string(),
  job: z.object({}).passthrough()
});
export type ArtworkFetchEnqueued = z.infer<typeof ArtworkFetchEnqueuedSchema>;

/** Respuesta del GET /api/album-artwork/jobs/:id. */
export const ArtworkJobSchema = z.object({
  status: ArtworkJobStatusSchema,
  matchStatus: z.string().nullable().optional(),
  outputUrl: z.string().nullable().optional(),
  outputUrlTall: z.string().nullable().optional(),
  error: z.string().nullable().optional()
});
export type ArtworkJob = z.infer<typeof ArtworkJobSchema>;

// ============================================================================
// Album Artwork — gestión admin (Housekeeping)
//   GET    /api/album-artwork              → listado (ADMIN)
//   DELETE /api/album-artwork/:albumId     → borra DB + archivos (ADMIN)
//   GET    /api/album-artwork/search       → candidatos Apple/iTunes (ADMIN)
// ============================================================================

/** Respuesta del GET /api/album-artwork — listado para Housekeeping. */
export const AlbumArtworkListResponseSchema = z.object({
  total: z.number(),
  entries: z.array(AlbumArtworkEntrySchema)
});
export type AlbumArtworkListResponse = z.infer<typeof AlbumArtworkListResponseSchema>;

/** Respuesta del DELETE /api/album-artwork/:albumId. Idempotente y best-effort:
    los archivos que ya no existían en disco se reportan en `missingFiles`. */
export const AlbumArtworkDeleteResponseSchema = z.object({
  ok: z.literal(true),
  albumId: z.string(),
  deletedFromDb: z.boolean(),
  deletedFiles: z.array(z.string()),
  missingFiles: z.array(z.string())
});
export type AlbumArtworkDeleteResponse = z.infer<typeof AlbumArtworkDeleteResponseSchema>;

/** Candidato de Apple/iTunes para el modal de confirmación del match.
    `hasMotion` indica si ese collectionId tiene motion artwork descargable.
    `artworkThumbnailUrl` es la carátula estática (300×300) para previsualizar. */
export const AppleSearchCandidateSchema = z.object({
  collectionId: z.union([z.string(), z.number()]),
  name: z.string(),
  artist: z.string(),
  hasMotion: z.boolean(),
  artworkThumbnailUrl: z.string().nullable().optional()
});
export type AppleSearchCandidate = z.infer<typeof AppleSearchCandidateSchema>;

/** Respuesta del GET /api/album-artwork/search — candidatos sin descargar nada.
    `best` es el collectionId sugerido por el auto-match (o null si ninguno
    supera el umbral de similitud). */
export const AlbumArtworkSearchResponseSchema = z.object({
  ok: z.boolean(),
  best: z.union([z.string(), z.number()]).nullable().optional(),
  bestHasMotion: z.boolean().optional(),
  candidates: z.array(AppleSearchCandidateSchema)
});
export type AlbumArtworkSearchResponse = z.infer<typeof AlbumArtworkSearchResponseSchema>;

// ============================================================================
// Last Playback — /api/user/:username/last-playback
// ============================================================================

/**
 * Item de la cola persistida en `lastPlayback.queue`. Mirror del shape que
 * iOS envía via `QueueManager.saveToBackend` y que el backend serializa
 * dentro del blob `preferences.lastPlayback`. El backend lo trata como
 * `unknown[]` así que no fuerza shape — somos nosotros (cliente) los
 * únicos consumidores de esto.
 *
 * iOS QueueManager:1670-1679 hace `PersistableSong(id, title, artist,
 * album, albumId, coverArt, duration, artistId="")` al restaurar.
 */
export const LastPlaybackQueueItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    artist: z.string(),
    album: z.string(),
    albumId: z.string().nullable().optional(),
    // `artistId` opcional — el backend lo trata como blob passthrough, así
    // que añadirlo no rompe nada. iOS legacy hardcodeaba "" porque no lo
    // necesitaba (MiniPlayer iOS no tenía link al artist). En web SÍ lo
    // necesitamos para que el nombre del artista del MiniPlayer siga siendo
    // clickeable tras un restore de lastPlayback.
    artistId: z.string().nullable().optional(),
    coverArt: z.string().nullable().optional(),
    duration: z.number()
  })
  .passthrough();
export type LastPlaybackQueueItem = z.infer<typeof LastPlaybackQueueItemSchema>;

/**
 * Estado completo del último playback. Backend interface
 * `LastPlaybackState` en userPreferencesService.ts:17-35. iOS lo restaura
 * con QueueManager.restoreLastPlayback (no autoplay).
 *
 * `path` es legacy iOS (file path local) — en web siempre vacío.
 * `currentIndex` lo añade iOS, no está tipado en el backend (vive dentro
 * del blob como campo extra). Lo aceptamos via passthrough.
 */
export const LastPlaybackStateSchema = z
  .object({
    songId: z.string(),
    title: z.string(),
    artist: z.string(),
    album: z.string(),
    coverArt: z.string().nullable().optional(),
    albumId: z.string().nullable().optional(),
    /** Ver nota en LastPlaybackQueueItemSchema. */
    artistId: z.string().nullable().optional(),
    path: z.string().optional(),
    duration: z.number(),
    position: z.number(),
    savedAt: z.string().optional(),
    queue: z.array(LastPlaybackQueueItemSchema).optional(),
    currentIndex: z.number().optional(),
    contextUri: z.string().optional(),
    playbackMode: z.string().optional()
  })
  .passthrough();
export type LastPlaybackState = z.infer<typeof LastPlaybackStateSchema>;

/**
 * Wrapper del response del GET. Si nunca hubo playback, `lastPlayback` es
 * `null`. Si lo hubo, viene el objeto entero.
 */
export const LastPlaybackResponseSchema = z.object({
  lastPlayback: LastPlaybackStateSchema.nullable()
});
export type LastPlaybackResponse = z.infer<typeof LastPlaybackResponseSchema>;

// ============================================================================
// Sesiones activas — /api/auth/sessions (backend eebf559)
// ============================================================================

/**
 * Una sesión viva del usuario, estilo "Tus dispositivos" de Google.
 *
 * `id` es un hash público estable e irreversible (NO el token) — sirve de
 * key de lista y de path param para el DELETE; sobrevive a las rotaciones de
 * token porque deriva del `familyId`. `current` lo resuelve el backend leyendo
 * el Bearer de la propia request. `country` viene solo de `cf-ipcountry`
 * (Cloudflare) → null en LAN. Todos los timestamps son epoch ms.
 *
 * `platform` usa `.catch(null)` a propósito: si el backend introdujese una
 * plataforma nueva fuera del whitelist, la fila cae a "Desconocido" en vez de
 * reventar el parse de toda la lista.
 */
export const SessionViewSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  platform: z.enum(['web', 'ios', 'android']).nullable().catch(null),
  country: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.number(),
  lastSeen: z.number(),
  expiresAt: z.number()
});
export type SessionView = z.infer<typeof SessionViewSchema>;

export const SessionsResponseSchema = z.object({
  sessions: z.array(SessionViewSchema)
});
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>;

/** GET /api/auth/sessions/all (admin) — todas las sesiones del servidor
    agrupadas por usuario. `isAdmin` = OR de los flags de las sesiones vivas
    del usuario. */
export const UserSessionsViewSchema = z.object({
  username: z.string(),
  isAdmin: z.boolean(),
  sessions: z.array(SessionViewSchema)
});
export type UserSessionsView = z.infer<typeof UserSessionsViewSchema>;
export const SessionsAllResponseSchema = z.object({
  users: z.array(UserSessionsViewSchema)
});

/** Resultado de "cerrar el resto de dispositivos" (DELETE colectivo). */
export const CloseSessionsResultSchema = z.object({
  closed: z.number()
});
export type CloseSessionsResult = z.infer<typeof CloseSessionsResultSchema>;
