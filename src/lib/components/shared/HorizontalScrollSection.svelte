<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import SeeAllCard from './SeeAllCard.svelte';
  import SeeAllArtistCard from './SeeAllArtistCard.svelte';

  type Props = {
    title?: string | undefined;
    subtitle?: string | undefined;
    items: readonly T[];
    seeAllHref?: string | undefined;
    /** Width mínimo de cada card. Album/Playlist = 180, Artist = 140. */
    itemMinWidth?: number;
    /** Variante visual del SeeAllCard. */
    seeAllShape?: 'square' | 'round';
    item: Snippet<[T]>;
  };

  let {
    title,
    subtitle,
    items,
    seeAllHref,
    itemMinWidth = 180,
    seeAllShape = 'square',
    item
  }: Props = $props();

  let trackEl!: HTMLDivElement;
  // SSR default: 6 cards (típico desktop con sidebar). En el primer mount
  // se recalcula contra el ancho real del container, evitando "8 fijo".
  let visibleCount = $state(6);

  /** Cantidad de cards (cuadradas o redondas) que caben en una sola fila
      del container, dado el itemMinWidth y el gap entre cards. */
  function compute() {
    if (!trackEl) return;
    const containerWidth = trackEl.clientWidth;
    // gap = var(--space-5) = 20px. Si cambiamos el gap en CSS hay que
    // sincronizar acá. Vale la fragilidad por la simplicidad.
    const gap = 20;
    // Solve: width = N * item + (N - 1) * gap → N = (width + gap) / (item + gap)
    const fits = Math.floor((containerWidth + gap) / (itemMinWidth + gap));
    visibleCount = Math.max(1, fits);
  }

  onMount(() => {
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(trackEl);
    return () => ro.disconnect();
  });

  /** Si hay overflow, dejamos un slot al final para el SeeAllCard.
      Si no hay overflow, mostramos todos los items sin SeeAllCard. */
  const showSeeAll = $derived(!!seeAllHref && items.length > visibleCount);
  const itemsToShow = $derived(
    showSeeAll ? items.slice(0, visibleCount - 1) : items
  );
  const remaining = $derived(items.length - (visibleCount - 1));
</script>

<section class="row-section">
  {#if title || subtitle}
    <header class="row-header">
      <div class="title-block">
        {#if title}
          <h2 class="row-title">{title}</h2>
        {/if}
        {#if subtitle}
          <p class="row-subtitle">{subtitle}</p>
        {/if}
      </div>
    </header>
  {/if}

  <div
    bind:this={trackEl}
    class="track"
    style:--col-count={visibleCount}
  >
    {#each itemsToShow as it, i}
      <!-- card-slot: wrapper para aplicar la entry animation con stagger.
           Cada slot recibe su índice como --card-i; el delay se calcula en
           CSS: i × --card-entry-stagger. La pure-CSS aproach evita JS en
           el hot path de mount. -->
      <div class="card-slot" style:--card-i={i}>
        {@render item(it)}
      </div>
    {/each}
    {#if showSeeAll && seeAllHref}
      <div class="card-slot" style:--card-i={itemsToShow.length}>
        {#if seeAllShape === 'round'}
          <SeeAllArtistCard {remaining} href={seeAllHref} />
        {:else}
          <SeeAllCard {remaining} href={seeAllHref} />
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .row-section {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }

  .row-header {
    padding: 0 var(--space-6);
  }
  .title-block {
    min-width: 0;
  }
  .row-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    margin: 0;
    line-height: 1.2;
  }
  .row-subtitle {
    margin: 4px 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  /* Track: grid de N columnas calculadas por JS. Items 1fr para que crezcan
     y llenen el ancho disponible — sin overflow, sin scroll horizontal. */
  .track {
    display: grid;
    grid-template-columns: repeat(var(--col-count), minmax(0, 1fr));
    gap: var(--space-5);
    padding: 0 var(--space-6);
    min-width: 0;
  }

  /* Wrapper de cada card. Es grid-item del .track — toma 1fr de ancho.
     min-width: 0 + display: contents-like via min-w resuelve los typical
     issues con grid items que truncan con ellipsis. La animación se aplica
     acá (no en la card hija) para que sea independiente del componente. */
  .card-slot {
    min-width: 0;
    animation: card-entry var(--card-entry-duration) var(--card-entry-ease)
      calc(var(--card-i, 0) * var(--card-entry-stagger)) backwards;
  }

  @keyframes card-entry {
    from {
      opacity: 0;
      transform: translateY(var(--card-entry-distance));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 640px) {
    .row-header {
      padding: 0 var(--space-4);
    }
    .row-title {
      font-size: var(--text-xl);
    }
    .track {
      gap: var(--space-4);
      padding: 0 var(--space-4);
    }
  }
</style>
