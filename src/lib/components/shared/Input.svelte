<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = Omit<HTMLInputAttributes, 'size'> & {
    label?: string | undefined;
    helper?: string | undefined;
    error?: string | undefined;
    value?: string | undefined;
  };

  let {
    label,
    helper,
    error,
    value = $bindable(''),
    id,
    type = 'text',
    ...rest
  }: Props = $props();

  /* Generate stable id si no viene uno. $props.id() requeriría Svelte 5.x; usamos un random simple. */
  const inputId = $derived(id ?? `input-${Math.random().toString(36).slice(2, 8)}`);
  const helperId = $derived(`${inputId}-helper`);
</script>

<div class="field" class:has-error={!!error}>
  {#if label}
    <label for={inputId} class="label">{label}</label>
  {/if}

  <input
    id={inputId}
    {type}
    bind:value
    aria-invalid={!!error || undefined}
    aria-describedby={helper || error ? helperId : undefined}
    {...rest}
  />

  {#if error}
    <p class="message error" id={helperId}>{error}</p>
  {:else if helper}
    <p class="message helper" id={helperId}>{helper}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    gap: var(--space-2);
  }

  .label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
  }

  input {
    width: 100%;
    height: 40px;
    padding: 0 var(--space-3);

    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);

    font-family: inherit;
    font-size: var(--text-base);
    line-height: 1.3;

    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-fast) var(--ease-ios-default);
  }

  input::placeholder {
    color: var(--text-placeholder);
  }

  input:hover:not(:disabled):not(:focus) {
    background: var(--bg-input-hover);
    border-color: var(--border-strong);
  }

  input:focus {
    outline: none;
    background: var(--bg-input-focus);
    border-color: var(--border-focus);
    box-shadow: var(--focus-ring);
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .field.has-error input {
    border-color: var(--status-danger);
  }
  .field.has-error input:focus {
    box-shadow: 0 0 0 3px var(--status-danger-bg);
    border-color: var(--status-danger);
  }

  .message {
    font-size: var(--text-xs);
    line-height: 1.3;
  }
  .message.helper {
    color: var(--text-tertiary);
  }
  .message.error {
    color: var(--status-danger-text);
  }
</style>
