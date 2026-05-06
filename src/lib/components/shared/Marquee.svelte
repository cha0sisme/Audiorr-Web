<script lang="ts">
  /**
   * Marquee condicional — texto que scrollea horizontalmente SOLO si el
   * contenido excede su contenedor. Caso de uso primario: record-label
   * footer del AlbumDetail cuando los nombres son largos
   * ("Universal Music Group International / Polydor / A subsidiary of...").
   *
   * Comportamiento:
   *   - Mide on mount (y on resize) si scrollWidth > clientWidth.
   *   - Si NO hay overflow → render plano, sin animación, sin duplicación
   *     del contenido. Casos cortos no pagan ningún coste.
   *   - Si hay overflow → duplica el contenido, anima translateX en loop
   *     continuo.
   *   - Hover pausa el loop (`animation-play-state: paused`).
   *   - Reduced motion: el token `--marquee-duration` no responde a
   *     reduced-motion (es ms, no ms-de-transición), pero envolvemos el
   *     check via @media para detener el animation entirely.
   *
   * Performance: 0 cuando no hay overflow. Cuando activo, animación CSS
   * pura sobre transform → GPU compositor, sub-1ms/frame.
   */
  import type { Snippet } from 'svelte';

  type Props = {
    /** Velocidad como duración de un ciclo completo. Default usa el token
        --marquee-duration (24s). Override solo para casos especiales. */
    duration?: string;
    /** Gap entre la copia 1 y la copia 2 cuando hay overflow. Default 4rem. */
    gap?: string;
    children: Snippet;
  };

  let {
    duration = 'var(--marquee-duration)',
    gap = '4rem',
    children
  }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let trackEl: HTMLDivElement | undefined = $state();
  let overflows = $state(false);

  function measure() {
    if (!containerEl || !trackEl) return;
    // Cuando NO hay overflow: solo hay UNA copia del contenido. La medimos
    // contra el container.
    const contentWidth = trackEl.scrollWidth;
    const containerWidth = containerEl.clientWidth;
    overflows = contentWidth > containerWidth + 1; // +1 = tolerance subpixel
  }

  $effect(() => {
    if (!containerEl) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerEl);
    if (trackEl) ro.observe(trackEl);
    return () => ro.disconnect();
  });
</script>

<div
  bind:this={containerEl}
  class="marquee"
  class:overflowing={overflows}
  style:--marquee-dur={duration}
  style:--marquee-gap={gap}
>
  <div bind:this={trackEl} class="marquee-track">
    <span class="marquee-content">
      {@render children()}
    </span>
    {#if overflows}
      <!-- Segunda copia del contenido: cuando la primera scrolla fuera, la
           segunda entra desde la derecha sin "salto". aria-hidden porque es
           pura redundancia visual. -->
      <span class="marquee-content" aria-hidden="true">
        {@render children()}
      </span>
    {/if}
  </div>
</div>

<style>
  .marquee {
    position: relative;
    overflow: hidden;
    width: 100%;
    min-width: 0;
  }

  .marquee-track {
    display: inline-flex;
    align-items: center;
    gap: var(--marquee-gap);
    /* Cuando NO hay overflow: el track ocupa solo lo necesario, el contenido
       se ve plano y centrado por el container padre. */
    white-space: nowrap;
  }

  /* Cuando overflow=true: animar translateX. La segunda copia llega cuando
     la primera sale exactamente. Al final del ciclo, snap al 0 — visualmente
     no se nota porque ambas copias son idénticas. */
  .marquee.overflowing .marquee-track {
    animation: marquee-scroll var(--marquee-dur) var(--marquee-ease, linear) infinite;
    /* will-change opt-in solo durante animación → libera memoria cuando no
       está activa (caller cerró la página o el contenido cambió). */
    will-change: transform;
  }

  .marquee.overflowing:hover .marquee-track,
  .marquee.overflowing:focus-within .marquee-track {
    animation-play-state: paused;
  }

  .marquee-content {
    display: inline-block;
    /* flex-shrink: 0 evita que las copias se compriman y se pierda el loop. */
    flex-shrink: 0;
  }

  @keyframes marquee-scroll {
    /* 50% es donde la PRIMERA copia ha scrolleado completamente fuera y la
       segunda copia ocupa el viewport. Hacer wrap a 0 al 100% es invisible
       porque el contenido es idéntico. La distancia es 50% porque el track
       contiene 2 copias = 200% de width. */
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .marquee.overflowing .marquee-track {
      animation: none;
      /* Sin animación, mostrar solo la primera copia con ellipsis. La segunda
         queda visible al lado pero invisible (segunda no es necesaria con
         ellipsis). */
    }
    .marquee.overflowing .marquee-content:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .marquee.overflowing .marquee-content:not(:first-child) {
      display: none;
    }
  }
</style>
