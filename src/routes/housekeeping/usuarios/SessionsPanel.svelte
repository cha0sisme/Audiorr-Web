<script lang="ts">
  /**
   * Panel "Sesiones activas" — gestor estilo "Tus dispositivos" de Google.
   *
   * Lista las sesiones vivas del usuario (la actual destacada) y permite
   * cerrarlas en remoto, individualmente o "el resto" de golpe. En esta
   * iteración solo gestiona las propias; el override admin `?user=` queda
   * disponible en `sessions.ts` para una vista futura.
   *
   * Contrato backend (eebf559):
   *   GET    /api/auth/sessions        → { sessions: SessionView[] }
   *   DELETE /api/auth/sessions/:id    → cierre duro (idempotente 204)
   *   DELETE /api/auth/sessions        → { closed: n } (conserva la actual)
   *
   * Caveats de datos (copy honesto, no son bugs):
   *   - country = "Desconocido" en LAN (cf-ipcountry solo llega tras Cloudflare).
   *   - Sesiones legacy (pre-deploy) salen "Desconocido" hasta re-login.
   *   - lastSeen = última API JSON (no cuenta carga de portadas/canvas).
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    Devices,
    Globe,
    AppleLogo,
    AndroidLogo,
    Question,
    SignOut,
    ArrowsClockwise
  } from 'phosphor-svelte';
  import HKInfoCard from '../HKInfoCard.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { listSessions, closeSession, closeOtherSessions } from '$services/sessions';
  import type { SessionView } from '$types/backend';

  const queryClient = useQueryClient();

  const sessionsQ = createQuery(() => ({
    queryKey: ['authSessions'],
    queryFn: () => listSessions(),
    enabled: credentials.isConfigured,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }));

  // La sesión actual primero, el resto por última actividad descendente.
  const sessions = $derived.by(() => {
    const list = sessionsQ.data ?? [];
    return [...list].sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return b.lastSeen - a.lastSeen;
    });
  });

  const otherCount = $derived(sessions.filter((s) => !s.current).length);

  let closingId = $state<string | null>(null);
  let closingOthers = $state(false);

  // ─── Helpers de formato ───────────────────────────────────────────────────
  const absoluteFmt = new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  function absolute(epochMs: number): string {
    return absoluteFmt.format(new Date(epochMs));
  }

  function relative(epochMs: number): string {
    const abs = Math.abs(Date.now() - epochMs);
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    if (abs < 60_000) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    if (hr < 24) return `hace ${hr} h`;
    return `hace ${day} ${day === 1 ? 'día' : 'días'}`;
  }

  const PLATFORM_LABEL: Record<string, string> = {
    web: 'Web',
    ios: 'iOS',
    android: 'Android'
  };
  function platformLabel(p: SessionView['platform']): string {
    return p ? (PLATFORM_LABEL[p] ?? 'Desconocido') : 'Desconocido';
  }
  function platformIcon(p: SessionView['platform']) {
    if (p === 'web') return Globe;
    if (p === 'ios') return AppleLogo;
    if (p === 'android') return AndroidLogo;
    return Question;
  }

  /** Bandera emoji desde ISO alpha-2 (regional indicators). Null → sin bandera. */
  function flag(country: string | null): string {
    if (!country || country.length !== 2) return '';
    const cc = country.toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(
      ...[...cc].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65))
    );
  }
  function countryLabel(country: string | null): string {
    return country ? country.toUpperCase() : 'Desconocido';
  }

  // ─── Acciones ─────────────────────────────────────────────────────────────
  async function handleClose(s: SessionView) {
    if (closingId) return;
    if (
      !confirm(
        `¿Cerrar esta sesión (${platformLabel(s.platform)}${
          s.country ? ` · ${countryLabel(s.country)}` : ''
        })?\n\nEse dispositivo tendrá que volver a iniciar sesión.`
      )
    )
      return;
    closingId = s.id;
    try {
      await closeSession(s.id);
      toasts.success('Sesión cerrada', 'El dispositivo ha sido desconectado.');
      await queryClient.invalidateQueries({ queryKey: ['authSessions'] });
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingId = null;
    }
  }

  async function handleCloseOthers() {
    if (closingOthers || otherCount === 0) return;
    if (
      !confirm(
        `¿Cerrar el resto de dispositivos (${otherCount})?\n\nSe conservará solo esta sesión. El resto tendrá que volver a iniciar sesión.`
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
      await queryClient.invalidateQueries({ queryKey: ['authSessions'] });
    } catch (err) {
      toasts.error('Error al cerrar', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      closingOthers = false;
    }
  }
</script>

<HKInfoCard
  Icon={Devices}
  kicker="SEGURIDAD"
  title="Sesiones activas"
  description="Los dispositivos con tu sesión abierta. Puedes cerrar cualquiera en remoto; el país solo se muestra cuando la conexión pasa por Cloudflare."
  pattern="mesh"
  tone="accent"
>
  {#snippet children()}
    {#if sessionsQ.isPending}
      <div class="se-skel-list">
        {#each Array(2) as _}
          <div class="se-skel-row"></div>
        {/each}
      </div>
    {:else if sessionsQ.isError}
      <p class="se-empty">
        <Question size={20} weight="regular" />
        No se han podido cargar las sesiones. Reintenta en un momento.
      </p>
    {:else if sessions.length === 0}
      <p class="se-empty">
        <Devices size={20} weight="regular" />
        No hay sesiones activas registradas.
      </p>
    {:else}
      {#if otherCount > 0}
        <div class="se-toolbar">
          <button
            class="se-btn se-btn-danger"
            type="button"
            disabled={closingOthers}
            onclick={() => void handleCloseOthers()}
          >
            {#if closingOthers}
              <ArrowsClockwise size={13} weight="bold" class="spin" />
              Cerrando…
            {:else}
              <SignOut size={13} weight="bold" />
              Cerrar el resto ({otherCount})
            {/if}
          </button>
        </div>
      {/if}

      <ul class="se-list">
        {#each sessions as s (s.id)}
          {@const Icon = platformIcon(s.platform)}
          <li class="se-row" class:current={s.current}>
            <span class="se-icon" aria-hidden="true">
              <Icon size={18} weight="regular" />
            </span>

            <div class="se-meta">
              <span class="se-head">
                <span class="se-platform">{platformLabel(s.platform)}</span>
                {#if s.current}
                  <span class="se-badge">Este dispositivo</span>
                {/if}
              </span>
              <span class="se-sub">
                <span class="se-country">
                  {#if flag(s.country)}<span class="se-flag">{flag(s.country)}</span>{/if}
                  {countryLabel(s.country)}
                </span>
                {#if s.ip}<span class="se-dot">·</span><span class="se-mono">{s.ip}</span>{/if}
              </span>
              <span class="se-times">
                Iniciada {absolute(s.createdAt)} · vista {relative(s.lastSeen)}
              </span>
            </div>

            {#if !s.current}
              <button
                class="se-btn se-btn-ghost se-btn-danger"
                type="button"
                disabled={closingId === s.id}
                onclick={() => void handleClose(s)}
                title="Cerrar esta sesión"
              >
                {#if closingId === s.id}
                  <ArrowsClockwise size={13} weight="bold" class="spin" />
                {:else}
                  <SignOut size={13} weight="bold" />
                {/if}
                <span class="se-btn-text">Cerrar</span>
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</HKInfoCard>

<style>
  /* ─── Toolbar ──────────────────────────────────────────────────────────── */
  .se-toolbar {
    display: flex;
    justify-content: flex-end;
  }

  /* ─── Lista de sesiones ────────────────────────────────────────────────── */
  .se-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .se-row {
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .se-row.current {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-canvas));
  }
  .se-icon {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    background: var(--bg-surface);
    color: var(--text-secondary);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .se-row.current .se-icon {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
  }
  .se-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .se-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .se-platform {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .se-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.01em;
    flex-shrink: 0;
  }
  .se-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    min-width: 0;
  }
  .se-country {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .se-flag {
    font-size: 13px;
    line-height: 1;
  }
  .se-dot {
    color: var(--text-tertiary);
  }
  .se-mono {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .se-times {
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ─── Botones ──────────────────────────────────────────────────────────── */
  .se-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 180ms var(--ease-ios-default),
      background 180ms ease,
      opacity 180ms ease;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .se-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .se-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .se-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .se-btn-ghost {
    background: var(--bg-glass-thin);
    color: var(--text-secondary);
    padding: 7px 12px;
  }
  .se-btn-ghost:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .se-btn-danger {
    color: var(--status-danger);
  }
  .se-btn-danger:not(.se-btn-ghost) {
    background: color-mix(in srgb, var(--status-danger) 12%, transparent);
  }
  .se-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 18%, transparent);
  }

  :global(.se-btn .spin) {
    animation: se-spin 1s linear infinite;
  }
  @keyframes se-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ─── Skeleton + vacío ─────────────────────────────────────────────────── */
  .se-skel-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .se-skel-row {
    height: 62px;
    background: var(--bg-canvas);
    border-radius: 12px;
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
    border-radius: 12px;
  }
  .se-empty :global(svg) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .se-btn-text {
      display: none;
    }
    .se-btn-ghost {
      padding: 8px;
    }
  }
</style>
