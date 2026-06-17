/**
 * RelatedAlbumsService — álbumes relacionados para el footer de AlbumDetail.
 *
 *   GET /api/related-albums?albumId=<id>&limit=12
 *   Auth: Bearer — gestionado automáticamente por BackendService.authedFetch.
 *
 * El backend resuelve la similitud vía Subsonic `getSimilarSongs2.view`
 * (Navidrome → Last.fm) y garantiza que todos los álbumes devueltos existen
 * en la biblioteca y son reproducibles. Excluye el álbum origen y aplica un
 * cap de 2 álbumes por artista para diversidad.
 *
 * Errores (404, 5xx, network) → null silencioso. La sección se esconde sola.
 * 404 es el caso esperado mientras el backend no esté desplegado con este
 * endpoint (commit 86e043f). La feature es aditiva: nunca debe romper AlbumDetail.
 */

import { backendService } from '$services/BackendService.svelte';
import {
  RelatedAlbumsResponseSchema,
  type RelatedAlbum
} from '$types/backend';

export type { RelatedAlbum };

/**
 * Obtiene los álbumes relacionados para un albumId de Navidrome.
 *
 * @param albumId  ID del álbum Navidrome (Subsonic).
 * @param limit    Máximo de resultados (default 12, backend cap 24).
 * @returns        Array de RelatedAlbum ordenados por score desc, o [] si no
 *                 hay similares o el endpoint no está disponible.
 */
export async function fetchRelatedAlbums(
  albumId: string,
  limit = 12
): Promise<RelatedAlbum[]> {
  if (!albumId) return [];
  try {
    const qs = new URLSearchParams({ albumId, limit: String(limit) });
    const res = await backendService.get(
      `/api/related-albums?${qs.toString()}`,
      RelatedAlbumsResponseSchema
    );
    return res?.relatedAlbums ?? [];
  } catch {
    // 404 (backend sin desplegar), 5xx o network error → sección oculta.
    return [];
  }
}
