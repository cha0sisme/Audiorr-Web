<script lang="ts">
  import { goto } from '$app/navigation';
  import { User, Gear, SignOut, CaretUp } from 'phosphor-svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { disconnect } from '$services/NavidromeService';

  const username = $derived(credentials.current?.username ?? '');
  const initials = $derived.by(() => {
    if (!username) return '?';
    const parts = username.trim().split(/[\s._-]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return (parts[0]?.[0] ?? '?').toUpperCase();
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  });

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleProfile() {
    close();
    // TODO: ruta /profile cuando exista
  }
  function handleSettings() {
    close();
    goto('/settings');
  }
  function handleLogout() {
    close();
    disconnect();
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
</script>

<div class="wrap">
  <button
    bind:this={triggerEl}
    type="button"
    class="trigger"
    class:open
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={toggle}
  >
    <span class="avatar" aria-hidden="true">{initials}</span>
    <span class="info">
      <span class="name">{username || 'Invitado'}</span>
      <span class="hint">Cuenta</span>
    </span>
    <CaretUp size={14} weight="bold" class="caret" />
  </button>

  {#if open}
    <div bind:this={menuEl} class="menu" role="menu" aria-label="Menú de usuario">
      <button type="button" role="menuitem" class="item" onclick={handleProfile}>
        <User size={16} weight="regular" />
        <span>Perfil</span>
      </button>
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

  .avatar {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--bg-canvas);
    display: grid;
    place-items: center;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: var(--tracking-wide);
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
