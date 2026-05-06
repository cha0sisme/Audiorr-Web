<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type Variant = 'primary' | 'secondary' | 'ghost';
  type Size = 'sm' | 'md' | 'lg';

  type Props = HTMLButtonAttributes & {
    variant?: Variant;
    size?: Size;
    loading?: boolean;
    children: Snippet;
  };

  let {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    type = 'button',
    children,
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  {...rest}
  disabled={disabled || loading}
  data-variant={variant}
  data-size={size}
  data-loading={loading || undefined}
>
  {#if loading}
    <span class="spinner" aria-hidden="true"></span>
  {/if}
  <span class="label" class:label-loading={loading}>
    {@render children()}
  </span>
</button>

<style>
  button {
    --button-bg: var(--bg-accent);
    --button-bg-hover: var(--bg-accent-hover);
    --button-bg-active: var(--bg-accent-active);
    --button-fg: var(--text-on-accent);
    --button-border: transparent;

    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);

    background: var(--button-bg);
    color: var(--button-fg);
    border: 1px solid var(--button-border);
    border-radius: var(--radius-full);

    font-family: var(--font-sans);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;

    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;

    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-fast) var(--ease-ios-default);
  }

  button:hover:not(:disabled) {
    background: var(--button-bg-hover);
  }
  /* Press: solo cambio de fondo + leve opacity. SIN scale ni translate
     para evitar el sub-pixel shift del texto que se siente como "rebote". */
  button:active:not(:disabled) {
    background: var(--button-bg-active);
    opacity: 0.9;
    transition-duration: var(--duration-instant);
  }
  button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Variants */
  button[data-variant='secondary'] {
    --button-bg: var(--bg-surface-elevated);
    --button-bg-hover: var(--bg-surface-active);
    --button-bg-active: var(--bg-surface-selected);
    --button-fg: var(--text-primary);
    --button-border: var(--border-subtle);
  }
  button[data-variant='ghost'] {
    --button-bg: transparent;
    --button-bg-hover: var(--hover-overlay);
    --button-bg-active: var(--active-overlay);
    --button-fg: var(--text-primary);
    --button-border: transparent;
  }

  /* Sizes */
  button[data-size='sm'] {
    height: 32px;
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
  }
  button[data-size='md'] {
    height: 40px;
    padding: 0 var(--space-5);
    font-size: var(--text-base);
  }
  button[data-size='lg'] {
    height: 48px;
    padding: 0 var(--space-6);
    font-size: var(--text-lg);
  }

  /* El reset hace `svg { display: block }` (evita el inline-gap fantasma).
     Inline-flex en .label permite que icon + text convivan en una sola línea
     con gap consistente. */
  .label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* Loading */
  .label-loading {
    opacity: 0;
  }
  .spinner {
    position: absolute;
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: var(--radius-full);
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
