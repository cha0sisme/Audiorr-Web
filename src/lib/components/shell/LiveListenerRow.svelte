<script lang="ts">
  /**
   * LiveListenerRow — una persona del Sidebar que está escuchando algo AHORA.
   *
   * Composición estilo Spotify Friend Activity: avatar + la portada del álbum
   * solapando su esquina + un indicador "en vivo" (ecualizador animado). La
   * fila entera es el disparador de un mini panel (mismo patrón que UserMenu:
   * `position: fixed` calculado desde el rect del trigger para escapar el
   * `overflow` del sidebar) con "Ver perfil" / "Enviar mensaje" — ambas
   * deshabilitadas con "Pronto" (no hay ruta de perfil de otro usuario ni
   * mensajería todavía).
   *
   * El cambio de canción NO re-monta la fila: la portada hace crossfade y el
   * texto un blur-replace vía `{#key}`. Copy validado por marketing-lead
   * (presencia social fuera del sistema de firmas Audiorr/Audiorr Engine).
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { User, ChatCircle, MusicNote } from 'phosphor-svelte';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import * as user from '$services/user';
  import { credentials } from '$stores/credentials.svelte';
  import { userAvatarColor, userAvatarInitial } from '$utils/avatar-color';
  import { tooltip } from '$lib/actions/tooltip';

  type Listener = {
    username: string;
    title: string;
    artist: string;
    coverArt: string | null;
  };

  type Props = {
    listener: Listener;
    collapsed?: boolean;
  };
  const { listener, collapsed = false }: Props = $props();

  const avatarColor = $derived(userAvatarColor(listener.username));
  const initial = $derived(userAvatarInitial(listener.username));

  // Avatar del backend — comparte cache key con UserMenu y /profile. No está
  // admin-gated, así que funciona para cualquier usuario (no solo el propio).
  const prefsQ = createQuery(() => ({
    queryKey: ['userPreferences', listener.username],
    queryFn: () => user.getUserPreferences(listener.username),
    enabled: credentials.isConfigured && listener.username.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false
  }));
  const avatarUrl = $derived(prefsQ.data?.avatarUrl ?? null);

  const coverUrl = $derived(listener.coverArt ? getCoverArtUrl(listener.coverArt, 64) : '');

  const subText = $derived(
    listener.artist ? `${listener.title} · ${listener.artist}` : listener.title
  );

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Crossfade de portada / blur-replace de texto al cambiar de canción.
  function coverFade(_n: Element, { duration = 260 } = {}) {
    if (reduceMotion) return { duration: 0 };
    return { duration, css: (t: number) => `opacity:${t};` };
  }
  function blurReplace(_n: Element, { duration = 240 } = {}) {
    if (reduceMotion) return { duration: 0 };
    return { duration, css: (t: number, u: number) => `opacity:${t}; filter: blur(${u * 3}px);` };
  }

  // ── Mini panel (patrón UserMenu: fixed desde getBoundingClientRect) ────────
  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let panelEl: HTMLDivElement | undefined = $state();
  let pos = $state<{ left: number; bottom: number } | null>(null);

  function computePos() {
    if (!triggerEl) return;
    const r = triggerEl.getBoundingClientRect();
    pos = {
      left: Math.round(r.right + 8),
      bottom: Math.round(window.innerHeight - r.bottom)
    };
  }
  function toggle() {
    if (!open) computePos();
    open = !open;
  }
  function close() {
    open = false;
  }

  $effect(() => {
    if (!open) {
      pos = null;
      return;
    }
    computePos();
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerEl?.contains(t) || panelEl?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('resize', computePos);
    window.addEventListener('scroll', computePos, true);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', computePos);
      window.removeEventListener('scroll', computePos, true);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<button
  bind:this={triggerEl}
  type="button"
  class="row"
  class:collapsed
  class:open
  aria-haspopup="menu"
  aria-expanded={open}
  onclick={toggle}
  use:tooltip={collapsed ? `${listener.username} · ${listener.title}` : ''}
>
  <span class="art">
    <span class="avatar" style:background={avatarUrl ? undefined : avatarColor.css} aria-hidden="true">
      {#if avatarUrl}
        <img class="avatar-img" src={avatarUrl} alt="" loading="lazy" decoding="async" />
      {:else}
        {initial}
      {/if}
    </span>
    <span class="cover" aria-hidden="true">
      {#key coverUrl}
        <span class="cover-layer" in:coverFade out:coverFade>
          {#if coverUrl}
            <img class="cover-img" src={coverUrl} alt="" loading="lazy" decoding="async" />
          {:else}
            <span class="cover-fallback"><MusicNote size={9} weight="fill" /></span>
          {/if}
        </span>
      {/key}
    </span>
    <span class="eq" class:static={reduceMotion} aria-hidden="true">
      <i></i><i></i><i></i>
    </span>
  </span>

  {#if !collapsed}
    <span class="text">
      <span class="name">{listener.username}</span>
      <span class="sub">
        {#key listener.title}
          <span class="sub-inner" in:blurReplace out:blurReplace>{subText}</span>
        {/key}
      </span>
    </span>
  {/if}
</button>

{#if open}
  <div
    bind:this={panelEl}
    class="panel"
    role="menu"
    aria-label={`Acciones de ${listener.username}`}
    style:left={pos ? `${pos.left}px` : null}
    style:bottom={pos ? `${pos.bottom}px` : null}
  >
    <div class="panel-head">
      <span class="panel-avatar" style:background={avatarUrl ? undefined : avatarColor.css} aria-hidden="true">
        {#if avatarUrl}
          <img src={avatarUrl} alt="" loading="lazy" />
        {:else}
          {initial}
        {/if}
      </span>
      <span class="panel-id">
        <span class="panel-name">{listener.username}</span>
        <span class="panel-now">{subText}</span>
      </span>
    </div>
    <div class="sep" role="separator"></div>
    <a
      role="menuitem"
      class="item"
      href={`/user/${encodeURIComponent(listener.username)}`}
      data-sveltekit-preload-data="hover"
      onclick={close}
    >
      <User size={16} weight="regular" />
      <span>Ver perfil</span>
    </a>
    <button type="button" role="menuitem" class="item" disabled>
      <ChatCircle size={16} weight="regular" />
      <span>Enviar mensaje</span>
      <span class="soon">Pronto</span>
    </button>
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: 6px var(--space-3);
    min-height: 48px;
    border: 0;
    background: transparent;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover,
  .row.open {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .row.collapsed {
    justify-content: center;
    padding: var(--space-1);
    min-height: 48px;
  }

  /* ── Composición avatar + portada solapada + ecualizador ─────────────── */
  .art {
    position: relative;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
  }
  .avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    overflow: hidden;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
  }
  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  /* Portada del álbum: cuadrado pequeño solapando la esquina inferior-derecha
     del avatar (estilo Spotify). Borde del color de la superficie para que
     "recorte" el avatar limpiamente. */
  .cover {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    background: var(--bg-surface-elevated);
    box-shadow: 0 0 0 2px var(--bg-surface);
  }
  .cover-layer {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .cover-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-fallback {
    color: var(--text-tertiary);
    display: grid;
    place-items: center;
  }
  /* Ecualizador "en vivo": 3 barras en el color de éxito. En colapsado se
     ancla arriba-izquierda del avatar (la portada ocupa abajo-derecha). */
  .eq {
    position: absolute;
    top: -3px;
    left: -3px;
    display: flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 11px;
    padding: 2px;
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    box-shadow: 0 0 0 1.5px var(--bg-surface);
  }
  .eq i {
    width: 2px;
    height: 100%;
    border-radius: 1px;
    background: var(--status-success);
    transform-origin: bottom;
    animation: eq-bounce 900ms var(--ease-ios-default) infinite;
  }
  .eq i:nth-child(1) { animation-delay: 0ms; }
  .eq i:nth-child(2) { animation-delay: 180ms; }
  .eq i:nth-child(3) { animation-delay: 360ms; }
  .eq.static i { transform: scaleY(0.6); animation: none; }
  @keyframes eq-bounce {
    0%, 100% { transform: scaleY(0.35); }
    50% { transform: scaleY(1); }
  }

  /* ── Texto (solo expandido) ──────────────────────────────────────────── */
  .text {
    min-width: 0;
    flex: 1;
    display: grid;
    line-height: 1.25;
  }
  .name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    position: relative;
    min-width: 0;
    height: 1.25em;
  }
  .sub-inner {
    display: block;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Los layers conviven durante el blur-replace → posición absoluta encima. */
  .sub :global(.sub-inner:not(:last-child)) {
    position: absolute;
    inset: 0;
  }

  /* ── Mini panel ──────────────────────────────────────────────────────── */
  .panel {
    position: fixed;
    z-index: var(--z-popover);
    min-width: 200px;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: var(--space-1);
    display: grid;
    gap: 1px;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-2);
    min-width: 0;
  }
  .panel-avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    overflow: hidden;
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .panel-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .panel-id { min-width: 0; display: grid; line-height: 1.2; }
  .panel-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .panel-now {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sep {
    height: 1px;
    background: var(--separator-subtle);
    margin: var(--space-1) 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-xs);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .item:hover:not(:disabled) { background: var(--row-hover); }
  .item:focus-visible { outline: none; background: var(--row-hover); }
  .item:disabled {
    color: var(--text-tertiary);
    cursor: not-allowed;
  }
  .soon {
    margin-left: auto;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--accent-muted);
    color: var(--text-accent);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  @media (prefers-reduced-motion: reduce) {
    .eq i { animation: none; transform: scaleY(0.6); }
  }
</style>
