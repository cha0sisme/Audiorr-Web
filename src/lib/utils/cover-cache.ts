/**
 * Cache global de covers + prefetch helper.
 *
 * Resuelve dos problemas:
 *
 * 1. Flash skeleton→fade-in al re-montar un componente con una URL ya cargada
 *    en otra parte de la sesión (típico al navegar atrás). El browser sí
 *    cachea el bitmap HTTP, pero el componente arranca con loaded=false y
 *    dispara shimmer brevemente. Con un Set global sabemos sin consultar al
 *    browser si esa URL ya completó alguna vez, y arrancamos en loaded=true.
 *
 * 2. Prefetch on hover/focus del cover hero (size mayor) que las cards no
 *    descargan por defecto. Cuando el usuario hace hover sobre una card,
 *    lanzamos `new Image()` con la URL del hero — el browser inicia el GET
 *    y, al click, el cache HTTP ya tiene la respuesta lista para el detalle.
 *
 * Sets LRU con cap a 500 entradas — sesiones largas navegan muchos álbumes,
 * no queremos memory unbounded.
 */

import { getCoverArtUrl } from '$services/NavidromeService';

const MAX_LOADED = 500;
const MAX_PREFETCH = 500;

/** URLs que han disparado onload al menos una vez en esta sesión.
    Map por orden de inserción → LRU eviction. */
const loadedUrls = new Map<string, true>();
const prefetchedUrls = new Set<string>();

export function markCoverLoaded(url: string | undefined): void {
  if (!url) return;
  // Re-insertar para llevarlo al "más reciente" y evitar evicción del LRU.
  if (loadedUrls.has(url)) loadedUrls.delete(url);
  loadedUrls.set(url, true);
  if (loadedUrls.size > MAX_LOADED) {
    const oldest = loadedUrls.keys().next().value;
    if (oldest) loadedUrls.delete(oldest);
  }
}

export function isCoverLoaded(url: string | undefined): boolean {
  return !!url && loadedUrls.has(url);
}

/**
 * Prefetch del cover en el size dado. Usa `new Image()` para que el browser
 * inicie el fetch como recurso normal — quedará en su HTTP cache y, al usarse
 * después, será cache-hit instantáneo.
 *
 * No-op si no hay coverArtId o si ya prefetcheamos esta URL (un solo hover
 * basta — el browser cachea por 10 años con el `Cache-Control: max-age` que
 * Navidrome envía).
 */
export function prefetchCover(coverArtId: string | undefined, size: number): void {
  if (!coverArtId) return;
  const url = getCoverArtUrl(coverArtId, size);
  prefetchUrl(url);
}

/**
 * Variante que acepta una URL externa (e.g. artistImageUrl de Last.fm), donde
 * no hay parámetro de tamaño que controlemos.
 */
export function prefetchUrl(url: string | undefined): void {
  if (!url || prefetchedUrls.has(url)) return;
  prefetchedUrls.add(url);
  if (prefetchedUrls.size > MAX_PREFETCH) {
    // Cap simple: cuando se llena, vaciamos. No necesitamos LRU exacto — el
    // browser igual recuerda los recursos en su cache HTTP por 10 años.
    prefetchedUrls.clear();
    prefetchedUrls.add(url);
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}
