/**
 * Datos simulados temporales. Se reemplazan por NavidromeService + TanStack
 * Query cuando esté el siguiente turno. La forma de los objetos imita los
 * tipos Subsonic/Navidrome para minimizar cambios después.
 */

export type FakeTrack = {
  id: string;
  title: string;
  durationSec: number;
  trackNumber: number;
};

export type FakeAlbum = {
  id: string;
  title: string;
  artist: string;
  year?: number;
  coverUrl?: string;
  tracks?: FakeTrack[];
};

/* Pool de títulos genéricos — se reemplaza por tracklists reales cuando
   conectemos NavidromeService. Los títulos buscan ser "neutralmente bonitos"
   para que las cards no se sientan vacías. */
const TRACK_POOL = [
  'Aurora',         'Beneath the Tide',  'Crystal Lattice',  'Drifting Skies',
  'Echo Chamber',   'Foreign Cities',    'Glass Reflections', 'Hollow Moon',
  'Inside Out',     'Just Before Dawn',  'Kaleidoscope',      'Lost Signal',
  'Midnight Drive', 'Neon Pulse',        'Open Air',          'Phantom Limb'
];

/** Genera un tracklist determinístico (mismo input → mismo output, SSR safe). */
function makeTracks(albumId: string, count = 10): FakeTrack[] {
  // Hash determinístico del id para variar el slice de pool entre álbumes
  const seed = [...albumId].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const titleIdx = (seed + i) % TRACK_POOL.length;
    const title = TRACK_POOL[titleIdx]!;
    const durationSec = 180 + ((seed + i * 47) % 180); // 3-6 min determinístico
    return {
      id: `${albumId}-t${i + 1}`,
      title,
      durationSec,
      trackNumber: i + 1
    };
  });
}

/** Decora una lista de albums con tracks generados (8-12 por album). */
function withTracks(albums: Omit<FakeAlbum, 'tracks'>[]): FakeAlbum[] {
  return albums.map((a) => {
    const seed = [...a.id].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
    const count = 8 + (seed % 5); // 8-12 tracks
    return { ...a, tracks: makeTracks(a.id, count) };
  });
}

/** Track de playlist — incluye artist propio (las playlists tienen tracks
    de varios artistas, a diferencia de los tracks de un álbum). */
export type FakePlaylistTrack = FakeTrack & {
  artist: string;
  albumId?: string;
};

export type FakePlaylist = {
  id: string;
  name: string;
  songCount: number;
  owner?: string;
  coverUrl?: string;
  tracks?: FakePlaylistTrack[];
};

export type FakeArtist = {
  id: string;
  name: string;
  albumCount?: number;
  coverUrl?: string;
};

export const recentReleases: FakeAlbum[] = withTracks([
  { id: 'r1', title: 'Hit Me Hard and Soft', artist: 'Billie Eilish', year: 2024 },
  { id: 'r2', title: 'Brat', artist: 'Charli XCX', year: 2024 },
  { id: 'r3', title: 'The Tortured Poets Department', artist: 'Taylor Swift', year: 2024 },
  { id: 'r4', title: 'Lover', artist: 'Taylor Swift', year: 2019 },
  { id: 'r5', title: 'Multitude', artist: 'Stromae', year: 2022 },
  { id: 'r6', title: 'Renaissance', artist: 'Beyoncé', year: 2022 },
  { id: 'r7', title: 'WE', artist: 'Arcade Fire', year: 2022 },
  { id: 'r8', title: 'Mr. Morale & The Big Steppers', artist: 'Kendrick Lamar', year: 2022 },
  { id: 'r9', title: 'An Evening With Silk Sonic', artist: 'Silk Sonic', year: 2021 },
  { id: 'r10', title: 'Sour', artist: 'Olivia Rodrigo', year: 2021 },
  { id: 'r11', title: 'Happier Than Ever', artist: 'Billie Eilish', year: 2021 },
  { id: 'r12', title: 'Justice', artist: 'Justin Bieber', year: 2021 }
]);

export const mostPlayed: FakeAlbum[] = withTracks([
  { id: 'm1', title: 'Currents', artist: 'Tame Impala', year: 2015 },
  { id: 'm2', title: 'Discovery', artist: 'Daft Punk', year: 2001 },
  { id: 'm3', title: 'In Rainbows', artist: 'Radiohead', year: 2007 },
  { id: 'm4', title: 'OK Computer', artist: 'Radiohead', year: 1997 },
  { id: 'm5', title: 'Channel Orange', artist: 'Frank Ocean', year: 2012 },
  { id: 'm6', title: 'Blonde', artist: 'Frank Ocean', year: 2016 },
  { id: 'm7', title: 'Demon Days', artist: 'Gorillaz', year: 2005 },
  { id: 'm8', title: 'Plastic Beach', artist: 'Gorillaz', year: 2010 },
  { id: 'm9', title: 'Random Access Memories', artist: 'Daft Punk', year: 2013 },
  { id: 'm10', title: 'AM', artist: 'Arctic Monkeys', year: 2013 },
  { id: 'm11', title: 'Lonerism', artist: 'Tame Impala', year: 2012 }
]);

export const randomAlbums: FakeAlbum[] = withTracks([
  { id: 'x1', title: 'Innerspeaker', artist: 'Tame Impala', year: 2010 },
  { id: 'x2', title: 'Lonerism', artist: 'Tame Impala', year: 2012 },
  { id: 'x3', title: 'Salad Days', artist: 'Mac DeMarco', year: 2014 },
  { id: 'x4', title: 'This Old Dog', artist: 'Mac DeMarco', year: 2017 },
  { id: 'x5', title: 'Dummy', artist: 'Portishead', year: 1994 },
  { id: 'x6', title: 'Endtroducing.....', artist: 'DJ Shadow', year: 1996 },
  { id: 'x7', title: 'Selected Ambient Works 85-92', artist: 'Aphex Twin', year: 1992 },
  { id: 'x8', title: 'Donuts', artist: 'J Dilla', year: 2006 },
  { id: 'x9', title: 'Madvillainy', artist: 'Madvillain', year: 2004 },
  { id: 'x10', title: 'Music Has the Right to Children', artist: 'Boards of Canada', year: 1998 }
]);

export const newestAlbums: FakeAlbum[] = withTracks([
  { id: 'n1', title: 'Cowboy Carter', artist: 'Beyoncé', year: 2024 },
  { id: 'n2', title: 'Romance', artist: 'Fontaines D.C.', year: 2024 },
  { id: 'n3', title: 'Two Star & The Dream Police', artist: 'Mk.gee', year: 2024 },
  { id: 'n4', title: 'Charm', artist: 'Clairo', year: 2024 },
  { id: 'n5', title: 'Funeral for Justice', artist: 'Mdou Moctar', year: 2024 },
  { id: 'n6', title: 'Tigers Blood', artist: 'Waxahatchee', year: 2024 },
  { id: 'n7', title: 'Older', artist: 'Lizzy McAlpine', year: 2024 },
  { id: 'n8', title: 'Wild God', artist: 'Nick Cave & The Bad Seeds', year: 2024 },
  { id: 'n9', title: 'A La Sala', artist: 'Khruangbin', year: 2024 },
  { id: 'n10', title: 'Imaginal Disk', artist: 'Magdalena Bay', year: 2024 }
]);

/** Helper para que /album/[id] resuelva un álbum por ID. */
export const ALL_ALBUMS: FakeAlbum[] = [
  ...recentReleases,
  ...mostPlayed,
  ...randomAlbums,
  ...newestAlbums
];

export function findAlbumById(id: string): FakeAlbum | undefined {
  return ALL_ALBUMS.find((a) => a.id === id);
}

/* ------------------------------------------------------------------------- */
/* Playlist tracks: mezcla pseudo-aleatoria de tracks de varios albums       */

function generatePlaylistTracks(playlistId: string, count: number): FakePlaylistTrack[] {
  const seed = [...playlistId].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const albumIdx = (seed + i * 13) % ALL_ALBUMS.length;
    const album = ALL_ALBUMS[albumIdx]!;
    const trackIdx = (seed + i * 17) % (album.tracks?.length ?? 1);
    const track = album.tracks?.[trackIdx];
    return {
      id: `${playlistId}-t${i + 1}`,
      title: track?.title ?? `Track ${i + 1}`,
      artist: album.artist,
      albumId: album.id,
      durationSec: track?.durationSec ?? 200,
      trackNumber: i + 1
    };
  });
}

// (La decoración de playlists con tracks va al final del archivo, donde
// `playlists` ya está declarado.)

export function findPlaylistById(id: string): FakePlaylist | undefined {
  return playlists.find((p) => p.id === id);
}

/* ------------------------------------------------------------------------- */
/* Artist data: top tracks + albums del catálogo                             */

export function findArtistById(id: string): FakeArtist | undefined {
  return artists.find((a) => a.id === id);
}

/** Albums de un artista — busca en ALL_ALBUMS por nombre de artista exacto. */
export function albumsByArtist(artistName: string): FakeAlbum[] {
  return ALL_ALBUMS.filter((a) => a.artist === artistName);
}

/** Top tracks del artista — toma el primer track de cada album suyo. */
export function topTracksOfArtist(artistName: string, max = 8): FakePlaylistTrack[] {
  const albums = albumsByArtist(artistName);
  const tracks: FakePlaylistTrack[] = [];
  for (const album of albums) {
    if (!album.tracks) continue;
    for (const t of album.tracks.slice(0, 2)) {
      tracks.push({
        id: t.id,
        title: t.title,
        artist: artistName,
        albumId: album.id,
        durationSec: t.durationSec,
        trackNumber: tracks.length + 1
      });
      if (tracks.length >= max) return tracks;
    }
  }
  return tracks;
}

export const playlists: FakePlaylist[] = [
  { id: 'p1', name: 'Concentración profunda', songCount: 87, owner: 'leandro' },
  { id: 'p2', name: 'Lo mejor de 2024', songCount: 54, owner: 'leandro' },
  { id: 'p3', name: 'Indie en español', songCount: 132, owner: 'leandro' },
  { id: 'p4', name: 'Jazz para domingo', songCount: 42, owner: 'leandro' },
  { id: 'p5', name: 'Workout', songCount: 28, owner: 'leandro' },
  { id: 'p6', name: 'Viajes en coche', songCount: 95, owner: 'leandro' },
  { id: 'p7', name: 'Lo-fi sessions', songCount: 67, owner: 'leandro' },
  { id: 'p8', name: 'Clásicos del rock', songCount: 156, owner: 'leandro' },
  { id: 'p9', name: 'Electrónica nocturna', songCount: 73, owner: 'leandro' },
  { id: 'p10', name: 'Despertar suave', songCount: 31, owner: 'leandro' }
];

export const artists: FakeArtist[] = [
  { id: 'a1', name: 'Tame Impala', albumCount: 4 },
  { id: 'a2', name: 'Radiohead', albumCount: 9 },
  { id: 'a3', name: 'Daft Punk', albumCount: 4 },
  { id: 'a4', name: 'Frank Ocean', albumCount: 2 },
  { id: 'a5', name: 'Arctic Monkeys', albumCount: 7 },
  { id: 'a6', name: 'Mac DeMarco', albumCount: 6 },
  { id: 'a7', name: 'Beyoncé', albumCount: 8 },
  { id: 'a8', name: 'Billie Eilish', albumCount: 3 },
  { id: 'a9', name: 'Charli XCX', albumCount: 6 },
  { id: 'a10', name: 'Kendrick Lamar', albumCount: 5 },
  { id: 'a11', name: 'Khruangbin', albumCount: 4 },
  { id: 'a12', name: 'Aphex Twin', albumCount: 12 }
];

/* ------------------------------------------------------------------------- */
/* Index para que /library/[type] resuelva el dataset correcto.              */

export type LibraryType = 'recent' | 'most-played' | 'random' | 'newest' | 'playlists' | 'artists';

export type LibraryKind = 'album' | 'playlist' | 'artist';
export type LibraryItem = FakeAlbum | FakePlaylist | FakeArtist;

export const LIBRARY_INDEX: Record<
  LibraryType,
  { title: string; kind: LibraryKind; items: readonly LibraryItem[] }
> = {
  'recent':       { title: 'Recientemente añadido', kind: 'album',    items: recentReleases },
  'most-played':  { title: 'Más escuchado',         kind: 'album',    items: mostPlayed },
  'random':       { title: 'Aleatorio',             kind: 'album',    items: randomAlbums },
  'newest':       { title: 'Nuevos lanzamientos',   kind: 'album',    items: newestAlbums },
  'playlists':    { title: 'Tus playlists',         kind: 'playlist', items: playlists },
  'artists':      { title: 'Artistas',              kind: 'artist',   items: artists }
};

/* ------------------------------------------------------------------------- */
/* Decoración de playlists con tracks generados — ejecuta al cargar el módulo,
   después de que todas las declaraciones estén disponibles.                  */

playlists.forEach((p) => {
  p.tracks = generatePlaylistTracks(p.id, Math.min(p.songCount, 25));
});
