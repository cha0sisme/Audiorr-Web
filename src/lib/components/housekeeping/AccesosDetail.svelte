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

<!-- Lista de eventos. Fila flex (NO tabla): el punto de resultado va a la
     IZQUIERDA, siempre visible; la IP (IPv6 larga) trunca con ellipsis en vez
     de forzar scroll horizontal que escondía el resultado. -->
{#if eventsQ.isPending}
  <div class="ac-skel">
    {#each Array(8) as _, i (i)}<div class="ac-skel-row"></div>{/each}
  </div>
{:else if eventsQ.isError}
  <p class="ac-state">No se pudieron cargar los eventos. ¿Backend desplegado?</p>
{:else if events.length === 0}
  <p class="ac-state">Sin eventos de acceso en esta ventana.</p>
{:else}
  <ul class="ac-events">
    {#each events as e, i (i)}
      <li class="ac-ev">
        <span class="ac-ev-dot" data-result={e.result} aria-hidden="true"></span>
        <div class="ac-ev-main">
          <div class="ac-ev-top">
            <span class="ac-ev-label" data-result={e.result}>{eventLabel(e)}</span>
            <span class="ac-ev-when">{fmtWhen(e.at)}</span>
          </div>
          <div class="ac-ev-sub">
            <span class="ac-ev-user">{e.username ?? '—'}</span>
            {#if e.ip}<span class="ac-ev-ip">{e.ip}</span>{/if}
          </div>
        </div>
      </li>
    {/each}
  </ul>
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
  /* Lista de eventos — fila flex, sin scroll horizontal. */
  .ac-events {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .ac-ev {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    padding: 8px 2px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .ac-ev:last-child { border-bottom: 0; }
  /* Punto de resultado: SIEMPRE a la izquierda y visible. */
  .ac-ev-dot {
    width: 9px;
    height: 9px;
    margin-top: 5px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .ac-ev-dot[data-result='ok'] { background: var(--status-success); }
  .ac-ev-dot[data-result='fail'] { background: var(--status-warning); }
  .ac-ev-dot[data-result='blocked'] { background: var(--status-danger); }
  .ac-ev-dot[data-result='other'] { background: var(--text-tertiary); }

  .ac-ev-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ac-ev-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .ac-ev-label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* fallido/bloqueado destacan en color de estado. */
  .ac-ev-label[data-result='fail'] { color: var(--status-warning-text); }
  .ac-ev-label[data-result='blocked'] { color: var(--status-danger-text); }
  .ac-ev-when {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .ac-ev-sub {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .ac-ev-user {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ac-ev-ip {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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
