<script lang="ts">
  /**
   * /housekeeping/dashboard — Resumen del panel.
   *
   * Pirámide de lectura de un dashboard pro: KPIs arriba (estado global en 2
   * segundos) → salud del sistema debajo. Sin cards decoradas, sin movimiento
   * ocioso, color reservado para estado.
   *
   *   1. KPI strip (4, variante sólida de DiagnosticsKPI):
   *      Biblioteca analizada · Reproducciones 7d (+sparkline) · Motor DJ ·
   *      Connect en vivo.
   *   2. Salud del sistema (AdminPanel sólido): backend (uptime/heap) +
   *      crons Daily/Smart con su estado y regeneración discreta + DBs.
   *
   * La latencia de Navidrome NO vive aquí: está en el pie del sidebar
   * (servidor de música). Esta card es el motor Audiorr (backend).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    Waveform,
    ChartLineUp,
    Sparkle,
    Broadcast,
    Database,
    ArrowsClockwise
  } from 'phosphor-svelte';
  import DiagnosticsKPI from '$components/diagnostics/DiagnosticsKPI.svelte';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import AdminStatusPill from '$components/housekeeping/AdminStatusPill.svelte';
  import {
    getCoverage,
    getSystemInfo,
    getDjSummary,
    getScrobblesDaily,
    getHubStatus
  } from '$services/dashboard';
  import { getDailyMixesCronStatus, generateAllDailyMixes } from '$services/dailyMixes';
  import { getSmartPlaylistsCronStatus, generateAllSmartPlaylists } from '$services/smartPlaylists';
  import { BackendError } from '$services/BackendService.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { CronStatus } from '$types/backend';

  const queryClient = useQueryClient();

  // ─── Queries (sin refetchInterval: el panel es de sesión corta) ─────────
  const enabled = $derived(credentials.isConfigured);
  const coverageQ = createQuery(() => ({
    queryKey: ['hk-coverage'],
    queryFn: getCoverage,
    enabled,
    staleTime: 5 * 60 * 1000
  }));
  const scrobblesQ = createQuery(() => ({
    queryKey: ['hk-scrobbles-daily', 7],
    queryFn: () => getScrobblesDaily(7),
    enabled,
    staleTime: 5 * 60 * 1000
  }));
  const summaryQ = createQuery(() => ({
    queryKey: ['hk-dj-summary'],
    queryFn: getDjSummary,
    enabled,
    staleTime: 60 * 1000
  }));
  const hubQ = createQuery(() => ({
    queryKey: ['hk-hub-status'],
    queryFn: getHubStatus,
    enabled,
    staleTime: 30 * 1000
  }));
  const systemQ = createQuery(() => ({
    queryKey: ['hk-system'],
    queryFn: getSystemInfo,
    enabled,
    staleTime: 60 * 1000
  }));
  const dailyCronQ = createQuery(() => ({
    queryKey: ['dailyMixesCron'],
    queryFn: () => getDailyMixesCronStatus(),
    enabled
  }));
  const smartCronQ = createQuery(() => ({
    queryKey: ['smartPlaylistsCron'],
    queryFn: () => getSmartPlaylistsCronStatus(),
    enabled
  }));

  // ─── Formatters ─────────────────────────────────────────────────────────
  const fmt = (n: number) => n.toLocaleString('es-ES');
  function fmtRating(r: number | null): string {
    return r === null ? '—' : r.toFixed(2).replace('.', ',');
  }
  function fmtUptime(sec: number): string {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  function fmtBytes(b: number): string {
    if (b >= 1e9) return `${(b / 1e9).toFixed(1).replace('.', ',')} GB`;
    if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
    return `${Math.round(b / 1e3)} KB`;
  }
  function relativeTime(iso?: string | null): string {
    if (!iso) return '—';
    const ms = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(ms);
    const future = ms > 0;
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    let phrase: string;
    if (abs < 60_000) phrase = 'un momento';
    else if (min < 60) phrase = `${min} min`;
    else if (hr < 24) phrase = `${hr} h`;
    else phrase = `${day} ${day === 1 ? 'día' : 'días'}`;
    return future ? `en ${phrase}` : `hace ${phrase}`;
  }

  // ─── Helper de tono para los pills de estado de cron ────────────────────
  function cronTone(s?: CronStatus['status']): 'idle' | 'running' | 'ok' | 'error' {
    if (s === 'running') return 'running';
    if (s === 'error') return 'error';
    if (s === 'success') return 'ok';
    return 'idle';
  }
  function cronLabel(c: CronStatus | undefined | null): string {
    if (!c) return 'Sin info';
    switch (c.status) {
      case 'running': return 'Procesando';
      case 'success': return 'Operativo';
      case 'error':   return 'Con errores';
      default:        return 'En espera';
    }
  }

  const smartAggregate = $derived.by<CronStatus['status']>(() => {
    const all = Object.values(smartCronQ.data ?? {});
    if (all.some((c) => c.status === 'error')) return 'error';
    if (all.some((c) => c.status === 'running')) return 'running';
    if (all.length > 0 && all.every((c) => c.status === 'success' || c.status === 'idle'))
      return 'success';
    return 'idle';
  });
  const smartLastRun = $derived.by(() => {
    const runs = Object.values(smartCronQ.data ?? {})
      .map((c) => c.lastRun)
      .filter((r): r is string => !!r)
      .sort();
    return runs.length > 0 ? runs[runs.length - 1] : null;
  });

  // ─── Valores derivados para los KPIs ────────────────────────────────────
  function kpiValue<T>(q: { data: T | null | undefined; isPending: boolean }, fn: (d: T) => string): string {
    if (q.data != null) return fn(q.data);
    return q.isPending ? '…' : '—';
  }
  const coverageValue = $derived(kpiValue(coverageQ, (d) => fmt(d.total)));
  const scrobblesValue = $derived(kpiValue(scrobblesQ, (d) => fmt(d.total)));
  const scrobblesSeries = $derived(scrobblesQ.data?.series.map((s) => s.plays) ?? null);
  const djValue = $derived(kpiValue(summaryQ, (d) => fmtRating(d.meanRating)));
  const djLabel = $derived(
    summaryQ.data ? `${fmt(summaryQ.data.totalTransitions)} transiciones` : 'media del motor'
  );
  const hubValue = $derived(kpiValue(hubQ, (d) => fmt(d.totalDevices)));

  // ─── Salud del sistema (derivados de /system) ───────────────────────────
  const dbCount = $derived(systemQ.data?.databases.length ?? 0);
  const dbTotalSize = $derived(systemQ.data?.databases.reduce((a, d) => a + d.size, 0) ?? 0);

  // ─── Acciones de regeneración (discretas, junto a su cron) ──────────────
  let dailyAction = $state({ running: false, cooldown: 0 });
  let smartAction = $state({ running: false, cooldown: 0 });

  function startCooldown(target: { cooldown: number }, seconds = 30) {
    target.cooldown = seconds;
    const tick = setInterval(() => {
      target.cooldown -= 1;
      if (target.cooldown <= 0) clearInterval(tick);
    }, 1000);
  }

  async function handleDaily() {
    if (dailyAction.running || dailyAction.cooldown > 0) return;
    if (!confirm('¿Regenerar los Daily Mixes para todas las personas?')) return;
    dailyAction.running = true;
    try {
      await generateAllDailyMixes();
      void dailyCronQ.refetch();
      startCooldown(dailyAction);
      toasts.success('Daily Mixes', 'Regeneración encolada.');
    } catch (err) {
      if (err instanceof BackendError && err.status === 429) {
        toasts.warning('Espera un momento', 'Acabamos de procesar los mixes.');
        startCooldown(dailyAction);
      } else {
        toasts.error('No se han podido generar', err instanceof Error ? err.message : 'Algo ha ido mal');
      }
    } finally {
      dailyAction.running = false;
    }
  }

  async function handleSmart() {
    if (smartAction.running || smartAction.cooldown > 0) return;
    if (!confirm('¿Regenerar todas las Smart Playlists para todas las personas?')) return;
    smartAction.running = true;
    try {
      await generateAllSmartPlaylists();
      void smartCronQ.refetch();
      startCooldown(smartAction);
      toasts.success('Smart Playlists', 'Regeneración encolada.');
    } catch (err) {
      if (err instanceof BackendError && err.status === 429) {
        toasts.warning('Espera un momento', 'Acabamos de regenerarlas.');
        startCooldown(smartAction);
      } else {
        toasts.error('No se han podido generar', err instanceof Error ? err.message : 'Algo ha ido mal');
      }
    } finally {
      smartAction.running = false;
    }
  }
</script>

<svelte:head>
  <title>Resumen · Housekeeping</title>
</svelte:head>

<!-- ─── KPI strip ─────────────────────────────────────────────────────── -->
<div class="kpi-strip">
  <DiagnosticsKPI
    variant="solid"
    showDelta={false}
    pattern="mesh"
    Icon={Waveform}
    kicker="ANÁLISIS"
    value={coverageValue}
    label="canciones analizadas"
  />
  <DiagnosticsKPI
    variant="solid"
    showDelta={false}
    pattern="mesh"
    Icon={ChartLineUp}
    kicker="ACTIVIDAD"
    value={scrobblesValue}
    label="reproducciones · 7 días"
    sparkline={scrobblesSeries}
  />
  <DiagnosticsKPI
    variant="solid"
    showDelta={false}
    pattern="mesh"
    Icon={Sparkle}
    kicker="MOTOR DJ"
    value={djValue}
    label={djLabel}
  />
  <DiagnosticsKPI
    variant="solid"
    showDelta={false}
    pattern="mesh"
    Icon={Broadcast}
    kicker="CONNECT"
    value={hubValue}
    label="dispositivos en vivo"
  />
</div>

<!-- ─── Salud del sistema ─────────────────────────────────────────────── -->
<AdminPanel
  title="Salud del sistema"
  subtitle="Motor Audiorr — backend, jobs y almacenamiento"
  loading={systemQ.isPending}
  error={systemQ.isError ? 'No se pudo leer el estado del backend.' : null}
  onRetry={() => systemQ.refetch()}
>
  <ul class="health-list">
    <li class="health-row">
      <div class="health-meta">
        <span class="health-name">Backend</span>
        <span class="health-sub">
          {#if systemQ.data}
            activo {fmtUptime(systemQ.data.uptimeSec)} · heap
            {fmtBytes(systemQ.data.memory.heapUsed)}/{fmtBytes(systemQ.data.memory.heapTotal)}
          {/if}
        </span>
      </div>
      <AdminStatusPill tone="ok" label={systemQ.data ? `v${systemQ.data.version}` : 'OK'} />
    </li>

    <li class="health-row">
      <div class="health-meta">
        <span class="health-name">Daily Mixes</span>
        <span class="health-sub">
          {dailyCronQ.data?.lastRun ? `Última ${relativeTime(dailyCronQ.data.lastRun)}` : 'Sin ejecuciones aún'}
        </span>
      </div>
      <div class="health-actions">
        <AdminStatusPill tone={cronTone(dailyCronQ.data?.status)} label={cronLabel(dailyCronQ.data)} />
        <button
          type="button"
          class="health-regen"
          onclick={handleDaily}
          disabled={dailyAction.running || dailyAction.cooldown > 0}
          aria-label="Regenerar Daily Mixes ahora"
          title="Regenerar ahora"
        >
          {#if dailyAction.cooldown > 0}
            <span class="health-cooldown">{dailyAction.cooldown}s</span>
          {:else}
            <ArrowsClockwise size={13} weight="bold" class={dailyAction.running ? 'spin' : ''} />
          {/if}
        </button>
      </div>
    </li>

    <li class="health-row">
      <div class="health-meta">
        <span class="health-name">Smart Playlists</span>
        <span class="health-sub">
          {smartLastRun ? `Última ${relativeTime(smartLastRun)}` : 'Sin ejecuciones aún'}
        </span>
      </div>
      <div class="health-actions">
        <AdminStatusPill tone={cronTone(smartAggregate)} label={cronLabel({ status: smartAggregate })} />
        <button
          type="button"
          class="health-regen"
          onclick={handleSmart}
          disabled={smartAction.running || smartAction.cooldown > 0}
          aria-label="Regenerar Smart Playlists ahora"
          title="Regenerar ahora"
        >
          {#if smartAction.cooldown > 0}
            <span class="health-cooldown">{smartAction.cooldown}s</span>
          {:else}
            <ArrowsClockwise size={13} weight="bold" class={smartAction.running ? 'spin' : ''} />
          {/if}
        </button>
      </div>
    </li>

    <li class="health-row">
      <div class="health-meta">
        <span class="health-name"><Database size={13} weight="regular" /> Bases de datos</span>
        <span class="health-sub">{dbCount} {dbCount === 1 ? 'archivo' : 'archivos'} en disco</span>
      </div>
      <AdminStatusPill tone="ok" label={fmtBytes(dbTotalSize)} />
    </li>
  </ul>
</AdminPanel>

<style>
  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: var(--space-4);
  }

  .health-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .health-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-surface-elevated);
    border-radius: var(--radius-md);
  }
  .health-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .health-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .health-sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .health-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .health-regen {
    display: grid;
    place-items: center;
    min-width: 30px;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface-active);
    color: var(--text-secondary);
    cursor: pointer;
    transition: color 160ms var(--ease-ios-default), background 160ms var(--ease-ios-default);
  }
  .health-regen:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-hover); }
  .health-regen:disabled { opacity: 0.6; cursor: not-allowed; }
  .health-regen:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .health-cooldown {
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  :global(.health-regen .spin) { animation: hk-spin 1s linear infinite; }
  @keyframes hk-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.health-regen .spin) { animation: none; }
  }
</style>
