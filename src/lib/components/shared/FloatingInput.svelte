<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  type Props = Omit<HTMLInputAttributes, 'size' | 'placeholder'> & {
    label: string;
    error?: string | undefined;
    value?: string | undefined;
  };

  let {
    label,
    error,
    value = $bindable(''),
    type = 'text',
    id,
    ...rest
  }: Props = $props();

  // ID estable para asociar label↔input. Si el caller no provee uno, derivamos
  // un random corto.
  const inputId = $derived(id ?? `field-${Math.random().toString(36).slice(2, 8)}`);
  const errorId = $derived(`${inputId}-error`);
</script>

<div class="field" class:has-error={!!error}>
  <input
    id={inputId}
    {type}
    bind:value
    placeholder=" "
    aria-invalid={!!error || undefined}
    aria-describedby={error ? errorId : undefined}
    {...rest}
  />
  <label for={inputId} class="label">{label}</label>

  {#if error}
    <p class="error" id={errorId} role="alert">{error}</p>
  {/if}
</div>

<style>
  .field {
    position: relative;
    display: grid;
    gap: var(--space-2);
  }

  /* Input alto, padding-top reservado para el label flotante.
     placeholder=" " (espacio) le permite al :not(:placeholder-shown) detectar
     "tiene contenido" sin meter texto visible. */
  input {
    width: 100%;
    height: 56px;
    padding: 22px var(--space-4) 8px;

    background: var(--field-bg);
    color: var(--field-text);
    border: none;
    border-radius: var(--radius-md);

    font-family: inherit;
    font-size: var(--text-base);
    line-height: 1.3;

    transition:
      background var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-fast) var(--ease-ios-default);
    -webkit-appearance: none;
    appearance: none;
  }
  input:hover:not(:focus) {
    background: var(--field-bg-focus);
  }
  input:focus {
    outline: none;
    background: var(--field-bg-focus);
    box-shadow: var(--field-ring-focus);
  }
  /* Error state */
  .field.has-error input {
    box-shadow: var(--field-ring-error);
  }
  /* Autofill: que no rompa el bg del input */
  input:-webkit-autofill {
    -webkit-text-fill-color: var(--field-text);
    -webkit-box-shadow: 0 0 0 1000px var(--field-bg) inset;
    transition: background-color 5000s ease-in-out 0s;
  }

  /* Label flotante. Estado por default = "dentro del input" (vertical center
     del padding visible). Estado focused/filled = "arriba del input" (small). */
  .label {
    position: absolute;
    left: var(--space-4);
    top: 18px;
    color: var(--field-label);
    font-size: var(--text-base);
    font-weight: 400;
    pointer-events: none;
    transform-origin: left top;
    transition:
      transform var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  /* Floats arriba cuando input tiene focus O contenido (placeholder-shown
     hack: input siempre tiene placeholder=" ", entonces :not(:placeholder-shown)
     == "user typed something"). */
  input:focus + .label,
  input:not(:placeholder-shown) + .label {
    transform: translateY(-12px) scale(0.75);
    color: var(--field-label-floating);
  }
  .field.has-error input:not(:focus) + .label {
    color: var(--field-label-error);
  }

  .error {
    margin: 0;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    color: var(--status-danger-text);
    line-height: 1.3;
  }
</style>
