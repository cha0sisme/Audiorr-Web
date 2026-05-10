<script lang="ts">
  /**
   * CoverImage — render robusto de cualquier cover/avatar/artwork.
   *
   * Filosofía: SIMPLE. Confiar en el browser para cargar la imagen y
   * disparar onload/onerror. No imponemos timeouts artificiales que
   * compitan contra la pool de conexiones del browser. No usamos
   * `image.decode()` porque introduce complexity sin beneficio observable
   * en covers de tamaño normal.
   *
   * Estados:
   *   - loading: la imagen se está descargando. Skeleton + shimmer.
   *   - loaded:  fade-in de 240ms.
   *   - errored: el browser disparó onerror (404, network fail). Skeleton
   *              estático con fallback icon.
   *
   * Cache-hit fast path: para URLs ya cargadas en otra parte de la sesión
   * (set global `cover-cache.ts`), arrancamos directamente en loaded=true
   * sin esperar al microtask. Sin esto, navegar atrás a una página con
   * cards ya vistas dispara shimmer→fade brevemente aunque el bitmap
   * esté en el cache HTTP del browser.
   *
   * Cache-hit recovery (fallback): si el browser dispara onload SINCRÓNICAMENTE
   * para imágenes cacheadas en el HTTP cache pero no en nuestro Set (e.g.
   * primer paint tras refresh), un queueMicrotask después del reset chequea
   * `imgEl.complete` y restaura loaded=true.
   *
   * Disposal: NO reseteamos src en unmount. En grids virtualizados, el
   * unmount es frecuente y abortar el GET fuerza retries cuando la card
   * vuelve a entrar al viewport. El browser ya gestiona su image-cache LRU.
   */
  import type { Snippet } from 'svelte';
  import { isCoverLoaded, markCoverLoaded } from '$utils/cover-cache';

  type Props = {
    src?: string | undefined;
    alt: string;
    /** Forma del cover. Default 'square'. 'circle' para avatares. */
    shape?: 'square' | 'circle';
    /** Native lazy loading. Default true (cards en grid).
        false para hero/above-the-fold. */
    lazy?: boolean;
    /** fetchpriority hint. 'high' para hero, 'low' para card grids
        (deprioriza covers vs API fetches). Default 'auto'. */
    priority?: 'high' | 'auto' | 'low';
    /** Width/height intrinsic hints — el browser los usa para mejorar la
        heurística de lazy-loading nativo (especialmente en overflow scroll
        horizontal donde sin estos las cards se cargan todas a la vez por
        considerarlas "near viewport"). NO controlan el render visual: el
        layout sigue siendo `width: 100%; height: 100%` con object-fit cover.
        Pasa el size pedido a getCoverArtUrl para coherencia (300 para cards,
        600 para hero). */
    width?: number;
    height?: number;
    /** Snippet del icono fallback (cuando no hay src o falla la carga). */
    fallback?: Snippet;
  };

  let {
    src,
    alt,
    shape = 'square',
    lazy = true,
    priority = 'auto',
    width,
    height,
    fallback
  }: Props = $props();

  let loaded = $state(false);
  let errored = $state(false);
  let imgEl: HTMLImageElement | undefined = $state();
  let coverEl: HTMLDivElement | undefined = $state();

  /** True una vez el elemento ha entrado al viewport (o si lazy=false desde
      el principio). Sin esto, en horizontal scroll containers Chrome/Safari
      cargan TODAS las cards a la vez con `loading="lazy"` native porque las
      consideran "near viewport" — saturando al server con N requests
      paralelos. El IntersectionObserver da control real: el GET se dispara
      solo cuando la card está a punto de verse (rootMargin 200px).

      Inicializado a false; un $effect aparte lo pone a true cuando lazy
      es false (evita el warning Svelte 5 de capturar el valor inicial de
      una prop reactiva). */
  let visible = $state(false);
  $effect(() => {
    if (!lazy) visible = true;
  });

  /** Setup del IntersectionObserver — solo cuando lazy=true y aún no visible.
      Observamos el wrapper `.cover` (siempre presente con skeleton) en lugar
      del <img> que solo existe cuando showImage es true. */
  $effect(() => {
    if (!lazy || visible) return;
    if (!coverEl) return;
    if (typeof IntersectionObserver === 'undefined') {
      // SSR / browser muy viejo: degradación → visible desde el start.
      visible = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            visible = true;
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px 100px' }
    );
    io.observe(coverEl);
    return () => io.disconnect();
  });

  /** Reset al cambiar src + cache-hit fast path + recovery. */
  $effect(() => {
    const currentSrc = src;
    errored = false;

    // Fast path: la URL ya completó alguna vez en esta sesión → no hay
    // shimmer, arrancamos en loaded=true directamente.
    if (isCoverLoaded(currentSrc)) {
      loaded = true;
      return;
    }

    loaded = false;
    if (!currentSrc) return;

    // Fallback: si el browser dispara onload sincrónicamente porque la imagen
    // ya está en su cache HTTP (sin pasar por nuestro Set — e.g. primer paint
    // tras refresh), queueMicrotask checa post-reset si imgEl.complete.
    queueMicrotask(() => {
      if (
        imgEl &&
        imgEl.complete &&
        imgEl.naturalWidth > 0 &&
        (imgEl.src.endsWith(currentSrc) || imgEl.src === currentSrc)
      ) {
        loaded = true;
        markCoverLoaded(currentSrc);
      }
    });
  });

  function handleLoad() {
    loaded = true;
    markCoverLoaded(src);
  }

  function handleError() {
    errored = true;
  }

  /** showImage requiere visible (gating por IO). Cuando aún no visible, solo
      renderizamos el skeleton — sin <img> en el DOM = cero requests HTTP. */
  const showImage = $derived(!!src && !errored && visible);
  const showSkeleton = $derived(!loaded || errored || !src);
  const showShimmer = $derived(!!src && !errored && !loaded);
  const showFallback = $derived((errored || !src) && !!fallback);
</script>

<div bind:this={coverEl} class="cover" class:circle={shape === 'circle'}>
  {#if showImage}
    <img
      bind:this={imgEl}
      {src}
      {alt}
      {width}
      {height}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      fetchpriority={priority}
      onload={handleLoad}
      onerror={handleError}
      class:loaded
    />
  {/if}

  {#if showSkeleton}
    <div class="skeleton" class:shimmer={showShimmer} aria-hidden="true">
      {#if showFallback}
        <span class="fallback">{@render fallback!()}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cover {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .cover.circle {
    border-radius: 50%;
  }

  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    opacity: 0;
    transition: opacity 240ms var(--ease-ios-default);
  }
  img.loaded {
    opacity: 1;
  }

  .skeleton {
    position: absolute;
    inset: 0;
    background: var(--skeleton-bg);
    color: var(--text-tertiary);
    display: grid;
    place-items: center;
  }

  .skeleton.shimmer {
    background:
      linear-gradient(
        90deg,
        var(--skeleton-bg) 0%,
        var(--skeleton-bg) 35%,
        var(--skeleton-shimmer) 50%,
        var(--skeleton-bg) 65%,
        var(--skeleton-bg) 100%
      );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .fallback {
    display: grid;
    place-items: center;
    width: 36%;
    height: 36%;
  }

  @keyframes shimmer {
    0%   { background-position: 100% 0; }
    100% { background-position: -100% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton.shimmer {
      animation: none;
    }
    img {
      transition: none;
    }
  }
</style>
