<script lang="ts">
  /**
   * EqualizerIcon — réplica 1:1 del Now Playing Indicator de iOS 26 Apple
   * Music (Control Center, Lock Screen, Dynamic Island).
   *
   * Geometría (calibrada contra el screenshot oficial WWDC25 — variante 6
   * bandas para más resolución espectral: bass, low-mid, mid, high-mid,
   * presencia, aire):
   *  - 6 barras capsule (rounded ambos extremos)
   *  - Alineadas al CENTRO vertical → crecen simétricamente desde el medio
   *  - Anchura uniforme, gap proporcional (ratio 1:1)
   *  - Cada barra tiene altura MÁXIMA distinta (perfil per-bar en el
   *    visualizer) → nunca se ve uniforme, "líderes" y "cortas"
   *
   * Reactividad: FFT real per-band via `EqualizerVisualizer`. Reactivo
   * al audio en vivo (post-EQ + ReplayGain). 1 FFT global por frame
   * independiente del número de instancias.
   */

  import { audioEngine } from '$lib/audio/AudioEngine.svelte';
  import { equalizerVisualizer } from '$lib/audio/EqualizerVisualizer.svelte';

  type Props = {
    /** Número de barras. Default 6 — más resolución espectral (bass→aire). */
    bars?: number;
    /** Altura del icono en px. iOS usa ~14-16. */
    height?: number;
    /** Ancho de cada barra en px. */
    barWidth?: number;
    /** Color CSS. Por defecto hereda via `currentColor`. */
    color?: string | undefined;
    /** Aria-label cuando suena audio. */
    label?: string;
  };

  let {
    bars = 6,
    height = 14,
    // Anchura ENTERA: con 2.5 el browser redondea distinto por barra y los
    // gaps quedan visualmente irregulares. Con 6 barras default barWidth=2
    // mantiene el ancho total cercano al de 4 barras × 3px del diseño previo.
    barWidth = 2,
    color,
    label = 'Reproduciendo'
  }: Props = $props();

  let barEls: HTMLSpanElement[] = $state([]);

  const isActive = $derived(audioEngine.isPlaying);

  $effect(() => {
    if (!isActive) return;
    const ready = barEls.slice(0, bars);
    if (ready.length !== bars || ready.some((el) => !el)) return;
    return equalizerVisualizer.subscribe(ready, bars);
  });
</script>

<span
  class="eq"
  data-active={isActive || undefined}
  style:--eq-h="{height}px"
  style:--eq-bw="{barWidth}px"
  style:color={color ?? null}
  aria-label={isActive ? label : 'En pausa'}
  role="img"
>
  {#each Array.from({ length: bars }) as _, i (i)}
    <span bind:this={barEls[i]} class="bar"></span>
  {/each}
</span>

<style>
  /* CENTER alignment — paridad con el iOS 26 Now Playing Indicator (las
     barras crecen simétricamente desde el medio del icono hacia arriba y
     hacia abajo). No es flex-end / bottom-anchored. */
  .eq {
    display: inline-flex;
    align-items: center;
    /* Gap proporcional al ancho de barra (ratio 1:1) — con 6 barras el
       diseño Apple pide más densidad de información sin amontonar. Igualar
       gap a barWidth (`var(--eq-bw)`) mantiene el ritmo visual uniforme
       independientemente del tamaño del icono. */
    gap: var(--eq-bw);
    height: var(--eq-h);
    line-height: 1;
    vertical-align: middle;
  }

  .bar {
    width: var(--eq-bw);
    height: 100%;
    background: currentColor;
    /* Capsule shape: radius = barWidth/2 → pill perfecto por toda la altura
       (rounded en arriba y abajo, no solo en un extremo). */
    border-radius: calc(var(--eq-bw) / 2);
    /* Crece desde el centro — el visualizer aplica scaleY simétrico. */
    transform-origin: center center;
    /* Floor estático cuando no hay audio (consistente con el floor 0.1
       del visualizer → sin saltos al arrancar/parar el playback). */
    transform: scaleY(0.1);
    will-change: transform;
  }

  /* Active: el visualizer escribe transform vía .style — sin transition
     CSS para que cada frame del rAF aplique al instante. El release
     suave es responsabilidad del envelope follower del visualizer. */
  .eq[data-active] .bar {
    transition: none;
  }
  /* Inactive: la transition cubre el último tramo desde el decay del
     visualizer hasta el floor estático cuando para el playback. */
  .eq:not([data-active]) .bar {
    transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .bar { transform: scaleY(0.4); }
    .eq[data-active] .bar,
    .eq:not([data-active]) .bar { transition: none; }
  }
</style>
