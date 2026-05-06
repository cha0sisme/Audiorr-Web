<script lang="ts">
  /**
   * Equalizer bars — 3 barras animadas que indican "está sonando esto".
   * Port del NowPlayingIndicator de iOS (NowPlaying/SongListView usage).
   *
   * Usa CSS animation con stagger por delay — más performante que rAF.
   * `isPlaying=false` congela las barras (consistente con iOS native).
   * Hereda color via `currentColor` o se le pasa via prop.
   */

  type Props = {
    isPlaying?: boolean;
    /** Altura del indicator en px. iOS usa 12 en SongRow. */
    height?: number;
    /** Ancho de cada barra en px. iOS usa 2.5. */
    barWidth?: number;
    /** Cantidad de barras. iOS usa 5 con sine waves; web usa 3 (clásico). */
    bars?: number;
    /** Color (CSS). Default `currentColor` — hereda del padre. */
    color?: string | undefined;
  };

  let {
    isPlaying = true,
    height = 12,
    barWidth = 2.5,
    bars = 3,
    color
  }: Props = $props();

  // Delays escalonados — cada barra arranca en un punto distinto del ciclo.
  // Negativos para que no haya un "frame 0 al unísono" al montar.
  const delays = $derived(
    Array.from({ length: bars }, (_, i) => `${-((i * 0.3) + 0.45)}s`)
  );
</script>

<span
  class="indicator"
  data-paused={!isPlaying || undefined}
  style:--np-height="{height}px"
  style:--np-bar-width="{barWidth}px"
  style:color={color ?? null}
  aria-label={isPlaying ? 'Reproduciendo' : 'En pausa'}
  role="img"
>
  {#each delays as delay}
    <span class="bar" style:animation-delay={delay}></span>
  {/each}
</span>

<style>
  .indicator {
    display: inline-flex;
    align-items: flex-end;
    gap: 2px;
    height: var(--np-height);
    line-height: 1;
  }
  .bar {
    width: var(--np-bar-width);
    background: currentColor;
    border-radius: 1px;
    animation: np-dance 0.95s ease-in-out infinite;
    will-change: height;
  }
  .indicator[data-paused] .bar {
    animation-play-state: paused;
  }

  @keyframes np-dance {
    0%, 100% { height: 28%; }
    50%      { height: 100%; }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
      height: 60%;
    }
  }
</style>
