<script lang="ts" module>
  import type { Component } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';

  /**
   * Item del context menu. Mirrors el patrón de iOS Menu(label, systemImage, action).
   * - `icon` es el componente Phosphor (ej. Plus, ListPlus, User).
   * - `destructive` aplica el rojo del system role .destructive.
   * - `divider: true` inserta un separador entre items (no es un item interactivo).
   */
  export type ContextMenuItem =
    | {
        label: string;
        icon: Component<{ size?: number | string; weight?: IconWeight }>;
        action: () => void;
        destructive?: boolean;
      }
    | {
        /** Item con submenu — al hacer click hace push del nuevo nivel dentro
            del mismo popover (mirror iOS Menu jerárquico). */
        label: string;
        icon: Component<{ size?: number | string; weight?: IconWeight }>;
        submenu: ContextMenuItem[];
      }
    | { divider: true };
</script>

<script lang="ts">
  /**
   * Menu contextual al estilo iOS — popover anclado al trigger, glass surface,
   * items con icon + label, click-outside / Escape para cerrar.
   *
   * Se posiciona con un Popover anchor "primitivo" (no usamos Bits UI todavía
   * para no añadir dep). El parent wrappa el trigger y el menú juntos en un
   * contenedor `position: relative`, y el menú se ancla absolute con el side
   * que decida el caller (default bottom-end, suficiente para action-rows).
   *
   * Accesibilidad:
   *   - Trigger debe ser un botón con aria-haspopup="menu" + aria-expanded
   *     (eso lo gestiona el caller, no este componente — el caller controla
   *     el state `open`).
   *   - role="menu" + role="menuitem" en items.
   *   - ↑/↓ navegación, Enter/Space activación, Escape cierra.
   */
  import { onMount, tick } from 'svelte';
  import { CaretLeft, CaretRight } from 'phosphor-svelte';

  type Props = {
    open: boolean;
    items: ContextMenuItem[];
    /** Lado del anchor relativo al trigger. default 'bottom-end'. */
    side?: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';
    /** Callback cuando el usuario cierra (Escape, click-outside, item action). */
    onClose: () => void;
  };

  let { open, items, side = 'bottom-end', onClose }: Props = $props();

  let menuEl: HTMLDivElement | null = $state(null);

  /** Stack de submenu activo. Cada vez que se hace click en un item con
      `submenu`, hacemos push con `{ title, items }`. El "Atrás" hace pop.
      Cuando está vacío, mostramos `items` raíz. */
  type Frame = { title: string; items: ContextMenuItem[] };
  let stack = $state<Frame[]>([]);
  const visibleItems = $derived(stack.length > 0 ? stack[stack.length - 1]!.items : items);
  const breadcrumb = $derived(stack.length > 0 ? stack[stack.length - 1]!.title : null);

  /** Items interactivos (excluye dividers) — para navegación por teclado.
      `$state` array porque Svelte 5 marca `bind:this={itemRefs[idx]}` como
      "binding to a non-reactive property" si itemRefs no es reactivo. */
  const itemRefs = $state<HTMLButtonElement[]>([]);

  function focusItem(idx: number) {
    itemRefs[idx]?.focus();
  }

  // Reset del stack cada vez que el menu se cierra — la próxima apertura
  // empieza desde la raíz.
  $effect(() => {
    if (!open) stack = [];
  });

  $effect(() => {
    if (open) {
      // Foco al primer item al abrir — coherente con menus de Apple.
      tick().then(() => focusItem(0));
    }
  });

  function handleAction(e: MouseEvent, item: ContextMenuItem) {
    // El menú vive dentro del propio anchor del row (.menu-anchor inside .row).
    // Sin stopPropagation, el click bubble hasta `.row` y dispara `onPlay()`
    // tras nuestro `onClose()` (que ya bajó menuOpen) — el guard `if (menuOpen)`
    // del row no salva nada. Cortamos la propagación aquí.
    e.stopPropagation();
    if ('divider' in item) return;
    if ('submenu' in item) {
      stack = [...stack, { title: item.label, items: item.submenu }];
      tick().then(() => focusItem(0));
      return;
    }
    item.action();
    onClose();
  }

  function popStack(e: MouseEvent) {
    e.stopPropagation();
    stack = stack.slice(0, -1);
    tick().then(() => focusItem(0));
  }

  function handleKeydown(e: KeyboardEvent, idx: number) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (stack.length > 0) {
        stack = stack.slice(0, -1);
        tick().then(() => focusItem(0));
        return;
      }
      onClose();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
      if (stack.length > 0) {
        e.preventDefault();
        stack = stack.slice(0, -1);
        tick().then(() => focusItem(0));
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (idx + 1) % itemRefs.length;
      focusItem(next);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (idx - 1 + itemRefs.length) % itemRefs.length;
      focusItem(prev);
      return;
    }
  }

  // Click-outside: si el target no está dentro del menú, cerrar.
  // Usamos capture phase y stopPropagation para que el click NO siga su curso
  // hasta otros listeners (por ejemplo, una row de SongList que también
  // escucha onclick para reproducir). UX estándar: click-fuera-cierra-menú
  // sin disparar otra acción colateral.
  onMount(() => {
    function onDocClick(e: MouseEvent) {
      if (!open) return;
      if (!menuEl) return;
      const target = e.target as Node;
      if (menuEl.contains(target)) return;
      // Buscar trigger por aria-expanded="true" — si el click es sobre él,
      // dejamos que el toggle se haga (no cerramos acá).
      const trigger = (target as Element).closest?.('[aria-expanded="true"]');
      if (trigger) return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  });
</script>

{#if open}
  <div
    bind:this={menuEl}
    class="menu"
    class:side-bottom-end={side === 'bottom-end'}
    class:side-bottom-start={side === 'bottom-start'}
    class:side-top-end={side === 'top-end'}
    class:side-top-start={side === 'top-start'}
    role="menu"
  >
    {#if breadcrumb}
      <button
        type="button"
        class="item submenu-back"
        role="menuitem"
        onclick={popStack}
      >
        <span class="item-icon back-arrow" aria-hidden="true">
          <CaretLeft size={14} weight="bold" />
        </span>
        <span class="item-label">{breadcrumb}</span>
      </button>
      <span class="divider" role="separator" aria-hidden="true"></span>
    {/if}
    {#each visibleItems as item, idx}
      {#if 'divider' in item}
        <span class="divider" role="separator" aria-hidden="true"></span>
      {:else}
        {@const Icon = item.icon}
        {@const hasSubmenu = 'submenu' in item}
        <button
          bind:this={itemRefs[idx]}
          type="button"
          class="item"
          class:destructive={!hasSubmenu && (item as { destructive?: boolean }).destructive}
          role="menuitem"
          aria-haspopup={hasSubmenu ? 'menu' : undefined}
          onclick={(e) => handleAction(e, item)}
          onkeydown={(e) => handleKeydown(e, idx)}
        >
          <span class="item-label">{item.label}</span>
          {#if hasSubmenu}
            <span class="item-icon submenu-chevron" aria-hidden="true">
              <CaretRight size={14} weight="bold" />
            </span>
          {:else}
            <span class="item-icon" aria-hidden="true">
              <Icon size={16} weight="regular" />
            </span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  /* Glass popover iOS-style. Backdrop blur+saturate, borde sutil, sombra
     para despegarlo del bg, y radius 14px aprox al menu de iOS 17+. */
  .menu {
    position: absolute;
    z-index: 50;
    min-width: 240px;
    padding: var(--space-1);
    background: var(--bg-glass-solid);
    backdrop-filter: blur(40px) saturate(1.6);
    -webkit-backdrop-filter: blur(40px) saturate(1.6);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow:
      0 12px 32px -8px rgb(0 0 0 / 0.35),
      0 2px 8px -2px rgb(0 0 0 / 0.20);
    /* Animation: scale-up subtle desde el origin del side. */
    transform-origin: top right;
    animation: menu-in 140ms var(--ease-ios-default);
  }
  /* Anchor por side — top en pixels lo decide el padding del row. */
  .side-bottom-end {
    top: calc(100% + var(--space-2));
    right: 0;
    transform-origin: top right;
  }
  .side-bottom-start {
    top: calc(100% + var(--space-2));
    left: 0;
    transform-origin: top left;
  }
  .side-top-end {
    bottom: calc(100% + var(--space-2));
    right: 0;
    transform-origin: bottom right;
  }
  .side-top-start {
    bottom: calc(100% + var(--space-2));
    left: 0;
    transform-origin: bottom left;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: scale(0.92) translateY(-4px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .item {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-base);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background var(--duration-fast) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .item:hover,
  .item:focus-visible {
    background: var(--bg-surface-hover);
    outline: none;
  }
  .item:active {
    background: var(--bg-surface-active);
    transition-duration: var(--duration-instant);
  }
  .item.destructive {
    color: var(--status-danger);
  }

  .item-icon {
    display: grid;
    place-items: center;
    color: var(--text-secondary);
  }
  .item.destructive .item-icon {
    color: inherit;
  }

  .item-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .divider {
    display: block;
    height: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--border-subtle);
  }

  /* Header item del submenu (back). Icono al INICIO en vez de al final, y
     label en color secundario (typografía de breadcrumb más que de acción). */
  .submenu-back {
    grid-template-columns: auto 1fr;
    color: var(--text-secondary);
  }
  .submenu-back .item-label {
    font-size: var(--text-sm);
  }
  .submenu-back .back-arrow {
    color: var(--text-secondary);
  }

  /* Chevron del item que abre submenu — más tenue que iconos de acción
     porque señala "hay más", no es la acción en sí. */
  .submenu-chevron {
    color: var(--text-tertiary);
  }
</style>
