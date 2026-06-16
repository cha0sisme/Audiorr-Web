<script lang="ts">
  /**
   * AccesosDetail — cuerpo del drawer de "Accesos". Rango 7/14/30 (gobierna la
   * serie diaria y la tabla), mini stacked-bars por día y tabla de eventos del
   * auth-audit-log (Hora · Usuario · IP · Resultado).
   *
   * Superficie CLARA (drawer = operación): consume tokens de texto y de estado,
   * nunca los tokens oscuros del chasis sala de control.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { getAuthDailySeries, getAuthRecentEvents } from '$services/dashboard';
  import { credentials } from '$stores/credentials.svelte';
  import type { AuthEvent } from '$types/dashboard';

  let days = $state(7);

  const seriesQ = createQuery(() => ({
    queryKey: ['hk-auth-daily', days],
    queryFn: () => getAuthDailySeries(days),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));
  const eventsQ = createQuery(() => ({
    queryKey: ['hk-auth-events', days],
    queryFn: () => getAuthRecentEvents(days, 200),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const series = $derived(seriesQ.data?.series ?? []);
  const maxTotal = $derived(
    series.reduce((m, d) => Math.max(m, d.ok + d.fail + d.blocked), 0)
  );
  const events = $derived(eventsQ.data?.events ?? []);

  const EVENT_LABEL: Record<string, string> = {
    login_ok: 'Login',
    login_fail: 'Login fallido',
    login_blocked_url: 'Bloqueado',
    refresh_ok: 'Refresh',
    refresh_fail: 'Refresh fallido',
    logout_ok: 'Logout',
    logout_noop: 'Logout',
    session_revoked: 'Sesión revocada'
  };
  function eventLabel(e: AuthEvent): string {
    return EVENT_LABEL[e.event] ?? e.event;
  }

  function fmtWhen(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
</script>

<div class="ac-range" role="radiogroup" aria-label="Ventana temporal">
  {#each [7, 14, 30] as d (d)}
    <button
      type="button"
      class="ac-range-chip"
      class:active={days === d}
      role="radio"
      aria-checked={days === d}
      onclick={() => (days = d)}
    >{d} días</button>
  {/each}
</div>

<!-- Mini stacked-bars por día (altura por total, segmentos ok/fail/blocked) -->
{#if series.length >= 2}
  <div class="ac-bars" role="img" aria-label={`Accesos diarios de los últimos ${days} días`}>
    {#each series as d (d.date)}
      {@const total = d.ok + d.fail + d.blocked}
      <div class="ac-bar-col" title={`${d.date}: ${d.ok} ok · ${d.fail} fallidos · ${d.blocked} bloqueados`}>
        <div class="ac-bar" style={`height:${maxTotal > 0 ? Math.max((total / maxTotal) * 100, total > 0 ? 6 : 0) : 0}%`}>
          {#if d.blocked > 0}<span class="ac-seg blocked" style={`flex:${d.blocked}`}></span>{/if}
          {#if d.fail > 0}<span class="ac-seg fail" style={`flex:${d.fail}`}></span>{/if}
          {#if d.ok > 0}<span class="ac-seg ok" style={`flex:${d.ok}`}></span>{/if}
        </div>
      </div>
    {/each}
  </div>
  <div class="ac-legend">
    <span class="ac-leg"><span class="ac-dot ok"></span>OK</span>
    <span class="ac-leg"><span class="ac-dot fail"></span>Fallidos</span>
    <span class="ac-leg"><span class="ac-dot blocked"></span>Bloqueados</span>
  </div>
{/if}

<!-- Tabla de eventos -->
{#if eventsQ.isPending}
  <div class="ac-skel">
    {#each Array(8) as _, i (i)}<div class="ac-skel-row"></div>{/each}
  </div>
{:else if eventsQ.isError}
  <p class="ac-state">No se pudieron cargar los eventos. ¿Backend desplegado?</p>
{:else if events.length === 0}
  <p class="ac-state">Sin eventos de acceso en esta ventana.</p>
{:else}
  <table class="ac-table">
    <thead>
      <tr>
        <th scope="col">Hora</th>
        <th scope="col">Usuario</th>
        <th scope="col">IP</th>
        <th scope="col">Resultado</th>
      </tr>
    </thead>
    <tbody>
      {#each events as e, i (i)}
        <tr>
          <td class="ac-when">{fmtWhen(e.at)}</td>
          <td class="ac-user">{e.username ?? '—'}</td>
          <td class="ac-ip">{e.ip ?? '—'}</td>
          <td class="ac-res">
            <span class="ac-res-dot" data-result={e.result} aria-hidden="true"></span>
            {eventLabel(e)}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .ac-range {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--segment-bg);
    border-radius: var(--radius-full);
    width: fit-content;
  }
  .ac-range-chip {
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
  .ac-range-chip:hover:not(.active) { color: var(--text-primary); }
  .ac-range-chip.active {
    color: var(--segment-text-active);
    background: var(--segment-indicator-bg);
    box-shadow: var(--segment-indicator-shadow);
  }
  .ac-range-chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  /* Mini stacked bars */
  .ac-bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 64px;
    padding: var(--space-3);
    background: var(--bg-surface-elevated);
    border-radius: var(--radius-md);
  }
  .ac-bar-col {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .ac-bar {
    width: 100%;
    max-width: 14px;
    min-height: 2px;
    display: flex;
    flex-direction: column;
    border-radius: 3px;
    overflow: hidden;
    background: var(--bg-surface-active);
  }
  .ac-seg { display: block; width: 100%; }
  .ac-seg.ok { background: var(--status-success); }
  .ac-seg.fail { background: var(--status-warning); }
  .ac-seg.blocked { background: var(--status-danger); }

  .ac-legend {
    display: flex;
    gap: var(--space-4);
    margin-top: -4px;
  }
  .ac-leg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .ac-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
  }
  .ac-dot.ok { background: var(--status-success); }
  .ac-dot.fail { background: var(--status-warning); }
  .ac-dot.blocked { background: var(--status-danger); }

  /* Tabla de eventos */
  .ac-state {
    margin: 0;
    padding: var(--space-6) var(--space-2);
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }
  .ac-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .ac-table th {
    padding: 6px 8px;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-subtle);
  }
  .ac-table td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
  }
  .ac-table tr:last-child td { border-bottom: 0; }
  .ac-when { color: var(--text-tertiary); font-size: var(--text-xs); white-space: nowrap; }
  .ac-user {
    color: var(--text-primary);
    font-weight: 600;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ac-ip {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .ac-res {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .ac-res-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .ac-res-dot[data-result='ok'] { background: var(--status-success); }
  .ac-res-dot[data-result='fail'] { background: var(--status-warning); }
  .ac-res-dot[data-result='blocked'] { background: var(--status-danger); }
  .ac-res-dot[data-result='other'] { background: var(--text-tertiary); }

  .ac-skel { display: flex; flex-direction: column; gap: 6px; }
  .ac-skel-row {
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--skeleton-bg);
    animation: ac-pulse 1.6s ease-in-out infinite;
  }
  @keyframes ac-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ac-skel-row { animation: none; }
  }
</style>
