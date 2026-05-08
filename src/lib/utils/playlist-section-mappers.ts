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
    owner: AUDIORR_ENGINE_LABEL,
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
    owner: AUDIORR_ENGINE_LABEL,
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

// ============================================================================
// Branding del autor — Audiorr nunca expone al admin de Navidrome como autor
// de playlists curadas o auto-generadas. Editoriales y Spotify-synced van
// firmadas como `Audiorr` (la marca); Daily Mix y Smart Playlists como
// `Audiorr Engine` (sugiere generación algorítmica). Solo las playlists del
// usuario muestran al owner real.
// ============================================================================

const AUDIORR_BRAND_LABEL = 'Audiorr';
const AUDIORR_ENGINE_LABEL = 'Audiorr Engine';

/** Subtítulo corto para PlaylistCard (cabe en una línea con `· N canciones`).
    Devuelve la string LISTA para concatenar (incluye "por …" si aplica). */
export function playlistAuthorDisplay(p: NavidromePlaylist): string {
  if (isDailyMixName(p) || isSmartPlaylistName(p)) return AUDIORR_ENGINE_LABEL;
  if (isEditorial(p) || isSpotifySynced(p)) return AUDIORR_BRAND_LABEL;
  return p.owner ? `por ${p.owner}` : '';
}

/** Frase larga para PlaylistDetail bajo el título (estilo "From the editors of …"). */
export function playlistAuthorDetail(p: NavidromePlaylist): string {
  if (isDailyMixName(p) || isSmartPlaylistName(p)) return 'Generada por Audiorr Engine';
  if (isEditorial(p) || isSpotifySynced(p)) return 'Una selección de Audiorr';
  return p.owner ? `Por ${p.owner}` : '';
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
