<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { CheckCircle, XCircle, Warning, Info, X } from 'phosphor-svelte';

  type Variant = 'success' | 'error' | 'warning' | 'info';

  type Props = {
    variant?: Variant;
    title: string;
    description?: string | undefined;
    actionLabel?: string | undefined;
    onAction?: (() => void) | undefined;
    onDismiss?: (() => void) | undefined;
    /** Auto-dismiss en ms. 0 = persistente (no aparece el timer ring). */
    duration?: number;
  };

  let {
    variant = 'info',
    title,
    description,
    actionLabel,
    onAction,
    onDismiss,
    duration = 4500
  }: Props = $props();

  let paused = $state(false);
  let dismissed = $state(false);

  $effect(() => {
    if (!duration || !onDismiss || paused || dismissed) return;
    const start = Date.now();
    const t = setTimeout(() => {
      dismissed = true;
      onDismiss?.();
    }, duration);
    return () => {
      clearTimeout(t);
      // si se pausa, restamos lo consumido para próximo $effect
      duration = Math.max(0, duration - (Date.now() - start));
    };
  });
</script>

<div
  class="toast"
  data-variant={variant}
  role="status"
  aria-live="polite"
  in:fly={{ y: -12, duration: 280 }}
  out:fade={{ duration: 180 }}
  onmouseenter={() => (paused = true)}
  onmouseleave={() => (paused = false)}
  onfocusin={() => (paused = true)}
  onfocusout={() => (paused = false)}
>
  <span class="icon" aria-hidden="true">
    {#if variant === 'success'}
      <CheckCircle size={22} weight="fill" />
    {:else if variant === 'error'}
      <XCircle size={22} weight="fill" />
    {:else if variant === 'warning'}
      <Warning size={22} weight="fill" />
    {:else}
      <Info size={22} weight="fill" />
    {/if}
  </span>

  <div class="content">
    <p class="title">{title}</p>
    {#if description}
      <p class="description">{description}</p>
    {/if}
  </div>

  {#if actionLabel}
    <button type="button" class="action" onclick={onAction}>{actionLabel}</button>
  {/if}

  {#if onDismiss}
    <button
      type="button"
      class="close"
      aria-label="Cerrar"
      onclick={() => {
        dismissed = true;
        onDismiss?.();
      }}
    >
      {#if duration > 0}
        <svg class="timer" viewBox="0 0 32 32" aria-hidden="true">
          <circle class="timer-track" cx="16" cy="16" r="13.5" />
          <circle
            class="timer-fill"
            cx="16"
            cy="16"
            r="13.5"
            style:--toast-duration="{duration}ms"
            style:animation-play-state={paused ? 'paused' : 'running'}
          />
        </svg>
      {/if}
      <span class="x" aria-hidden="true">
        <X size={12} weight="bold" />
      </span>
    </button>
  {/if}
</div>

<style>
  .toast {
    --toast-icon: var(--text-secondary);

    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    column-gap: 12px;

    width: min(380px, calc(100vw - var(--space-6)));
    padding: 12px 10px 12px 14px;

    /* Solid surface, NO glass. Bg theme-aware vía --toast-bg. */
    background: var(--toast-bg);
    border: 1px solid var(--toast-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--toast-shadow);

    color: var(--text-primary);
    -webkit-tap-highlight-color: transparent;
  }

  /* Variants — solo cambian el color del icono. */
  .toast[data-variant='success'] { --toast-icon: var(--status-success); }
  .toast[data-variant='error']   { --toast-icon: var(--status-danger); }
  .toast[data-variant='warning'] { --toast-icon: var(--status-warning); }
  .toast[data-variant='info']    { --toast-icon: var(--status-info); }

  /* === Icon === */
  .icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    color: var(--toast-icon);
    flex-shrink: 0;
  }

  /* === Content === */
  .content {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .title {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.3;
    color: var(--text-primary);
    letter-spacing: var(--tracking-body);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .description {
    font-size: 12.5px;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.35;
  }

  /* === Action (text button) === */
  .action {
    border: none;
    background: transparent;
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 10px;
    cursor: pointer;
    border-radius: 8px;
    white-space: nowrap;
    transition: opacity var(--duration-fast) var(--ease-ios-default);
  }
  .action:hover { opacity: 0.7; }
  .action:active { opacity: 0.5; }

  /* === Close + timer ring === */
  .close {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--toast-icon);
    cursor: pointer;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .close:hover {
    color: var(--text-primary);
  }
  .close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .timer {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .timer-track,
  .timer-fill {
    fill: none;
    stroke-width: 2;
  }
  .timer-track {
    stroke: var(--player-progress-bg);
  }
  .timer-fill {
    stroke: currentColor;
    stroke-linecap: round;
    /* Empieza arriba (12 en punto) y se vacía clockwise */
    transform: rotate(-90deg);
    transform-origin: center;
    stroke-dasharray: 84.823;          /* 2 * π * 13.5 */
    stroke-dashoffset: 0;
    animation: toast-countdown var(--toast-duration, 4500ms) linear forwards;
  }

  /* La X aparece ENCIMA del timer cuando hover. El timer se mantiene como
     indicador siempre visible pero la X es la affordance. */
  .x {
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-ios-default);
  }
  .close:hover .x,
  .close:focus-visible .x {
    opacity: 1;
  }

  @keyframes toast-countdown {
    from { stroke-dashoffset: 0; }
    to   { stroke-dashoffset: 84.823; }
  }

  @media (prefers-reduced-motion: reduce) {
    .timer-fill { animation: none; opacity: 0.4; }
  }
</style>
