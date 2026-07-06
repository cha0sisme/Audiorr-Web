import type { NavidromeAlbum } from '$types/navidrome';

/**
 * Clasificación de un álbum por tipo de lanzamiento. Alimenta el subtítulo
 * "Año · Tipo" de las AlbumCard de Discografía y los chips de filtro de
 * ArtistDetail (Todo / Álbumes / Sencillos).
 */
export type ReleaseKind = 'album' | 'single' | 'ep' | 'compilation' | 'live';

/** Etiquetas visibles (castellano). Mantener en un solo sitio — es copy
    de marca (Sencillo = paridad iOS L.single). */
export const RELEASE_KIND_LABEL: Record<ReleaseKind, string> = {
  album: 'Álbum',
  single: 'Sencillo',
  ep: 'EP',
  compilation: 'Recopilatorio',
  live: 'Álbum en vivo'
};

/**
 * Deriva el tipo de lanzamiento de un álbum.
 *
 * Fuente primaria: `releaseTypes` (OpenSubsonic, tags MusicBrainz del
 * release group). Los tipos secundarios (live, compilation) ganan al
 * primario ("album" + "live" → álbum en directo, como Apple Music).
 *
 * Fallback sin tags: heurística por songCount — mirrors la card
 * "Lanzamiento reciente" de ArtistDetailView.swift (iOS), que clasifica
 * 1 pista = sencillo, 2-6 = EP, resto = álbum.
 */
export function albumReleaseKind(
  album: Pick<NavidromeAlbum, 'releaseTypes' | 'isCompilation' | 'songCount'>
): ReleaseKind {
  const types = (album.releaseTypes ?? []).map((t) => t.toLowerCase());
  if (types.includes('live')) return 'live';
  if (types.includes('compilation') || album.isCompilation) return 'compilation';
  if (types.includes('single')) return 'single';
  if (types.includes('ep')) return 'ep';
  if (types.includes('album')) return 'album';

  const n = album.songCount ?? 0;
  if (n === 1) return 'single';
  if (n >= 2 && n <= 6) return 'ep';
  return 'album';
}

/**
 * Filtro de Discografía. 'albums' agrupa los formatos largos (álbum,
 * directo, recopilatorio); 'singles' agrupa sencillos y EPs — mismo
 * criterio de agrupación que el filtro "Sencillos y EP" de Spotify,
 * con label corto "Sencillos".
 */
export type DiscographyFilter = 'all' | 'albums' | 'singles';

export function matchesDiscographyFilter(
  kind: ReleaseKind,
  filter: DiscographyFilter
): boolean {
  if (filter === 'all') return true;
  const isSingle = kind === 'single' || kind === 'ep';
  return filter === 'singles' ? isSingle : !isSingle;
}

/** Parse defensivo del query param `?type=` de la página Ver todo. */
export function parseDiscographyFilter(raw: string | null): DiscographyFilter {
  return raw === 'albums' || raw === 'singles' ? raw : 'all';
}
