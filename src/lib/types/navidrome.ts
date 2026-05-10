/**
 * Zod schemas para las respuestas Subsonic/Navidrome.
 * Source of truth de los tipos — los `type X = z.infer<typeof XSchema>`
 * derivan automáticamente y se mantienen en sync con la validación.
 *
 * Per CLAUDE.md: nombres iguales que iOS (NavidromeAlbum, NavidromePlaylist,
 * NavidromeArtist, NavidromeSong) para que la mental model sea idéntica.
 */

import { z } from 'zod';

// ============================================================================
// Envelope común — toda respuesta Subsonic viene wrapped en "subsonic-response"
// ============================================================================

export const SubsonicErrorSchema = z.object({
  code: z.number(),
  message: z.string()
});

export const SubsonicEnvelopeSchema = z.object({
  status: z.enum(['ok', 'failed']),
  version: z.string(),
  type: z.string().optional(),
  serverVersion: z.string().optional(),
  error: SubsonicErrorSchema.optional()
});

export type SubsonicError = z.infer<typeof SubsonicErrorSchema>;
export type SubsonicEnvelope = z.infer<typeof SubsonicEnvelopeSchema>;

// ============================================================================
// Album
// ============================================================================

/** Forma de un record-label devuelto por OpenSubsonic en getAlbum.
    Algunos servers ya devuelven `recordLabels: [{ name: 'Sony' }]`; otros
    devuelven solo strings sueltos. Para no perder ninguno, mapeamos por
    `.name` cuando existe. */
export const NavidromeRecordLabelSchema = z.object({
  name: z.string()
});

export type NavidromeRecordLabel = z.infer<typeof NavidromeRecordLabelSchema>;

export const NavidromeAlbumSchema = z.object({
  id: z.string(),
  name: z.string(),
  artist: z.string().optional(),
  artistId: z.string().optional(),
  coverArt: z.string().optional(),
  songCount: z.number().optional(),
  duration: z.number().optional(),
  year: z.number().optional(),
  genre: z.string().optional(),
  created: z.string().optional(),
  starred: z.string().optional(),
  // OpenSubsonic extension: 'explicit' | 'clean' | '' (vacío = unknown).
  // Algunos servers no lo exponen a nivel álbum; en ese caso se deriva
  // de las songs (si CUALQUIERA es explicit → álbum es explicit).
  explicitStatus: z.string().optional(),
  // OpenSubsonic extension. Lista de sellos discográficos asociados al álbum.
  // Usado para el footer "© {year} {labels}" en AlbumDetail.
  recordLabels: z.array(NavidromeRecordLabelSchema).optional()
});

export type NavidromeAlbum = z.infer<typeof NavidromeAlbumSchema>;

// ============================================================================
// Artist
// ============================================================================

export const NavidromeArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  coverArt: z.string().optional(),
  artistImageUrl: z.string().optional(),
  albumCount: z.number().optional(),
  starred: z.string().optional()
});

export type NavidromeArtist = z.infer<typeof NavidromeArtistSchema>;

// ============================================================================
// Playlist
// ============================================================================

export const NavidromePlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  comment: z.string().optional(),
  owner: z.string().optional(),
  public: z.boolean().optional(),
  songCount: z.number().optional(),
  duration: z.number().optional(),
  created: z.string().optional(),
  changed: z.string().optional(),
  coverArt: z.string().optional()
});

export type NavidromePlaylist = z.infer<typeof NavidromePlaylistSchema>;

// ============================================================================
// Song
// ============================================================================

export const NavidromeSongSchema = z.object({
  id: z.string(),
  title: z.string(),
  album: z.string().optional(),
  albumId: z.string().optional(),
  artist: z.string().optional(),
  artistId: z.string().optional(),
  track: z.number().optional(),
  year: z.number().optional(),
  genre: z.string().optional(),
  coverArt: z.string().optional(),
  size: z.number().optional(),
  contentType: z.string().optional(),
  suffix: z.string().optional(),
  duration: z.number().optional(),
  bitRate: z.number().optional(),
  path: z.string().optional(),
  starred: z.string().optional(),
  // OpenSubsonic extension. 'explicit' marca contenido explícito;
  // 'clean' es la edición limpia; vacío/undefined = no etiquetado.
  explicitStatus: z.string().optional()
});

export type NavidromeSong = z.infer<typeof NavidromeSongSchema>;

// ============================================================================
// Endpoint-specific response schemas
// ============================================================================

/** GET /rest/getAlbumList2 → albumList2.album[] */
export const AlbumList2ResponseSchema = z.object({
  albumList2: z.object({
    album: z.array(NavidromeAlbumSchema).optional()
  })
});

/** GET /rest/getArtists → artists.index[].artist[] (alphabetic indexing) */
export const ArtistsResponseSchema = z.object({
  artists: z.object({
    index: z
      .array(
        z.object({
          name: z.string(),
          artist: z.array(NavidromeArtistSchema).optional()
        })
      )
      .optional()
  })
});

/** GET /rest/getPlaylists → playlists.playlist[] */
export const PlaylistsResponseSchema = z.object({
  playlists: z.object({
    playlist: z.array(NavidromePlaylistSchema).optional()
  })
});

/** GET /rest/getAlbum → album with embedded songs */
export const AlbumResponseSchema = z.object({
  album: NavidromeAlbumSchema.extend({
    song: z.array(NavidromeSongSchema).optional()
  })
});

/** GET /rest/getSong → song singleton */
export const SongResponseSchema = z.object({
  song: NavidromeSongSchema
});

/** GET /rest/getUser — info del usuario incluyendo roles. */
export const NavidromeUserSchema = z.object({
  username: z.string(),
  email: z.string().optional(),
  scrobblingEnabled: z.boolean().optional(),
  adminRole: z.boolean().optional(),
  settingsRole: z.boolean().optional(),
  downloadRole: z.boolean().optional(),
  uploadRole: z.boolean().optional(),
  playlistRole: z.boolean().optional(),
  coverArtRole: z.boolean().optional(),
  commentRole: z.boolean().optional(),
  podcastRole: z.boolean().optional(),
  streamRole: z.boolean().optional(),
  jukeboxRole: z.boolean().optional(),
  shareRole: z.boolean().optional()
});
export type NavidromeUser = z.infer<typeof NavidromeUserSchema>;
export const UserResponseSchema = z.object({
  user: NavidromeUserSchema
});

/** GET /rest/getPlaylist → playlist with embedded entries (songs) */
export const PlaylistResponseSchema = z.object({
  playlist: NavidromePlaylistSchema.extend({
    entry: z.array(NavidromeSongSchema).optional()
  })
});

/** GET /rest/getArtist → artist with embedded albums */
export const ArtistResponseSchema = z.object({
  artist: NavidromeArtistSchema.extend({
    album: z.array(NavidromeAlbumSchema).optional()
  })
});

// ============================================================================
// AlbumInfo / ArtistInfo — Last.fm-backed metadata (Subsonic getAlbumInfo2 /
// getArtistInfo2). Devuelven notas, biografía, similar artists, mb/lastfm urls.
// Casi todo es opcional: muchos servers no exponen todos los campos según
// si el plugin Last.fm está activo o no.
// ============================================================================

export const NavidromeAlbumInfoSchema = z.object({
  notes: z.string().optional(),
  musicBrainzId: z.string().optional(),
  lastFmUrl: z.string().optional(),
  smallImageUrl: z.string().optional(),
  mediumImageUrl: z.string().optional(),
  largeImageUrl: z.string().optional()
});

export type NavidromeAlbumInfo = z.infer<typeof NavidromeAlbumInfoSchema>;

/** GET /rest/getAlbumInfo2 → albumInfo */
export const AlbumInfoResponseSchema = z.object({
  albumInfo: NavidromeAlbumInfoSchema
});

/** Forma cruda de un similar artist devuelto por Last.fm via Subsonic.
    El id puede venir vacío si el server no tiene el artista en su biblioteca
    (Last.fm devuelve por nombre, no garantiza un match local). */
export const NavidromeSimilarArtistSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  coverArt: z.string().optional(),
  artistImageUrl: z.string().optional(),
  albumCount: z.number().optional()
});

export type NavidromeSimilarArtist = z.infer<typeof NavidromeSimilarArtistSchema>;

export const NavidromeArtistInfoSchema = z.object({
  biography: z.string().optional(),
  musicBrainzId: z.string().optional(),
  lastFmUrl: z.string().optional(),
  smallImageUrl: z.string().optional(),
  mediumImageUrl: z.string().optional(),
  largeImageUrl: z.string().optional(),
  similarArtist: z.array(NavidromeSimilarArtistSchema).optional()
});

export type NavidromeArtistInfo = z.infer<typeof NavidromeArtistInfoSchema>;

/** GET /rest/getArtistInfo2 → artistInfo2 */
export const ArtistInfoResponseSchema = z.object({
  artistInfo2: NavidromeArtistInfoSchema
});

/** GET /rest/getTopSongs (artistName param) → topSongs.song[]
    Devuelve top tracks rankeadas por Last.fm para un artist name dado. */
export const TopSongsResponseSchema = z.object({
  topSongs: z.object({
    song: z.array(NavidromeSongSchema).optional()
  })
});

// ============================================================================
// LYRICS — dos endpoints distintos del Subsonic ecosystem:
//
//   - getLyricsBySongId (OpenSubsonic, 1.16.1+): devuelve letras EMBEDDED del
//     archivo (ID3 USLT/SYLT) o del .lrc al lado del archivo. Reemplaza la
//     necesidad de leer ID3 desde el cliente. Acepta `id` (songId).
//     Response shape: lyricsList.structuredLyrics[] con `synced: bool` y
//     `line[]` con `start` (ms) si synced.
//
//   - getLyrics (Subsonic legacy 1.2.0+): busca letras por title+artist en
//     el plugin Last.fm del server. Plain text único (no synced). Útil como
//     último fallback cuando el archivo no tiene letras embedded ni LRCLib
//     responde.
// ============================================================================

export const LyricsLineSchema = z.object({
  /** Tiempo en milisegundos. Solo presente si la pista es synced. */
  start: z.number().optional(),
  value: z.string()
});

export const StructuredLyricsSchema = z.object({
  lang: z.string().optional(),
  synced: z.boolean().optional(),
  displayArtist: z.string().optional(),
  displayTitle: z.string().optional(),
  line: z.array(LyricsLineSchema).default([])
});

export type StructuredLyrics = z.infer<typeof StructuredLyricsSchema>;

export const LyricsBySongIdResponseSchema = z.object({
  lyricsList: z
    .object({
      structuredLyrics: z.array(StructuredLyricsSchema).default([])
    })
    .optional()
});

export const LyricsLegacyResponseSchema = z.object({
  lyrics: z
    .object({
      artist: z.string().optional(),
      title: z.string().optional(),
      value: z.string().optional()
    })
    .optional()
});

// ============================================================================
// AlbumList2 con artistId — Subsonic permite filtrar getAlbumList2 por
// byArtist + artistId para traer todos los álbumes en los que aparece un
// artista (incluyendo collabs donde no es el albumArtist). Reutilizamos
// AlbumList2ResponseSchema que ya existe.
// ============================================================================


// ============================================================================
// Search3 — endpoint unificado que devuelve artistas + álbumes + canciones
// para una query. Subsonic NO incluye playlists en search3, las filtramos
// client-side desde getPlaylists() (cacheado por library).
//
// Cada array es opcional: si la query no tiene matches en ese tipo, el
// server omite el array entero (no devuelve lista vacía).
// ============================================================================

export const Search3ResponseSchema = z.object({
  searchResult3: z.object({
    artist: z.array(NavidromeArtistSchema).optional(),
    album: z.array(NavidromeAlbumSchema).optional(),
    song: z.array(NavidromeSongSchema).optional()
  })
});

export type Search3Result = {
  artists: NavidromeArtist[];
  albums: NavidromeAlbum[];
  songs: NavidromeSong[];
};
