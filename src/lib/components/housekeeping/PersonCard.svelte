<script lang="ts">
  /**
   * PersonCard — ficha de una persona en el directorio de Housekeeping.
   *
   * Colapsada: avatar + identidad (badges tú/admin) + último scrobble + meta
   * (último acceso + nº sesiones + caret). Expandible (mismo disclosure que el
   * acordeón de Jobs: grid-rows 0fr→1fr + caret) al detalle, que reutiliza
   * `SessionRow` SIN tocarlo y conserva el cierre remoto. Vive en chasis claro
   * (AdminPanel), no en superficie --sec- oscura (esa es para instrumentos).
   */
  import { MusicNote, CaretRight } from 'phosphor-svelte';
  import SessionRow from '$components/sessions/SessionRow.svelte';
  import { userAvatarColor, userAvatarInitial } from '$utils/avatar-color';
  import type { AdminUser, SessionView } from '$types/backend';

  type Person = {
    username: string;
    avatarUrl: string | null;
    lastScrobble: AdminUser['lastScrobble'];
    lastLogin: AdminUser['lastLogin'];
    isSelf: boolean;
    isAdmin: boolean;
    sessions: SessionView[];
  };

  type Props = {
    person: Person;
    expanded: boolean;
    onToggle: () => void;
    closingId: string | null;
    closingRest: boolean;
    onCloseSession: (id: string) => void;
    onCloseRest: () => void;
  };

  let { person, expanded, onToggle, closingId, closingRest, onCloseSession, onCloseRest }: Props =
    $props();

  const n = $derived(person.sessions.length);
  const expandable = $derived(n > 0);
  const avatarColor = $derived(userAvatarColor(person.username));

  /** Cerrable salvo la sesión actual del propio admin (no auto-desconectarse). */
  function isClosable(s: SessionView): boolean {
    return !(person.isSelf && s.current);
  }
  const closeableCount = $derived(person.sessions.filter(isClosable).length);

  // Escuchando AHORA solo si el scrobble es < 5 min y hay sesión activa; si no,
  // es el "último" (honestidad sobre el dato, no inventar presencia).
  const isLive = $derived.by(() => {
    if (!person.lastScrobble || n === 0) return false;
    return Date.now() - new Date(person.lastScrobble.playedAt).getTime() < 5 * 60 * 1000;
  });

  function rel(iso?: string | null): string {
    if (!iso) return '—';
    const abs = Math.abs(new Date(iso).getTime() - Date.now());
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    if (abs < 60_000) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    if (hr < 24) return `hace ${hr} h`;
    if (day === 1) return 'ayer';
    return `hace ${day} días`;
  }
</script>

<article class="person" class:expanded>
  <button
    type="button"
    class="person-head"
    aria-expanded={expanded}
    disabled={!expandable}
    onclick={onToggle}
  >
    <span class="avatar" style:background={person.avatarUrl ? undefined : avatarColor.css} aria-hidden="true">
      {#if person.avatarUrl}
        <img src={person.avatarUrl} alt="" loading="lazy" />
      {:else}
        {userAvatarInitial(person.username)}
      {/if}
    </span>

    <span class="identity">
      <span class="name">
        {person.username}
        {#if person.isSelf}<span class="badge self">tú</span>{/if}
        {#if person.isAdmin}<span class="badge admin">admin</span>{/if}
      </span>
    </span>

    <span class="now" class:live={isLive}>
      {#if person.lastScrobble}
        <MusicNote size={12} weight="fill" />
        <span class="now-text">
          {#if isLive}Escuchando: {/if}{person.lastScrobble.title} · {person.lastScrobble.artist}
        </span>
      {:else}
        <span class="now-empty">Sin reproducciones recientes</span>
      {/if}
    </span>

    <span class="meta">
      <span class="meta-lines">
        {#if person.lastLogin}
          <span class="meta-access">Último acceso {rel(person.lastLogin.at)}</span>
        {/if}
        <span class="meta-sessions">{n} {n === 1 ? 'sesión' : 'sesiones'}</span>
      </span>
      {#if expandable}
        <span class="caret"><CaretRight size={13} weight="bold" /></span>
      {/if}
    </span>
  </button>

  <div class="person-drawer" class:open={expanded && expandable}>
    <div class="person-drawer-inner" role="region" aria-label={`Detalle de ${person.username}`}>
      {#if expanded && expandable}
        <div class="detail">
          <div class="detail-head">
            <span class="detail-label">Sesiones activas</span>
            {#if closeableCount > 0}
              <button
                type="button"
                class="close-rest"
                disabled={closingRest}
                onclick={onCloseRest}
              >
                {person.isSelf ? 'Cerrar el resto' : 'Cerrar todas'}
              </button>
            {/if}
          </div>
          <div class="detail-rows">
            {#each person.sessions as s (s.id)}
              <SessionRow
                session={s}
                closable={isClosable(s)}
                closing={closingId === s.id}
                onClose={() => onCloseSession(s.id)}
              />
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</article>

<style>
  .person {
    border-radius: var(--radius-lg);
    background: var(--bg-surface-elevated);
    overflow: hidden;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .person.expanded { background: var(--bg-surface-active); }

  .person-head {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) minmax(0, 1.4fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 0;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .person-head:disabled { cursor: default; }
  .person-head:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: var(--radius-lg); }

  .avatar {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    overflow: hidden;
    display: grid;
    place-items: center;
    color: var(--hero-text-primary);
    font-size: var(--text-base);
    font-weight: 700;
    flex-shrink: 0;
  }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }

  .identity { min-width: 0; }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .badge.self  { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text-accent); }
  .badge.admin { background: color-mix(in srgb, var(--status-warning) 18%, transparent); color: var(--status-warning-text); }

  .now {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .now :global(svg) { color: var(--text-tertiary); flex-shrink: 0; }
  .now.live :global(svg) { color: var(--status-success); }
  .now-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .now-empty { color: var(--text-tertiary); }

  .meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    justify-self: end;
  }
  .meta-lines {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }
  .meta-access {
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .meta-sessions {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .caret {
    display: inline-flex;
    color: var(--text-tertiary);
    transition: transform var(--duration-fast) var(--ease-ios-default);
  }
  .person.expanded .caret { transform: rotate(90deg); color: var(--text-secondary); }

  /* ─── Detalle expandible — mismo morph que el acordeón de Jobs ────────── */
  .person-drawer {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--morph-duration) var(--morph-ease);
  }
  .person-drawer.open { grid-template-rows: 1fr; }
  .person-drawer-inner { overflow: hidden; min-height: 0; }
  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-4);
    animation: person-detail-in 260ms var(--morph-ease) var(--morph-icon-in-delay, 80ms) both;
  }
  @keyframes person-detail-in {
    from { opacity: 0; transform: translateY(6px); filter: blur(4px); }
    to   { opacity: 1; transform: translateY(0);   filter: blur(0); }
  }
  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .detail-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .close-rest {
    padding: 5px 11px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-glass-thin);
    color: var(--status-danger);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .close-rest:hover:not(:disabled) { background: color-mix(in srgb, var(--status-danger) 14%, transparent); }
  .close-rest:disabled { opacity: 0.45; cursor: not-allowed; }
  .close-rest:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .detail-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    .person-drawer { transition: none; }
    .caret { transition: none; }
    .detail { animation: none; }
  }

  @media (max-width: 720px) {
    .person-head {
      grid-template-columns: 40px minmax(0, 1fr) auto;
      row-gap: 6px;
    }
    .now { grid-column: 2 / -1; }
  }
</style>
