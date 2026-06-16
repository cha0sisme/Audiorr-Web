<script lang="ts">
  /**
   * WorldSymbolMap — mapa de símbolos proporcionales (NO choropleth) del origen
   * de accesos. Silueta de países muda + 1 círculo por país con dato, área ∝ √valor.
   *
   * Mapa base: world-map.min.svg de flekschas/simple-world-map (Author: Al
   * MacDonald, Editor: Fritz Lekschas) — CC BY-SA 3.0. Atribución obligatoria
   * (queda embebida en el <desc> del propio SVG y aquí).
   *
   * Render en DOS capas para evitar el gotcha de {@html} dentro de <svg> (los
   * paths se parsearían en namespace HTML → invisibles): (1) el SVG base completo
   * vía {@html} (se parsea correctamente como SVG), (2) un <svg> overlay propio
   * con el MISMO viewBox para los círculos. Posicionamos cada círculo con
   * getBBox() del path del país (id = ISO alpha-2) en el SVG base → coords del
   * overlay (comparten sistema de coordenadas).
   */
  import worldMapRaw from './world-map.svg?raw';
  import { GlobeHemisphereWest } from 'phosphor-svelte';
  import { countryName } from '$utils/session-format';

  export type MapMetric = 'suspicious' | 'blocked' | 'all';
  export type MapSymbol = { country: string; value: number; tone: 'good' | 'watch' | 'alert' | 'calm' };

  type Props = {
    symbols: MapSymbol[];
    vMax: number;
    metric: MapMetric;
    onMetric: (m: MapMetric) => void;
    hoveredCountry: string | null;
    loading?: boolean;
  };
  let { symbols, vMax, metric, onMetric, hoveredCountry = $bindable(), loading = false }: Props = $props();

  // viewBox del world-map.min.svg (compartido por base y overlay → coords alineadas).
  const VIEWBOX = '30.767 241.591 784.077 458.627';

  const METRICS: { value: MapMetric; label: string }[] = [
    { value: 'suspicious', label: 'Sospechoso' },
    { value: 'blocked', label: 'Bloqueados' },
    { value: 'all', label: 'Todos' }
  ];

  const R_MIN = 4;
  const R_MAX = 22;
  function radius(v: number): number {
    if (vMax <= 0 || v <= 0) return 0;
    return R_MIN + (R_MAX - R_MIN) * Math.sqrt(v / vMax);
  }
  const isIso = (c: string) => /^[A-Za-z]{2}$/.test(c);

  let baseEl = $state<HTMLDivElement | undefined>();
  // Centroides (x,y en unidades del viewBox) por país, vía getBBox del path base.
  let centroids = $state<Record<string, { x: number; y: number }>>({});

  $effect(() => {
    const base = baseEl;
    if (!base) return;
    const svg = base.querySelector('svg');
    if (!svg) return;
    const next: Record<string, { x: number; y: number }> = {};
    for (const s of symbols) {
      if (!isIso(s.country)) continue;
      const el = svg.querySelector<SVGGraphicsElement>(`#${s.country.toLowerCase()}`);
      if (el && typeof el.getBBox === 'function') {
        try {
          const b = el.getBBox();
          if (b.width || b.height) next[s.country] = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        } catch {
          /* getBBox puede fallar si el path aún no tiene caja; se ignora */
        }
      }
    }
    centroids = next;
  });

  // Realce del país bajo hover/foco (vínculo bidireccional con la tabla).
  $effect(() => {
    const base = baseEl;
    if (!base) return;
    const svg = base.querySelector('svg');
    if (!svg) return;
    svg.querySelector('path[data-hl]')?.removeAttribute('data-hl');
    if (hoveredCountry && isIso(hoveredCountry)) {
      svg.querySelector(`#${hoveredCountry.toLowerCase()}`)?.setAttribute('data-hl', '');
    }
  });

  const hasSymbols = $derived(symbols.length > 0);
  const showColorKey = $derived(metric === 'suspicious' || metric === 'all');
  const mapSummary = $derived(
    hasSymbols
      ? `Mapa de origen de accesos: ${symbols.length} ${symbols.length === 1 ? 'país' : 'países'} con dato en el rango.`
      : 'Mapa de origen de accesos: sin datos de país todavía.'
  );
</script>

<div class="wsm">
  <div class="wsm-metric" role="radiogroup" aria-label="Métrica del mapa">
    {#each METRICS as m (m.value)}
      <button
        type="button"
        class="wsm-metric-chip"
        class:active={metric === m.value}
        role="radio"
        aria-checked={metric === m.value}
        onclick={() => onMetric(m.value)}
      >{m.label}</button>
    {/each}
  </div>

  <div class="wsm-frame" role="img" aria-label={mapSummary}>
    <!-- Capa 1: SVG base mudo (paths id = ISO). {@html} a nivel de bloque → se
         parsea correctamente como SVG (no anidado en otro <svg>). -->
    <div class="wsm-base" bind:this={baseEl} aria-hidden="true">{@html worldMapRaw}</div>

    <!-- Capa 2: overlay con los símbolos, mismo viewBox que el base. -->
    <svg
      class="wsm-overlay"
      viewBox={VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {#each symbols as s (s.country)}
        {#if centroids[s.country]}
          <circle
            class="wsm-dot"
            class:hovered={hoveredCountry === s.country}
            data-tone={s.tone}
            role="img"
            aria-label={`${countryName(s.country) ?? s.country}: ${s.value}`}
            cx={centroids[s.country]!.x}
            cy={centroids[s.country]!.y}
            r={radius(s.value)}
            onmouseenter={() => (hoveredCountry = s.country)}
            onmouseleave={() => { if (hoveredCountry === s.country) hoveredCountry = null; }}
          ><title>{countryName(s.country) ?? s.country} · {s.value}</title></circle>
        {/if}
      {/each}
    </svg>

    {#if !loading && !hasSymbols}
      <div class="wsm-empty">
        <GlobeHemisphereWest size={30} weight="regular" />
        <p>Aún no hay datos de país. Se irán registrando a partir de ahora.</p>
      </div>
    {/if}
  </div>

  <!-- Leyenda: escala de tamaño + clave de color (si la métrica usa >1 color). -->
  <div class="wsm-legend">
    <div class="wsm-legend-size" aria-hidden="true">
      <svg width="74" height="26" viewBox="0 0 74 26">
        <circle cx="9" cy="18" r={R_MIN} class="wsm-leg-dot" />
        <circle cx="40" cy="14" r={(R_MIN + R_MAX) / 2.4} class="wsm-leg-dot" />
        <circle cx="64" cy="13" r={R_MAX / 1.6} class="wsm-leg-dot" />
      </svg>
      <span class="wsm-legend-cap">1 → {vMax > 0 ? vMax : '·'}</span>
    </div>
    {#if showColorKey}
      <div class="wsm-legend-key">
        <span class="wsm-key"><span class="wsm-key-dot" data-tone="watch"></span>fallidos</span>
        <span class="wsm-key"><span class="wsm-key-dot" data-tone="alert"></span>bloqueados</span>
        {#if metric === 'all'}<span class="wsm-key"><span class="wsm-key-dot" data-tone="calm"></span>accesos</span>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .wsm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  /* Selector de métrica */
  .wsm-metric {
    display: inline-flex;
    align-self: flex-start;
    gap: 2px;
    padding: 3px;
    background: var(--segment-bg);
    border-radius: var(--radius-full);
  }
  .wsm-metric-chip {
    padding: 4px 12px;
    border: 0;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--segment-text);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-ios-default), background var(--duration-fast) var(--ease-ios-default);
  }
  .wsm-metric-chip:hover:not(.active) { color: var(--text-primary); }
  .wsm-metric-chip.active {
    color: var(--segment-text-active);
    background: var(--segment-indicator-bg);
    box-shadow: var(--segment-indicator-shadow);
  }
  .wsm-metric-chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  /* Marco del mapa: el base define el alto; el overlay se superpone exacto. */
  .wsm-frame {
    position: relative;
    border-radius: var(--radius-md);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }
  .wsm-base { display: block; width: 100%; }
  .wsm-base :global(svg) { display: block; width: 100%; height: auto; }
  /* Silueta muda; el país bajo hover/selección se realza (no es el canal del dato). */
  .wsm-base :global(svg path) {
    fill: var(--map-land);
    stroke: none;
    transition: fill 160ms var(--ease-ios-default);
  }
  .wsm-base :global(svg path[data-hl]) { fill: var(--map-land-active); }

  .wsm-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .wsm-dot {
    stroke: var(--map-symbol-stroke);
    stroke-width: 1;
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 160ms var(--ease-ios-default);
    cursor: pointer;
  }
  .wsm-dot[data-tone='good']  { fill: var(--sec-good); }
  .wsm-dot[data-tone='calm']  { fill: var(--sec-calm); }
  .wsm-dot[data-tone='watch'] { fill: var(--sec-watch); }
  .wsm-dot[data-tone='alert'] { fill: var(--sec-alert); }
  .wsm-dot.hovered { transform: scale(1.25); }

  .wsm-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-align: center;
    padding: var(--space-4);
    color: var(--text-tertiary);
    background: color-mix(in srgb, var(--bg-surface-elevated) 70%, transparent);
  }
  .wsm-empty p { margin: 0; font-size: var(--text-sm); max-width: 32ch; }

  /* Leyenda */
  .wsm-legend {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    flex-wrap: wrap;
    padding: 0 var(--space-1);
  }
  .wsm-legend-size { display: inline-flex; align-items: center; gap: 6px; }
  .wsm-leg-dot { fill: none; stroke: var(--text-tertiary); stroke-width: 1; }
  .wsm-legend-cap, .wsm-key {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .wsm-legend-key { display: inline-flex; gap: var(--space-4); }
  .wsm-key { display: inline-flex; align-items: center; gap: 5px; }
  .wsm-key-dot { width: 8px; height: 8px; border-radius: var(--radius-full); }
  .wsm-key-dot[data-tone='watch'] { background: var(--sec-watch); }
  .wsm-key-dot[data-tone='alert'] { background: var(--sec-alert); }
  .wsm-key-dot[data-tone='calm'] { background: var(--sec-calm); }

  @media (prefers-reduced-motion: reduce) {
    .wsm-base :global(svg path), .wsm-dot { transition: none; }
  }
  @media (forced-colors: active) {
    .wsm-dot { stroke: CanvasText; }
  }
</style>
