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
   * Cache-hit recovery: si el browser dispara onload SINCRÓNICAMENTE para
   * imágenes ya cacheadas (puede ocurrir antes de que corra el $effect
   * que resetea loaded=false), un queueMicrotask después del reset chequea
   * `imgEl.complete` y restaura loaded=true.
   *
   * Disposal: al desmontar, src='' libera el bitmap del image-cache y
   * cancela cualquier fetch in-flight.
   */
  import type { Snippet } from 'svelte';
  import { onDestroy } from 'svelte';

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
    /** Snippet del icono fallback (cuando no hay src o falla la carga). */
    fallback?: Snippet;
  };

  let {
    src,
    alt,
    shape = 'square',
    lazy = true,
    priority = 'auto',
    fallback
  }: Props = $props();

  let loaded = $state(false);
  let errored = $state(false);
  let imgEl: HTMLImageElement | undefined = $state();

  /** Reset al cambiar src + cache-hit recovery. */
  $effect(() => {
    const currentSrc = src;

    loaded = false;
    errored = false;

    if (!currentSrc) return;

    // Para imágenes ya cacheadas en el browser, onload puede haber disparado
    // sincrónicamente antes que este effect. queueMicrotask checa después
    // del reset si la img ya está completa con el src esperado.
    queueMicrotask(() => {
      if (
        imgEl &&
        imgEl.complete &&
        imgEl.naturalWidth > 0 &&
        (imgEl.src.endsWith(currentSrc) || imgEl.src === currentSrc)
      ) {
        loaded = true;
      }
    });
  });

  function handleLoad() {
    loaded = true;
  }

  function handleError() {
    errored = true;
  }

  onDestroy(() => {
    // Cancelar src libera el bitmap del image-cache (loaded) o aborta el
    // fetch in-flight (loading). Crítico en escenarios con muchos covers
    // para que cards desmontadas no ocupen connections de la pool.
    if (imgEl?.isConnected) {
      imgEl.src = '';
    }
  });

  const showImage = $derived(!!src && !errored);
  const showSkeleton = $derived(!loaded || errored || !src);
  const showShimmer = $derived(!!src && !errored && !loaded);
  const showFallback = $derived((errored || !src) && !!fallback);
</script>

<div class="cover" class:circle={shape === 'circle'}>
  {#if showImage}
    <img
      bind:this={imgEl}
      {src}
      {alt}
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
