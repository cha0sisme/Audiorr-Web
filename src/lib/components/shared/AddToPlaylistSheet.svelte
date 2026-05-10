<script lang="ts">
  /**
   * AddToPlaylistSheet — modal centrado mirror iOS sheet de
   * AddToPlaylistView (NowPlaying/AddToPlaylistView.swift). Apple lo
   * presenta como sheet flotante con presentationDetents medium/large,
   * NUNCA como side panel (los side panels son chrome persistente:
   * Queue, DevicePicker). Aquí lo replicamos como modal centrado, scrim
   * oscuro, animación scale-in — mismo lenguaje que el CreatePlaylistDialog
   * con el que comparte el flow.
   *
   * Carga `getPlaylists()` y filtra con `filterMyPlaylists()` — solo
   * playlists privadas del usuario actual (sin daily mix, smart playlist,
   * editorial, ni Spotify-synced). Click en una row → updatePlaylist con
   * `songIdsToAdd` → checkmark verde + auto-dismiss tras 900ms.
   *
   * Botón "Crear nueva playlist" arriba abre el dialog de creación
   * pasando los songIds actuales — flow encadenado: el director quería
   * añadir una canción a algo que aún no existe, lo crea de paso con
   * la canción ya dentro.
   */
  import { fade, scale } from 'svelte/transition';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    X, MusicNote, Plus, CheckCircle, Queue as QueueIcon
  } from 'phosphor-svelte';
  import { addToPlaylistUI, createPlaylistUI } from '$stores/playlist-mutations-ui.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import * as nav from '$services/NavidromeService';
  import { filterMyPlaylists } from '$utils/playlist-section-mappers';
  import CoverImage from './CoverImage.svelte';

  const qc = useQueryClient();

  /** Cargamos las playlists del usuario lazy: la query se enable solo
      cuando el sheet esté abierto. Reutiliza la cache de `['library',
      'playlists']` que ya pueblan otros lugares. */
  const playlistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: addToPlaylistUI.isOpen && credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const myPlaylists = $derived.by(() => {
    if (!playlistsQ.data) return [];
    return filterMyPlaylists(playlistsQ.data, credentials.current?.username);
  });

  /** id de la playlist a la que acabamos de añadir → checkmark verde +
      auto-close. Reset cuando se cierra el sheet. */
  let addedToId = $state<string | null>(null);
  let pendingId = $state<string | null>(null);

  $effect(() => {
    if (!addToPlaylistUI.isOpen) {
      addedToId = null;
      pendingId = null;
    }
  });

  async function handleAdd(playlistId: string, playlistName: string) {
    if (pendingId) return;
    pendingId = playlistId;
    try {
      await nav.updatePlaylist(playlistId, {
        songIdsToAdd: addToPlaylistUI.songIds
      });
      addedToId = playlistId;
      // Invalidate para que el songCount + sniff aparezcan al re-fetch.
      void qc.invalidateQueries({ queryKey: ['library', 'playlists'] });
      void qc.invalidateQueries({ queryKey: ['library-grid', 'playlists'] });
      void qc.invalidateQueries({ queryKey: ['playlist', playlistId] });
      toasts.success(`Añadido a "${playlistName}"`);
      // Dismiss tras un beat para que el checkmark se aprecie.
      setTimeout(() => addToPlaylistUI.close(), 900);
    } catch (err) {
      toasts.error('No se pudo añadir a la playlist');
      console.error('[AddToPlaylist]', err);
      pendingId = null;
    }
  }

  function handleCreateNew() {
    // Encadena: cierra el sheet, abre el dialog con los songIds actuales.
    const songs = [...addToPlaylistUI.songIds];
    addToPlaylistUI.close();
    createPlaylistUI.open(songs);
  }

  function close() {
    addToPlaylistUI.close();
  }

  // ESC cierra
  $effect(() => {
    if (!addToPlaylistUI.isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function thumbUrl(coverArt: string | undefined): string | undefined {
    if (!coverArt) return undefined;
    return nav.getCoverArtUrl(coverArt, 200);
  }

  function songCountLabel(n: number | undefined): string {
    const c = n ?? 0;
    return c === 1 ? '1 canción' : `${c} canciones`;
  }
</script>

{#if addToPlaylistUI.isOpen}
  <div
    class="atp-scrim"
    role="presentation"
    onclick={close}
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 120 }}
  ></div>
  <div
    class="atp-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Añadir a playlist"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="atp-header">
      <h2 class="atp-title">Añadir a playlist</h2>
      <button type="button" class="atp-close" aria-label="Cerrar" onclick={close}>
        <X size={16} weight="bold" />
      </button>
    </header>

    <button type="button" class="atp-create-btn" onclick={handleCreateNew}>
      <span class="atp-create-icon" aria-hidden="true">
        <Plus size={18} weight="bold" />
      </span>
      <span class="atp-create-label">
        <span class="atp-create-title">Crear nueva playlist</span>
        <span class="atp-create-sub">
          {addToPlaylistUI.songIds.length === 1
            ? 'Con esta canción ya dentro'
            : `Con ${addToPlaylistUI.songIds.length} canciones ya dentro`}
        </span>
      </span>
    </button>

    <div class="atp-body">
      {#if playlistsQ.isPending}
        <div class="atp-empty"><p>Cargando playlists…</p></div>
      {:else if myPlaylists.length === 0}
        <div class="atp-empty">
          <QueueIcon size={28} weight="regular" />
          <p class="atp-empty-title">No tienes playlists propias</p>
          <p class="atp-empty-sub">Crea tu primera con el botón de arriba.</p>
        </div>
      {:else}
        <ul class="atp-list">
          {#each myPlaylists as p (p.id)}
            <li>
              <button
                type="button"
                class="atp-row"
                class:pending={pendingId === p.id}
                disabled={pendingId !== null && pendingId !== p.id}
                onclick={() => handleAdd(p.id, p.name)}
              >
                <span class="atp-thumb">
                  <CoverImage src={thumbUrl(p.coverArt)} alt="" priority="low" width={120} height={120}>
                    {#snippet fallback()}
                      <MusicNote size="100%" weight="regular" />
                    {/snippet}
                  </CoverImage>
                </span>
                <span class="atp-meta">
                  <span class="atp-name">{p.name}</span>
                  <span class="atp-count">{songCountLabel(p.songCount)}</span>
                </span>
                {#if addedToId === p.id}
                  <span class="atp-check" aria-label="Añadido">
                    <CheckCircle size={20} weight="fill" />
                  </span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Scrim oscuro full-viewport — click cierra. Mismo token --scrim que el
     resto de modales (CreatePlaylistDialog comparte). */
  .atp-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: var(--z-sticky);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  /* Modal centrado — patrón Apple iOS sheet (presentationDetents medium).
     Width contenido (no ancho fijo de panel), max-height 70vh para que
     no monopolice la pantalla. Border-radius lg + shadow profunda + bg
     surface elevated (no glass — los modales centrados son sólidos en
     iOS para que el contenido se lea limpio sin compita con el fondo). */
  .atp-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-sticky) + 1);
    width: min(440px, calc(100vw - 32px));
    max-height: min(70vh, 720px);
    display: flex;
    flex-direction: column;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow:
      0 20px 60px var(--shadow-color-xl),
      0 6px 20px var(--shadow-color-lg);
    color: var(--text-primary);
    overflow: hidden;
  }

  .atp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .atp-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: var(--tracking-body);
  }
  .atp-close {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .atp-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .atp-close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Botón "Crear nueva playlist" — destacado arriba con tinte accent. */
  .atp-create-btn {
    margin: var(--space-3) var(--space-4) 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default);
    font-family: inherit;
  }
  .atp-create-btn:hover {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .atp-create-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .atp-create-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--text-on-accent);
    flex-shrink: 0;
  }
  .atp-create-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .atp-create-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.25;
  }
  .atp-create-sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.25;
  }

  .atp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-3) 0 var(--space-4);
  }

  .atp-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .atp-row {
    width: 100%;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    padding: var(--space-2) var(--space-5);
    background: transparent;
    border: none;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      opacity var(--duration-fast) var(--ease-ios-default);
    font-family: inherit;
  }
  .atp-row:hover {
    background: var(--row-hover);
  }
  .atp-row:focus-visible {
    outline: none;
    background: var(--row-hover);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .atp-row:disabled {
    cursor: progress;
    opacity: 0.5;
  }
  .atp-row.pending {
    background: var(--row-hover);
    opacity: 1;
  }

  .atp-thumb {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--artwork-placeholder-bg);
    flex-shrink: 0;
    color: var(--artwork-placeholder-fg);
  }
  .atp-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .atp-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .atp-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .atp-check {
    color: var(--status-success);
    display: grid;
    place-items: center;
    animation: atp-check-pop 380ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes atp-check-pop {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  .atp-empty {
    padding: var(--space-12) var(--space-6);
    display: grid;
    place-items: center;
    gap: var(--space-2);
    text-align: center;
    color: var(--text-tertiary);
  }
  .atp-empty-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .atp-empty-sub {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  @media (prefers-reduced-motion: reduce) {
    .atp-check { animation: none; }
  }
</style>
