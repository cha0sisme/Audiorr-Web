<script lang="ts">
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { User, DotsThree, Plus, ListPlus } from 'phosphor-svelte';
  import HeroPlayButton from '$components/shared/HeroPlayButton.svelte';
  import HeroCircleButton from '$components/shared/HeroCircleButton.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import NowPlayingIndicator from '$components/shared/NowPlayingIndicator.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import * as nav from '$services/NavidromeService';
  import {
    albumToCardProps,
    playlistToCardProps,
    similarArtistToCardProps,
    songToListItem,
    type SongListItem
  } from '$utils/navidrome-mappers';
  import { findPlaylistsByArtist } from '$utils/playlists-by-artist';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { theme } from '$stores/theme.svelte';
  import { cleanNotes } from '$utils/clean-notes';
  import {
    extractPalette,
    playButtonBg,
    heroBackgroundLayered,
    heroBackgroundFlat,
    HERO_PLACEHOLDER_PALETTE,
    type CoverPalette
  } from '$utils/palette';
  import type { NavidromeSimilarArtist } from '$types/navidrome';

  const artistId = $derived(page.params.id ?? '');

  const queryClient = useQueryClient();

  const artistQ = createQuery(() => ({
    queryKey: ['artist', artistId],
    queryFn: () => nav.getArtist(artistId),
    enabled: credentials.isConfigured && !!artistId
  }));

  const artist = $derived(artistQ.data);
  const albums = $derived(artist?.album ?? []);

  const artistInfoQ = createQuery(() => ({
    queryKey: ['artistInfo', artistId],
    queryFn: () => nav.getArtistInfo2(artistId, 20),
    enabled: credentials.isConfigured && !!artistId,
    retry: false,
    staleTime: 1000 * 60 * 60
  }));

  const topSongsQ = createQuery(() => ({
    queryKey: ['topSongs', artist?.name ?? ''],
    queryFn: () => nav.getTopSongs(artist!.name, 10),
    enabled: credentials.isConfigured && !!artist?.name,
    retry: false,
    staleTime: 1000 * 60 * 30
  }));

  // Playlists con este artista — SOLO Editorial o "This is …".
  // Aislada del resto de queries: nunca bloquea el render del hero/discografía
  // porque corre en su propio createQuery (Svelte Query maneja el loading state
  // independiente). Reusa el cache global de `['library', 'playlists']` cuando
  // existe (p. ej. el usuario navegó desde /library?tab=playlists) — eso evita
  // un round-trip a Navidrome y la query resuelve en milisegundos.
  const artistPlaylistsQ = createQuery(() => ({
    queryKey: ['artistPlaylists', artist?.name ?? ''],
    queryFn: async () => {
      const all = await queryClient.fetchQuery({
        queryKey: ['library', 'playlists'],
        queryFn: () => nav.getPlaylists(),
        staleTime: 5 * 60 * 1000
      });
      return findPlaylistsByArtist(artist!.name, all, (id) => nav.getPlaylist(id));
    },
    enabled: credentials.isConfigured && !!artist?.name,
    retry: false,
    // 15 min: editoriales y "This is …" cambian poco. Si el admin sube/quita
    // una editorial, en el peor caso el usuario la ve al cabo de 15 min o tras
    // refrescar la página.
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const artistPlaylists = $derived(artistPlaylistsQ.data ?? []);

  // 600: hero size mayor que las cards (300). El prefetch on hover de las
  // cards calienta el cache HTTP. Si artistImageUrl (Last.fm scrape) está
  // presente, es URL fija sin parámetro de tamaño — ya es la "hero version".
  const coverUrl = $derived(
    artist?.artistImageUrl && artist.artistImageUrl.length > 0
      ? artist.artistImageUrl
      : artist?.coverArt
        ? getCoverArtUrl(artist.coverArt, 600)
        : undefined
  );

  const fallbackHue = $derived(
    artist
      ? [...artist.name].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0) % 360
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

  // Placeholder neutral mientras carga (chroma ≈ 0) — evita flash de color
  // hasheado durante la View Transition card → detail.
  const heroBg = $derived.by(() => {
    if (!coverUrl) return heroBackgroundFlat(palette);
    if (paletteQ.data) return heroBackgroundLayered(palette);
    return heroBackgroundLayered(HERO_PLACEHOLDER_PALETTE);
  });

  const playBg = $derived(playButtonBg(palette, isDark));

  const isCurrentArtist = $derived(player.isPlayingFrom('artist', artistId));

  const initial = $derived(artist?.name?.charAt(0).toUpperCase() ?? '?');

  let showAllSongs = $state(false);
  const allTopSongs = $derived(topSongsQ.data ?? []);
  const visibleTopSongs = $derived(
    allTopSongs.slice(0, showAllSongs ? 10 : 5).map((s, i) => songToListItem(s, i, false, true))
  );
  const hasMoreThanFive = $derived(allTopSongs.length > 5);

  const albumsByYear = $derived(
    [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  );

  const similarArtists = $derived<NavidromeSimilarArtist[]>(
    (artistInfoQ.data?.similarArtist ?? []).filter((a) => a.id && a.id.length > 0)
  );

  const biography = $derived(cleanNotes(artistInfoQ.data?.biography));

  function loadTopSong(_track: SongListItem, index: number) {
    if (!artist || allTopSongs.length === 0) return;
    player.context = { type: 'artist', id: artist.id };
    queueManager.play(allTopSongs, index);
  }

  async function playArtist() {
    if (!artist) return;
    if (allTopSongs.length > 0) {
      player.context = { type: 'artist', id: artist.id };
      queueManager.play(allTopSongs, 0);
      return;
    }
    // Sin top songs: cargamos el primer álbum y disparamos su queue.
    const firstAlbum = albums[0];
    if (!firstAlbum) return;
    const alb = await nav.getAlbum(firstAlbum.id);
    const albumSongs = alb.song ?? [];
    if (albumSongs.length === 0) return;
    player.context = { type: 'artist', id: artist.id };
    queueManager.play(albumSongs, 0);
  }

  // Context menu (3-dots).
  let menuOpen = $state(false);
  const menuItems = $derived<ContextMenuItem[]>([
    {
      label: 'Añadir a continuación',
      icon: Plus,
      action: () => {
        if (allTopSongs.length > 0) queueManager.insertNextMany(allTopSongs);
      }
    },
    {
      label: 'Añadir a Playlist',
      icon: ListPlus,
      action: () => {
        // TODO: abrir picker de playlists
      }
    }
  ]);
</script>

<svelte:head>
  <title>{artist?.name ?? 'Artista'} · Audiorr</title>
</svelte:head>

<div class="artist-detail">
  <header class="hero" style:background={heroBg}>
    <div
      class="hero-avatar"
      style:view-transition-name={artistId ? `artist-${artistId}` : undefined}
    >
      {#if coverUrl}
        <CoverImage src={coverUrl} alt="" shape="circle" lazy={false} priority="high">
          {#snippet fallback()}
            <User size="100%" weight="regular" />
          {/snippet}
        </CoverImage>
      {:else}
        <span class="avatar-initial" aria-hidden="true">{initial}</span>
      {/if}

      {#if isCurrentArtist}
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
      {#if artistQ.isPending}
        <div class="hero-skeleton">
          <div class="sk sk-1"></div>
          <div class="sk sk-2"></div>
        </div>
      {:else if artistQ.isError}
        <p class="error">No se pudo cargar el artista.</p>
      {:else if artist}
        <p class="kicker">Artista</p>
        <h1 class="title">{artist.name}</h1>
        {#if albums.length > 0}
          <p class="meta-line">
            {albums.length}
            {albums.length === 1 ? 'álbum' : 'álbumes'}
          </p>
        {/if}

        <div class="actions">
          <HeroPlayButton
            bgColor={playBg}
            onclick={playArtist}
            disabled={albums.length === 0 && allTopSongs.length === 0}
          >
            Play
          </HeroPlayButton>
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

  <div class="sections">
    <!-- === Popular (top songs) === -->
    {#if topSongsQ.isPending}
      <section class="section">
        <header class="section-header">
          <h2 class="section-title">Popular</h2>
        </header>
        <div class="popular-skeleton">
          {#each Array(5) as _}
            <div class="row-sk-cover"></div>
          {/each}
        </div>
      </section>
    {:else if allTopSongs.length > 0}
      <section class="section">
        <header class="section-header">
          <h2 class="section-title">Popular</h2>
          {#if hasMoreThanFive}
            <button
              type="button"
              class="toggle-btn"
              onclick={() => (showAllSongs = !showAllSongs)}
            >
              {showAllSongs ? 'Mostrar menos' : 'Mostrar más'}
            </button>
          {/if}
        </header>
        {#key showAllSongs}
          <div class="popular-list">
            <SongList
              tracks={visibleTopSongs}
              contextType="artist"
              contextId={artistId}
              showCover
              onPlay={loadTopSong}
            />
          </div>
        {/key}
      </section>
    {/if}

    <!-- === Discografía === -->
    {#if albumsByYear.length > 0}
      <section class="section">
        <HorizontalScrollSection
          title="Discografía"
          items={albumsByYear}
          seeAllHref={`/artist/${artistId}/albums`}
        >
          {#snippet item(album)}
            {@const props = albumToCardProps(album)}
            <AlbumCard {...props} subtitleMode="year" />
          {/snippet}
        </HorizontalScrollSection>
      </section>
    {/if}

    <!-- === Playlists con {artist} ===
         SOLO Editorial o "This is …". "This is {artistName}" siempre primero.
         La query es aislada: si tarda no bloquea ninguna otra sección. La
         sección entera solo se monta cuando hay matches. Mientras pending y el
         resto del detail ya está visible, mostramos un skeleton breve. -->
    {#if artist}
      {#if artistPlaylistsQ.isPending}
        <section class="section">
          <header class="section-header">
            <h2 class="section-title">Playlists con {artist.name}</h2>
          </header>
          <div class="card-row-skeleton" aria-hidden="true">
            {#each Array(4) as _}
              <div class="card-sk"></div>
            {/each}
          </div>
        </section>
      {:else if artistPlaylists.length > 0}
        <section class="section">
          <HorizontalScrollSection
            title={`Playlists con ${artist.name}`}
            items={artistPlaylists}
            seeAllHref={`/artist/${artistId}/playlists`}
          >
            {#snippet item(p)}
              {@const props = playlistToCardProps(p)}
              <PlaylistCard {...props} />
            {/snippet}
          </HorizontalScrollSection>
        </section>
      {/if}
    {/if}

    <!--
      TODO: "Appears in" (collabs). Subsonic no expone un endpoint directo
      para "álbumes donde el artista aparece pero no es albumArtist". El iOS
      lo arma con el plugin custom `getAlbumsAppearedOn` del backend, que aún
      no expusimos en el web. Omitido por ahora — añadir cuando portemos
      backendService.appearsOn(artistId).
    -->

    <!-- === Fans también escuchan === -->
    {#if similarArtists.length > 0}
      <section class="section">
        <HorizontalScrollSection
          title="Fans también escuchan"
          items={similarArtists}
          itemMinWidth={140}
          seeAllShape="round"
          seeAllHref={`/artist/${artistId}/similar`}
        >
          {#snippet item(sa)}
            {@const props = similarArtistToCardProps(sa)}
            <ArtistCard {...props} />
          {/snippet}
        </HorizontalScrollSection>
      </section>
    {/if}

    <!-- === About === -->
    {#if artistInfoQ.isPending}
      <section class="about-card about-loading" aria-busy="true">
        <div class="about-skeleton-title"></div>
        <div class="about-skeleton-line"></div>
        <div class="about-skeleton-line"></div>
        <div class="about-skeleton-line"></div>
        <div class="about-skeleton-line short"></div>
      </section>
    {:else if biography && artist}
      <section class="about-card">
        <h2 class="about-title">Sobre {artist.name}</h2>
        <p class="about-body">{biography}</p>
      </section>
    {/if}
  </div>

  <div class="bottom-spacer" aria-hidden="true"></div>
</div>

<style>
  .artist-detail {
    min-height: 100%;
  }

  /* === Hero (layout side-by-side, avatar izquierda + meta derecha) === */
  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: var(--space-6);
    padding: var(--space-12) var(--space-6) var(--space-8);
    color: var(--hero-text-primary);
    transition: background var(--duration-normal) var(--ease-ios-default);
  }

  .hero-avatar {
    position: relative;
    width: 200px;
    height: 200px;
    border-radius: var(--radius-full);
    overflow: hidden;
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.45);
    flex-shrink: 0;
    background: rgb(255 255 255 / 0.18);
    display: grid;
    place-items: center;
    color: #fff;
  }
  .avatar-initial {
    font-size: 80px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    user-select: none;
  }
  .hero-playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    border-radius: inherit;
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
    margin: 0;
  }
  .title {
    font-size: var(--text-4xl);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    color: var(--hero-text-primary);
  }
  .meta-line {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--hero-text-secondary);
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

  .hero-skeleton {
    display: grid;
    gap: var(--space-3);
  }
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

  /* === Sections === */
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    padding-top: var(--space-2);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 0 var(--space-6);
  }
  .section-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    line-height: 1.2;
  }
  .toggle-btn {
    background: none;
    border: none;
    padding: var(--space-1) var(--space-2);
    margin: 0;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .toggle-btn:hover {
    color: var(--text-primary);
  }
  .toggle-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .popular-list {
    padding: 0 var(--space-4);
  }
  .popular-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-4);
  }
  .row-sk-cover {
    height: 56px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }

  /* Skeleton de carruseles tipo card-row (mismo paddings y altura aproximada
     que HorizontalScrollSection con cards 180px). */
  .card-row-skeleton {
    display: flex;
    gap: var(--space-4);
    padding: 0 var(--space-6);
    overflow: hidden;
  }
  .card-sk {
    flex: 0 0 180px;
    aspect-ratio: 1;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .about-card {
    margin: 0 var(--space-4);
    padding: var(--space-6);
    border-radius: var(--radius-2xl);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
  }
  .about-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .about-body {
    margin: 0;
    max-width: none; /* Override del reset (65ch) — queremos full-width del card. */
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre-wrap;
  }
  .about-loading { display: grid; gap: var(--space-3); }
  .about-skeleton-title {
    height: 22px;
    width: 220px;
    background: var(--bg-surface-hover);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .about-skeleton-line {
    height: 14px;
    background: var(--bg-surface-hover);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .about-skeleton-line.short { width: 60%; }

  .bottom-spacer { height: 120px; }

  .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--hero-text-secondary);
  }

  @media (max-width: 768px) {
    .hero {
      grid-template-columns: 1fr;
      text-align: center;
      padding: var(--space-8) var(--space-4) var(--space-6);
      justify-items: center;
    }
    .hero-avatar {
      width: 160px;
      height: 160px;
    }
    .avatar-initial {
      font-size: 64px;
    }
    .hero-meta { justify-items: center; }
    .title { font-size: var(--text-3xl); }
    .actions { justify-content: center; }
    .section-header { padding: 0 var(--space-4); }
    .popular-list { padding: 0 var(--space-3); }
    .card-row-skeleton { padding: 0 var(--space-4); }
    .about-card { padding: var(--space-5); }
  }
</style>
