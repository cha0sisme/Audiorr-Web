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
    Cpu,
    CheckCircle
  } from 'phosphor-svelte';
  import SecCard from '$components/housekeeping/SecCard.svelte';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import AdminStatusPill from '$components/housekeeping/AdminStatusPill.svelte';
  import Sparkline from '$components/diagnostics/Sparkline.svelte';
  import { getSecuritySummary, getSystemInfo, getScrobblesDaily } from '$services/dashboard';
  import { credentials } from '$stores/credentials.svelte';
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
  const scrobblesQ = createQuery(() => ({
    queryKey: ['hk-scrobbles-daily', 7],
    queryFn: () => getScrobblesDaily(7),
    enabled,
    staleTime: 5 * 60 * 1000
  }));

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

  // Card 1 · Accesos — balance de intentos
  const accTotal = $derived(sec ? sec.logins7d.ok + sec.logins7d.fail + sec.logins7d.blocked : 0);
  function accPct(n: number): number {
    return accTotal > 0 ? (n / accTotal) * 100 : 0;
  }
  const accessState = $derived.by<'calm' | 'watch' | 'alert'>(() => {
    if (!sec) return 'calm';
    const b = sec.logins7d.blocked;
    if (b >= 5) return 'alert';
    if (b > 0 || sec.logins7d.fail > 0) return 'watch';
    return 'calm';
  });

  // Card 2 · IPs — lista ranked
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

  // ─── Actividad + salud ──────────────────────────────────────────────────
  const scrobblesSeries = $derived(scrobblesQ.data?.series.map((s) => s.plays) ?? null);
  const hasSpark = $derived((scrobblesSeries?.length ?? 0) >= 2);

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
</script>

<svelte:head>
  <title>Resumen · Housekeeping</title>
</svelte:head>

<!-- ─── Sala de control: 3 cards de estado ────────────────────────────────── -->
<div class="sec-grid">
  <!-- Card 1 · Accesos · balance de intentos -->
  <SecCard state={accessState} Icon={ShieldCheck} kicker="Accesos · 7 días">
    {#snippet peek()}
      <span class="sec-peek-text">
        Últimas 24h: {sec ? sec.logins24h.ok : '·'} ok · {sec ? sec.logins24h.fail : '·'} fallidos
      </span>
    {/snippet}

    {#if securityQ.isError}
      <span class="sec-num">—</span>
      <span class="sec-unit">no se pudo leer</span>
    {:else}
      <div class="sec-total">
        <span class="sec-num">{sec ? fmt(accTotal) : '…'}</span>
        <span class="sec-unit">intentos</span>
      </div>
      <div class="bar" role="img" aria-label={sec ? `${sec.logins7d.ok} ok, ${sec.logins7d.fail} fallidos, ${sec.logins7d.blocked} bloqueados` : 'Sin datos'}>
        {#if accTotal > 0}
          <span class="bar-seg" data-tone="good" style:width="{accPct(sec!.logins7d.ok)}%"></span>
          <span class="bar-seg" data-tone="watch" style:width="{accPct(sec!.logins7d.fail)}%"></span>
          <span class="bar-seg" data-tone="alert" style:width="{accPct(sec!.logins7d.blocked)}%"></span>
        {/if}
      </div>
      <div class="legend">
        <span class="legend-item"><span class="dot" data-tone="good"></span>{sec ? sec.logins7d.ok : '·'} ok</span>
        <span class="legend-item"><span class="dot" data-tone="watch"></span>{sec ? sec.logins7d.fail : '·'} fallidos</span>
        <span class="legend-item"><span class="dot" data-tone="alert"></span>{sec ? sec.logins7d.blocked : '·'} bloqueados</span>
      </div>
    {/if}
  </SecCard>

  <!-- Card 2 · IPs · lista ranked -->
  <SecCard state={ipState} Icon={GlobeHemisphereWest} kicker="IPs con fallos · 7 días">
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
  <SecCard state={secNowState} Icon={UsersThree} kicker="Seguridad ahora">
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
</div>

<!-- ─── Salud y actividad ─────────────────────────────────────────────────── -->
<AdminPanel
  title="Salud y actividad"
  subtitle="Motor Audiorr — pulso, backend, jobs y almacenamiento"
  loading={systemQ.isPending}
  error={systemQ.isError ? 'No se pudo leer el estado del backend.' : null}
  onRetry={() => systemQ.refetch()}
>
  <!-- Zona héroe: pulso de reproducciones -->
  <div class="pulse">
    <div class="pulse-meta">
      <span class="pulse-num">{scrobblesQ.data ? fmt(scrobblesQ.data.total) : '—'}</span>
      <span class="pulse-label"><ChartLineUp size={12} weight="bold" /> reproducciones · 7 días</span>
    </div>
    {#if hasSpark && scrobblesSeries}
      <span class="pulse-spark"><Sparkline points={scrobblesSeries} smooth showLast={false} /></span>
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
          {fmtBytes(systemQ.data.memory.heapUsed)}/{fmtBytes(systemQ.data.memory.heapTotal)}
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

  <!-- Jobs: crons comprimidos en chips -->
  <div class="jobs">
    <span class="jobs-label">Jobs</span>
    <div class="jobs-chips">
      {#each CRON_ORDER as key (key)}
        {@const c = systemQ.data?.crons?.[key]}
        <span class="job-chip" title="Última {relativeTime(c?.lastRun)}">
          <AdminStatusPill tone={cronTone(c?.status)} label={CRON_LABELS[key] ?? key} />
        </span>
      {/each}
    </div>
  </div>
</AdminPanel>

<style>
  .sec-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: var(--space-4);
  }

  /* ─── Tipografía común de las cards de estado ────────────────────────── */
  .sec-total {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .sec-num {
    font-size: var(--text-3xl);
    font-weight: 700;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    font-variant-numeric: tabular-nums;
    color: var(--sec-fg);
  }
  .sec-unit {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--sec-fg-secondary);
  }
  .sec-peek-text {
    font-size: 11px;
    color: var(--sec-fg-tertiary);
  }

  /* ─── Card 1: stacked bar + leyenda ──────────────────────────────────── */
  .bar {
    display: flex;
    gap: 2px;
    height: 8px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--sec-surface-raised);
  }
  .bar-seg { height: 100%; }
  .bar-seg[data-tone='good']  { background: var(--sec-good); }
  .bar-seg[data-tone='watch'] { background: var(--sec-watch); }
  .bar-seg[data-tone='alert'] { background: var(--sec-alert); }
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

  /* ─── Panel salud: pulso héroe ───────────────────────────────────────── */
  .pulse {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-4);
    border-radius: var(--radius-md);
    background: var(--bg-surface-elevated);
  }
  .pulse-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
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
  .pulse-spark {
    flex: 1;
    min-width: 0;
    height: 48px;
    color: var(--accent);
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
  .jobs-label {
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
</style>
