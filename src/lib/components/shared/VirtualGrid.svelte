<script lang="ts" generics="T">
  /**
   * VirtualGrid — grid responsivo con virtualización por filas.
   *
   * Por qué existe:
   *   Las páginas tipo Library (1000+ álbumes) montan TODAS las cards en
   *   DOM con el patrón {#each} → 1000 imgs decoded en image-cache de
   *   Chrome → ~1 GB de RAM residual. VirtualGrid solo monta las filas
   *   visibles + un buffer (overscan), manteniendo la RAM acotada al
   *   window de scroll.
   *
   * Cómo funciona:
   *   - El container computa cuántas columnas caben (= grid-template-columns
   *     auto-fill) en base a minItemWidth + gap.
   *   - El item count se traduce a row count (ceil(items / cols)).
   *   - @tanstack/svelte-virtual decide qué filas pintar en base al
   *     scroll del contenedor padre (`.main` del layout).
   *   - Cada fila es un grid de columnCount celdas, posicionada
   *     absolutamente con transform translateY.
   *
   * Performance:
   *   - DOM mantenido = (visible rows + overscan) × columnCount.
   *     En desktop típico: 4 filas visibles × 5 cols × 2 buffer = ~40 cards.
   *   - Image cache de Chrome solo mantiene los 40 covers vivos,
   *     más eviction LRU del CoverImage.onDestroy → src=''.
   *
   * Uso:
   *   ```svelte
   *   <VirtualGrid
   *     items={albums}
   *     estimateRowHeight={250}
   *     minItemWidth={180}
   *     getKey={(a) => a.id}
   *   >
   *     {#snippet item(album)}
   *       <AlbumCard {...album} />
   *     {/snippet}
   *   </VirtualGrid>
   *   ```
   */
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { getContext } from 'svelte';
  import { get } from 'svelte/store';
  import type { Snippet } from 'svelte';

  type Props = {
    items: readonly T[];
    /** Altura estimada de fila (cover + texto + gap vertical) en px. */
    estimateRowHeight: number;
    /** Ancho mínimo de cada item en px. Mismo número que pasarías a
        `minmax(min(<n>px, 100%), 1fr)` en CSS grid normal. */
    minItemWidth: number;
    /** Ancho MÁXIMO de cada item en px. CRÍTICO: sin un cap, las cells
        crecen a `1fr` y los covers con aspect-ratio:1 superan la altura
        del `estimateRowHeight`, causando que las filas (position:absolute)
        se solapen visualmente. Por defecto = `minItemWidth + 20`. */
    maxItemWidth?: number;
    /** Gap entre items y entre filas (px). Default 20 (= --space-5). */
    gap?: number;
    /** Filas extra renderizadas fuera del viewport para evitar pop-in
        durante scroll rápido. Default 4. */
    overscan?: number;
    /** Identidad estable por item — clave del block #each. */
    getKey: (item: T) => string;
    item: Snippet<[T, number]>;
  };

  let {
    items,
    estimateRowHeight,
    minItemWidth,
    maxItemWidth,
    gap = 20,
    overscan = 4,
    getKey,
    item
  }: Props = $props();

  const effectiveMaxWidth = $derived(maxItemWidth ?? minItemWidth + 20);

  /** Scroll container — provisto por el layout via context. Si no existe
      (e.g. /design-system standalone), caemos al window. */
  const getScroll = getContext<(() => HTMLElement | null) | undefined>(
    'main-scroll-el'
  );

  let containerEl: HTMLDivElement | undefined = $state();
  let columnCount = $state(1);

  function computeColumns() {
    if (!containerEl) return;
    const w = containerEl.clientWidth;
    if (w === 0) return;
    // Mismo cálculo que CSS auto-fill: width = N*item + (N-1)*gap.
    const fits = Math.floor((w + gap) / (minItemWidth + gap));
    columnCount = Math.max(1, fits);
  }

  $effect(() => {
    if (!containerEl) return;
    computeColumns();
    const ro = new ResizeObserver(computeColumns);
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  const rowCount = $derived(Math.ceil(items.length / columnCount));

  // Init con valores stub — el $effect inmediato setOptions con los reales.
  // Evita capturar `overscan` (prop reactive) en el initial closure.
  const virtualizer = createVirtualizer({
    count: 0,
    getScrollElement: () => getScroll?.() ?? null,
    estimateSize: () => 0,
    overscan: 0
  });

  /**
   * Sincroniza opciones reactivamente. CRITICAL: usamos `get(virtualizer)`
   * en vez de `$virtualizer` para acceder al instance SIN suscribirnos al
   * store dentro del $effect.
   *
   * Si nos suscribimos: `setOptions()` → el virtualizer actualiza su estado
   * interno → notifica al store → el $effect (que lee $virtualizer) se
   * re-dispara → setOptions otra vez → ... LOOP INFINITO que congela el tab.
   *
   * Con `get()` solo leemos el value actual sin trackear. Tracked stays sólo
   * en lo que queremos: rowCount, estimateRowHeight, overscan, getScroll.
   */
  $effect(() => {
    get(virtualizer).setOptions({
      count: rowCount,
      getScrollElement: () => getScroll?.() ?? null,
      estimateSize: () => estimateRowHeight,
      overscan
    });
  });
</script>

<div
  bind:this={containerEl}
  class="vgrid"
  style:height="{$virtualizer.getTotalSize()}px"
>
  {#each $virtualizer.getVirtualItems() as vRow (vRow.key)}
    <div
      class="vrow"
      style:transform="translateY({vRow.start}px)"
      style:--col-count={columnCount}
      style:--vgap="{gap}px"
      style:--cell-max="{effectiveMaxWidth}px"
    >
      {#each Array(columnCount) as _, colIdx}
        {@const itemIdx = vRow.index * columnCount + colIdx}
        {@const it = items[itemIdx]}
        {#if it !== undefined}
          <div class="vcell" data-idx={itemIdx}>
            {@render item(it, itemIdx)}
          </div>
        {/if}
      {/each}
    </div>
  {/each}
</div>

<style>
  .vgrid {
    position: relative;
    width: 100%;
    min-width: 0;
  }
  /* Cells con ancho CAPADO (--cell-max). Sin esto, las cells crecían con
     `1fr` y los covers (aspect-ratio:1) generaban filas más altas que el
     `estimateRowHeight` — al ser cada fila position:absolute con translateY
     calculado por el estimate, las filas se solapaban visualmente.
     `justify-content: start` deja el sobrante a la derecha (paridad Apple
     Music / Spotify). */
  .vrow {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(var(--col-count), minmax(0, var(--cell-max)));
    gap: var(--vgap);
    justify-content: start;
    align-items: start;
  }
  .vcell {
    min-width: 0;
  }
</style>
