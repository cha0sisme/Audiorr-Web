<script lang="ts">
  /**
   * DiagnosticsKPI — card de métrica para el viewer admin.
   *
   * Hereda el lenguaje visual de HKInfoCard del housekeeping (glass + pattern
   * decorativo + tone tinting), pero el cuerpo está orientado a una sola
   * métrica: número grande Söhne 700 + delta arrow up/down (estilo Binance) +
   * sparkline opcional al fondo.
   *
   * Tones: accent (azul), pink, mint, amber. Patterns: mesh / waves / lines.
   * Combinación libre — cada KPI elige el suyo según semántica.
   *
   * Delta:
   *   - +N → arrow up + status-success.
   *   - −N → arrow down + status-danger.
   *   - 0 ó null → arrow neutral + text-tertiary.
   * El caller decide qué unidad mostrar (`%`, `pts`, vacío). El delta puede
   * ser null si no hay datos para comparar (caso histórico < 2 períodos).
   */
  import type { Component } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';
  import { TrendUp, TrendDown, Minus } from 'phosphor-svelte';
  import Sparkline from './Sparkline.svelte';

  type Pattern = 'mesh' | 'waves' | 'lines';
  type Tone = 'accent' | 'pink' | 'mint' | 'amber';

  type Props = {
    Icon: Component<{ size?: number | string; weight?: IconWeight }>;
    /** Texto pequeño tipo eyebrow encima del número. */
    kicker?: string;
    /** Etiqueta debajo del número. */
    label: string;
    /** Valor formateado (string). El KPI no formatea — el caller controla. */
    value: string;
    /** Delta vs período anterior. Positivo = subió, negativo = bajó.
        null = no hay comparación (mostrar `—`). */
    delta?: number | null;
    /** Unidad sufijo del delta (`%`, `pts`...). Default vacío. */
    deltaUnit?: string;
    /** Decimales del delta. Default 2. */
    deltaDecimals?: number;
    /** Texto contextual al lado del delta (ej. "vs anterior"). */
    deltaSuffix?: string;
    /** Series de puntos para el sparkline al fondo. Si null/vacío,
        no se renderiza. */
    sparkline?: number[] | null;
    pattern: Pattern;
    tone?: Tone;
    /** 'glass' (default, lenguaje original del viewer de diagnostics) o
        'solid' (superficie sobria sin pattern/gradiente, para el Resumen). */
    variant?: 'glass' | 'solid';
    /** Oculta el badge de delta cuando la métrica no tiene comparación
        temporal (KPIs de estado puntual). Default true. */
    showDelta?: boolean;
  };

  let {
    Icon,
    kicker,
    label,
    value,
    delta = null,
    deltaUnit = '',
    deltaDecimals = 2,
    deltaSuffix,
    sparkline = null,
    pattern,
    tone = 'accent',
    variant = 'glass',
    showDelta = true
  }: Props = $props();

  const deltaTone = $derived.by<'up' | 'down' | 'neutral'>(() => {
    if (delta === null || Math.abs(delta) < 0.005) return 'neutral';
    return delta > 0 ? 'up' : 'down';
  });

  const deltaText = $derived.by(() => {
    if (delta === null) return '—';
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    return `${sign}${Math.abs(delta).toFixed(deltaDecimals)}${deltaUnit}`;
  });

  const hasSparkline = $derived(sparkline !== null && sparkline.length >= 2);
</script>

<article
  class="kpi"
  data-pattern={pattern}
  data-tone={tone}
  data-variant={variant}
  class:has-sparkline={hasSparkline}
>
  <header class="kpi-head">
    <span class="kpi-icon" aria-hidden="true">
      <Icon size={16} weight="regular" />
    </span>
    {#if kicker}
      <span class="kpi-kicker">{kicker}</span>
    {/if}
  </header>

  <div class="kpi-body">
    <div class="kpi-number">{value}</div>
    <div class="kpi-meta">
      <span class="kpi-label">{label}</span>
      {#if showDelta}
        <span class="kpi-delta" data-tone={deltaTone}>
          {#if deltaTone === 'up'}
            <TrendUp size={12} weight="bold" />
          {:else if deltaTone === 'down'}
            <TrendDown size={12} weight="bold" />
          {:else}
            <Minus size={12} weight="bold" />
          {/if}
          <span>{deltaText}</span>
          {#if deltaSuffix}
            <span class="kpi-delta-suffix">{deltaSuffix}</span>
          {/if}
        </span>
      {/if}
    </div>
  </div>

  {#if hasSparkline && sparkline}
    <div class="kpi-spark">
      <Sparkline points={sparkline} smooth strokeWidth={1.5} />
    </div>
  {/if}
</article>

<style>
  /* ─── Card glass + pattern (mismo lenguaje que HKInfoCard) ────────────── */
  .kpi {
    --card-accent: var(--accent);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--card-accent) 14%, var(--bg-glass-solid)) 0%,
        var(--bg-glass-solid) 70%
      );
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: 18px;
    overflow: hidden;
    isolation: isolate;
    transition: transform 240ms var(--hk-spring-soft);
  }
  .kpi:hover {
    transform: translateY(-1px);
  }
  .kpi[data-tone='pink']  { --card-accent: oklch(0.7 0.18 12);  }
  .kpi[data-tone='mint']  { --card-accent: oklch(0.72 0.16 165); }
  .kpi[data-tone='amber'] { --card-accent: oklch(0.78 0.15 75);  }

  /* ─── Variante sólida (Resumen): superficie sobria, sin decoración ─────
     Sin gradiente accent, sin blur, sin pattern. El color se reserva: el
     icono va neutro y solo el sparkline conserva un toque de acento (es
     dato, no adorno). */
  .kpi[data-variant='solid'] {
    background: var(--bg-surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border: 1px solid var(--border-subtle);
  }
  .kpi[data-variant='solid']:hover { transform: none; }
  .kpi[data-variant='solid']::before { display: none; }
  .kpi[data-variant='solid'] .kpi-icon {
    background: var(--bg-surface-active);
    color: var(--text-secondary);
  }
  .kpi[data-variant='solid'] .kpi-kicker { color: var(--text-tertiary); }
  .kpi[data-variant='solid'] .kpi-spark { color: var(--accent); }

  /* Patrón decorativo en esquina top-right (mismo helper que HKInfoCard). */
  .kpi::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.55;
    -webkit-mask-image: radial-gradient(
      ellipse 80% 70% at 100% 0%,
      black 0%,
      transparent 70%
    );
    mask-image: radial-gradient(
      ellipse 80% 70% at 100% 0%,
      black 0%,
      transparent 70%
    );
  }
  .kpi[data-pattern='mesh']::before {
    background-image: radial-gradient(
      circle,
      color-mix(in srgb, var(--card-accent) 50%, transparent) 1.2px,
      transparent 1.8px
    );
    background-size: 14px 14px;
  }
  .kpi[data-pattern='waves']::before {
    background:
      radial-gradient(circle at 80% 20%, color-mix(in srgb, var(--card-accent) 38%, transparent) 0%, transparent 28%),
      radial-gradient(circle at 60% 40%, color-mix(in srgb, var(--card-accent) 24%, transparent) 0%, transparent 22%),
      radial-gradient(circle at 90% 50%, color-mix(in srgb, var(--card-accent) 28%, transparent) 0%, transparent 25%);
    background-size: 100% 100%;
  }
  .kpi[data-pattern='lines']::before {
    background-image: repeating-linear-gradient(
      -45deg,
      transparent 0,
      transparent 7px,
      color-mix(in srgb, var(--card-accent) 32%, transparent) 7px,
      color-mix(in srgb, var(--card-accent) 32%, transparent) 8px
    );
  }
  .kpi > * { position: relative; z-index: 1; }

  /* ─── Head: icono + kicker ────────────────────────────────────────── */
  .kpi-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }
  .kpi-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--card-accent) 18%, transparent);
    color: var(--card-accent);
    flex-shrink: 0;
  }
  .kpi-kicker {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--card-accent);
  }

  /* ─── Body: número + label + delta ────────────────────────────────── */
  .kpi-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .kpi-number {
    font-family: var(--font-sans);
    font-size: var(--text-3xl);
    font-weight: 700;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    /* Para que números muy largos no rompan layout. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kpi-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: 4px;
  }
  .kpi-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* ─── Delta arrow + value ─────────────────────────────────────────── */
  .kpi-delta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    transition:
      color var(--duration-normal) var(--ease-ios-default),
      background var(--duration-normal) var(--ease-ios-default);
  }
  .kpi-delta[data-tone='up'] {
    color: var(--status-success-text);
    background: var(--status-success-bg);
  }
  .kpi-delta[data-tone='down'] {
    color: var(--status-danger-text);
    background: var(--status-danger-bg);
  }
  .kpi-delta[data-tone='neutral'] {
    color: var(--text-tertiary);
    background: var(--bg-surface-elevated);
  }
  .kpi-delta-suffix {
    font-weight: 500;
    opacity: 0.75;
    margin-left: 2px;
  }

  /* ─── Sparkline ───────────────────────────────────────────────────── */
  .kpi-spark {
    margin-top: var(--space-2);
    height: 32px;
    color: var(--card-accent);
    /* Mask suave en bordes para que el chart se funda con el card. */
    -webkit-mask-image: linear-gradient(
      90deg,
      transparent 0%,
      black 8%,
      black 100%
    );
    mask-image: linear-gradient(
      90deg,
      transparent 0%,
      black 8%,
      black 100%
    );
  }

  /* Cuando hay sparkline, el card crece un pelín. */
  .kpi.has-sparkline {
    padding-bottom: var(--space-3);
  }
</style>
