<script lang="ts" generics="T extends string">
  /**
   * Fila de chips-badge para filtrar contenido in-place (Discografía:
   * Todo / Álbumes / Sencillos). Mismo lenguaje visual que los filter
   * chips del viewer de diagnostics — pill, activo = accent sólido —
   * pero como componente reutilizable de superficie de contenido.
   *
   * No confundir con SegmentedControl (contenedor único con indicador
   * deslizante): aquí son badges sueltas, el patrón de Spotify/Apple
   * Music para filtros de catálogo.
   */
  type Item = {
    id: T;
    label: string;
  };

  type Props = {
    items: Item[];
    value: T;
    onChange: (id: T) => void;
    /** Aria-label del grupo. */
    ariaLabel?: string | undefined;
  };

  let { items, value, onChange, ariaLabel }: Props = $props();
</script>

<div class="chips" role="tablist" aria-label={ariaLabel}>
  {#each items as item (item.id)}
    <button
      type="button"
      role="tab"
      class="chip"
      class:active={item.id === value}
      aria-selected={item.id === value}
      onclick={() => {
        if (item.id !== value) onChange(item.id);
      }}
    >
      {item.label}
    </button>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 6px 14px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.3;
    cursor: pointer;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .chip:hover:not(.active) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .chip.active {
    background: var(--accent);
    color: var(--text-on-accent);
  }
  .chip:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
