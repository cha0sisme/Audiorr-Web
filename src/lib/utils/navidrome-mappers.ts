/**
 * Mappers entre tipos del backend Navidrome (Subsonic) y los props que
 * consumen las cards y la SongList.
 *
 * Mantienen los componentes desacoplados del shape de Navidrome — si en el
 * futuro cambiamos a otro backend (Plex, Jellyfin, custom), solo se reescriben
 * estos mappers, no las cards.
 */

import { getCoverArtUrl } from '$services/NavidromeService';
import type {
  NavidromeAlbum,
  NavidromePlaylist,
  NavidromeArtist,
  NavidromeSong
} from '$types/navidrome';

/** Props comunes a AlbumCard. */
export type AlbumCardProps = {
  id: string;
  title: string;
  artist: string;
  coverUrl?: string | undefined;
  href: string;
  explicit?: boolean | undefined;
  year?: number | undefined;
};

export function albumToCardProps(album: NavidromeAlbum): AlbumCardProps {
  return {
    id: album.id,
    title: album.name,
    artist: album.artist ?? 'Artista desconocido',
    // 500: misma URL que el hero del AlbumDetail → cache shared. CRÍTICO
    // para que la View Transition card → detail no parpadee al final del
    // morph (el cover del detail muestra inmediato del cache en lugar de
    // re-descargar). El bitmap es 1 MB vs 360 KB de 300×300, pero con
    // virtualización solo hay ~40 cards mounted = ~40 MB total, fine.
    coverUrl: album.coverArt ? getCoverArtUrl(album.coverArt, 500) : undefined,
    href: `/album/${album.id}`,
    explicit: album.explicitStatus === 'explicit',
    year: album.year
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
};

export function playlistToCardProps(p: NavidromePlaylist): PlaylistCardProps {
  return {
    id: p.id,
    name: p.name,
    songCount: p.songCount,
    owner: p.owner,
    // 500: cache-share con PlaylistDetail hero. Ver nota en albumToCardProps.
    coverUrl: p.coverArt ? getCoverArtUrl(p.coverArt, 500) : undefined,
    href: `/playlist/${p.id}`
  };
}

/** Props comunes a ArtistCard. */
export type ArtistCardProps = {
  id: string;
  name: string;
  albumCount?: number | undefined;
  coverUrl?: string | undefined;
  href: string;
};

export function artistToCardProps(a: NavidromeArtist): ArtistCardProps {
  return {
    id: a.id,
    name: a.name,
    albumCount: a.albumCount,
    // Navidrome tiene `artistImageUrl` (Last.fm scrape) o `coverArt`
    coverUrl:
      a.artistImageUrl && a.artistImageUrl.length > 0
        ? a.artistImageUrl
        : a.coverArt
          ? getCoverArtUrl(a.coverArt, 500)
          : undefined,
    href: `/artist/${a.id}`
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
    coverUrl: includeCover && song.coverArt ? getCoverArtUrl(song.coverArt, 200) : undefined,
    album: song.album,
    albumId: song.albumId,
    artistId: song.artistId
  };
}
