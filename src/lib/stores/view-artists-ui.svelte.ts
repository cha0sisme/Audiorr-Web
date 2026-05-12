/**
 * Store UI para el mini-modal "Ver artistas" — se abre desde el menu contextual
 * de SongRow cuando la canción tiene más de un artista en `song.artists[]`
 * (OpenSubsonic). El modal vive en +layout y se renderiza condicionalmente.
 *
 * Es solo el plumbing de visibilidad + payload (artistas a listar). El fetch
 * de avatar de cada artista lo hace el propio modal con TanStack Query.
 */

import type { NavidromeItemArtist } from '$types/navidrome';

class ViewArtistsUI {
  isOpen = $state(false);
  artists = $state<NavidromeItemArtist[]>([]);
  songTitle = $state<string | undefined>(undefined);

  open(artists: NavidromeItemArtist[], songTitle?: string) {
    this.artists = artists;
    this.songTitle = songTitle;
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
  }
}

export const viewArtistsUI = new ViewArtistsUI();
