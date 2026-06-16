<script lang="ts">
  /**
   * /housekeeping/usuarios — Personas: el directorio de gente del servidor.
   *
   * Invierte la jerarquía anterior (que solo listaba sesiones): el sujeto es la
   * PERSONA. Cada usuario es una ficha (avatar + último scrobble + último acceso
   * + nº sesiones) que se expande a su detalle, donde viven las sesiones reales
   * con cierre remoto (SessionRow reutilizado, lógica de cierre migrada del
   * antiguo SessionsAdminPanel). Arriba, una tira de pulso (SecCard tiles).
   *
   * Datos reales: getAdminUsers (lastScrobble, avatarUrl, lastLogin) +
   * listAllSessions (sesiones por usuario). Join por username (lowercase).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { UsersThree } from 'phosphor-svelte';
  import SecCard from '$components/housekeeping/SecCard.svelte';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import PersonCard from '$components/housekeeping/PersonCard.svelte';
  import { getAdminUsers } from '$services/user';
  import { getNowPlaying } from '$services/NavidromeService';
  import { listAllSessions, closeSession, closeOtherSessions } from '$services/sessions';
  import { sortSessions } from '$utils/session-format';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { AdminUser, SessionView } from '$types/backend';

  const queryClient = useQueryClient();
  const enabled = $derived(credentials.isConfigured);

  const usersQ = createQuery(() => ({
    queryKey: ['adminUsers'],
    queryFn: () => getAdminUsers(),
    enabled,
    staleTime: 60 * 1000
  }));
  const sessionsQ = createQuery(() => ({
    queryKey: ['authSessions', 'all'],
    queryFn: () => listAllSessions(),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }));
  // "Reproduciendo ahora" real (Subsonic getNowPlaying), refresco corto.
  const nowPlayingQ = createQuery(() => ({
    queryKey: ['nowPlaying'],
    queryFn: () => getNowPlaying(),
    enabled,
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false
  }));
  const nowPlayingByUser = $derived.by(() => {
    const m = new Map<string, { title: string; artist: string }>();
    for (const e of nowPlayingQ.data ?? []) {
      if (e.title) m.set(e.username.toLowerCase(), { title: e.title, artist: e.artist ?? '' });
    }
    return m;
  });

  type Person = {
    username: string;
    avatarUrl: string | null;
    lastScrobble: AdminUser['lastScrobble'];
    lastLogin: AdminUser['lastLogin'];
    isSelf: boolean;
    isAdmin: boolean;
    sessions: SessionView[];
  };

  function activityTs(p: Person): number {
    const login = p.lastLogin?.at ? new Date(p.lastLogin.at).getTime() : 0;
    const scrob = p.lastScrobble?.playedAt ? new Date(p.lastScrobble.playedAt).getTime() : 0;
    const seen = p.sessions.reduce((m, s) => Math.max(m, s.lastSeen), 0);
    return Math.max(login, scrob, seen);
  }

  const persons = $derived.by<Person[]>(() => {
    const users = usersQ.data ?? [];
    const groups = sessionsQ.data ?? [];
    const self = (credentials.current?.username ?? '').toLowerCase();
    const byUser = new Map(groups.map((g) => [g.username.toLowerCase(), g]));
    return users
      .map((u) => {
        const key = u.username.toLowerCase();
        const g = byUser.get(key);
        return {
          username: u.username,
          avatarUrl: u.avatarUrl ?? null,
          lastScrobble: u.lastScrobble ?? null,
          lastLogin: u.lastLogin ?? null,
          isSelf: key === self,
          isAdmin: g?.isAdmin ?? false,
          sessions: g ? sortSessions(g.sessions) : []
        } satisfies Person;
      })
      .sort((a, b) => {
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        const ta = activityTs(a);
        const tb = activityTs(b);
        if (ta !== tb) return tb - ta;
        return a.username.localeCompare(b.username);
      });
  });

  // ─── Tira de pulso ───────────────────────────────────────────────────────
  const nPersons = $derived(persons.length);
  const nSessions = $derived(persons.reduce((n, p) => n + p.sessions.length, 0));
  const lastActivity = $derived(
    nowPlayingByUser.size > 0 ? Date.now() : persons.reduce((m, p) => Math.max(m, activityTs(p)), 0)
  );
  function relMs(ms: number): string {
    if (ms <= 0) return '—';
    const abs = Math.abs(ms - Date.now());
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    if (abs < 60_000) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    if (hr < 24) return `hace ${hr} h`;
    return `hace ${day} d`;
  }

  // ─── Expansión (múltiples a la vez — caso comparativo) ────────────────────
  let openUsers = $state<string[]>([]);
  function toggle(username: string) {
    openUsers = openUsers.includes(username)
      ? openUsers.filter((u) => u !== username)
      : [...openUsers, username];
  }

  // ─── Cierre remoto (migrado del antiguo SessionsAdminPanel) ───────────────
  let closingId = $state<string | null>(null);
  let closingRestUser = $state<string | null>(null);

  function refresh() {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ['authSessions'] }),
      queryClient.invalidateQueries({ queryKey: ['adminUsers'] })
    ]);
  }

  async function closeOne(p: Person, id: string) {
    if (closingId) return;
    const who = p.isSelf ? 'tu sesión' : `la sesión de ${p.username}`;
    if (!confirm(`¿Cerrar ${who}?\n\nEse dispositivo tendrá que volver a iniciar sesión.`)) return;
    closingId = id;
    try {
      await closeSession(id, p.username);
      toasts.success('Sesión cerrada', 'El dispositivo ha sido desconectado.');
      await refresh();
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingId = null;
    }
  }

  async function closeRest(p: Person) {
    if (closingRestUser) return;
    const closeable = p.sessions.filter((s) => !(p.isSelf && s.current)).length;
    if (closeable === 0) return;
    const msg = p.isSelf
      ? `¿Cerrar el resto de tus dispositivos (${closeable})?\n\nSe conservará solo tu sesión actual.`
      : `¿Cerrar todas las sesiones de ${p.username} (${closeable})?\n\nTendrá que volver a iniciar sesión en todos sus dispositivos.`;
    if (!confirm(msg)) return;
    closingRestUser = p.username;
    try {
      const { closed } = await closeOtherSessions(p.username);
      toasts.success(
        'Sesiones cerradas',
        `${closed} ${closed === 1 ? 'sesión cerrada' : 'sesiones cerradas'}.`
      );
      await refresh();
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingRestUser = null;
    }
  }
</script>

<svelte:head>
  <title>Personas · Housekeeping</title>
</svelte:head>

<!-- Tira de pulso (instrumento) -->
<div class="pulse-strip">
  <SecCard state="calm" Icon={UsersThree} kicker="Directorio" arch="tiles">
    <div class="tiles">
      <div class="tile">
        <span class="tile-num">{usersQ.isPending ? '…' : nPersons}</span>
        <span class="tile-label">{nPersons === 1 ? 'persona' : 'personas'}</span>
      </div>
      <div class="tile">
        <span class="tile-num">{sessionsQ.isPending ? '…' : nSessions}</span>
        <span class="tile-label">sesiones activas</span>
      </div>
      <div class="tile">
        <span class="tile-num sm">{lastActivity > 0 ? relMs(lastActivity) : '—'}</span>
        <span class="tile-label">última actividad</span>
      </div>
    </div>
  </SecCard>
</div>

<!-- Directorio de personas -->
<AdminPanel
  title="Personas"
  subtitle="Quién es cada usuario, qué escucha y desde qué dispositivos"
  loading={usersQ.isPending}
  error={usersQ.isError ? 'No se pudo cargar la lista de usuarios. ¿Tienes permisos de admin?' : null}
  onRetry={() => usersQ.refetch()}
  empty={!usersQ.isPending && persons.length === 0}
  emptyText="No hay usuarios registrados."
>
  <div class="people">
    {#each persons as p (p.username)}
      <PersonCard
        person={p}
        nowPlaying={nowPlayingByUser.get(p.username.toLowerCase()) ?? null}
        expanded={openUsers.includes(p.username)}
        onToggle={() => toggle(p.username)}
        closingId={closingId}
        closingRest={closingRestUser === p.username}
        onCloseSession={(id) => void closeOne(p, id)}
        onCloseRest={() => void closeRest(p)}
      />
    {/each}
  </div>
</AdminPanel>

<style>
  .pulse-strip {
    /* La tira no ocupa todo el ancho: una SecCard compacta de instrumento. */
    max-width: 460px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    width: 100%;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--sec-surface-raised);
    min-width: 0;
  }
  .tile-num {
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--sec-fg);
  }
  .tile-num.sm { font-size: var(--text-base); }
  .tile-label {
    font-size: 10px;
    color: var(--sec-fg-tertiary);
    line-height: 1.2;
  }

  .people {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
</style>
