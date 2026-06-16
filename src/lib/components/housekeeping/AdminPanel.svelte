<script lang="ts">
  /**
   * AdminPanel — contenedor sobrio para una sección de contenido del panel.
   *
   * Superficie SÓLIDA (no glass): puede contener listas/texto, y la regla del
   * proyecto reserva el glass para controles flotantes. Cabecera consistente
   * (título + subtítulo + acción opcional) y estados de primera clase:
   * loading (skeleton), error (mensaje + reintentar), empty (texto). Sin
   * patterns ni gradientes — el "pro" viene de la contención.
   */
  import type { Snippet } from 'svelte';
  import { ArrowsClockwise, WarningCircle } from 'phosphor-svelte';
  import InfoPopover from './InfoPopover.svelte';

  type Props = {
    title: string;
    subtitle?: string;
    /** Ayuda contextual en un popover (i) junto al título. Si está presente,
        el subtítulo NO se pinta como línea (se mueve al popover). */
    info?: Snippet;
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    emptyText?: string;
    onRetry?: (() => void) | undefined;
    /** Acción a la derecha de la cabecera (botón, etc.). */
    action?: Snippet;
    children: Snippet;
  };

  let {
    title,
    subtitle,
    info,
    loading = false,
    error = null,
    empty = false,
    emptyText = 'Nada que mostrar todavía.',
    onRetry,
    action,
    children
  }: Props = $props();
</script>

<section class="admin-panel">
  <header class="admin-panel-head">
    <div class="admin-panel-titles">
      <div class="admin-panel-title-row">
        <h2>{title}</h2>
        {#if info}<InfoPopover>{@render info()}</InfoPopover>{/if}
      </div>
      {#if subtitle && !info}<p>{subtitle}</p>{/if}
    </div>
    {#if action}
      <div class="admin-panel-action">{@render action()}</div>
    {/if}
  </header>

  {#if loading}
    <div class="admin-panel-skeleton" aria-busy="true">
      {#each Array(3) as _, i (i)}
        <div class="skeleton-row"></div>
      {/each}
    </div>
  {:else if error}
    <div class="admin-panel-state">
      <WarningCircle size={22} weight="regular" />
      <p>{error}</p>
      {#if onRetry}
        <button type="button" class="admin-panel-retry" onclick={onRetry}>
          <ArrowsClockwise size={13} weight="bold" /> Reintentar
        </button>
      {/if}
    </div>
  {:else if empty}
    <div class="admin-panel-state">
      <p>{emptyText}</p>
    </div>
  {:else}
    {@render children()}
  {/if}
</section>

<style>
  .admin-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--hk-card-padding);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--hk-card-radius);
    min-width: 0;
  }
  .admin-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .admin-panel-titles {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .admin-panel-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .admin-panel-titles h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    line-height: 1.2;
  }
  .admin-panel-titles p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .admin-panel-action { flex-shrink: 0; }

  /* ─── Estados ─────────────────────────────────────────────────────────── */
  .admin-panel-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .skeleton-row {
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--skeleton-bg);
    animation: panel-pulse 1.6s ease-in-out infinite;
  }
  @keyframes panel-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton-row { animation: none; }
  }
  .admin-panel-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--text-tertiary);
  }
  .admin-panel-state p {
    margin: 0;
    font-size: var(--text-sm);
  }
  .admin-panel-retry {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--space-1);
    padding: 6px 14px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .admin-panel-retry:hover { background: var(--bg-surface-active); }
  .admin-panel-retry:focus-visible { outline: none; box-shadow: var(--focus-ring); }
</style>
