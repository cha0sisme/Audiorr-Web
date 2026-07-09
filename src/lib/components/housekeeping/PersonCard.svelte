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
  import { createQuery } from '@tanstack/svelte-query';
  import SessionRow from '$components/sessions/SessionRow.svelte';
  import PlaylistCustomCover from './PlaylistCustomCover.svelte';
  import { getDailyMixes } from '$services/dailyMixes';
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
    /** Reproducción en vivo (Subsonic getNowPlaying) si el usuario está
        sonando ahora; null si no. Dato real, no heurística. */
    nowPlaying?: { title: string; artist: string } | null;
    expanded: boolean;
    onToggle: () => void;
    closingId: string | null;
    closingRest: boolean;
    onCloseSession: (id: string) => void;
    onCloseRest: () => void;
  };

  let {
    person,
    nowPlaying = null,
    expanded,
    onToggle,
    closingId,
    closingRest,
    onCloseSession,
    onCloseRest
  }: Props = $props();

  const n = $derived(person.sessions.length);
  // Siempre expandible: aunque no tenga sesiones activas, el detalle también
  // muestra sus Daily Mixes (portada manual) — antes solo abría con n > 0.
  const expandable = true;
  const avatarColor = $derived(userAvatarColor(person.username));

  // ─── Daily Mixes del usuario (lazy: solo al expandir) ───────────────────
  // Reutiliza el mismo endpoint que /library — el admin puede asignar una
  // portada manual a cualquier Daily Mix concreto de cualquier persona.
  const dailyMixesQ = createQuery(() => ({
    queryKey: ['dailyMixes', person.username],
    queryFn: () => getDailyMixes(person.username),
    enabled: expanded,
    staleTime: 5 * 60 * 1000
  }));
  const dailyMixes = $derived(
    (dailyMixesQ.data ?? []).filter(
      (m): m is typeof m & { navidromeId: string } => m.navidromeId !== null
    )
  );

  /** Cerrable salvo la sesión actual del propio admin (no auto-desconectarse). */
  function isClosable(s: SessionView): boolean {
    return !(person.isSelf && s.current);
  }
  const closeableCount = $derived(person.sessions.filter(isClosable).length);

  // "Escuchando ahora" = dato REAL de getNowPlaying, no una heurística sobre el
  // último scrobble.
  const isLive = $derived(nowPlaying != null);

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
      {#if nowPlaying}
        <MusicNote size={12} weight="fill" />
        <span class="now-text">Escuchando: {nowPlaying.title}{#if nowPlaying.artist} · {nowPlaying.artist}{/if}</span>
      {:else if person.lastScrobble}
        <MusicNote size={12} weight="regular" />
        <span class="now-text">{person.lastScrobble.title} · {person.lastScrobble.artist}</span>
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
          {#if n > 0}
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
          {:else}
            <p class="detail-empty">Sin sesiones activas.</p>
          {/if}

          {#if dailyMixes.length > 0}
            <div class="detail-head daily-mixes-head">
              <span class="detail-label">Daily Mixes · portada manual</span>
            </div>
            <div class="daily-mixes-rows">
              {#each dailyMixes as mix (mix.navidromeId)}
                <div class="daily-mix-row">
                  <span class="daily-mix-name">{mix.name}</span>
                  <PlaylistCustomCover playlistId={mix.navidromeId} playlistName={mix.name} size={32} />
                </div>
              {/each}
            </div>
          {/if}
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
  .detail-empty {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* ─── Daily Mixes — portada manual por mix ───────────────────────────── */
  .daily-mixes-head { margin-top: var(--space-1); }
  .daily-mixes-rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .daily-mix-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .daily-mix-name {
    min-width: 96px;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
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
