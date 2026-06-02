<script lang="ts">
  /**
   * SessionsSelfPanel — sesiones del propio usuario, estilo "Tus dispositivos".
   * Pensado para Ajustes: cada usuario ve y cierra SUS sesiones (sin override
   * admin). Reutiliza `SessionRow` y los helpers de formato.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Devices, Warning, SignOut, ArrowsClockwise } from 'phosphor-svelte';
  import SessionRow from './SessionRow.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { listSessions, closeSession, closeOtherSessions } from '$services/sessions';
  import { sortSessions } from '$utils/session-format';
  import type { SessionView } from '$types/backend';

  const queryClient = useQueryClient();

  const sessionsQ = createQuery(() => ({
    queryKey: ['authSessions', 'self'],
    queryFn: () => listSessions(),
    enabled: credentials.isConfigured,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }));

  const sessions = $derived(sortSessions(sessionsQ.data ?? []));
  const otherCount = $derived(sessions.filter((s) => !s.current).length);

  let closingId = $state<string | null>(null);
  let closingOthers = $state(false);

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: ['authSessions'] });
  }

  async function closeOne(s: SessionView) {
    if (closingId) return;
    if (!confirm('¿Cerrar esta sesión?\n\nEse dispositivo tendrá que volver a iniciar sesión.'))
      return;
    closingId = s.id;
    try {
      await closeSession(s.id);
      toasts.success('Sesión cerrada', 'El dispositivo ha sido desconectado.');
      await refresh();
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingId = null;
    }
  }

  async function closeOthers() {
    if (closingOthers || otherCount === 0) return;
    if (
      !confirm(
        `¿Cerrar el resto de tus dispositivos (${otherCount})?\n\nSe conservará solo esta sesión.`
      )
    )
      return;
    closingOthers = true;
    try {
      const { closed } = await closeOtherSessions();
      toasts.success(
        'Dispositivos cerrados',
        `${closed} ${closed === 1 ? 'sesión cerrada' : 'sesiones cerradas'}.`
      );
      await refresh();
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingOthers = false;
    }
  }
</script>

<section class="card">
  <header class="head">
    <div class="title-wrap">
      <h2>Tus dispositivos</h2>
      <p class="sub">
        Las sesiones con tu cuenta abierta. Cierra en remoto las que no reconozcas.
      </p>
    </div>
    {#if otherCount > 0}
      <button
        type="button"
        class="rest-btn"
        disabled={closingOthers}
        onclick={() => void closeOthers()}
      >
        {#if closingOthers}
          <ArrowsClockwise size={13} weight="bold" class="spin" /> Cerrando…
        {:else}
          <SignOut size={13} weight="bold" /> Cerrar el resto ({otherCount})
        {/if}
      </button>
    {/if}
  </header>

  {#if sessionsQ.isPending}
    <div class="skel">
      {#each Array(2) as _}
        <div class="skel-row"></div>
      {/each}
    </div>
  {:else if sessionsQ.isError}
    <p class="empty">
      <Warning size={20} weight="fill" />
      No se han podido cargar tus sesiones. Reintenta en un momento.
    </p>
  {:else if sessions.length === 0}
    <p class="empty">
      <Devices size={20} weight="regular" />
      No hay sesiones activas registradas.
    </p>
  {:else}
    <div class="rows">
      {#each sessions as s (s.id)}
        <SessionRow
          session={s}
          closable={!s.current}
          closing={closingId === s.id}
          onClose={() => void closeOne(s)}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-5) var(--space-6);
    display: grid;
    gap: var(--space-4);
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .title-wrap {
    min-width: 0;
  }
  .head h2 {
    font-size: var(--text-lg);
    font-weight: 600;
    margin: 0;
  }
  .sub {
    margin: 4px 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    max-width: 60ch;
  }
  .rest-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--status-danger) 11%, transparent);
    color: var(--status-danger);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) ease;
  }
  .rest-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 18%, transparent);
  }
  .rest-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .rest-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  :global(.rest-btn .spin) {
    animation: self-spin 1s linear infinite;
  }
  @keyframes self-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .skel {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .skel-row {
    height: 74px;
    background: var(--bg-canvas);
    border-radius: 14px;
    animation: self-pulse 1.6s ease-in-out infinite;
  }
  @keyframes self-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
  .empty {
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
  .empty :global(svg) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
</style>
