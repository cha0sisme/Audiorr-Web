<script lang="ts">
  /**
   * Botón circular del hero — companion del HeroPlayButton (capsule).
   * Mismo bgColor dinámico (derivado del cover art) para mantener cohesión
   * visual con el play. Usado por shuffle y three-dots menu.
   *
   * Tamaño 40x40 fijo: empareja la altura del HeroPlayButton (capsule h=40),
   * para que la fila de actions quede alineada vertical y proporcionalmente.
   */
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';

  type Props = HTMLButtonAttributes & {
    bgColor: string;
    children: Snippet;
  };

  let { bgColor, type = 'button', disabled, children, ...rest }: Props = $props();
</script>

<button
  {type}
  {disabled}
  {...rest}
  style:--play-bg-dynamic={bgColor}
  class="hero-circle"
>
  {@render children()}
</button>

<style>
  .hero-circle {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--play-bg-dynamic);
    color: #fff;
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
    transition:
      filter var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-fast) var(--ease-ios-default);
  }
  .hero-circle:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.22);
  }
  .hero-circle:active:not(:disabled) {
    transform: scale(0.95);
    filter: brightness(0.96);
    transition-duration: var(--duration-instant);
  }
  .hero-circle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), 0 1px 2px rgb(0 0 0 / 0.18);
  }
  .hero-circle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
