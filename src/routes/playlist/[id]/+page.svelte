<script lang="ts">
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { DotsThree, Queue, Plus, ListPlus } from 'phosphor-svelte';
  import HeroPlayButton from '$components/shared/HeroPlayButton.svelte';
  import HeroCircleButton from '$components/shared/HeroCircleButton.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import NowPlayingIndicator from '$components/shared/NowPlayingIndicator.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import * as nav from '$services/NavidromeService';
  import { songToListItem } from '$utils/navidrome-mappers';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { theme } from '$stores/theme.svelte';
  import {
    extractPalette,
    playButtonBg,
    heroGradientTop,
    heroGradientMid,
    HERO_PLACEHOLDER_PALETTE,
    type CoverPalette
  } from '$utils/palette';

  const playlistId = $derived(page.params.id ?? '');

  const playlistQ = createQuery(() => ({
    queryKey: ['playlist', playlistId],
    queryFn: () => nav.getPlaylist(playlistId),
    enabled: credentials.isConfigured && !!playlistId
  }));

  const playlist = $derived(playlistQ.data);
  const songs = $derived(playlist?.entry ?? []);

  // Mismo size (500) que playlistToCardProps → cache hit perfecto al venir
  // de una card (la imagen aparece instantánea, sin re-descargar).
  const coverUrl = $derived(playlist?.coverArt ? getCoverArtUrl(playlist.coverArt, 500) : undefined);

  const fallbackHue = $derived(
    playlist
      ? [...playlist.name].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0) % 360
      : 220
  );

  const paletteQ = createQuery(() => ({
    queryKey: ['palette', coverUrl ?? ''],
    queryFn: () => extractPalette(coverUrl!),
    enabled: !!coverUrl,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false
  }));

  const palette = $derived<CoverPalette>(
    paletteQ.data ?? { hue: fallbackHue, chroma: 0.12 }
  );

  const isDark = $derived(theme.current === 'dark');

  // Placeholder neutral (chroma ≈ 0) mientras Vibrant extrae la paleta real.
  // Evita el flash de color hasheado durante la View Transition.
  const heroBg = $derived.by(() => {
    const p = paletteQ.data ?? HERO_PLACEHOLDER_PALETTE;
    return `linear-gradient(180deg, ${heroGradientTop(p)} 0%, ${heroGradientMid(p)} 60%, var(--bg-canvas) 100%)`;
  });

  const playBg = $derived(playButtonBg(palette, isDark));

  // Playlist tracks vienen con artist propio (varios artistas en la lista)
  const tracks = $derived(songs.map((s, i) => songToListItem(s, i, true)));

  const totalDuration = $derived(tracks.reduce((sum, t) => sum + t.durationSec, 0));

  const totalDurationFormatted = $derived.by(() => {
    const totalMin = Math.floor(totalDuration / 60);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h} h ${m} min`;
  });

  const isCurrentPlaylist = $derived(player.isPlayingFrom('playlist', playlistId));

  function loadTrack(_track: ReturnType<typeof songToListItem>, index: number) {
    if (!playlist) return;
    player.context = { type: 'playlist', id: playlist.id };
    queueManager.play(songs, index);
  }

  function playAll() {
    if (!playlist || tracks.length === 0) return;
    player.context = { type: 'playlist', id: playlist.id };
    queueManager.play(songs, 0);
  }

  // Context menu (3-dots).
  let menuOpen = $state(false);
  const menuItems = $derived<ContextMenuItem[]>([
    {
      label: 'Añadir a continuación',
      icon: Plus,
      action: () => {
        if (songs.length > 0) queueManager.insertNextMany(songs);
      }
    },
    {
      label: 'Añadir a Playlist',
      icon: ListPlus,
      action: () => {
        // TODO: abrir picker de playlists (aún en la misma playlist?)
      }
    }
  ]);
</script>

<svelte:head>
  <title>{playlist?.name ?? 'Playlist'} · Audiorr</title>
</svelte:head>

<div class="playlist-detail">
  <header class="hero" style:background={heroBg}>
    <div
      class="hero-cover"
      style:view-transition-name={playlistId ? `playlist-${playlistId}` : undefined}
    >
      <CoverImage src={coverUrl} alt="" lazy={false} priority="high">
        {#snippet fallback()}
          <Queue size="100%" weight="regular" />
        {/snippet}
      </CoverImage>

      {#if isCurrentPlaylist}
        <div class="hero-playing-overlay" aria-hidden="true">
          <NowPlayingIndicator
            isPlaying={player.isPlaying}
            color="#fff"
            height={32}
            barWidth={4}
          />
        </div>
      {/if}
    </div>

    <div class="hero-meta">
      {#if playlistQ.isPending}
        <div class="hero-skeleton">
          <div class="sk sk-1"></div>
          <div class="sk sk-2"></div>
        </div>
      {:else if playlistQ.isError}
        <p class="error">No se pudo cargar la playlist.</p>
      {:else if playlist}
        <p class="kicker">Playlist</p>
        <h1 class="title">{playlist.name}</h1>
        {#if playlist.owner}
          <p class="owner">por {playlist.owner}</p>
        {/if}
        <p class="meta-line">
          {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'} · {totalDurationFormatted}
        </p>

        <div class="actions">
          <HeroPlayButton
            bgColor={playBg}
            onclick={playAll}
            disabled={tracks.length === 0}
          />
          <div class="menu-anchor">
            <HeroCircleButton
              bgColor={playBg}
              onclick={() => (menuOpen = !menuOpen)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Más opciones"
            >
              <DotsThree size={20} weight="bold" />
            </HeroCircleButton>
            <ContextMenu
              open={menuOpen}
              items={menuItems}
              onClose={() => (menuOpen = false)}
            />
          </div>
        </div>
      {/if}
    </div>
  </header>

  <section class="tracks">
    {#if playlistQ.isPending}
      <div class="tracks-skeleton">
        {#each Array(8) as _}
          <div class="row-sk"></div>
        {/each}
      </div>
    {:else if tracks.length > 0}
      <SongList
        {tracks}
        contextType="playlist"
        contextId={playlistId}
        onPlay={loadTrack}
      />
    {:else if playlist}
      <p class="empty">Esta playlist está vacía.</p>
    {/if}
  </section>
</div>

<style>
  .playlist-detail { min-height: 100%; }

  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: var(--space-6);
    padding: var(--space-12) var(--space-6) var(--space-8);
    color: var(--hero-text-primary);
    transition: background var(--duration-normal) var(--ease-ios-default);
  }

  .hero-cover {
    /* CoverImage rellena el slot. Radius + sombra acá; shimmer/imagen
       los maneja CoverImage internamente. */
    position: relative;
    width: 232px;
    height: 232px;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-2xl);
    flex-shrink: 0;
  }
  .hero-playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
  }

  .hero-meta {
    min-width: 0;
    display: grid;
    gap: var(--space-2);
    color: var(--hero-text-primary);
  }
  .kicker {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--hero-text-secondary);
  }
  .title {
    font-size: var(--text-4xl);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
  }
  .owner {
    font-size: var(--text-base);
    font-weight: 600;
    margin: 0;
    color: var(--hero-text-primary);
  }
  .meta-line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--hero-text-tertiary);
  }

  .actions {
    margin-top: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .menu-anchor {
    position: relative;
    display: inline-flex;
  }

  .hero-skeleton { display: grid; gap: var(--space-3); }
  .sk {
    background: rgb(255 255 255 / 0.15);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .sk-1 { height: 48px; width: 60%; }
  .sk-2 { height: 20px; width: 40%; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  .tracks { padding: var(--space-2) var(--space-4) var(--space-12); }
  .tracks-skeleton { display: grid; gap: var(--space-2); padding: var(--space-3); }
  .row-sk {
    height: 48px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .empty, .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
  }
  .error { color: var(--hero-text-secondary); }

  @media (max-width: 768px) {
    .hero {
      grid-template-columns: 1fr;
      text-align: center;
      padding: var(--space-8) var(--space-4) var(--space-6);
      justify-items: center;
    }
    .hero-cover { width: 192px; height: 192px; }
    .hero-meta { justify-items: center; }
    .title { font-size: var(--text-3xl); }
    .actions { justify-content: center; }
  }
</style>
