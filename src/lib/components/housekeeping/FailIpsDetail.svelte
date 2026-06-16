<script lang="ts">
  /**
   * FailIpsDetail — cuerpo del drawer de "IPs con fallos". Tabla ranked completa
   * (IP · Intentos · Último intento) con data-bar por fila.
   *
   * NOTA: el backend no tiene geoip → no hay columna País (el spec la asumía,
   * pero el dato no existe; mismo criterio honesto que SessionRow). Solo IP.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { getFailIps } from '$services/dashboard';
  import { credentials } from '$stores/credentials.svelte';

  let days = $state(7);

  const failIpsQ = createQuery(() => ({
    queryKey: ['hk-fail-ips', days],
    queryFn: () => getFailIps(days, 100),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const ips = $derived(failIpsQ.data?.ips ?? []);
  const maxCount = $derived(ips.reduce((m, r) => Math.max(m, r.count), 0));

  // Hora en horario peninsular (los `ts` del audit-log están en UTC).
  function fmtWhen(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Madrid'
    });
  }
</script>

<div class="fi-range" role="radiogroup" aria-label="Ventana temporal">
  {#each [7, 14, 30] as d (d)}
    <button
      type="button"
      class="fi-range-chip"
      class:active={days === d}
      role="radio"
      aria-checked={days === d}
      onclick={() => (days = d)}
    >{d} días</button>
  {/each}
</div>

{#if failIpsQ.isPending}
  <div class="fi-skel">
    {#each Array(6) as _, i (i)}<div class="fi-skel-row"></div>{/each}
  </div>
{:else if failIpsQ.isError}
  <p class="fi-state">No se pudieron cargar las IPs. ¿Backend desplegado?</p>
{:else if ips.length === 0}
  <p class="fi-state">Sin intentos fallidos en esta ventana. 🎉</p>
{:else}
  <table class="fi-table">
    <thead>
      <tr>
        <th scope="col">IP</th>
        <th scope="col" class="fi-num">Intentos</th>
        <th scope="col">Último intento</th>
      </tr>
    </thead>
    <tbody>
      {#each ips as row (row.ip)}
        <tr>
          <td class="fi-ip">
            <span class="fi-bar" style={`--w:${maxCount > 0 ? (row.count / maxCount) * 100 : 0}%`} aria-hidden="true"></span>
            <span class="fi-ip-text">{row.ip}</span>
          </td>
          <td class="fi-num"><span class="fi-count">{row.count}</span></td>
          <td class="fi-when">{fmtWhen(row.lastAttemptAt)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .fi-range {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--segment-bg);
    border-radius: var(--radius-full);
    width: fit-content;
  }
  .fi-range-chip {
    padding: 5px 12px;
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
  .fi-range-chip:hover:not(.active) { color: var(--text-primary); }
  .fi-range-chip.active {
    color: var(--segment-text-active);
    background: var(--segment-indicator-bg);
    box-shadow: var(--segment-indicator-shadow);
  }
  .fi-range-chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .fi-state {
    margin: 0;
    padding: var(--space-6) var(--space-2);
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .fi-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .fi-table th {
    padding: 6px 10px;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-subtle);
  }
  .fi-table th.fi-num { text-align: right; }
  .fi-table td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
  }
  .fi-table tr:last-child td { border-bottom: 0; }

  .fi-ip {
    position: relative;
    min-width: 0;
  }
  /* Data-bar de fondo, proporcional a los intentos. */
  .fi-bar {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    height: 22px;
    width: var(--w);
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }
  .fi-ip-text {
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .fi-num { text-align: right; }
  .fi-count {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    color: var(--status-danger-text);
  }
  .fi-when {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .fi-skel { display: flex; flex-direction: column; gap: 6px; }
  .fi-skel-row {
    height: 38px;
    border-radius: var(--radius-sm);
    background: var(--skeleton-bg);
    animation: fi-pulse 1.6s ease-in-out infinite;
  }
  @keyframes fi-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .fi-skel-row { animation: none; }
  }
</style>
