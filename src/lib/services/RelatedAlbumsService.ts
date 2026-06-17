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
import { getQueryClient } from '$services/query-bus';
import {
  RelatedAlbumsResponseSchema,
  type RelatedAlbum
} from '$types/backend';

export type { RelatedAlbum };

/** staleTime compartido con la query de AlbumDetail (`['relatedAlbums', id]`).
    Debe coincidir para que el prefetch on-hover quede "fresco" cuando el detalle
    monte su `createQuery` → render instantáneo sin refetch. */
const RELATED_STALE_MS = 1000 * 60 * 30;

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

/**
 * Pre-carga los álbumes relacionados de un albumId en la caché de TanStack,
 * usando la MISMA queryKey que AlbumDetail (`['relatedAlbums', id]`). Se invoca
 * on-hover desde las cards: cuando el usuario navega al detalle, el dato ya está
 * fresco → la sección renderiza al instante en lugar de esperar el round-trip
 * (getAlbum + 3× getSimilarSongs2 → Last.fm) del primer cache miss del backend.
 *
 * `prefetchQuery` respeta `staleTime`, así que repetir el hover sobre el mismo
 * álbum dentro de la ventana es un no-op (no duplica peticiones). No-op también
 * antes de que +layout.svelte registre el QueryClient.
 */
export function prefetchRelatedAlbums(albumId: string): void {
  const qc = getQueryClient();
  if (!qc || !albumId) return;
  void qc.prefetchQuery({
    queryKey: ['relatedAlbums', albumId],
    queryFn: () => fetchRelatedAlbums(albumId),
    staleTime: RELATED_STALE_MS,
    retry: false
  });
}
