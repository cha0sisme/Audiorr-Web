<script lang="ts">
  import { goto } from '$app/navigation';
  import { User, Gear, SignOut, CaretUp, Wrench } from 'phosphor-svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { credentials } from '$stores/credentials.svelte';
  import * as nav from '$services/NavidromeService';
  import { disconnect } from '$services/NavidromeService';
  import * as user from '$services/user';
  import { userAvatarColor, userAvatarInitial } from '$utils/avatar-color';

  type Props = {
    /** Modo colapsado: solo avatar visible, popover ancla al lateral. */
    compact?: boolean;
  };
  const { compact = false }: Props = $props();

  const username = $derived(credentials.current?.username ?? '');
  const initial = $derived(userAvatarInitial(username || '?'));
  const avatarColor = $derived(userAvatarColor(username || '?'));

  // Avatar del backend — comparte cache key con /profile.
  // Si el backend no tiene preferencias para el user, prefsQ.data === null y
  // caemos al initial sobre fondo coloreado (mismo color que /profile).
  const prefsQ = createQuery(() => ({
    queryKey: ['userPreferences', username],
    queryFn: () => user.getUserPreferences(username),
    enabled: credentials.isConfigured && username.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
  const avatarUrl = $derived(prefsQ.data?.avatarUrl ?? null);

  // === Admin role (Subsonic getUser → adminRole) ===
  // Mostramos "Admin" en lugar de "Cuenta" cuando el user lo es. Para usuarios
  // sin permisos de getUser sobre otros, Subsonic permite consultar el OWN
  // user sin restricciones — siempre funciona para el current user.
  const userInfoQ = createQuery(() => ({
    queryKey: ['navidromeUser', username],
    queryFn: () => nav.getUser(username),
    enabled: credentials.isConfigured && username.length > 0,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false
  }));
  const isAdmin = $derived(userInfoQ.data?.adminRole === true);
  const roleLabel = $derived(isAdmin ? 'Admin' : 'Cuenta');

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();

  // En modo `compact` el menú se renderiza con `position: fixed` calculado
  // desde el bounding rect del trigger. Razón: el sidebar tiene
  // `overflow-x: hidden` (para evitar bleed horizontal de cards/pinned) y un
  // menú `position: absolute` de 180px dentro del rail estrecho (~64px) se
  // recorta. `position: fixed` escapa del contexto de clipping del sidebar
  // sin tener que renderizar en un portal.
  let menuPos = $state<{ left: number; bottom: number } | null>(null);

  function toggle() {
    // Pre-cómputo síncrono de la posición fixed cuando se va a abrir en
    // compact. Sin esto, el primer frame del menú renderiza con menuPos
    // null → fallback a top:0 left:0 (flicker). El $effect posterior se
    // encarga de updates en resize/scroll.
    if (!open && compact && triggerEl) {
      const r = triggerEl.getBoundingClientRect();
      menuPos = {
        left: Math.round(r.right + 8),
        bottom: Math.round(window.innerHeight - r.bottom)
      };
    }
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleProfile() {
    close();
    goto('/profile');
  }
  function handleHousekeeping() {
    close();
    goto('/housekeeping');
  }
  function handleSettings() {
    close();
    goto('/settings');
  }
  async function handleLogout() {
    close();
    await disconnect();
    goto('/login', { replaceState: true });
  }

  // Click fuera + tecla Escape cierran el menú.
  $effect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerEl && triggerEl.contains(target)
      ) return;
      if (menuEl && menuEl.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  });

  // Posicionamiento fixed para modo compact. Re-calcula en open, resize y
  // scroll del sidebar (el sidebar tiene overflow-y: auto, así que el
  // trigger se mueve si el user scrollea con el menú abierto).
  $effect(() => {
    if (!open || !compact) {
      menuPos = null;
      return;
    }
    function updatePos() {
      if (!triggerEl) return;
      const r = triggerEl.getBoundingClientRect();
      menuPos = {
        // 8px gap a la derecha del avatar — separa visualmente del rail.
        left: Math.round(r.right + 8),
        // Bottom del menú alineado con el bottom del trigger → el menú
        // crece hacia arriba (igual que el caso no-compact, que es bottom
        // del trigger via `bottom: calc(100% + space-2)`).
        bottom: Math.round(window.innerHeight - r.bottom)
      };
    }
    updatePos();
    window.addEventListener('resize', updatePos);
    // capture: capturamos scrolls de cualquier ancestro (incl. el sidebar).
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  });
</script>

<div class="wrap" class:compact>
  <button
    bind:this={triggerEl}
    type="button"
    class="trigger"
    class:open
    class:compact
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
    title={compact ? username || 'Invitado' : undefined}
  >
    <span class="avatar" style:background={avatarColor.css} aria-hidden="true">
      {#if avatarUrl}
        <img class="avatar-img" src={avatarUrl} alt="" loading="lazy" decoding="async" />
      {:else}
        {initial}
      {/if}
    </span>
    {#if !compact}
      <span class="info">
        <span class="name">{username || 'Invitado'}</span>
        <span class="hint" class:admin={isAdmin}>{roleLabel}</span>
      </span>
      <CaretUp size={14} weight="bold" class="caret" />
    {/if}
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      class="menu"
      class:menu-compact={compact}
      role="menu"
      aria-label="Menú de usuario"
      style:left={compact && menuPos ? `${menuPos.left}px` : null}
      style:bottom={compact && menuPos ? `${menuPos.bottom}px` : null}
    >
      <button type="button" role="menuitem" class="item" onclick={handleProfile}>
        <User size={16} weight="regular" />
        <span>Perfil</span>
      </button>
      {#if isAdmin}
        <button type="button" role="menuitem" class="item" onclick={handleHousekeeping}>
          <Wrench size={16} weight="regular" />
          <span>Housekeeping</span>
        </button>
      {/if}
      <button type="button" role="menuitem" class="item" onclick={handleSettings}>
        <Gear size={16} weight="regular" />
        <span>Ajustes</span>
      </button>
      <div class="separator" role="separator"></div>
      <button type="button" role="menuitem" class="item danger" onclick={handleLogout}>
        <SignOut size={16} weight="regular" />
        <span>Cerrar sesión</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    text-align: left;
    min-height: 44px;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .trigger:hover,
  .trigger.open {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .trigger:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  /* Compact: solo avatar centrado en el rail estrecho del sidebar. */
  .trigger.compact {
    justify-content: center;
    width: 48px;
    height: 48px;
    min-height: 48px;
    padding: 0;
    margin: 0 auto;
  }

  .avatar {
    position: relative;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    /* background es inline (HSL determinístico del username). */
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: var(--tracking-wide);
    overflow: hidden;
  }
  .avatar-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .info {
    min-width: 0;
    flex: 1;
    display: grid;
    line-height: 1.15;
  }
  .name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    font-size: 11px;
    color: var(--text-tertiary);
  }
  /* Cuando el user es admin, el label "Admin" toma el accent — pista visual
     sutil de que tiene poderes elevados. Tipografía estándar, sin pill. */
  .hint.admin {
    color: var(--accent);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .trigger :global(.caret) {
    flex-shrink: 0;
    color: var(--text-tertiary);
    transition: transform var(--duration-fast) var(--ease-ios-default);
  }
  .trigger.open :global(.caret) {
    transform: rotate(180deg);
  }

  .menu {
    position: absolute;
    bottom: calc(100% + var(--space-2));
    left: 0;
    right: 0;
    z-index: var(--z-popover);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    padding: var(--space-1);
    display: grid;
    gap: 1px;
  }
  /* Cuando el trigger es compact, el menú se renderiza con `position: fixed`
     (left/bottom inline desde el JS) para escapar del clipping `overflow-x:
     hidden` del sidebar. El ancho fijo evita que el menú colapse a 48px. */
  .menu-compact {
    position: fixed;
    right: auto;
    min-width: 180px;
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
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .item:hover {
    background: var(--row-hover);
  }
  .item:focus-visible {
    outline: none;
    background: var(--row-hover);
  }
  .item.danger {
    color: var(--status-danger-text);
  }
  .item.danger:hover {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
  }

  .separator {
    height: 1px;
    background: var(--separator-subtle);
    margin: var(--space-1) 0;
  }
</style>
