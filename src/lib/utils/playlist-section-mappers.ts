/**
 * playlist-section-mappers — mappers DailyMix/SmartPlaylist → props de
 * PlaylistCard, y filtros de categorización del legacy PlaylistsPage.
 *
 * Compartidos entre /library?tab=playlists (carruseles) y /library/<type>
 * (SeeAllGrid de cada sección).
 */

import { getPlaylistCoverUrl } from '$services/dailyMixes';
import type { DailyMix, SmartPlaylist } from '$types/backend';
import type { NavidromePlaylist } from '$types/navidrome';
import type { PlaylistCardProps } from './navidrome-mappers';

/**
 * Cover SIEMPRE del backend personalizado. El store playlistCovers ya tiene
 * el `coverContentHash` post-fetch de getDailyMixes/getSmartPlaylists, así
 * que las URLs salen con `?v=<hash>` (immutable 1 año).
 */
export function dailyMixToProps(mix: DailyMix): PlaylistCardProps {
  return {
    id: mix.navidromeId ?? `mix-${mix.mixNumber}`,
    name: mix.name,
    songCount: mix.trackCount,
    coverUrl: mix.navidromeId ? getPlaylistCoverUrl(mix.navidromeId) : undefined,
    href: mix.navidromeId ? `/playlist/${mix.navidromeId}` : '#',
    prefetchHero: () => {}
  };
}

export function smartPlaylistToProps(sp: SmartPlaylist): PlaylistCardProps {
  return {
    id: sp.navidromeId ?? `smart-${sp.playlistKey}`,
    name: sp.name,
    songCount: sp.trackCount,
    coverUrl: sp.navidromeId ? getPlaylistCoverUrl(sp.navidromeId) : undefined,
    href: sp.navidromeId ? `/playlist/${sp.navidromeId}` : '#',
    prefetchHero: () => {}
  };
}

// ============================================================================
// Filtros de categorización — replican legacy PlaylistsPage:239-267.
// ============================================================================

export function isSpotifySynced(p: NavidromePlaylist): boolean {
  const name = (p.name ?? '').trim().toLowerCase();
  if (name.startsWith('[spotify] ')) return true;
  return (p.comment ?? '').includes('Spotify Synced');
}

export function isSmartPlaylistName(p: NavidromePlaylist): boolean {
  const name = (p.name ?? '').trim().toLowerCase();
  if ((p.comment ?? '').includes('Smart Playlist')) return true;
  return ['en bucle', 'tiempo atras', 'radar de novedades'].includes(name);
}

export function isDailyMixName(p: NavidromePlaylist): boolean {
  return (p.name ?? '').trim().toLowerCase().startsWith('mix diario');
}

export function isEditorial(p: NavidromePlaylist): boolean {
  return (p.comment ?? '').includes('[Editorial]');
}

/**
 * Filtra las playlists del usuario para `fixed_user`: owner=username y no
 * generadas automáticamente ni etiquetadas como editorial / Spotify-synced.
 */
export function filterMyPlaylists(
  all: NavidromePlaylist[],
  username: string | undefined
): NavidromePlaylist[] {
  if (!username) return [];
  return all.filter(
    (p) =>
      !isDailyMixName(p) &&
      !isSmartPlaylistName(p) &&
      p.owner === username &&
      !isEditorial(p) &&
      !isSpotifySynced(p)
  );
}
