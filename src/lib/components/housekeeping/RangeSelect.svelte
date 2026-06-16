<script lang="ts">
  /**
   * RangeSelect — mini-desplegable compacto para elegir un rango temporal
   * (7 / 14 / 30 días…). Trigger pill discreto con el valor actual + caret;
   * menú con las opciones. Cierre por Esc / clic fuera. Cero deps.
   */
  import { CaretDown, Check } from 'phosphor-svelte';

  type Option = { value: number; label: string };
  type Props = {
    value: number;
    options: Option[];
    onChange: (value: number) => void;
  };
  let { value, options, onChange }: Props = $props();

  let open = $state(false);
  let el: HTMLElement | undefined = $state();
  const current = $derived(options.find((o) => o.value === value) ?? options[0]);

  function pick(v: number) {
    onChange(v);
    open = false;
  }

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
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {current?.label ?? ''}
    <CaretDown size={11} weight="bold" />
  </button>

  {#if open}
    <ul class="menu" role="listbox">
      {#each options as o (o.value)}
        <li>
          <button
            type="button"
            class="opt"
            class:active={o.value === value}
            role="option"
            aria-selected={o.value === value}
            onclick={() => pick(o.value)}
          >
            <span>{o.label}</span>
            {#if o.value === value}<Check size={12} weight="bold" />{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 10px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-ios-default), color var(--duration-fast) var(--ease-ios-default);
  }
  .trigger:hover { background: var(--bg-surface-active); color: var(--text-primary); }
  .trigger.open { background: var(--bg-surface-active); color: var(--text-primary); }
  .trigger :global(svg) { color: var(--text-tertiary); }
  .trigger:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    min-width: 130px;
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    animation: range-in var(--duration-fast) var(--ease-ios-default);
  }
  @keyframes range-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .opt:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .opt.active { color: var(--text-primary); font-weight: 600; }
  .opt.active :global(svg) { color: var(--accent); }
  .opt:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  @media (prefers-reduced-motion: reduce) {
    .menu { animation: none; }
  }
</style>
