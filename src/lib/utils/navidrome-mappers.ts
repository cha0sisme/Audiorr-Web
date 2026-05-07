/**
 * Mappers entre tipos del backend Navidrome (Subsonic) y los props que
 * consumen las cards y la SongList.
 *
 * Mantienen los componentes desacoplados del shape de Navidrome — si en el
 * futuro cambiamos a otro backend (Plex, Jellyfin, custom), solo se reescriben
 * estos mappers, no las cards.
 */

import { getCoverArtUrl } from '$services/NavidromeService';
import { prefetchCover, prefetchUrl } from '$utils/cover-cache';
import type {
  NavidromeAlbum,
  NavidromePlaylist,
  NavidromeArtist,
  NavidromeSong
} from '$types/navidrome';

/**
 * Tamaños de cover normalizados (px). El servidor (Navidrome) re-encodea con
 * Bilinear a estos tamaños y los cachea (`ND_IMAGECACHESIZE`). Una vez en el
 * cache HTTP del browser, son `Cache-Control: max-age=315360000` (~10 años).
 *
 * - CARD: cards de listas y carruseles. Se renderizan ~180px display, con DPR 2
 *   da 360 efectivo — 300 es el balance entre nitidez y bandwidth.
 * - HERO: detalle (album/artist/playlist). 232×232 css × DPR 2 = 464 — 600
 *   cubre densidades 2.5x sin sobrar.
 * - ROW: thumbnails en SongList tipo "Popular". 56×56 display, 120 sobra.
 */
const CARD_SIZE = 300;
const HERO_SIZE = 600;
const ROW_SIZE = 120;

/** Props comunes a AlbumCard. */
export type AlbumCardProps = {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string | undefined;
  href: string;
  explicit?: boolean | undefined;
  year?: number | undefined;
  /** Pre-fetch de la versión hero del cover. Las cards lo invocan en
      onmouseenter/onfocus — al click el detalle ya tendrá la imagen
      en el cache HTTP. No-op si la card no tiene coverArt. */
  prefetchHero: () => void;
};

export function albumToCardProps(album: NavidromeAlbum): AlbumCardProps {
  return {
    id: album.id,
    title: album.name,
    artist: album.artist ?? 'Artista desconocido',
    coverUrl: album.coverArt ? getCoverArtUrl(album.coverArt, CARD_SIZE) : undefined,
    href: `/album/${album.id}`,
    explicit: album.explicitStatus === 'explicit',
    year: album.year,
    prefetchHero: () => prefetchCover(album.coverArt, HERO_SIZE)
  };
}

/** Props comunes a PlaylistCard. */
export type PlaylistCardProps = {
  id: string;
  name: string;
  songCount?: number | undefined;
  owner?: string | undefined;
  coverUrl?: string | undefined;
  href: string;
  prefetchHero: () => void;
};

export function playlistToCardProps(p: NavidromePlaylist): PlaylistCardProps {
  return {
    id: p.id,
    name: p.name,
    songCount: p.songCount,
    owner: p.owner,
    coverUrl: p.coverArt ? getCoverArtUrl(p.coverArt, CARD_SIZE) : undefined,
    href: `/playlist/${p.id}`,
    prefetchHero: () => prefetchCover(p.coverArt, HERO_SIZE)
  };
}

/** Props comunes a ArtistCard. */
export type ArtistCardProps = {
  id: string;
  name: string;
  albumCount?: number | undefined;
  coverUrl?: string | undefined;
  href: string;
  prefetchHero: () => void;
};

export function artistToCardProps(a: NavidromeArtist): ArtistCardProps {
  const externalUrl =
    a.artistImageUrl && a.artistImageUrl.length > 0 ? a.artistImageUrl : undefined;
  return {
    id: a.id,
    name: a.name,
    albumCount: a.albumCount,
    // Navidrome devuelve `artistImageUrl` (URL fija scrapeada de Last.fm sin
    // parámetro de tamaño) o `coverArt` (Subsonic estándar, sí con size).
    coverUrl: externalUrl
      ? externalUrl
      : a.coverArt
        ? getCoverArtUrl(a.coverArt, CARD_SIZE)
        : undefined,
    href: `/artist/${a.id}`,
    // artistImageUrl ya es la URL final del Last.fm — solo "calentamos" cache
    // (idéntica a la del detail). Para coverArt sí pedimos el hero size.
    prefetchHero: externalUrl
      ? () => prefetchUrl(externalUrl)
      : () => prefetchCover(a.coverArt, HERO_SIZE)
  };
}

/** Item normalizado para SongList. Incluye artist opcional para playlists
    (donde tracks son de varios artistas) y coverUrl opcional para listas
    tipo "Popular" del artista (rows con thumbnail). */
export type SongListItem = {
  id: string;
  title: string;
  durationSec: number;
  trackNumber: number;
  artist?: string | undefined;
  explicit?: boolean | undefined;
  coverUrl?: string | undefined;
  /** Album donde aparece la canción — necesario al cargar al player para que
      el mini player y Now Playing muestren el contexto correcto cuando
      sale de "Popular" (sin pasar por AlbumDetail). */
  album?: string | undefined;
  albumId?: string | undefined;
  /** Necesario para "Ver artista" desde el menu contextual de cada row.
      Subsonic lo expone en cada NavidromeSong. */
  artistId?: string | undefined;
};

/** Convierte NavidromeSong → SongListItem. Pasa `includeArtist: true` para
    listas tipo playlist donde hay varios artistas, e `includeCover: true`
    para top-songs del artista. */
export function songToListItem(
  song: NavidromeSong,
  index: number,
  includeArtist = false,
  includeCover = false
): SongListItem {
  return {
    id: song.id,
    title: song.title,
    durationSec: song.duration ?? 0,
    trackNumber: song.track ?? index + 1,
    artist: includeArtist ? song.artist : undefined,
    explicit: song.explicitStatus === 'explicit',
    coverUrl: includeCover && song.coverArt ? getCoverArtUrl(song.coverArt, ROW_SIZE) : undefined,
    album: song.album,
    albumId: song.albumId,
    artistId: song.artistId
  };
}
