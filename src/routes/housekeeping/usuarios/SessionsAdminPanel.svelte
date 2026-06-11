<script lang="ts">
  /**
   * Panel admin de sesiones activas (Housekeeping → Usuarios).
   *
   * Muestra TODAS las sesiones abiertas del servidor, agrupadas por usuario,
   * vía el agregado admin `GET /api/auth/sessions/all`. (El fan-out original
   * sobre Subsonic `getUsers` no funcionaba: Navidrome lo implementa
   * devolviendo solo al usuario autenticado, así que el panel solo veía las
   * sesiones del propio admin.)
   *
   * Acciones: cerrar una sesión concreta, o cerrar todas las de un usuario
   * ("el resto" para el propio admin, conservando la actual; "todas" para
   * otros usuarios).
   *
   * Caveats (copy honesto): país solo se puebla tras Cloudflare (`cf-ipcountry`),
   * en LAN sale "Desconocido"; sesiones legacy salen "Desconocido" hasta
   * re-login; "vista" = última actividad API JSON (no portadas/canvas).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Devices, Warning, UsersThree } from 'phosphor-svelte';
  import HKInfoCard from '../HKInfoCard.svelte';
  import SessionRow from '$components/sessions/SessionRow.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { listAllSessions, closeSession, closeOtherSessions } from '$services/sessions';
  import { sortSessions } from '$utils/session-format';
  import type { SessionView } from '$types/backend';

  type Group = {
    username: string;
    isAdmin: boolean;
    isSelf: boolean;
    sessions: SessionView[];
  };

  const queryClient = useQueryClient();

  const groupsQ = createQuery(() => ({
    queryKey: ['authSessions', 'all'],
    queryFn: async (): Promise<Group[]> => {
      const users = await listAllSessions();
      // El backend canonicaliza usernames a lowercase; las credenciales locales
      // pueden conservar el casing que tecleó el usuario.
      const self = (credentials.current?.username ?? '').toLowerCase();
      // Orden: yo primero, luego por nº de sesiones desc, luego alfabético.
      return users
        .map(
          (u) =>
            ({
              username: u.username,
              isAdmin: u.isAdmin,
              isSelf: u.username === self,
              sessions: sortSessions(u.sessions)
            }) satisfies Group
        )
        .sort((a, b) => {
          if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
          if (a.sessions.length !== b.sessions.length) return b.sessions.length - a.sessions.length;
          return a.username.localeCompare(b.username);
        });
    },
    enabled: credentials.isConfigured,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }));

  const groups = $derived(groupsQ.data ?? []);
  const totalSessions = $derived(groups.reduce((n, g) => n + g.sessions.length, 0));

  let closingId = $state<string | null>(null);
  let closingGroup = $state<string | null>(null);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['authSessions'] });
  }

  /** Una sesión es "cerrable" salvo que sea la sesión actual del propio admin
      (cerrarla = auto-logout). */
  function isClosable(group: Group, s: SessionView): boolean {
    return !(group.isSelf && s.current);
  }

  async function closeOne(group: Group, s: SessionView) {
    if (closingId) return;
    const who = group.isSelf ? 'tu sesión' : `la sesión de ${group.username}`;
    if (!confirm(`¿Cerrar ${who}?\n\nEse dispositivo tendrá que volver a iniciar sesión.`)) return;
    closingId = s.id;
    try {
      await closeSession(s.id, group.username);
      toasts.success('Sesión cerrada', 'El dispositivo ha sido desconectado.');
      await refresh();
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingId = null;
    }
  }

  async function closeRest(group: Group) {
    if (closingGroup) return;
    // Para el propio admin se conserva la sesión actual ("el resto"); para
    // otros usuarios se cierran TODAS (ninguna es la del admin).
    const closeableCount = group.sessions.filter((s) => isClosable(group, s)).length;
    if (closeableCount === 0) return;
    const msg = group.isSelf
      ? `¿Cerrar el resto de tus dispositivos (${closeableCount})?\n\nSe conservará solo tu sesión actual.`
      : `¿Cerrar todas las sesiones de ${group.username} (${closeableCount})?\n\nTendrá que volver a iniciar sesión en todos sus dispositivos.`;
    if (!confirm(msg)) return;
    closingGroup = group.username;
    try {
      const { closed } = await closeOtherSessions(group.username);
      toasts.success(
        'Sesiones cerradas',
        `${closed} ${closed === 1 ? 'sesión cerrada' : 'sesiones cerradas'}.`
      );
      await refresh();
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingGroup = null;
    }
  }
</script>

<HKInfoCard
  Icon={UsersThree}
  kicker="SEGURIDAD"
  title="Sesiones activas"
  description="Todos los dispositivos con sesión abierta, agrupados por usuario. Puedes cerrar cualquiera en remoto. El país solo se muestra cuando la conexión pasa por Cloudflare."
  pattern="mesh"
  tone="accent"
>
  {#snippet children()}
    {#if groupsQ.isPending}
      <div class="se-skel-list">
        {#each Array(2) as _}
          <div class="se-skel-row"></div>
        {/each}
      </div>
    {:else if groupsQ.isError}
      <p class="se-empty">
        <Warning size={20} weight="fill" />
        No se han podido cargar las sesiones. ¿Tienes permisos de admin?
      </p>
    {:else if groups.length === 0}
      <p class="se-empty">
        <Devices size={20} weight="regular" />
        No hay sesiones activas en ningún usuario.
      </p>
    {:else}
      <p class="se-summary">
        {totalSessions}
        {totalSessions === 1 ? 'sesión activa' : 'sesiones activas'} en
        {groups.length}
        {groups.length === 1 ? 'usuario' : 'usuarios'}.
      </p>

      <div class="se-groups">
        {#each groups as group (group.username)}
          {@const closeable = group.sessions.filter((s) => isClosable(group, s)).length}
          <section class="se-group">
            <header class="se-group-head">
              <span class="se-avatar" class:self={group.isSelf} aria-hidden="true">
                {group.username.charAt(0).toUpperCase()}
              </span>
              <span class="se-group-meta">
                <span class="se-group-name">
                  {group.username}
                  {#if group.isSelf}<span class="se-you">tú</span>{/if}
                  {#if group.isAdmin}<span class="se-admin">admin</span>{/if}
                </span>
                <span class="se-group-sub">
                  {group.sessions.length}
                  {group.sessions.length === 1 ? 'sesión' : 'sesiones'}
                </span>
              </span>
              {#if closeable > 0}
                <button
                  type="button"
                  class="se-group-action"
                  disabled={closingGroup === group.username}
                  onclick={() => void closeRest(group)}
                >
                  {group.isSelf ? 'Cerrar el resto' : 'Cerrar todas'}
                </button>
              {/if}
            </header>

            <div class="se-rows">
              {#each group.sessions as s (s.id)}
                <SessionRow
                  session={s}
                  closable={isClosable(group, s)}
                  closing={closingId === s.id}
                  onClose={() => void closeOne(group, s)}
                />
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  {/snippet}
</HKInfoCard>

<style>
  .se-summary {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .se-groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .se-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .se-group-head {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-1);
  }
  .se-avatar {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .se-avatar.self {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
  }
  .se-group-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .se-group-name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .se-you,
  .se-admin {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .se-you {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }
  .se-admin {
    background: color-mix(in srgb, var(--status-warning) 18%, transparent);
    color: var(--status-warning-text);
  }
  .se-group-sub {
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .se-group-action {
    flex-shrink: 0;
    padding: 6px 12px;
    border: 0;
    border-radius: 999px;
    background: var(--bg-glass-thin);
    color: var(--status-danger);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) ease;
  }
  .se-group-action:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
  }
  .se-group-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .se-group-action:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .se-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* ── Skeleton + vacío ── */
  .se-skel-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .se-skel-row {
    height: 74px;
    background: var(--bg-canvas);
    border-radius: 14px;
    animation: se-pulse 1.6s ease-in-out infinite;
  }
  @keyframes se-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
  .se-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    background: var(--bg-canvas);
    border-radius: 14px;
  }
  .se-empty :global(svg) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
</style>
