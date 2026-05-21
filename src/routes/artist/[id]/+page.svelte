<script lang="ts">
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { User, DotsThree, Plus, ListPlus, Shuffle, Pause } from 'phosphor-svelte';
  import HeroPlayButton from '$components/shared/HeroPlayButton.svelte';
  import HeroCircleButton from '$components/shared/HeroCircleButton.svelte';
  import SmartMixButton from '$components/shared/SmartMixButton.svelte';
  import { smartMixManager } from '$services/SmartMixManager.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import ImageLightbox from '$components/shared/ImageLightbox.svelte';
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
    isGifUrl,
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

  // "Aparece en" — álbumes donde el artista colabora (no es el albumArtist).
  // search3(name, songCount=500) → filtro por song.artists[].id === artistId
  // (OpenSubsonic ext, captura feats canción-a-canción), dedupe por albumId,
  // restamos los principales (getArtist().album), resolve via getAlbum.
  // Aislada como query independiente — no bloquea hero ni discografía.
  const collaborationsQ = createQuery(() => ({
    queryKey: ['artistCollaborations', artistId],
    queryFn: () =>
      nav.getArtistCollaborations(
        artistId,
        artist!.name,
        new Set(albums.map((a) => a.id))
      ),
    enabled: credentials.isConfigured && !!artist,
    retry: false,
    // Las collabs son derivadas del catálogo Navidrome — cambian poco.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000
  }));
  const collaborations = $derived(collaborationsQ.data ?? []);

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

  const paletteQ = createQuery(() => ({
    queryKey: ['palette', coverUrl ?? ''],
    queryFn: () => extractPalette(coverUrl!),
    enabled: !!coverUrl,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false
  }));

  // Fallback NEUTRO (no hasheado): si Vibrant aún no ha resuelto o ha fallado
  // (CORS, network, swatch nulo), usamos HERO_PLACEHOLDER_PALETTE (chroma ≈ 0)
  // → hero gris/neutro acorde con la UI. Cuando llegue la paleta real, el
  // chroma se anima del placeholder al accent extraído.
  const palette = $derived<CoverPalette>(paletteQ.data ?? HERO_PLACEHOLDER_PALETTE);

  const isDark = $derived(theme.current === 'dark');

  // GIF detection — cuando el avatar es un GIF (típico de Last.fm artist
  // images animadas), simplificamos el hero a un flat fill. El gradiente
  // diagonal layered + GIF en movimiento compiten visualmente; con flat
  // el GIF queda como protagonista único.
  const isGifAvatar = $derived(isGifUrl(coverUrl));
  const heroBg = $derived(
    !coverUrl || isGifAvatar ? heroBackgroundFlat(palette) : heroBackgroundLayered(palette)
  );

  const playBg = $derived(playButtonBg(palette, isDark));

  const isCurrentArtist = $derived(player.isPlayingFrom('artist', artistId));

  const initial = $derived(artist?.name?.charAt(0).toUpperCase() ?? '?');

  // Lightbox state — avatar clickeable abre el visor fullscreen.
  let lightboxOpen = $state(false);

  let showAllSongs = $state(false);
  const allTopSongs = $derived(topSongsQ.data ?? []);
  const visibleTopSongs = $derived(
    allTopSongs.slice(0, showAllSongs ? 10 : 5).map((s, i) => songToListItem(s, i, false, true))
  );
  const hasMoreThanFive = $derived(allTopSongs.length > 5);

  const albumsByYear = $derived(
    [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
  );

  // Similar artists: solo los que existen en la biblioteca (id presente Y
  // albumCount > 0). Sin esa garantía el card lleva al usuario a una vista
  // vacía. iOS no muestra similares "fantasma" tampoco.
  const similarArtists = $derived<NavidromeSimilarArtist[]>(
    (artistInfoQ.data?.similarArtist ?? []).filter(
      (a) => a.id && a.id.length > 0 && (a.albumCount ?? 0) > 0
    )
  );

  const biography = $derived(cleanNotes(artistInfoQ.data?.biography));

  // Bio toggle (estilo iOS): por defecto una sola línea con ellipsis,
  // clic en el párrafo lo expande a full text inline.
  let bioExpanded = $state(false);

  // Estados reactivos de los botones del hero (paridad con AlbumDetail /
  // PlaylistDetail).
  const isPlayingNormalHere = $derived(
    isCurrentArtist &&
      !player.isSmartMixContext(artistId) &&
      !queueManager.shuffleMode &&
      player.isPlaying
  );
  const isPlayingShuffleHere = $derived(
    isCurrentArtist &&
      !player.isSmartMixContext(artistId) &&
      queueManager.shuffleMode &&
      player.isPlaying
  );

  // Pasamos `contextUri` formal a queueManager.play para que se persista
  // en lastPlayback y se restaure correctamente (ver nota en AlbumDetail).

  function loadTopSong(_track: SongListItem, index: number) {
    if (!artist || allTopSongs.length === 0) return;
    // Click en row específica = play normal (paridad Apple Music).
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    player.context = { type: 'artist', id: artist.id };
    queueManager.play(allTopSongs, index, { contextUri: `artist:${artist.id}` });
  }

  async function playArtist() {
    if (!artist) return;
    if (isPlayingNormalHere) {
      player.toggle();
      return;
    }
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    const ctxUri = `artist:${artist.id}`;
    if (allTopSongs.length > 0) {
      player.context = { type: 'artist', id: artist.id };
      queueManager.play(allTopSongs, 0, { contextUri: ctxUri });
      return;
    }
    // Sin top songs: cargamos el primer álbum y disparamos su queue.
    const firstAlbum = albums[0];
    if (!firstAlbum) return;
    const alb = await nav.getAlbum(firstAlbum.id);
    const albumSongs = alb.song ?? [];
    if (albumSongs.length === 0) return;
    player.context = { type: 'artist', id: artist.id };
    queueManager.play(albumSongs, 0, { contextUri: ctxUri });
  }

  async function shuffleArtist() {
    if (!artist) return;
    if (isPlayingShuffleHere) {
      player.toggle();
      return;
    }
    if (!queueManager.shuffleMode) queueManager.toggleShuffle();
    const ctxUri = `artist:${artist.id}`;
    if (allTopSongs.length > 0) {
      player.context = { type: 'artist', id: artist.id };
      queueManager.play(allTopSongs, 0, { contextUri: ctxUri });
      return;
    }
    const firstAlbum = albums[0];
    if (!firstAlbum) return;
    const alb = await nav.getAlbum(firstAlbum.id);
    const albumSongs = alb.song ?? [];
    if (albumSongs.length === 0) return;
    player.context = { type: 'artist', id: artist.id };
    queueManager.play(albumSongs, 0, { contextUri: ctxUri });
  }

  // ─── SmartMix hand-off ─────────────────────────────────────────────────
  // Para artist usamos top songs como tracks del SmartMix (mejor señal que
  // primer álbum: top songs = lo que el listener realmente conoce).
  const smartMixSongs = $derived(allTopSongs);
  const smartMixReady = $derived(
    smartMixManager.playlistId === artistId && smartMixManager.status === 'ready'
  );
  const isSmartMixContext = $derived(player.isSmartMixContext(artistId));
  const collapsePlay = $derived(smartMixReady || isSmartMixContext);

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
  <header class="hero" style:--hero-bg={heroBg}>
    {#if coverUrl}
      <button
        type="button"
        class="hero-avatar hero-avatar-btn"
        style:view-transition-name={artistId ? `artist-${artistId}` : undefined}
        onclick={() => (lightboxOpen = true)}
        aria-label={artist ? `Ampliar foto de ${artist.name}` : 'Ampliar foto'}
      >
        <CoverImage src={coverUrl} alt="" shape="circle" lazy={false} priority="high">
          {#snippet fallback()}
            <User size="100%" weight="regular" />
          {/snippet}
        </CoverImage>
      </button>
    {:else}
      <div
        class="hero-avatar"
        style:view-transition-name={artistId ? `artist-${artistId}` : undefined}
      >
        <span class="avatar-initial" aria-hidden="true">{initial}</span>
      </div>
    {/if}

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
            {albums.length} {albums.length === 1 ? 'álbum' : 'álbumes'}
          </p>
        {/if}

        {#if artistInfoQ.isPending}
          <p class="bio-line bio-skeleton" aria-busy="true"></p>
        {:else if biography}
          <button
            type="button"
            class="bio-line"
            class:bio-expanded={bioExpanded}
            onclick={() => (bioExpanded = !bioExpanded)}
            aria-expanded={bioExpanded}
          >{biography}</button>
        {/if}

        <div class="actions">
          <HeroPlayButton
            bgColor={playBg}
            onclick={playArtist}
            disabled={albums.length === 0 && allTopSongs.length === 0}
            collapsed={collapsePlay}
            isActive={isPlayingNormalHere}
          />
          <HeroCircleButton
            bgColor={playBg}
            onclick={shuffleArtist}
            disabled={albums.length === 0 && allTopSongs.length === 0}
            aria-label={isPlayingShuffleHere ? 'Pausar' : 'Shuffle'}
          >
            {#if isPlayingShuffleHere}
              <Pause size={15} weight="fill" />
            {:else}
              <Shuffle size={15} weight="bold" />
            {/if}
          </HeroCircleButton>
          <SmartMixButton
            bgColor={playBg}
            playlistId={artistId}
            songs={smartMixSongs}
            disabled={smartMixSongs.length === 0}
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

    <!-- === Aparece en === Álbumes donde el artista colabora (feat./&) y no
         es el albumArtist principal. Mismo patrón aislado que la sección
         "Playlists con {artist}" — query independiente. -->
    {#if collaborations.length > 0 && artist}
      <section class="section">
        <HorizontalScrollSection
          title={`Aparece en`}
          items={collaborations}
          seeAllHref={`/artist/${artistId}/appears-in`}
        >
          {#snippet item(album)}
            {@const props = albumToCardProps(album)}
            <AlbumCard {...props} />
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

  </div>

  <div class="bottom-spacer" aria-hidden="true"></div>
</div>

{#if lightboxOpen && coverUrl}
  <ImageLightbox
    src={coverUrl}
    alt={artist?.name ?? ''}
    shape="circle"
    onClose={() => (lightboxOpen = false)}
  />
{/if}

<style>
  .artist-detail {
    min-height: 100%;
  }

  /* === Hero (layout side-by-side, avatar izquierda + meta derecha) === */
  .hero {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: var(--space-6);
    padding: var(--space-12) var(--space-6) var(--space-8);
    color: var(--hero-text-primary);
  }
  /* Backdrop con mask ease-out — el hero se desvanece sobre `--bg-canvas`
     en su tercio inferior sin banding (la mask interpola alpha pura). */
  .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--hero-bg);
    -webkit-mask-image: var(--hero-backdrop-mask);
    mask-image: var(--hero-backdrop-mask);
    z-index: -1;
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
  /* Variante <button> cuando el avatar es clickable (abre lightbox).
     Reset del chrome de button + cursor zoom-in + hover scale sutil
     (paridad Apple Music). */
  .hero-avatar-btn {
    border: none;
    padding: 0;
    cursor: zoom-in;
    transition: transform var(--duration-fast) var(--ease-ios-default);
  }
  .hero-avatar-btn:hover {
    transform: scale(1.025);
  }
  .hero-avatar-btn:active {
    transform: scale(0.98);
    transition-duration: var(--duration-instant);
  }
  .hero-avatar-btn:focus-visible {
    outline: none;
    box-shadow:
      0 8px 20px rgb(0 0 0 / 0.45),
      0 0 0 3px rgb(255 255 255 / 0.6);
  }
  .avatar-initial {
    font-size: 80px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    user-select: none;
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

  /* Bio inline en el hero estilo iOS: 1 línea truncada con ellipsis, clic
     expande a full text. */
  .bio-line {
    appearance: none;
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    color: var(--hero-text-secondary);
    font-size: var(--text-sm);
    line-height: 1.5;
    max-width: 100%;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    overflow: hidden;
    transition: color var(--duration-fast) var(--ease-ios-default);
    white-space: pre-wrap;
  }
  .bio-line:hover { color: var(--hero-text-primary); }
  .bio-line:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
  .bio-expanded {
    -webkit-line-clamp: unset;
    line-clamp: unset;
    display: block;
  }
  .bio-skeleton {
    width: min(420px, 80%);
    height: 14px;
    background: rgb(255 255 255 / 0.12);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
    cursor: default;
  }

  /* Meta-line del hero (count de álbumes). Mismo lenguaje visual que la
     meta-line de PlaylistDetail ("X canciones · Y h Z min") — tipografía
     pequeña, color hero-text-tertiary, sin margen propio (el gap del
     .hero-meta grid se encarga). */
  .meta-line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--hero-text-tertiary);
  }

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
    .bio-line { text-align: center; }
  }
</style>
