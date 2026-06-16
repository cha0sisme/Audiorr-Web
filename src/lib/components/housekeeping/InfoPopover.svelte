<script lang="ts">
  /**
   * InfoPopover — icono (i) que despliega ayuda contextual en un popover.
   *
   * Progressive disclosure para subtítulos descriptivos: en vez de robar una
   * línea permanente, la ayuda se revela al pulsar la (i). Cierre por Esc o
   * clic fuera. Superficie sólida (texto de ayuda → nunca glass). Cero deps.
   */
  import type { Snippet } from 'svelte';
  import { Info } from 'phosphor-svelte';

  type Props = { children: Snippet; label?: string };
  let { children, label = 'Más información' }: Props = $props();

  let open = $state(false);
  let el: HTMLElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (el && !el.contains(e.target as Node)) open = false;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') open = false;
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<span class="wrap" bind:this={el}>
  <button
    type="button"
    class="trigger"
    class:open
    aria-label={label}
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <Info size={15} weight="bold" />
  </button>
  {#if open}
    <div class="content" role="tooltip">{@render children()}</div>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-ios-default), background var(--duration-fast) var(--ease-ios-default);
  }
  .trigger:hover { color: var(--text-secondary); background: var(--bg-surface-hover); }
  .trigger.open { color: var(--text-primary); }
  .trigger:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .content {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 20;
    width: max-content;
    max-width: 260px;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    animation: info-in var(--duration-fast) var(--ease-ios-default);
  }
  @keyframes info-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .content { animation: none; }
  }
</style>
