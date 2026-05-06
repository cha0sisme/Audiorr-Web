<script lang="ts">
  /**
   * WaveText — port del struct WaveText de iOS (ProgressBarView.swift).
   * Cada char oscila en opacidad entre 0.5 y 1.0 con delay escalonado
   * (i / text.length * cycleDuration). El color lo hereda del padre.
   *
   * Implementación CSS pura (vs el TimelineView + rAF de SwiftUI) — más
   * performante en web, GPU-accelerated, sin JS per frame.
   */

  type Props = {
    text: string;
    /** Duración de un ciclo completo en segundos. iOS default: 2.8. */
    cycleDuration?: number;
  };

  let { text, cycleDuration = 2.8 }: Props = $props();

  const chars = $derived([...text]);
</script>

<span
  class="wave"
  style:--cycle="{cycleDuration}s"
  aria-label={text}
>
  {#each chars as char, i}
    <span
      class="char"
      style:--delay="calc({i} / {chars.length} * var(--cycle) * -1)"
      aria-hidden="true"
    >{char === ' ' ? ' ' : char}</span>
  {/each}
</span>

<style>
  .wave {
    display: inline-flex;
    color: inherit;
  }

  .char {
    display: inline-block;
    opacity: 0.5;
    color: inherit;
    /* Animation runs continuously, cada char con su delay específico para
       crear el efecto wave recorriendo el texto. */
    animation: wave-opacity var(--cycle, 2.8s) ease-in-out infinite;
    animation-delay: var(--delay, 0s);
    /* Compositor layer hint — GPU sin subpixel jitter. */
    will-change: opacity;
  }

  @keyframes wave-opacity {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .char {
      animation: none;
      opacity: 1;
    }
  }
</style>
