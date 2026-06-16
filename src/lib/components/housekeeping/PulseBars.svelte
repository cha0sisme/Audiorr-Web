<script lang="ts">
  /**
   * PulseBars — mini bar chart por día (estilo "actividad" Stripe/GitHub).
   *
   * Para una serie de días DISCRETOS (7 valores), las barras son la forma
   * correcta: leen la magnitud por día de un vistazo y el pico salta solo —
   * a diferencia de un área/curva, que inventa continuidad entre días.
   * Cero deps: cada barra es un <div> con height %. El día más alto va en
   * --accent lleno; el resto al 32%. Un día con 0 plays pinta un stub de 2px
   * (hueco = dato perdido; stub = "ese día fue 0", honesto).
   */
  type Day = { date: string; plays: number };
  type Props = {
    series: Day[];
    /** Inicial del día bajo cada barra (L M X J V S D). Default true. */
    showDayLabels?: boolean;
  };
  let { series, showDayLabels = true }: Props = $props();

  const max = $derived(Math.max(1, ...series.map((d) => d.plays)));
  const total = $derived(series.reduce((n, d) => n + d.plays, 0));

  const NARROW = new Intl.DateTimeFormat('es-ES', { weekday: 'narrow' });
  const LONG = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  function dayNarrow(date: string): string {
    return NARROW.format(new Date(date)).toUpperCase();
  }
  function titleFor(d: Day): string {
    return `${LONG.format(new Date(d.date))} · ${d.plays} reprod.`;
  }

  // Resumen para lectores de pantalla (no recorren 7 barras).
  const summary = $derived.by(() => {
    if (series.length === 0) return 'Sin datos de reproducciones';
    const peak = series.reduce((a, d) => (d.plays > a.plays ? d : a), series[0]!);
    return `Reproducciones por día, últimos ${series.length} días: ${total} en total, máximo el ${LONG.format(new Date(peak.date))} con ${peak.plays}`;
  });
</script>

<div class="bars" role="img" aria-label={summary}>
  {#each series as d, i (d.date)}
    <div class="col">
      <div class="track" title={titleFor(d)}>
        <div
          class="bar"
          data-peak={d.plays === max && max > 0}
          data-zero={d.plays === 0}
          style:height="{(d.plays / max) * 100}%"
          style:--i={i}
          aria-hidden="true"
        ></div>
      </div>
      {#if showDayLabels}
        <span class="day" aria-hidden="true">{dayNarrow(d.date)}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    width: 100%;
  }
  .col {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
  }
  .track {
    width: 100%;
    height: 52px;
    display: flex;
    align-items: flex-end;
    /* Suelo compartido: hairline que ancla las barras como "instrumento". */
    border-bottom: 1px solid var(--separator-subtle);
  }
  .bar {
    width: 100%;
    min-height: 2px;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: color-mix(in srgb, var(--accent) 32%, transparent);
    transform-origin: bottom;
    animation: pulse-grow var(--duration-normal) var(--ease-ios-default) backwards;
    animation-delay: calc(var(--i) * var(--stagger-step-tight, 30ms));
  }
  .bar[data-peak='true'] { background: var(--accent); }
  .bar[data-zero='true'] { background: var(--bg-surface-active); }
  @keyframes pulse-grow {
    from { transform: scaleY(0); }
    to   { transform: scaleY(1); }
  }
  .day {
    font-size: 9px;
    font-weight: 500;
    color: var(--text-quaternary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar { animation: none; }
  }
</style>
