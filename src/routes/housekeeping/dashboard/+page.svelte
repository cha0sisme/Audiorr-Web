<script lang="ts">
  /**
   * /housekeeping/dashboard — Resumen del panel ("sala de control").
   *
   * Tres arquetipos de visualización, no un molde repetido — la forma sigue al
   * dato y el color codifica ESTADO (semáforo), no decora:
   *   1. Accesos · 7d → gauge de balance (barra segmentada ok/fallidos/bloqueados).
   *   2. IPs con fallos → lista ranked con data-bars (el atacante salta a la vista).
   *   3. Seguridad ahora → trío de stat tiles (sesiones / bloqueadas / eventos).
   * + Panel "Salud y actividad" con jerarquía: pulso héroe > backend/DBs > jobs.
   *
   * Datos de /api/admin/security-summary, /api/diagnostics/system y
   * /api/stats/scrobbles-daily (verificados en prod). Sala de control: superficie
   * sólida con accent rail; lenguaje propio, distinto del card-poster de Diagnostics.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import {
    ShieldCheck,
    GlobeHemisphereWest,
    UsersThree,
    Database,
    ChartLineUp,
    Gauge,
    Cpu,
    CheckCircle,
    CaretRight,
    ArrowsClockwise,
    Image as ImageIcon
  } from 'phosphor-svelte';
  import SecCard from '$components/housekeeping/SecCard.svelte';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import AdminStatusPill from '$components/housekeeping/AdminStatusPill.svelte';
  import PulseBars from '$components/housekeeping/PulseBars.svelte';
  import RangeSelect from '$components/housekeeping/RangeSelect.svelte';
  import DetailDrawer from '$components/housekeeping/DetailDrawer.svelte';
  import AccesosDetail from '$components/housekeeping/AccesosDetail.svelte';
  import FailIpsDetail from '$components/housekeeping/FailIpsDetail.svelte';
  import {
    getSecuritySummary,
    getSystemInfo,
    getScrobblesDaily,
    getAuthDailySeries,
    getRateLimitStats
  } from '$services/dashboard';
  import { generateAllDailyMixes, regenerateAllCovers } from '$services/dailyMixes';
  import { generateAllSmartPlaylists } from '$services/smartPlaylists';
  import { BackendError } from '$services/BackendService.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { SystemCron } from '$types/dashboard';

  const enabled = $derived(credentials.isConfigured);

  const securityQ = createQuery(() => ({
    queryKey: ['hk-security-summary'],
    queryFn: getSecuritySummary,
    enabled,
    staleTime: 60 * 1000
  }));
  const systemQ = createQuery(() => ({
    queryKey: ['hk-system'],
    queryFn: getSystemInfo,
    enabled,
    staleTime: 60 * 1000
  }));
  // Rango del pulso, seleccionable (mini-desplegable). `value: 0` = semana
  // natural ISO (lunes→hoy) y es el DEFAULT (la semana empieza en lunes).
  // 7/14/30 rodantes quedan como opciones para lectura de tendencia continua.
  let pulseDays = $state(0);
  const RANGE_OPTIONS = [
    { value: 7, label: '7 días' },
    { value: 14, label: '14 días' },
    { value: 30, label: '30 días' },
    { value: 0, label: 'Esta semana' }
  ];
  // Días desde el lunes inclusive (Lun=1 … Dom=7). getDay(): Dom=0 … Sáb=6.
  function daysSinceMonday(): number {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
  }
  const effectivePulseDays = $derived(pulseDays === 0 ? daysSinceMonday() : pulseDays);
  const scrobblesQ = createQuery(() => ({
    queryKey: ['hk-scrobbles-daily', effectivePulseDays],
    queryFn: () => getScrobblesDaily(effectivePulseDays),
    enabled,
    staleTime: 5 * 60 * 1000
  }));
  const pulseSeries = $derived(scrobblesQ.data?.series ?? []);

  // Drill-down: drawer lateral de detalle (solo Accesos e IPs tienen registro
  // detrás; el resto de cards no drillan). Una card abierta a la vez.
  let openDrawer = $state<'accesos' | 'ips' | null>(null);

  // ─── Cards de observabilidad (Zona A) ─────────────────────────────────────
  // Accesos: una sola card con rango seleccionable (7/14/30) — fusiona lo que
  // antes eran dos cards (balance 7d + serie 30d). Comparte cache con el drawer.
  let accesosDays = $state(7);
  const ACCESOS_RANGE = [
    { value: 7, label: '7 días' },
    { value: 14, label: '14 días' },
    { value: 30, label: '30 días' }
  ];
  const authDailyQ = createQuery(() => ({
    queryKey: ['hk-auth-daily', accesosDays],
    queryFn: () => getAuthDailySeries(accesosDays),
    enabled,
    staleTime: 5 * 60 * 1000
  }));
  const rateLimitQ = createQuery(() => ({
    queryKey: ['hk-rate-limit'],
    queryFn: getRateLimitStats,
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }));

  // Accesos por día (stacked bars). Altura por total diario; rail por actividad
  // sospechosa reciente (bloqueos/fallos de los últimos 7 días).
  const authSeries = $derived(authDailyQ.data?.series ?? []);
  const authMaxDay = $derived(Math.max(1, ...authSeries.map((d) => d.ok + d.fail + d.blocked)));
  const authTotals = $derived(
    authSeries.reduce(
      (a, d) => ({ ok: a.ok + d.ok, fail: a.fail + d.fail, blocked: a.blocked + d.blocked }),
      { ok: 0, fail: 0, blocked: 0 }
    )
  );
  const authState = $derived.by<'calm' | 'watch' | 'alert'>(() => {
    const recent = authSeries.slice(-7);
    const blocked = recent.reduce((n, d) => n + d.blocked, 0);
    const fail = recent.reduce((n, d) => n + d.fail, 0);
    if (blocked >= 5) return 'alert';
    if (blocked > 0 || fail > 0) return 'watch';
    return 'calm';
  });

  // Rate-limits (abuso). Tiles por limiter; rail por total de hits.
  const rlLimiters = $derived(rateLimitQ.data?.limiters ?? []);
  const rlTotal = $derived(rlLimiters.reduce((n, l) => n + l.hits, 0));
  const rlState = $derived.by<'calm' | 'watch' | 'alert'>(() => {
    if (rlTotal >= 20) return 'alert';
    if (rlTotal > 0) return 'watch';
    return 'calm';
  });
  const RL_LABELS: Record<string, string> = {
    analyze: 'Análisis',
    backfill: 'Backfill',
    strict: 'General'
  };

  // ─── Formatters ─────────────────────────────────────────────────────────
  const fmt = (n: number) => n.toLocaleString('es-ES');
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
    if (!iso) return 'nunca';
    const ms = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(ms);
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    if (abs < 60_000) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    if (hr < 24) return `hace ${hr} h`;
    return `hace ${day} ${day === 1 ? 'día' : 'días'}`;
  }
  function shortIp(ip: string): string {
    return ip.replace(/^::ffff:/, '');
  }

  // ─── Security summary ───────────────────────────────────────────────────
  const sec = $derived(securityQ.data ?? null);

  // Card · IPs — lista ranked
  const ipsAll = $derived(sec?.topFailIps ?? []);
  const ipsVisible = $derived(ipsAll.slice(0, 3));
  const ipsRest = $derived(ipsAll.slice(3));
  const ipMax = $derived(ipsAll[0]?.count ?? 1);
  const ipState = $derived.by<'calm' | 'watch' | 'alert'>(() => {
    if (ipsAll.length === 0) return 'calm';
    const top = ipsAll[0]!.count;
    const second = ipsAll[1]?.count ?? 0;
    if (top >= 8 || top >= 3 * Math.max(second, 1)) return 'alert';
    return 'watch';
  });
  function ipBarTone(count: number, isTop: boolean): 'alert' | 'watch' {
    return isTop && ipState === 'alert' ? 'alert' : 'watch';
  }

  // Card 3 · Seguridad ahora
  const secNowState = $derived.by<'calm' | 'alert'>(() =>
    sec && sec.lockedUsernames > 0 ? 'alert' : 'calm'
  );

  // ─── Salud del sistema ────────────────────────────────────────────────────
  const dbValid = $derived(systemQ.data?.databases.filter((d) => d.size != null) ?? []);
  const dbCount = $derived(systemQ.data?.databases.length ?? 0);
  const dbTotalSize = $derived(dbValid.reduce((a, d) => a + (d.size ?? 0), 0));
  const dbMissing = $derived(systemQ.data?.databases.filter((d) => d.status !== 'OK').length ?? 0);

  const CRON_ORDER = ['daily_mixes', 'en_bucle', 'tiempo_atras', 'radar_novedades'] as const;
  const CRON_LABELS: Record<string, string> = {
    daily_mixes: 'Daily Mixes',
    en_bucle: 'En bucle',
    tiempo_atras: 'Tiempo atrás',
    radar_novedades: 'Radar de novedades'
  };
  function cronTone(s?: SystemCron['status']): 'idle' | 'running' | 'ok' | 'error' {
    if (s === 'running') return 'running';
    if (s === 'error') return 'error';
    if (s === 'success') return 'ok';
    return 'idle';
  }
  function cronLabel(c?: SystemCron): string {
    if (!c) return 'Sin info';
    switch (c.status) {
      case 'running': return 'Procesando';
      case 'success': return 'Operativo';
      case 'error':   return 'Con errores';
      default:        return 'En espera';
    }
  }

  // ─── Acordeón de Jobs: cada chip despliega su acción de regeneración ────
  let openJob = $state<string | null>(null);
  function toggleJob(key: string) {
    openJob = openJob === key ? null : key;
  }

  type ActionState = { running: boolean; cooldown: number };
  let dailyAction = $state<ActionState>({ running: false, cooldown: 0 });
  let smartAction = $state<ActionState>({ running: false, cooldown: 0 });
  let coversAction = $state<ActionState>({ running: false, cooldown: 0 });

  function startCooldown(target: ActionState, seconds = 30) {
    target.cooldown = seconds;
    const tick = setInterval(() => {
      target.cooldown -= 1;
      if (target.cooldown <= 0) clearInterval(tick);
    }, 1000);
  }

  async function runAction(
    target: ActionState,
    fn: () => Promise<unknown>,
    okTitle: string,
    okBody: string
  ) {
    if (target.running || target.cooldown > 0) return;
    target.running = true;
    try {
      await fn();
      void systemQ.refetch();
      startCooldown(target);
      toasts.success(okTitle, okBody);
    } catch (err) {
      if (err instanceof BackendError && err.status === 429) {
        const s = err.retryAfter ?? 30;
        startCooldown(target, s);
        toasts.warning('Espera un momento', `Vuelve a intentarlo en ${s} s.`);
      } else {
        toasts.error('No se pudo regenerar', err instanceof Error ? err.message : 'Algo ha ido mal');
      }
    } finally {
      target.running = false;
    }
  }

  const handleDaily = () =>
    runAction(dailyAction, generateAllDailyMixes, 'Daily Mixes regenerados', 'Generados para todos los usuarios.');
  const handleSmart = () =>
    runAction(smartAction, generateAllSmartPlaylists, 'Playlists inteligentes regeneradas', 'En bucle, Tiempo atrás y Radar recalculadas.');
  const handleCovers = () =>
    runAction(coversAction, regenerateAllCovers, 'Portadas en cola', 'Se están regenerando las portadas personalizadas.');

  // Cada job (cron key) → su acción. Los 3 smart comparten llamada y cooldown
  // (el backend no separa por key; el copy lo dice claro, sin botones que mientan).
  type JobInfo = { label: string; copy: string; run: () => void; state: ActionState };
  function jobInfo(key: string): JobInfo {
    if (key === 'daily_mixes') {
      return {
        label: 'Regenerar Daily Mixes',
        copy: 'Genera de nuevo los Daily Mixes para todos los usuarios.',
        run: handleDaily,
        state: dailyAction
      };
    }
    return {
      label: 'Regenerar playlists inteligentes',
      copy: 'Recalcula En bucle, Tiempo atrás y Radar de novedades a la vez.',
      run: handleSmart,
      state: smartAction
    };
  }
</script>

<svelte:head>
  <title>Dashboard · Housekeeping</title>
</svelte:head>

<!-- ─── Sala de control: 3 cards de estado ────────────────────────────────── -->
<div class="sec-grid">
  <!-- Card 1 · Accesos · serie diaria con rango seleccionable (fusiona 7d+30d) -->
  <SecCard
    state={authState}
    Icon={ShieldCheck}
    kicker="Accesos"
    arch="balance"
    onExpand={() => (openDrawer = 'accesos')}
    expandLabel="Ampliar accesos: registro de eventos"
  >
    {#snippet headerAction()}
      <RangeSelect value={accesosDays} options={ACCESOS_RANGE} onChange={(v) => (accesosDays = v)} />
    {/snippet}
    {#snippet peek()}
      <span class="sec-peek-text">
        Últimas 24h: {sec ? sec.logins24h.ok : '·'} ok · {sec ? sec.logins24h.fail : '·'} fallidos
      </span>
    {/snippet}

    {#if authDailyQ.isError}
      <span class="sec-unit">no se pudo leer</span>
    {:else if authSeries.length === 0}
      <span class="sec-unit">cargando…</span>
    {:else}
      <div
        class="daybars"
        role="img"
        aria-label={`Accesos por día: ${authTotals.ok} ok, ${authTotals.fail} fallidos, ${authTotals.blocked} bloqueados en ${authSeries.length} días`}
      >
        {#each authSeries as d (d.date)}
          <div class="daybar" title={`${d.date} · ${d.ok} ok · ${d.fail} fallidos · ${d.blocked} bloqueados`}>
            <span class="seg" data-tone="good" style:height="{(d.ok / authMaxDay) * 100}%"></span>
            <span class="seg" data-tone="watch" style:height="{(d.fail / authMaxDay) * 100}%"></span>
            <span class="seg" data-tone="alert" style:height="{(d.blocked / authMaxDay) * 100}%"></span>
          </div>
        {/each}
      </div>
      <div class="legend">
        <span class="legend-item"><span class="dot" data-tone="good"></span>{fmt(authTotals.ok)} ok</span>
        <span class="legend-item"><span class="dot" data-tone="watch"></span>{fmt(authTotals.fail)} fallidos</span>
        <span class="legend-item"><span class="dot" data-tone="alert"></span>{fmt(authTotals.blocked)} bloq.</span>
      </div>
    {/if}
  </SecCard>

  <!-- Card 2 · IPs · lista ranked -->
  <SecCard
    state={ipState}
    Icon={GlobeHemisphereWest}
    kicker="IPs con fallos · 7 días"
    arch="ranked"
    onExpand={() => (openDrawer = 'ips')}
    expandLabel="Ampliar IPs con fallos: tabla completa"
  >
    {#if ipsRest.length > 0}
      {#snippet peek()}
        <ul class="iplist">
          {#each ipsRest as entry (entry.ip)}
            <li class="iprow">
              <span class="ip">{shortIp(entry.ip)}</span>
              <span class="ip-count">{entry.count}</span>
            </li>
          {/each}
        </ul>
      {/snippet}
    {/if}

    {#if securityQ.isError}
      <span class="sec-unit">no se pudo leer</span>
    {:else if !sec}
      <span class="sec-unit">cargando…</span>
    {:else if ipsAll.length === 0}
      <div class="empty-good">
        <CheckCircle size={22} weight="fill" />
        <span>Sin intentos fallidos. Todo limpio.</span>
      </div>
    {:else}
      <ul class="iplist">
        {#each ipsVisible as entry, i (entry.ip)}
          <li class="iprow" class:top={i === 0}>
            <span class="ip">{shortIp(entry.ip)}</span>
            <span class="ip-bar"><span class="ip-bar-fill" data-tone={ipBarTone(entry.count, i === 0)} style:width="{(entry.count / ipMax) * 100}%"></span></span>
            <span class="ip-count">{entry.count}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </SecCard>

  <!-- Card 3 · Seguridad ahora · trío de tiles -->
  <SecCard state={secNowState} Icon={UsersThree} kicker="Seguridad ahora" arch="tiles">
    {#if securityQ.isError}
      <span class="sec-unit">no se pudo leer</span>
    {:else}
      <div class="tiles">
        <div class="tile">
          <span class="tile-num">{sec ? fmt(sec.activeSessions) : '…'}</span>
          <span class="tile-label">sesiones activas</span>
        </div>
        <div class="tile" data-tone={sec && sec.lockedUsernames > 0 ? 'alert' : 'good'}>
          <span class="tile-num">{sec ? sec.lockedUsernames : '·'}</span>
          <span class="tile-label">bloqueadas</span>
        </div>
        <div class="tile">
          <span class="tile-num">{sec ? fmt(sec.auditTotalRecords) : '…'}</span>
          <span class="tile-label">eventos</span>
        </div>
      </div>
    {/if}
  </SecCard>

  <!-- Card · Rate-limits · abuso (tiles por limiter) -->
  <SecCard state={rlState} Icon={Gauge} kicker="Rate-limits">
    {#if rateLimitQ.isError}
      <span class="sec-unit">no se pudo leer</span>
    {:else if rlTotal === 0}
      <div class="empty-good">
        <CheckCircle size={22} weight="fill" />
        <span>Sin peticiones bloqueadas.</span>
      </div>
    {:else}
      <div class="tiles">
        {#each rlLimiters as l (l.key)}
          <div class="tile" data-tone={l.hits > 0 ? 'alert' : 'good'}>
            <span class="tile-num">{fmt(l.hits)}</span>
            <span class="tile-label">{RL_LABELS[l.key] ?? l.key}</span>
          </div>
        {/each}
      </div>
    {/if}
  </SecCard>

</div>

<!-- ─── Salud y actividad ─────────────────────────────────────────────────── -->
<AdminPanel
  title="Salud y actividad"
  loading={systemQ.isPending}
  error={systemQ.isError ? 'No se pudo leer el estado del backend.' : null}
  onRetry={() => systemQ.refetch()}
>
  {#snippet info()}
    Motor Audiorr: pulso de reproducciones, estado del backend, jobs programados
    y almacenamiento de bases de datos.
  {/snippet}

  <!-- Zona héroe: pulso de reproducciones (rango seleccionable) -->
  <div class="pulse">
    <div class="pulse-head">
      <div class="pulse-meta">
        <span class="pulse-num">{scrobblesQ.data ? fmt(scrobblesQ.data.total) : '—'}</span>
        <span class="pulse-label">
          <ChartLineUp size={12} weight="bold" /> reproducciones · {pulseDays === 0
            ? 'esta semana'
            : `${pulseDays} días`}
        </span>
      </div>
      <RangeSelect value={pulseDays} options={RANGE_OPTIONS} onChange={(v) => (pulseDays = v)} />
    </div>
    {#if pulseSeries.length >= 2}
      <PulseBars series={pulseSeries} showDayLabels={effectivePulseDays <= 14} />
    {/if}
  </div>

  <!-- Stat strip: backend + bases de datos -->
  <div class="strip">
    <div class="strip-tile">
      <div class="strip-head">
        <span class="strip-name"><Cpu size={13} weight="regular" /> Backend</span>
        <AdminStatusPill tone="ok" label={systemQ.data ? `v${systemQ.data.version}` : 'OK'} />
      </div>
      <span class="strip-sub">
        {#if systemQ.data}
          activo {fmtUptime(systemQ.data.uptimeSec)} · heap
          {fmtBytes(systemQ.data.memory.heapUsed)}/{fmtBytes(systemQ.data.memory.heapTotal)}{#if systemQ.data.commit}
            · <span class="commit">{systemQ.data.commit}</span>{/if}
        {/if}
      </span>
    </div>
    <div class="strip-tile">
      <div class="strip-head">
        <span class="strip-name"><Database size={13} weight="regular" /> Bases de datos</span>
        <AdminStatusPill tone={dbMissing > 0 ? 'warn' : 'ok'} label={fmtBytes(dbTotalSize)} />
      </div>
      <span class="strip-sub">
        {dbCount} {dbCount === 1 ? 'archivo' : 'archivos'}{dbMissing > 0 ? ` · ${dbMissing} no disponible${dbMissing === 1 ? '' : 's'}` : ''}
      </span>
    </div>
  </div>

  <!-- Jobs: chips expandibles (crons con su acción de regeneración) -->
  <div class="jobs">
    <span class="block-label">Jobs</span>
    <div class="jobs-chips">
      {#each CRON_ORDER as key (key)}
        {@const c = systemQ.data?.crons?.[key]}
        <button
          type="button"
          class="job-chip"
          class:expanded={openJob === key}
          aria-expanded={openJob === key}
          aria-controls="jobs-drawer"
          disabled={!systemQ.data}
          onclick={() => toggleJob(key)}
        >
          <AdminStatusPill tone={cronTone(c?.status)} label={CRON_LABELS[key] ?? key} />
          <span class="job-caret"><CaretRight size={11} weight="bold" /></span>
        </button>
      {/each}
    </div>

    <div class="jobs-drawer" class:open={openJob !== null}>
      <div class="jobs-drawer-inner" id="jobs-drawer" role="region" aria-label="Acción del job">
        {#if openJob}
          {@const job = jobInfo(openJob)}
          {@const cron = systemQ.data?.crons?.[openJob]}
          {#key openJob}
            <div class="drawer-content">
              <span class="drawer-meta">Última ejecución: {relativeTime(cron?.lastRun)}</span>
              <button
                type="button"
                class="drawer-action"
                onclick={job.run}
                disabled={job.state.running || job.state.cooldown > 0}
              >
                {#if job.state.running}
                  <ArrowsClockwise size={13} weight="bold" class="spin" /> Regenerando…
                {:else if job.state.cooldown > 0}
                  <ArrowsClockwise size={13} weight="bold" /> {job.label} ({job.state.cooldown}s)
                {:else}
                  <ArrowsClockwise size={13} weight="bold" /> {job.label}
                {/if}
              </button>
              <span class="drawer-copy">{job.copy}</span>
            </div>
          {/key}
        {/if}
      </div>
    </div>

  </div>

  <!-- Mantenimiento: acciones globales (bloque hermano de Jobs, no hijo) -->
  <div class="maint">
    <span class="block-label">Mantenimiento</span>
    <button
      type="button"
      class="maint-action"
      onclick={handleCovers}
      disabled={coversAction.running || coversAction.cooldown > 0}
    >
      {#if coversAction.running}
        <ArrowsClockwise size={13} weight="bold" class="spin" /> Regenerando…
      {:else if coversAction.cooldown > 0}
        <ImageIcon size={13} weight="regular" /> Regenerar portadas ({coversAction.cooldown}s)
      {:else}
        <ImageIcon size={13} weight="regular" /> Regenerar portadas
      {/if}
    </button>
  </div>
</AdminPanel>

<!-- ─── Drill-down: drawers laterales de detalle ──────────────────────────── -->
<DetailDrawer
  open={openDrawer === 'accesos'}
  title="Accesos · detalle"
  Icon={ShieldCheck}
  onClose={() => (openDrawer = null)}
>
  <AccesosDetail />
</DetailDrawer>

<DetailDrawer
  open={openDrawer === 'ips'}
  title="IPs con fallos · detalle"
  Icon={GlobeHemisphereWest}
  onClose={() => (openDrawer = null)}
>
  <FailIpsDetail />
</DetailDrawer>

<style>
  .sec-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: var(--space-4);
  }

  /* ─── Tipografía común de las cards de estado ────────────────────────── */
  .sec-unit {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--sec-fg-secondary);
  }
  .sec-peek-text {
    font-size: 11px;
    color: var(--sec-fg-tertiary);
  }

  /* ─── Leyenda (ok/fallidos/bloqueados) ───────────────────────────────── */
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    font-weight: 500;
    color: var(--sec-fg-secondary);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .dot[data-tone='good']  { background: var(--sec-good); }
  .dot[data-tone='watch'] { background: var(--sec-watch); }
  .dot[data-tone='alert'] { background: var(--sec-alert); }

  /* ─── Card 2: lista ranked con data bars ─────────────────────────────── */
  .iplist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .iprow {
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr auto;
    align-items: center;
    gap: 10px;
  }
  .ip {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--sec-fg-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 13ch;
  }
  .iprow.top .ip { color: var(--sec-fg); font-weight: 600; }
  .ip-bar {
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--sec-surface-raised);
    overflow: hidden;
  }
  .ip-bar-fill {
    display: block;
    height: 100%;
    border-radius: var(--radius-full);
  }
  .ip-bar-fill[data-tone='alert'] { background: var(--sec-alert); }
  .ip-bar-fill[data-tone='watch'] { background: var(--sec-watch-soft); }
  .iprow.top .ip-bar-fill[data-tone='watch'] { background: var(--sec-watch); }
  .ip-count {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--sec-fg);
    min-width: 1.5ch;
    text-align: right;
  }
  .empty-good {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--sec-good);
    font-size: var(--text-sm);
  }
  .empty-good span { color: var(--sec-fg-secondary); }

  /* ─── Card 3: trío de tiles ──────────────────────────────────────────── */
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--sec-surface-raised);
    text-align: left;
    min-width: 0;
  }
  .tile-num {
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--sec-fg);
  }
  .tile-label {
    font-size: 10px;
    color: var(--sec-fg-tertiary);
    line-height: 1.2;
  }
  .tile[data-tone='good'] .tile-num  { color: var(--sec-good); }
  .tile[data-tone='alert'] .tile-num { color: var(--sec-alert); }
  .tile[data-tone='alert'] { background: var(--sec-alert-soft); }

  /* ─── Card Accesos por día: stacked bars (ok/fallidos/bloqueados) ─────── */
  .daybars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 56px;
    width: 100%;
  }
  .daybar {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-start;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    overflow: hidden;
    background: var(--sec-surface-raised);
  }
  .seg { width: 100%; }
  .seg[data-tone='good']  { background: var(--sec-good); }
  .seg[data-tone='watch'] { background: var(--sec-watch); }
  .seg[data-tone='alert'] { background: var(--sec-alert); }


  /* ─── Panel salud: pulso héroe (mini-bars + rango) ───────────────────── */
  .pulse {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg-surface-elevated);
  }
  .pulse-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .pulse-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .pulse-num {
    font-size: var(--text-3xl);
    font-weight: 700;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .pulse-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .commit {
    font-family: var(--font-mono);
  }

  /* ─── Panel salud: stat strip ────────────────────────────────────────── */
  .strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: var(--space-2);
  }
  .strip-tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg-surface-elevated);
  }
  .strip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .strip-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .strip-sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* ─── Panel salud: jobs (crons en chips) ─────────────────────────────── */
  .jobs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  /* Etiqueta de sección reutilizable dentro de un AdminPanel (Jobs, Mantenimiento…). */
  .block-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .jobs-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Chip-job = botón disclosure (pill de estado + caret). */
  .job-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px 3px 3px;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
    background: transparent;
    font: inherit;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default);
  }
  .job-chip:hover:not(:disabled) { background: var(--bg-surface-elevated); }
  .job-chip.expanded {
    background: var(--bg-surface-active);
    border-color: var(--border-subtle);
  }
  .job-chip:disabled { opacity: 0.5; cursor: default; }
  .job-chip:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .job-caret {
    display: inline-flex;
    align-items: center;
    color: var(--text-tertiary);
    transition: transform var(--duration-fast) var(--ease-ios-default);
  }
  .job-chip.expanded .job-caret { transform: rotate(90deg); color: var(--text-secondary); }

  /* Cajón compartido — morph de altura sin medir en JS (0fr → 1fr). */
  .jobs-drawer {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--morph-duration) var(--morph-ease);
  }
  .jobs-drawer.open { grid-template-rows: 1fr; }
  .jobs-drawer-inner {
    overflow: hidden;
    min-height: 0;
  }
  .drawer-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    margin-top: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg-surface-elevated);
    /* Entrada escalonada blur-replace (sensación SmartMixButton). */
    animation: drawer-in 260ms var(--morph-ease) var(--morph-icon-in-delay, 80ms) both;
  }
  @keyframes drawer-in {
    from { opacity: 0; transform: translateY(6px); filter: blur(4px); }
    to   { opacity: 1; transform: translateY(0);   filter: blur(0); }
  }
  .drawer-meta {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .drawer-copy {
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .drawer-action,
  .maint-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface-active);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .drawer-action :global(svg),
  .maint-action :global(svg) { color: var(--accent); }
  .drawer-action:hover:not(:disabled),
  .maint-action:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .drawer-action:disabled,
  .maint-action:disabled { opacity: 0.55; cursor: not-allowed; }
  .drawer-action:focus-visible,
  .maint-action:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  /* Mantenimiento: bloque hermano de Jobs (acciones globales). Separado por el
     gap del AdminPanel como los demás bloques, sin border-top ad-hoc. */
  .maint {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .maint-action { padding: 6px 12px; font-size: var(--text-xs); }

  :global(.jobs .spin),
  :global(.maint .spin) { animation: jobs-spin 1s linear infinite; }
  @keyframes jobs-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .jobs-drawer { transition: none; }
    .job-caret { transition: none; }
    .drawer-content { animation: none; }
    :global(.jobs .spin),
    :global(.maint .spin) { animation: none; }
  }
</style>
