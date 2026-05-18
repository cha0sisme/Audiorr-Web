/**
 * userAffinity — cliente de `/api/user/:username/ranked-layout`.
 *
 * Reordena las playlists del `homepage_layout` (admin) según el perfil de
 * afinidad del usuario (scrobbles 90d, género/bpm/energy/long-term match).
 * Solo afecta a las secciones `dynamic`; las fixed_* (daily/smart/user)
 * mantienen su orden editorial.
 *
 * El backend NO cachea — confiamos en TanStack Query (staleTime 5min) en el
 * caller. Fail-soft: cualquier error devuelve null para que el caller caiga
 * al legacy `getHomepageLayout()` → DEFAULT_HOMEPAGE_LAYOUT.
 */

import { backendService } from './BackendService.svelte';
import {
  RankedLayoutResponseSchema,
  PlaylistSectionTypeSchema,
  type RankedLayoutResponse,
  type PlaylistSection
} from '$types/backend';
import { getHomepageLayout, DEFAULT_HOMEPAGE_LAYOUT } from './globalSettings';

/**
 * GET tipado del ranked-layout. `debug=true` añade breakdown de scoring por
 * playlist (~62 KB). Reservado para Housekeeping admin — no usar en home.
 *
 * Devuelve null en cualquier error (400/500/timeout/Zod) para que el caller
 * pueda caer al layout legacy sin manejo de errores explícito.
 */
export async function getRankedLayout(
  username: string,
  debug = false
): Promise<RankedLayoutResponse | null> {
  if (!username) return null;
  const qs = debug ? '?debug=1' : '';
  const path = `/api/user/${encodeURIComponent(username)}/ranked-layout${qs}`;
  try {
    return await backendService.get(path, RankedLayoutResponseSchema);
  } catch (err) {
    console.warn('[ranked-layout] fail-soft → layout legacy:', err);
    return null;
  }
}

/**
 * Convierte el ranked response al shape `PlaylistSection[]` que consume la
 * página /library. Para secciones `dynamic`, extrae los `playlistId` en el
 * orden `rankPredicted` que el backend ya entrega ordenado. Para fixed_*,
 * deja `playlists: undefined` — sus items se resuelven en la página desde
 * dailyMixesQ/smartPlaylistsQ/myPlaylists como siempre.
 *
 * Secciones con `rowType` desconocido (futuro tipo nuevo no soportado por el
 * cliente) se descartan para evitar romper el render.
 */
export function rankedToHomepageLayout(
  ranked: RankedLayoutResponse
): PlaylistSection[] {
  const sections: PlaylistSection[] = [];
  for (const s of ranked.sections) {
    const parsedType = PlaylistSectionTypeSchema.safeParse(s.rowType);
    if (!parsedType.success) {
      // Backend introdujo un `rowType` que el cliente no soporta — lo
      // descartamos silenciosamente para no romper el render, pero
      // logueamos para que un debug futuro no sea a ciegas.
      console.warn(
        `[ranked-layout] rowType desconocido "${s.rowType}" en sección "${s.sectionId}" — descartada`
      );
      continue;
    }
    const section: PlaylistSection = {
      id: s.sectionId,
      title: s.title,
      type: parsedType.data
    };
    if (parsedType.data === 'dynamic') {
      section.playlists = s.playlists.map((p) => p.playlistId);
    }
    sections.push(section);
  }
  return sections;
}

/**
 * Helper unificado para `/library` y `/library/section/[id]`. Intenta el
 * endpoint personalizado; si falla o no hay username, cae a `homepage_layout`
 * legacy; si tampoco hay, devuelve el DEFAULT.
 *
 * El caller no necesita distinguir entre las 3 rutas — el shape de salida
 * es siempre `PlaylistSection[]`.
 */
export async function loadPlaylistsLayout(
  username: string | undefined
): Promise<PlaylistSection[]> {
  if (username) {
    const ranked = await getRankedLayout(username, false);
    if (ranked) return rankedToHomepageLayout(ranked);
  }
  // Fail-soft total: `getHomepageLayout()` ya devuelve null en 404 / Zod
  // miss, pero un 5xx tiraría `BackendError` y dejaría la home en error.
  // Envolvemos para garantizar que SIEMPRE caemos a DEFAULT en último recurso.
  try {
    const legacy = await getHomepageLayout();
    return legacy ?? DEFAULT_HOMEPAGE_LAYOUT;
  } catch (err) {
    console.warn('[playlists-layout] legacy también falló → DEFAULT:', err);
    return DEFAULT_HOMEPAGE_LAYOUT;
  }
}
