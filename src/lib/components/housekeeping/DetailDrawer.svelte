<script lang="ts">
  /**
   * DetailDrawer — panel lateral derecho para el drill-down de una card del
   * Dashboard. Chasis CLARO (operación, AdminPanel-like), NO `--sec-*` oscuro.
   *
   * Sin Bits UI (no hay lib headless en el stack): accesibilidad nativa —
   * scrim que cierra, Escape, focus al abrir + focus-trap por Tab, restitución
   * del foco al cerrar, scroll-lock del body. Slide desde la derecha; en
   * reduced-motion solo fade.
   */
  import type { Component, Snippet } from 'svelte';
  import { X, type IconWeight } from 'phosphor-svelte';

  type Props = {
    open: boolean;
    title: string;
    Icon?: Component<{ size?: number | string; weight?: IconWeight }>;
    onClose: () => void;
    children: Snippet;
    /** Controles a la derecha de la cabecera (ej. RangeSelect). */
    headerExtra?: Snippet;
    /** Acciones al pie (ej. exportar). */
    footer?: Snippet;
  };

  let { open, title, Icon, onClose, children, headerExtra, footer }: Props = $props();

  let panelEl = $state<HTMLElement | undefined>();
  const titleId = `drawer-title-${Math.random().toString(36).slice(2, 8)}`;

  function focusables(): HTMLElement[] {
    if (!panelEl) return [];
    return Array.from(
      panelEl.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
  }

  $effect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Foco inicial al panel (al primer focusable o al propio panel).
    queueMicrotask(() => {
      const els = focusables();
      (els[0] ?? panelEl)?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        panelEl?.focus();
        return;
      }
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === panelEl)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  });
</script>

{#if open}
  <!-- scrim: clic cierra; no es focusable -->
  <div
    class="drawer-scrim"
    onclick={onClose}
    role="presentation"
  ></div>

  <div
    class="drawer-panel"
    bind:this={panelEl}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
  >
    <header class="drawer-head">
      <div class="drawer-title-wrap">
        {#if Icon}<span class="drawer-icon" aria-hidden="true"><Icon size={16} weight="fill" /></span>{/if}
        <h2 class="drawer-title" id={titleId}>{title}</h2>
      </div>
      <div class="drawer-head-tools">
        {#if headerExtra}{@render headerExtra()}{/if}
        <button type="button" class="drawer-close" onclick={onClose} aria-label="Cerrar">
          <X size={16} weight="bold" />
        </button>
      </div>
    </header>

    <div class="drawer-body">
      {@render children()}
    </div>

    {#if footer}
      <footer class="drawer-footer">{@render footer()}</footer>
    {/if}
  </div>
{/if}

<style>
  .drawer-scrim {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: var(--scrim);
    animation: drawer-scrim-in var(--duration-fast) var(--ease-ios-default);
  }
  @keyframes drawer-scrim-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .drawer-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 201;
    width: clamp(380px, 38vw, 520px);
    max-width: 100vw;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-lg);
    animation: drawer-slide-in var(--duration-normal) var(--ease-ios-default);
  }
  @keyframes drawer-slide-in {
    from { transform: translateX(100%); }
    to   { transform: translateX(0); }
  }
  .drawer-panel:focus-visible { outline: none; }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .drawer-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .drawer-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--bg-surface-elevated);
    color: var(--accent);
    flex-shrink: 0;
  }
  .drawer-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-head-tools {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .drawer-close {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default), color var(--duration-fast) var(--ease-ios-default);
  }
  .drawer-close:hover { background: var(--bg-surface-active); color: var(--text-primary); }
  .drawer-close:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .drawer-footer {
    flex-shrink: 0;
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border-subtle);
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  @media (prefers-reduced-motion: reduce) {
    .drawer-panel { animation: drawer-fade-in var(--duration-fast) var(--ease-ios-default); }
    @keyframes drawer-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
  }

  @media (max-width: 520px) {
    .drawer-panel { width: 100vw; border-left: 0; }
  }
</style>
