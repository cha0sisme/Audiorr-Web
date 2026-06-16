<script lang="ts">
  /**
   * /housekeeping/dashboard — Resumen del panel (observabilidad).
   *
   * Lo que un admin vigila de un vistazo: accesos, intentos sospechosos y
   * salud del sistema. Tres cards con fondo geométrico 2026 (aurora/prism/
   * ripple, GeoStatCard) + un panel sobrio de salud y actividad.
   *
   *   1. Accesos (7d): logins ok / fallidos / bloqueados.
   *   2. IPs con fallos: top de IPs con intentos fallidos (detección fuerza bruta).
   *   3. Seguridad ahora: sesiones activas + cuentas bloqueadas.
   *   4. Salud + actividad: pulso de reproducciones, backend (uptime/heap),
   *      estado de los crons y bases de datos.
   *
   * Datos de /api/admin/security-summary, /api/stats/scrobbles-daily y
   * /api/diagnostics/system. La latencia de Navidrome vive en el pie del sidebar.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import {
    ShieldCheck,
    GlobeHemisphereWest,
    UsersThree,
    Database,
    ChartLineUp,
    Cpu
  } from 'phosphor-svelte';
  import GeoStatCard from '$components/housekeeping/GeoStatCard.svelte';
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
  /** Acorta IPv6 largas para que no rompan la fila. */
  function shortIp(ip: string): string {
    const clean = ip.replace(/^::ffff:/, '');
    return clean.length > 22 ? `${clean.slice(0, 21)}…` : clean;
  }

  // ─── Security summary ───────────────────────────────────────────────────
  const sec = $derived(securityQ.data ?? null);
  const topIps = $derived(sec?.topFailIps.slice(0, 4) ?? []);

  // ─── Actividad ──────────────────────────────────────────────────────────
  const scrobblesSeries = $derived(scrobblesQ.data?.series.map((s) => s.plays) ?? null);
  const hasSpark = $derived((scrobblesSeries?.length ?? 0) >= 2);

  // ─── Salud del sistema ──────────────────────────────────────────────────
  const dbValid = $derived(systemQ.data?.databases.filter((d) => d.size != null) ?? []);
  const dbCount = $derived(systemQ.data?.databases.length ?? 0);
  const dbTotalSize = $derived(dbValid.reduce((a, d) => a + (d.size ?? 0), 0));
  const dbMissing = $derived(
    systemQ.data?.databases.filter((d) => d.status !== 'OK').length ?? 0
  );

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

<!-- ─── Cards de observabilidad (geometría 2026) ──────────────────────────── -->
<div class="geo-strip">
  <!-- 1. Accesos -->
  <GeoStatCard variant="aurora" Icon={ShieldCheck} kicker="Accesos · 7 días">
    {#if securityQ.isError}
      <span class="geo-num">—</span>
      <span class="geo-sub">No se pudo leer</span>
    {:else}
      <span class="geo-num">{sec ? fmt(sec.logins7d.ok) : '…'}</span>
      <div class="geo-chips">
        <span class="geo-chip" data-tone="warn">{sec ? sec.logins7d.fail : '·'} fallidos</span>
        <span class="geo-chip" data-tone="danger">{sec ? sec.logins7d.blocked : '·'} bloqueados</span>
      </div>
      <span class="geo-sub">
        Últimas 24h: {sec ? sec.logins24h.ok : '·'} ok · {sec ? sec.logins24h.fail : '·'} fallidos
      </span>
    {/if}
  </GeoStatCard>

  <!-- 2. IPs con fallos -->
  <GeoStatCard variant="prism" Icon={GlobeHemisphereWest} kicker="IPs con fallos · 7 días">
    {#if securityQ.isError}
      <span class="geo-sub">No se pudo leer</span>
    {:else if !sec}
      <span class="geo-sub">Cargando…</span>
    {:else if topIps.length === 0}
      <span class="geo-num sm">0</span>
      <span class="geo-sub">Ninguna IP con fallos. Todo limpio.</span>
    {:else}
      <ul class="geo-iplist">
        {#each topIps as entry (entry.ip)}
          <li>
            <span class="geo-ip">{shortIp(entry.ip)}</span>
            <span class="geo-ip-count">{entry.count}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </GeoStatCard>

  <!-- 3. Seguridad ahora -->
  <GeoStatCard variant="ripple" Icon={UsersThree} kicker="Seguridad ahora">
    {#if securityQ.isError}
      <span class="geo-num">—</span>
      <span class="geo-sub">No se pudo leer</span>
    {:else}
      <span class="geo-num">{sec ? fmt(sec.activeSessions) : '…'}</span>
      <span class="geo-unit">sesiones activas</span>
      <div class="geo-chips">
        <span class="geo-chip" data-tone={sec && sec.lockedUsernames > 0 ? 'danger' : 'ok'}>
          {sec ? sec.lockedUsernames : '·'} bloqueadas
        </span>
        <span class="geo-chip">{sec ? fmt(sec.auditTotalRecords) : '·'} eventos</span>
      </div>
    {/if}
  </GeoStatCard>
</div>

<!-- ─── Salud + actividad ─────────────────────────────────────────────────── -->
<AdminPanel
  title="Salud y actividad"
  subtitle="Motor Audiorr — pulso, backend, jobs y almacenamiento"
  loading={systemQ.isPending}
  error={systemQ.isError ? 'No se pudo leer el estado del backend.' : null}
  onRetry={() => systemQ.refetch()}
>
  <ul class="health-list">
    <!-- Pulso de actividad -->
    <li class="health-row">
      <div class="health-meta">
        <span class="health-name"><ChartLineUp size={13} weight="regular" /> Pulso · 7 días</span>
        <span class="health-sub">
          {scrobblesQ.data ? `${fmt(scrobblesQ.data.total)} reproducciones` : '—'}
        </span>
      </div>
      {#if hasSpark && scrobblesSeries}
        <span class="health-spark"><Sparkline points={scrobblesSeries} smooth /></span>
      {/if}
    </li>

    <!-- Backend -->
    <li class="health-row">
      <div class="health-meta">
        <span class="health-name"><Cpu size={13} weight="regular" /> Backend</span>
        <span class="health-sub">
          {#if systemQ.data}
            activo {fmtUptime(systemQ.data.uptimeSec)} · heap
            {fmtBytes(systemQ.data.memory.heapUsed)}/{fmtBytes(systemQ.data.memory.heapTotal)}
          {/if}
        </span>
      </div>
      <AdminStatusPill tone="ok" label={systemQ.data ? `v${systemQ.data.version}` : 'OK'} />
    </li>

    <!-- Crons -->
    {#each CRON_ORDER as key (key)}
      {@const c = systemQ.data?.crons?.[key]}
      <li class="health-row">
        <div class="health-meta">
          <span class="health-name">{CRON_LABELS[key]}</span>
          <span class="health-sub">Última {relativeTime(c?.lastRun)}</span>
        </div>
        <AdminStatusPill tone={cronTone(c?.status)} label={cronLabel(c)} />
      </li>
    {/each}

    <!-- Bases de datos -->
    <li class="health-row">
      <div class="health-meta">
        <span class="health-name"><Database size={13} weight="regular" /> Bases de datos</span>
        <span class="health-sub">
          {dbCount} {dbCount === 1 ? 'archivo' : 'archivos'}{dbMissing > 0 ? ` · ${dbMissing} no disponible${dbMissing === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      <AdminStatusPill tone={dbMissing > 0 ? 'warn' : 'ok'} label={fmtBytes(dbTotalSize)} />
    </li>
  </ul>
</AdminPanel>

<style>
  .geo-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: var(--space-4);
  }

  /* ─── Contenido dentro de las GeoStatCard (texto claro sobre geometría) ── */
  .geo-num {
    font-size: var(--text-3xl);
    font-weight: 700;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    font-variant-numeric: tabular-nums;
    color: var(--geo-fg);
  }
  .geo-num.sm { font-size: var(--text-2xl); }
  .geo-unit {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--geo-fg-secondary);
  }
  .geo-sub {
    font-size: 11px;
    color: var(--geo-fg-tertiary);
    line-height: 1.4;
  }
  .geo-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .geo-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: color-mix(in oklch, var(--geo-fg) 16%, transparent);
    color: var(--geo-fg);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .geo-chip[data-tone='warn']   { background: color-mix(in oklch, var(--geo-amber) 60%, transparent); }
  .geo-chip[data-tone='danger'] { background: color-mix(in oklch, var(--geo-magenta) 55%, transparent); }
  .geo-chip[data-tone='ok']     { background: color-mix(in oklch, var(--geo-teal) 50%, transparent); }

  .geo-iplist {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
  }
  .geo-iplist li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .geo-ip {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--geo-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .geo-ip-count {
    flex-shrink: 0;
    padding: 1px 8px;
    border-radius: var(--radius-full);
    background: color-mix(in oklch, var(--geo-fg) 18%, transparent);
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--geo-fg);
  }

  /* ─── Lista de salud (dentro del AdminPanel sólido) ──────────────────── */
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
  .health-spark {
    width: 96px;
    height: 30px;
    flex-shrink: 0;
    color: var(--accent);
  }
</style>
