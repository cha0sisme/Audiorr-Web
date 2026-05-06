<script lang="ts" generics="T extends string">
  import { onMount } from 'svelte';

  type Item = {
    id: T;
    label: string;
    /** Conteo opcional, mostrado en pequeño después del label. */
    count?: number;
  };

  type Props = {
    items: Item[];
    value: T;
    onChange: (id: T) => void;
    /** Aria-label para el grupo. */
    ariaLabel?: string | undefined;
  };

  let { items, value, onChange, ariaLabel }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  // Map de refs por id — usado para medir el rect del item activo
  const refs: Record<string, HTMLButtonElement | undefined> = $state({});

  // Posición y ancho del indicador deslizante. Se calcula desde el rect del
  // item activo relativo al container.
  let indicatorX = $state(0);
  let indicatorW = $state(0);
  // Visible solo después de medir (evita flash en (0,0) al primer paint)
  let measured = $state(false);

  function measure() {
    const ref = refs[value];
    if (!ref || !containerEl) return;
    const itemRect = ref.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    indicatorX = itemRect.left - containerRect.left;
    indicatorW = itemRect.width;
    measured = true;
  }

  // Re-mide cuando cambia el item activo. raf espera al próximo paint para
  // que los refs estén bound y el layout estable.
  $effect(() => {
    void value; // touch reactivity
    requestAnimationFrame(measure);
  });

  onMount(() => {
    measure();
    if (!containerEl) return;
    const ro = new ResizeObserver(measure);
    ro.observe(containerEl);
    return () => ro.disconnect();
  });

  function activate(id: T) {
    if (id !== value) onChange(id);
  }
</script>

<div
  bind:this={containerEl}
  class="segmented"
  role="tablist"
  aria-label={ariaLabel}
>
  <div
    class="indicator"
    class:visible={measured}
    style:transform="translateX({indicatorX}px)"
    style:width="{indicatorW}px"
    aria-hidden="true"
  ></div>

  {#each items as item}
    <button
      bind:this={refs[item.id]}
      type="button"
      role="tab"
      aria-selected={item.id === value}
      class="tab"
      class:active={item.id === value}
      onclick={() => activate(item.id)}
    >
      <span class="label">{item.label}</span>
      {#if item.count !== undefined}
        <span class="count">{item.count}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .segmented {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 4px;
    background: var(--segment-bg);
    border-radius: var(--radius-full);
    isolation: isolate;
    /* fit-content evita que el padre (grid/flex con stretch default) lo
       estire al 100% del ancho disponible. */
    width: fit-content;
    max-width: 100%;
  }

  /* Indicador deslizante — animación spring iOS al cambiar de tab. */
  .indicator {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 0;
    background: var(--segment-indicator-bg);
    border-radius: var(--radius-full);
    box-shadow: var(--segment-indicator-shadow);
    z-index: 0;
    opacity: 0;
    transition:
      transform 380ms var(--ease-ios-default),
      width 380ms var(--ease-ios-default);
  }
  .indicator.visible {
    opacity: 1;
  }

  .tab {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-2) var(--space-4);
    background: transparent;
    border: none;
    color: var(--segment-text);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    border-radius: var(--radius-full);
    -webkit-tap-highlight-color: transparent;
    transition: color var(--duration-fast) var(--ease-ios-default);
    white-space: nowrap;
  }
  .tab:hover:not(.active) {
    color: var(--text-primary);
  }
  .tab.active {
    color: var(--segment-text-active);
  }
  .tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Count: misma fuente que label (sans, no mono — el ⌘K-style mono no
     baseline-aligns bien con sans next door). Tamaño levemente menor y
     color sutil. tabular-nums para que múltiples dígitos no salten. */
  .count {
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--segment-count);
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .tab.active .count {
    color: var(--segment-count-active);
  }
</style>
