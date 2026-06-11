<script lang="ts">
  /**
   * /favorites — canciones marcadas como favoritas (Subsonic getStarred2).
   *
   * La query trae el snapshot del server; la lista visible se cruza con el
   * store `favorites` para que quitar una canción desde el context menu la
   * saque de la vista al instante, sin esperar refetch. Favoritos añadidos
   * desde otras vistas aparecen al volver a montar la página (staleTime 0).
   *
   * Reproducción ad-hoc (sin PlaybackContext): favoritos no es un álbum ni
   * una playlist — mismo criterio que la reproducción desde /search.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { Star, Play, Shuffle } from 'phosphor-svelte';
  import SongList from '$components/shared/SongList.svelte';
  import * as nav from '$services/NavidromeService';
  import { songToListItem, type SongListItem } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';
  import { favorites } from '$stores/favorites.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';

  const starredQ = createQuery(() => ({
    queryKey: ['starred2'],
    queryFn: () => nav.getStarred2(),
    enabled: credentials.isConfigured
  }));

  const allSongs = $derived(starredQ.data?.songs ?? []);
  const songs = $derived(
    favorites.loaded ? allSongs.filter((s) => favorites.isSong(s.id)) : allSongs
  );
  const tracks = $derived<SongListItem[]>(songs.map((s, i) => songToListItem(s, i, true, true)));

  function loadTrack(_track: SongListItem, index: number) {
    if (songs.length === 0) return;
    player.context = null;
    queueManager.play(songs, index);
  }

  function playAll() {
    if (songs.length === 0) return;
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    player.context = null;
    queueManager.play(songs, 0);
  }

  function shuffleAll() {
    if (songs.length === 0) return;
    if (!queueManager.shuffleMode) queueManager.toggleShuffle();
    player.context = null;
    queueManager.play(songs, 0);
  }
</script>

<svelte:head>
  <title>Favoritos · Audiorr</title>
</svelte:head>

<div class="fav-page">
  <header class="header">
    <h1 class="title">Favoritos</h1>
    {#if tracks.length > 0}
      <p class="lead">
        {tracks.length}
        {tracks.length === 1 ? 'canción' : 'canciones'}
      </p>
      <div class="actions">
        <button type="button" class="action-btn primary" onclick={playAll}>
          <Play size={16} weight="fill" />
          Reproducir
        </button>
        <button type="button" class="action-btn" onclick={shuffleAll}>
          <Shuffle size={16} weight="bold" />
          Aleatorio
        </button>
      </div>
    {/if}
  </header>

  {#if starredQ.isPending}
    <div class="skel-list">
      {#each Array(8) as _}
        <div class="skel-row"></div>
      {/each}
    </div>
  {:else if starredQ.isError}
    <p class="empty">No se han podido cargar tus favoritos. Reintenta.</p>
  {:else if tracks.length === 0}
    <div class="empty-state">
      <Star size={36} weight="regular" />
      <p class="empty-title">Aún no tienes favoritos</p>
      <p class="empty-sub">
        Marca canciones con la estrella desde el reproductor o desde el menú de cualquier lista.
      </p>
    </div>
  {:else}
    <SongList {tracks} contextType="queue" contextId="favorites" showCover onPlay={loadTrack} />
  {/if}
</div>

<style>
  .fav-page {
    display: grid;
    gap: var(--space-6);
  }

  .header {
    display: grid;
    gap: var(--space-2);
  }
  .title {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    line-height: 1.15;
  }
  .lead {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .actions {
    margin-top: var(--space-2);
    display: flex;
    gap: var(--space-3);
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .action-btn:hover {
    background: var(--bg-surface-hover);
  }
  .action-btn.primary {
    background: var(--accent);
    border-color: transparent;
    color: var(--text-on-accent);
  }
  .action-btn.primary:hover {
    background: var(--accent-hover);
  }
  .action-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ── Skeleton / vacíos ── */
  .skel-list {
    display: grid;
    gap: var(--space-2);
  }
  .skel-row {
    height: 56px;
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    animation: fav-pulse 1.6s ease-in-out infinite;
  }
  @keyframes fav-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
  .empty {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .empty-state {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    padding: var(--space-10) var(--space-4);
    color: var(--text-tertiary);
    text-align: center;
  }
  .empty-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .empty-sub {
    margin: 0;
    font-size: var(--text-sm);
    max-width: 40ch;
  }
</style>
