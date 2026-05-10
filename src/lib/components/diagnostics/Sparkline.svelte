<script lang="ts">
  /**
   * Sparkline — mini SVG chart linear/area trendy 2026.
   *
   * Mirror del patrón usado en /housekeeping/dashboard (sparkline de latencia
   * Navidrome líneas 84-98). Cero deps, viewBox normalizado, smooth curve
   * opcional via Catmull-Rom interpolation, area fill suave.
   *
   * Usar con un array de puntos (number[]). Min y max se calculan en runtime
   * o se pueden fijar via props para que múltiples sparklines compartan
   * escala (útil para comparar cards en una strip).
   *
   * Color heredado del padre via `currentColor` — el caller setea `color`
   * en el wrapper. Stroke 1.5px finita, area fill al 18% del color para
   * peso visual sin chillar.
   */
  type Props = {
    /** Array de valores. Render vacío si len < 2. */
    points: number[];
    /** Forzar el min de la escala vertical. Si null, usa min(points). */
    min?: number | null;
    /** Forzar el max. Si null, usa max(points). */
    max?: number | null;
    /** Width del viewBox SVG. Por defecto 100. */
    width?: number;
    /** Height del viewBox SVG. Por defecto 28. */
    height?: number;
    /** Stroke width relativo al viewBox. Default 1.5. */
    strokeWidth?: number;
    /** Mostrar dot en el último punto. Default true. */
    showLast?: boolean;
    /** Curve smoothing — true = Catmull-Rom, false = polyline lineal. */
    smooth?: boolean;
  };

  let {
    points,
    min = null,
    max = null,
    width = 100,
    height = 28,
    strokeWidth = 1.5,
    showLast = true,
    smooth = true
  }: Props = $props();

  const stats = $derived.by(() => {
    if (points.length < 2) return null;
    const lo = min ?? Math.min(...points);
    const hi = max ?? Math.max(...points);
    const range = Math.max(1e-6, hi - lo);
    const stepX = width / (points.length - 1);
    const coords = points.map((v, i) => {
      const x = i * stepX;
      // Padding 2px arriba/abajo para que la línea no roce los bordes.
      const padTop = 2;
      const padBottom = 2;
      const usable = height - padTop - padBottom;
      const norm = (v - lo) / range;
      const y = padTop + usable * (1 - norm);
      return { x, y };
    });
    return { coords, lo, hi };
  });

  /** Catmull-Rom → cubic Bezier path (smooth). */
  function smoothPath(coords: { x: number; y: number }[]): string {
    if (coords.length < 2) return '';
    const segs: string[] = [`M ${coords[0]!.x.toFixed(2)} ${coords[0]!.y.toFixed(2)}`];
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i - 1] ?? coords[i]!;
      const p1 = coords[i]!;
      const p2 = coords[i + 1]!;
      const p3 = coords[i + 2] ?? p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      segs.push(
        `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
      );
    }
    return segs.join(' ');
  }

  /** Polyline lineal — más eficiente para series largas/ruidosas. */
  function linearPath(coords: { x: number; y: number }[]): string {
    return coords
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
      .join(' ');
  }

  const linePath = $derived.by(() => {
    if (!stats) return '';
    return smooth ? smoothPath(stats.coords) : linearPath(stats.coords);
  });

  /** Area fill: misma curva + close al baseline. */
  const areaPath = $derived.by(() => {
    if (!stats || stats.coords.length < 2) return '';
    const last = stats.coords[stats.coords.length - 1]!;
    const first = stats.coords[0]!;
    return `${linePath} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;
  });

  const lastPoint = $derived(stats?.coords[stats.coords.length - 1] ?? null);
</script>

{#if stats}
  <svg
    class="sparkline"
    viewBox="0 0 {width} {height}"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path d={areaPath} class="sk-area" />
    <path
      d={linePath}
      class="sk-line"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    {#if showLast && lastPoint}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={strokeWidth * 1.4}
        class="sk-dot"
      />
    {/if}
  </svg>
{/if}

<style>
  .sparkline {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    color: inherit;
  }
  /* Area: mismo color que la línea (currentColor) al 16% — peso sin chillar. */
  .sk-area {
    fill: currentColor;
    opacity: 0.16;
  }
  .sk-dot {
    fill: currentColor;
    /* Pulso sutil sobre el último punto para denotar "live". */
    animation: sk-pulse 2.4s var(--ease-ios-default) infinite;
  }
  @keyframes sk-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.55; }
  }
  @media (prefers-reduced-motion: reduce) {
    .sk-dot { animation: none; }
  }
</style>
