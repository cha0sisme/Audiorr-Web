<script lang="ts">
  /**
   * CreatePlaylistDialog — modal centrado para crear una playlist nueva.
   *
   * Mirror del flujo iOS: input para el nombre + botón Crear. Si el caller
   * pasó `initialSongIds` (típicamente desde el flow "Añadir a playlist →
   * Crear nueva"), la playlist se crea ya con esas canciones dentro vía
   * `createPlaylist(name, songIds)`.
   *
   * Tras crear: invalida el cache de playlists para que aparezca al
   * instante en `/library?tab=playlists` y en cualquier otro consumer
   * de `getPlaylists()`. La playlist queda owner=current con `public=false`
   * por default (createPlaylist Subsonic) — entra en filterMyPlaylists.
   */
  import { fade, scale } from 'svelte/transition';
  import { tick } from 'svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { X, MusicNotesPlus } from 'phosphor-svelte';
  import { createPlaylistUI } from '$stores/playlist-mutations-ui.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import * as nav from '$services/NavidromeService';

  const qc = useQueryClient();

  let name = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let creating = $state(false);

  $effect(() => {
    if (createPlaylistUI.isOpen) {
      // Reset al abrir + autofocus al input.
      name = '';
      creating = false;
      void tick().then(() => inputEl?.focus());
    }
  });

  // ESC cierra
  $effect(() => {
    if (!createPlaylistUI.isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function close() {
    if (creating) return;
    createPlaylistUI.close();
  }

  async function submit(e: Event) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    creating = true;
    try {
      const playlist = await nav.createPlaylist(
        trimmed,
        createPlaylistUI.initialSongIds
      );
      // Invalidate caches que rendean playlists para que la nueva aparezca
      // al instante en library tab + grid + cualquier section que las use.
      void qc.invalidateQueries({ queryKey: ['library', 'playlists'] });
      void qc.invalidateQueries({ queryKey: ['library-grid', 'playlists'] });
      const songsAdded = createPlaylistUI.initialSongIds.length;
      toasts.success(
        `"${playlist.name}" creada`,
        songsAdded > 0
          ? `Con ${songsAdded === 1 ? '1 canción' : `${songsAdded} canciones`} dentro`
          : undefined
      );
      createPlaylistUI.close();
    } catch (err) {
      toasts.error('No se pudo crear la playlist');
      console.error('[CreatePlaylist]', err);
      creating = false;
    }
  }
</script>

{#if createPlaylistUI.isOpen}
  <div
    class="cpd-scrim"
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 120 }}
    role="presentation"
    onclick={close}
  ></div>
  <div
    class="cpd-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Crear nueva playlist"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="cpd-head">
      <span class="cpd-icon" aria-hidden="true">
        <MusicNotesPlus size={20} weight="regular" />
      </span>
      <div class="cpd-head-text">
        <h2 class="cpd-title">Nueva playlist</h2>
        <p class="cpd-sub">
          {createPlaylistUI.initialSongIds.length === 0
            ? 'Vacía. Añade canciones después.'
            : createPlaylistUI.initialSongIds.length === 1
              ? 'Empezará con la canción que estabas añadiendo.'
              : `Empezará con ${createPlaylistUI.initialSongIds.length} canciones.`}
        </p>
      </div>
      <button type="button" class="cpd-close" aria-label="Cerrar" onclick={close} disabled={creating}>
        <X size={14} weight="bold" />
      </button>
    </header>

    <form class="cpd-form" onsubmit={submit}>
      <input
        bind:this={inputEl}
        bind:value={name}
        type="text"
        class="cpd-input"
        placeholder="Nombre de la playlist"
        maxlength="80"
        disabled={creating}
        spellcheck="false"
        autocomplete="off"
      />
      <div class="cpd-actions">
        <button type="button" class="cpd-btn cpd-btn-ghost" onclick={close} disabled={creating}>
          Cancelar
        </button>
        <button type="submit" class="cpd-btn cpd-btn-primary" disabled={creating || !name.trim()}>
          {creating ? 'Creando…' : 'Crear'}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .cpd-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: var(--z-sticky);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .cpd-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-sticky) + 1);
    width: min(420px, calc(100vw - 32px));
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow:
      0 20px 60px var(--shadow-color-xl),
      0 6px 20px var(--shadow-color-lg);
    color: var(--text-primary);
    overflow: hidden;
  }

  .cpd-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }
  .cpd-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--accent);
    flex-shrink: 0;
  }
  .cpd-head-text {
    min-width: 0;
  }
  .cpd-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1.25;
  }
  .cpd-sub {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }
  .cpd-close {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .cpd-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .cpd-close:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cpd-form {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .cpd-input {
    width: 100%;
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    transition: border-color var(--duration-fast) var(--ease-ios-default);
    box-sizing: border-box;
  }
  .cpd-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-muted);
  }
  .cpd-input:disabled {
    opacity: 0.6;
  }

  .cpd-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .cpd-btn {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
    font-family: inherit;
  }
  .cpd-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: var(--duration-instant);
  }
  .cpd-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cpd-btn-ghost {
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }
  .cpd-btn-ghost:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }
  .cpd-btn-primary {
    background: var(--accent);
    border: 1px solid transparent;
    color: var(--text-on-accent);
  }
  .cpd-btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .cpd-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
