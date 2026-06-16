<script lang="ts">
  /**
   * /housekeeping/dashboard — vista de inicio consolidada.
   *
   * Bloques:
   *   1. Hero "Servidor": Navidrome host + Subsonic version + LATENCIA EN VIVO
   *      (ping cada 2s con sparkline de los últimos ~30 valores).
   *   2. Action cards (3): Portadas / Daily Mixes / Smart Playlists.
   *   3. Info cards (2): Detalle por playlist (Smart) + Personas del sistema.
   *      Mismas patterns / tonos que las action cards — coherencia visual.
   */
  import { onMount } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import {
    ImageSquare,
    MusicNotes,
    Sparkle,
    Pulse,
    Cpu,
    Hash,
    UsersThree,
    Headphones,
    ArrowsClockwise
  } from 'phosphor-svelte';
  import HKActionCard from '../HKActionCard.svelte';
  import HKInfoCard from '../HKInfoCard.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { ping } from '$services/NavidromeService';
  import { regenerateAllCovers, generateAllDailyMixes, getDailyMixesCronStatus } from '$services/dailyMixes';
  import { generateAllSmartPlaylists, getSmartPlaylistsCronStatus } from '$services/smartPlaylists';
  import { getAdminUsers } from '$services/user';
  import { BackendError } from '$services/BackendService.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { userAvatarColor, userAvatarInitial } from '$utils/avatar-color';
  import type { CronStatus } from '$types/backend';

  // ─── Salud del servidor — check puntual on-demand ───────────────────────
  // Un ping al entrar + botón "comprobar". Sin loop perpetuo ni sparkline:
  // este panel es de sesión corta, no un stack de observabilidad en vivo.
  let lastLatency = $state<number | null>(null);
  let serverVersion = $state<string | null>(null);
  let pingFailed = $state(false);
  let checking = $state(false);

  async function checkHealth() {
    if (!credentials.isConfigured || checking) return;
    checking = true;
    const start = performance.now();
    try {
      const res = await ping();
      lastLatency = Math.round(performance.now() - start);
      serverVersion = res.version;
      pingFailed = false;
    } catch {
      pingFailed = true;
    } finally {
      checking = false;
    }
  }

  onMount(() => {
    void checkHealth();
  });

  const latencyBand = $derived.by<'good' | 'mid' | 'high' | 'unknown'>(() => {
    if (lastLatency === null) return 'unknown';
    if (lastLatency < 100) return 'good';
    if (lastLatency < 300) return 'mid';
    return 'high';
  });
  const latencyText = $derived.by(() => {
    if (pingFailed) return 'Sin respuesta';
    if (checking) return 'Comprobando…';
    if (lastLatency === null) return 'Sin comprobar';
    if (latencyBand === 'good') return 'Respuesta rápida';
    if (latencyBand === 'mid') return 'Respuesta normal';
    return 'Respuesta lenta';
  });

  const serverUrl = $derived(credentials.current?.serverUrl ?? '—');
  const serverHost = $derived.by(() => {
    try {
      return new URL(serverUrl).host;
    } catch {
      return serverUrl;
    }
  });

  // ─── Cron status (Daily + Smart) ──────────────────────────────────────
  const dailyCronQ = createQuery(() => ({
    queryKey: ['dailyMixesCron'],
    queryFn: () => getDailyMixesCronStatus(),
    enabled: credentials.isConfigured,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  }));
  const smartCronQ = createQuery(() => ({
    queryKey: ['smartPlaylistsCron'],
    queryFn: () => getSmartPlaylistsCronStatus(),
    enabled: credentials.isConfigured,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false
  }));

  // ─── Admin users ──────────────────────────────────────────────────────
  const usersQ = createQuery(() => ({
    queryKey: ['adminUsers'],
    queryFn: () => getAdminUsers(),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  // ─── Action state por card ────────────────────────────────────────────
  let coversAction = $state({ running: false, saved: false, cooldown: 0 });
  let dailyAction = $state({ running: false, saved: false, cooldown: 0 });
  let smartAction = $state({ running: false, saved: false, cooldown: 0 });

  function startCooldown(target: { cooldown: number }, seconds = 30) {
    target.cooldown = seconds;
    const tick = setInterval(() => {
      target.cooldown -= 1;
      if (target.cooldown <= 0) clearInterval(tick);
    }, 1000);
  }

  async function handleCovers() {
    if (coversAction.running || coversAction.cooldown > 0) return;
    if (
      !confirm(
        '¿Regenerar todas las portadas personalizadas? Encolamos un job low-priority para cada playlist editorial, daily mix y smart playlist. Tarda unos minutos.'
      )
    ) {
      return;
    }
    coversAction.running = true;
    try {
      await regenerateAllCovers();
      coversAction.saved = true;
      setTimeout(() => (coversAction.saved = false), 1800);
      startCooldown(coversAction);
    } catch (err) {
      toasts.error(
        'No se han podido regenerar',
        err instanceof Error ? err.message : 'Algo ha ido mal'
      );
    } finally {
      coversAction.running = false;
    }
  }

  async function handleDaily() {
    if (dailyAction.running || dailyAction.cooldown > 0) return;
    if (!confirm('¿Regenerar los Daily Mixes para todas las personas?')) return;
    dailyAction.running = true;
    try {
      await generateAllDailyMixes();
      void dailyCronQ.refetch();
      dailyAction.saved = true;
      setTimeout(() => (dailyAction.saved = false), 1800);
      startCooldown(dailyAction);
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
      smartAction.saved = true;
      setTimeout(() => (smartAction.saved = false), 1800);
      startCooldown(smartAction);
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

  // ─── Helpers display ───────────────────────────────────────────────────
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

  function statusToTone(s?: CronStatus['status']): 'idle' | 'running' | 'success' | 'error' {
    if (s === 'running') return 'running';
    if (s === 'error') return 'error';
    if (s === 'success') return 'success';
    return 'idle';
  }
  function statusLabel(c: CronStatus | undefined | null): string {
    if (!c) return 'Sin información';
    switch (c.status) {
      case 'running':  return 'Procesando';
      case 'success':  return 'Operativo';
      case 'error':    return c.lastError ?? 'Con errores';
      case 'idle':
      default:         return 'En espera';
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

  const dailyStatusText = $derived.by(() => {
    const c = dailyCronQ.data;
    if (!c) return 'Sin información';
    if (c.status === 'running') return 'Procesando ahora';
    if (c.status === 'error') return 'Con errores';
    if (c.lastRun) return `Última ${relativeTime(c.lastRun)}`;
    return 'En espera';
  });
  const smartStatusText = $derived.by(() => {
    if (smartAggregate === 'running') return 'Procesando ahora';
    if (smartAggregate === 'error') return 'Algún cron con errores';
    if (smartAggregate === 'success') return 'Todas operativas';
    return 'En espera';
  });

  // ─── Smart playlists keys ─────────────────────────────────────────────
  type SmartKey = 'en_bucle' | 'tiempo_atras' | 'radar_novedades';
  const SMART_LABELS: Record<SmartKey, { name: string; sub: string }> = {
    en_bucle:        { name: 'En bucle',           sub: 'Lo que repites mucho · diario' },
    tiempo_atras:    { name: 'Tiempo atrás',       sub: 'Canciones olvidadas · domingos' },
    radar_novedades: { name: 'Radar de novedades', sub: 'Lanzamientos nuevos · viernes' }
  };
  const smartKeys: SmartKey[] = ['en_bucle', 'tiempo_atras', 'radar_novedades'];

  const users = $derived(usersQ.data ?? []);
  const totalUsers = $derived(users.length);
  const activeUsers = $derived.by(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return users.filter((u) => {
      const ts = u.lastScrobble?.playedAt;
      return ts && new Date(ts).getTime() > sevenDaysAgo;
    }).length;
  });
</script>

<svelte:head>
  <title>Inicio · Housekeeping</title>
</svelte:head>

<!-- ════════════════════════════════════════════════════════════════════
     Hero Servidor — host + Subsonic + salud (check on-demand)
     ════════════════════════════════════════════════════════════════════ -->
<section class="hk-server-card">
  <div class="hk-server-cell">
    <span class="hk-server-label">
      <Cpu size={11} weight="bold" /> Servidor
    </span>
    <span class="hk-server-value host">{serverHost}</span>
    {#if serverVersion}
      <span class="hk-server-sub">Subsonic API v{serverVersion}</span>
    {:else}
      <span class="hk-server-sub">Sin comprobar</span>
    {/if}
  </div>

  <div class="hk-server-cell live" data-band={latencyBand}>
    <span class="hk-server-label">
      <Pulse size={11} weight="bold" /> Latencia
    </span>
    <div class="hk-latency-row">
      <span class="hk-server-value latency" data-band={latencyBand}>
        {#if lastLatency !== null}
          {lastLatency}<span class="ms">ms</span>
        {:else}
          —
        {/if}
      </span>
      <button
        type="button"
        class="hk-recheck"
        onclick={checkHealth}
        disabled={checking}
        aria-label="Comprobar la latencia del servidor"
      >
        <ArrowsClockwise size={13} weight="bold" class={checking ? 'spin' : ''} />
      </button>
    </div>
    <span class="hk-server-sub">{latencyText}</span>
  </div>

  <div class="hk-server-cell">
    <span class="hk-server-label">
      <Hash size={11} weight="bold" /> Sesión
    </span>
    <span class="hk-server-value username">{credentials.current?.username ?? '—'}</span>
    <span class="hk-server-sub">Conectado como admin</span>
  </div>
</section>

<!-- ════════════════════════════════════════════════════════════════════
     3 action cards (Apple Music-style con patterns)
     ════════════════════════════════════════════════════════════════════ -->
<div class="hk-actions-grid">
  <HKActionCard
    Icon={ImageSquare}
    kicker="MANTENIMIENTO"
    title="Regenerar portadas"
    description="Rehace las covers personalizadas de todas las playlists destacadas, los Daily Mixes y las Smart Playlists."
    pattern="mesh"
    tone="accent"
    actionLabel="Regenerar todas"
    runningLabel="Encolando…"
    successLabel="Encoladas"
    isRunning={coversAction.running}
    isJustSaved={coversAction.saved}
    cooldownSec={coversAction.cooldown}
    onAction={handleCovers}
  />

  <HKActionCard
    Icon={MusicNotes}
    kicker="MIX DIARIO"
    title="Daily Mixes"
    description="Cada noche a las 3 generamos 4 mixes para cada persona. Aquí puedes adelantarlo."
    metric={dailyCronQ.data?.lastRun ? relativeTime(dailyCronQ.data.lastRun) : '—'}
    metricLabel="Última ejecución"
    statusText={dailyStatusText}
    statusTone={statusToTone(dailyCronQ.data?.status)}
    pattern="waves"
    tone="pink"
    actionLabel="Generar ahora"
    runningLabel="Generando…"
    successLabel="Listo"
    isRunning={dailyAction.running}
    isJustSaved={dailyAction.saved}
    cooldownSec={dailyAction.cooldown}
    onAction={handleDaily}
  />

  <HKActionCard
    Icon={Sparkle}
    kicker="ENGINE"
    title="Smart Playlists"
    description="Tres playlists curadas por Audiorr Engine: En bucle, Tiempo atrás y Radar de novedades."
    metric="3"
    metricLabel="playlists"
    statusText={smartStatusText}
    statusTone={statusToTone(smartAggregate)}
    pattern="lines"
    tone="mint"
    actionLabel="Generar todas"
    runningLabel="Generando…"
    successLabel="Listo"
    isRunning={smartAction.running}
    isJustSaved={smartAction.saved}
    cooldownSec={smartAction.cooldown}
    onAction={handleSmart}
  />
</div>

<!-- ════════════════════════════════════════════════════════════════════
     2 info cards: Detalle por playlist + Personas del sistema
     ════════════════════════════════════════════════════════════════════ -->
<div class="hk-info-grid">
  <HKInfoCard
    Icon={Sparkle}
    kicker="DETALLE"
    title="Smart Playlists, una a una"
    description="Estado individual de los crons que las regeneran."
    pattern="lines"
    tone="mint"
  >
    {#snippet children()}
      <ul class="hk-detail-list">
        {#each smartKeys as key (key)}
          {@const info = SMART_LABELS[key]}
          {@const cron = smartCronQ.data?.[key]}
          <li class="hk-detail-row">
            <div class="hk-detail-meta">
              <span class="hk-detail-name">{info.name}</span>
              <span class="hk-detail-sub">{info.sub}</span>
            </div>
            <div class="hk-detail-stat" data-tone={statusToTone(cron?.status)}>
              <span class="hk-detail-dot" aria-hidden="true"></span>
              <span class="hk-detail-stat-text">
                <span class="hk-detail-stat-label">{statusLabel(cron)}</span>
                {#if cron?.lastRun}
                  <span class="hk-detail-stat-time">{relativeTime(cron.lastRun)}</span>
                {/if}
              </span>
            </div>
          </li>
        {/each}
      </ul>
    {/snippet}
  </HKInfoCard>

  <HKInfoCard
    Icon={UsersThree}
    kicker="EQUIPO"
    title="Personas del sistema"
    description={
      usersQ.isPending
        ? 'Cargando…'
        : `${totalUsers} ${totalUsers === 1 ? 'persona registrada' : 'personas'} · ${activeUsers} ${activeUsers === 1 ? 'activa' : 'activas'} esta semana`
    }
    pattern="mesh"
    tone="pink"
  >
    {#snippet children()}
      {#if usersQ.isPending}
        <div class="hk-users-skel">
          {#each Array(3) as _}
            <div class="hk-skel-row"></div>
          {/each}
        </div>
      {:else if users.length === 0}
        <p class="hk-users-empty">
          <Headphones size={20} weight="regular" />
          Aún no hay personas registradas.
        </p>
      {:else}
        <ul class="hk-users-list">
          {#each users.slice(0, 6) as u (u.username)}
            {@const c = userAvatarColor(u.username)}
            <li class="hk-user-row">
              <span
                class="hk-user-avatar"
                style:background={u.avatarUrl ? undefined : c.css}
              >
                {#if u.avatarUrl}
                  <img src={u.avatarUrl} alt="" loading="lazy" />
                {:else}
                  {userAvatarInitial(u.username)}
                {/if}
              </span>
              <div class="hk-user-meta">
                <span class="hk-user-name">{u.username}</span>
                <span class="hk-user-sub">
                  {#if u.lastScrobble}
                    {u.lastScrobble.title} — {u.lastScrobble.artist}
                  {:else}
                    Sin escuchas
                  {/if}
                </span>
              </div>
              <span class="hk-user-time">
                {#if u.lastScrobble?.playedAt}
                  {relativeTime(u.lastScrobble.playedAt)}
                {:else}
                  —
                {/if}
              </span>
            </li>
          {/each}
        </ul>
        {#if users.length > 6}
          <p class="hk-users-more">+{users.length - 6} {users.length - 6 === 1 ? 'persona más' : 'personas más'}</p>
        {/if}
      {/if}
    {/snippet}
  </HKInfoCard>
</div>

<style>
  /* ============================================================================
     === Hero Servidor ===
     ============================================================================ */
  .hk-server-card {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-4);
    padding: var(--space-5);
    background: var(--hk-card-bg);
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: var(--hk-card-radius);
  }
  .hk-server-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .hk-server-cell.live { gap: 6px; }

  .hk-server-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .hk-server-value {
    font-family: 'Söhne Mono', var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-server-value.host { font-size: var(--text-base); }
  .hk-server-value.username { font-size: var(--text-base); }
  .hk-server-value .ms {
    font-size: 12px;
    color: var(--text-tertiary);
    margin-left: 2px;
    font-weight: 500;
  }
  .hk-server-value.latency[data-band='good'] { color: oklch(0.72 0.18 145); }
  .hk-server-value.latency[data-band='mid']  { color: oklch(0.78 0.15 75);  }
  .hk-server-value.latency[data-band='high'] { color: var(--status-danger); }
  .hk-server-sub {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* === Latency row con botón de recheck al lado === */
  .hk-latency-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hk-recheck {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 0;
    border-radius: 999px;
    background: var(--bg-glass-thin);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background 200ms var(--hk-spring-soft),
      color 160ms var(--hk-spring-soft);
  }
  .hk-recheck:hover:not(:disabled) { background: var(--bg-glass); color: var(--text-primary); }
  .hk-recheck:disabled { opacity: 0.5; cursor: progress; }
  .hk-recheck:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  :global(.hk-recheck .spin) { animation: hk-spin 1s linear infinite; }
  @keyframes hk-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.hk-recheck .spin) { animation: none; }
  }

  /* ============================================================================
     === Action grid + Info grid ===
     ============================================================================ */
  .hk-actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
    gap: var(--space-4);
  }
  .hk-info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
    gap: var(--space-4);
  }

  /* ============================================================================
     === Detail list (dentro de info card) ===
     ============================================================================ */
  .hk-detail-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hk-detail-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .hk-detail-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hk-detail-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.005em;
  }
  .hk-detail-sub {
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .hk-detail-stat {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 11px;
    background: var(--bg-glass-thin);
    border-radius: 999px;
    flex-shrink: 0;
  }
  .hk-detail-stat-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .hk-detail-stat-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .hk-detail-stat-time {
    font-size: 10px;
    color: var(--text-tertiary);
  }
  .hk-detail-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--text-tertiary);
    flex-shrink: 0;
  }
  .hk-detail-stat[data-tone='running'] .hk-detail-dot {
    background: var(--accent);
    animation: hk-dot-pulse 1.4s ease-in-out infinite;
  }
  .hk-detail-stat[data-tone='success'] .hk-detail-dot { background: oklch(0.72 0.18 145); }
  .hk-detail-stat[data-tone='error']   .hk-detail-dot { background: var(--status-danger); }
  @keyframes hk-dot-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1.6); opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hk-detail-stat[data-tone='running'] .hk-detail-dot { animation: none; }
  }

  /* ============================================================================
     === Users list (dentro de info card) ===
     ============================================================================ */
  .hk-users-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hk-user-row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .hk-user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    overflow: hidden;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
  }
  .hk-user-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hk-user-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .hk-user-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-user-sub {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-user-time {
    font-family: 'Söhne Mono', var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .hk-users-more {
    margin: 0;
    padding-top: 4px;
    text-align: center;
    font-size: 11px;
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .hk-users-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .hk-users-empty :global(svg) { color: var(--text-tertiary); flex-shrink: 0; }

  .hk-users-skel {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hk-skel-row {
    height: 48px;
    background: var(--bg-canvas);
    border-radius: 12px;
    animation: hk-pulse 1.6s ease-in-out infinite;
  }
  @keyframes hk-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  @media (max-width: 640px) {
    .hk-server-card { padding: var(--space-4); }
    .hk-detail-row { grid-template-columns: 1fr; }
    .hk-detail-stat { align-self: start; }
    .hk-user-time { display: none; }
  }
</style>
