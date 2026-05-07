<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { MusicNote, Shuffle, DotsThree, Plus, ListPlus, User } from 'phosphor-svelte';
  import HeroPlayButton from '$components/shared/HeroPlayButton.svelte';
  import HeroCircleButton from '$components/shared/HeroCircleButton.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import NowPlayingIndicator from '$components/shared/NowPlayingIndicator.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import Marquee from '$components/shared/Marquee.svelte';
  import * as nav from '$services/NavidromeService';
  import { songToListItem, type SongListItem } from '$utils/navidrome-mappers';
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

  const albumId = $derived(page.params.id ?? '');

  const albumQ = createQuery(() => ({
    queryKey: ['album', albumId],
    queryFn: () => nav.getAlbum(albumId),
    enabled: credentials.isConfigured && !!albumId
  }));

  // Notas Last.fm — carga independiente, falla silenciosa si el server no
  // tiene plugin. El bloque About queda omitido si no hay notes.
  const albumInfoQ = createQuery(() => ({
    queryKey: ['albumInfo', albumId],
    queryFn: () => nav.getAlbumInfo2(albumId),
    enabled: credentials.isConfigured && !!albumId,
    retry: false,
    staleTime: 1000 * 60 * 60
  }));

  const album = $derived(albumQ.data);
  const songs = $derived(album?.song ?? []);

  // 600: hero size mayor que las cards (300). El prefetch on hover de las
  // cards calienta el cache HTTP de esta URL antes del click → la View
  // Transition card→detail no parpadea. Si llega aquí sin hover (e.g.
  // teclado, navegación directa), CoverImage muestra skeleton ~200 ms.
  const coverUrl = $derived(album?.coverArt ? getCoverArtUrl(album.coverArt, 600) : undefined);

  const fallbackHue = $derived(
    album
      ? [...(album.name + (album.artist ?? ''))]
          .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0) % 360
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

  // Mientras Vibrant extrae la paleta, usamos HERO_PLACEHOLDER_PALETTE
  // (chroma ≈ 0) en la MISMA recipe layered. Evita el "flash" de un color
  // hasheado del nombre durante la View Transition card → detail. Cuando
  // llega la paleta real, solo cambia el chroma del gradient (no la
  // estructura) — algunos browsers interpolan smooth, otros snap.
  const heroBg = $derived.by(() => {
    if (!coverUrl) return heroBackgroundFlat(palette);
    if (paletteQ.data) return heroBackgroundLayered(palette);
    return heroBackgroundLayered(HERO_PLACEHOLDER_PALETTE);
  });

  const isDark = $derived(theme.current === 'dark');
  const playBg = $derived(playButtonBg(palette, isDark));

  const tracks = $derived(songs.map((s, i) => songToListItem(s, i, false)));

  const notes = $derived(cleanNotes(albumInfoQ.data?.notes));

  const recordLabels = $derived(album?.recordLabels?.map((l) => l.name).join(', ') ?? '');
  const copyrightYear = $derived(album?.year ?? new Date().getFullYear());

  const isExplicit = $derived(
    album?.explicitStatus === 'explicit' ||
      songs.some((s) => s.explicitStatus === 'explicit')
  );

  const isCurrentAlbum = $derived(player.isPlayingFrom('album', albumId));

  function loadTrack(_track: SongListItem, index: number) {
    if (!album) return;
    // Cargamos TODAS las canciones del álbum a la queue, arrancando en `index`.
    // El context queda como 'album' para que cards/listas pinten el indicator.
    player.context = { type: 'album', id: album.id };
    queueManager.play(songs, index);
  }

  function playAll() {
    if (!album || tracks.length === 0) return;
    player.context = { type: 'album', id: album.id };
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    queueManager.play(songs, 0);
  }

  function shuffleAll() {
    if (!album || tracks.length === 0) return;
    player.context = { type: 'album', id: album.id };
    if (!queueManager.shuffleMode) queueManager.toggleShuffle();
    // play() reaplica shuffle si está activo, pinneando startIndex=0.
    queueManager.play(songs, 0);
  }

  // Context menu (3-dots).
  let menuOpen = $state(false);

  // Items del menú. "Ver artista" solo si tenemos artistId — sin id no
  // podemos navegar y el item sería un dead-end.
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
        // TODO: abrir picker de playlists
      }
    },
    ...(album?.artistId
      ? [
          { divider: true } as const,
          {
            label: 'Ver artista',
            icon: User,
            action: () => {
              if (album?.artistId) goto(`/artist/${album.artistId}`);
            }
          }
        ]
      : [])
  ]);
</script>

<svelte:head>
  <title>{album?.name ?? 'Álbum'} · Audiorr</title>
</svelte:head>

<div class="album-detail">
  <header class="hero" style:background={heroBg}>
    <div
      class="hero-cover"
      style:view-transition-name={albumId ? `album-${albumId}` : undefined}
    >
      <CoverImage src={coverUrl} alt="" lazy={false} priority="high">
        {#snippet fallback()}
          <MusicNote size="100%" weight="regular" />
        {/snippet}
      </CoverImage>

      {#if isCurrentAlbum}
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
      {#if albumQ.isPending}
        <div class="hero-skeleton">
          <div class="sk sk-1"></div>
          <div class="sk sk-2"></div>
        </div>
      {:else if albumQ.isError}
        <p class="error">No se pudo cargar el álbum.</p>
      {:else if album}
        <p class="kicker">Álbum</p>
        <h1 class="title">
          <span class="title-name">{album.name}</span>
          {#if isExplicit}
            <ExplicitBadge size="22px" onArt />
          {/if}
        </h1>

        <p class="meta-line">
          {#if album.artist}
            {#if album.artistId}
              <a class="meta-link" href={`/artist/${album.artistId}`}>{album.artist}</a>
            {:else}
              {album.artist}
            {/if}
          {/if}
          {#if album.year}
            {#if album.artist}<span class="meta-sep">·</span>{/if}{album.year}
          {/if}
          {#if album.genre}
            {#if album.artist || album.year}<span class="meta-sep">·</span>{/if}{album.genre}
          {/if}
        </p>

        <div class="actions">
          <HeroPlayButton
            bgColor={playBg}
            onclick={playAll}
            disabled={tracks.length === 0}
          >
            Play
          </HeroPlayButton>
          <HeroCircleButton
            bgColor={playBg}
            onclick={shuffleAll}
            disabled={tracks.length === 0}
            aria-label="Shuffle"
          >
            <Shuffle size={15} weight="bold" />
          </HeroCircleButton>
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
    {#if albumQ.isPending}
      <div class="tracks-skeleton">
        {#each Array(Math.max(album?.songCount ?? 0, 8)) as _}
          <div class="row-sk"></div>
        {/each}
      </div>
    {:else if tracks.length > 0}
      <SongList
        {tracks}
        contextType="album"
        contextId={albumId}
        onPlay={loadTrack}
      />
    {:else if album}
      <p class="empty">Este álbum no tiene canciones disponibles.</p>
    {/if}
  </section>

  {#if recordLabels}
    <div class="record-label">
      <Marquee>
        © {copyrightYear} {recordLabels}
      </Marquee>
    </div>
  {/if}

  {#if albumInfoQ.isPending}
    <section class="about-card about-loading" aria-busy="true">
      <div class="about-skeleton-title"></div>
      <div class="about-skeleton-line"></div>
      <div class="about-skeleton-line"></div>
      <div class="about-skeleton-line"></div>
      <div class="about-skeleton-line short"></div>
    </section>
  {:else if notes && album}
    <section class="about-card">
      <h2 class="about-title">Sobre {album.name}</h2>
      <p class="about-body">{notes}</p>
    </section>
  {/if}

  <div class="bottom-spacer" aria-hidden="true"></div>
</div>

<style>
  .album-detail {
    min-height: 100%;
  }

  /* === Hero (layout side-by-side, cover izquierda + meta derecha) === */
  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: var(--space-6);
    padding: var(--space-12) var(--space-6) var(--space-8);
    color: var(--hero-text-primary);
    /* Suaviza el swap de bg cuando la paleta resuelve (placeholder → real).
       Browsers modernos interpolan gradients del mismo type; el resto
       hace snap pero la transición sigue siendo de "neutro a color"
       en lugar de "color falso → color real". */
    transition: background var(--duration-normal) var(--ease-ios-default);
  }

  .hero-cover {
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
    margin: 0;
  }
  .title {
    font-size: var(--text-4xl);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    color: var(--hero-text-primary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .title-name {
    display: inline;
  }

  .meta-line {
    margin: 0;
    max-width: none;
    font-size: var(--text-sm);
    color: var(--hero-text-secondary);
    font-weight: 500;
  }
  .meta-sep {
    margin: 0 0.4em;
    opacity: 0.7;
  }
  /* El artista es link, pero queremos que se vea como el resto de la línea —
     sin underline, sin color de link. Hover sutil para indicar interactividad
     sin romper la jerarquía visual. */
  .meta-link {
    color: inherit;
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .meta-link:hover {
    color: var(--hero-text-primary);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .meta-link:focus-visible {
    outline: none;
    text-decoration: underline;
    text-underline-offset: 3px;
    color: var(--hero-text-primary);
  }

  .actions {
    margin-top: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  /* Wrapper relativo para anclar el ContextMenu al dots-button. */
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

  .tracks {
    padding: var(--space-2) var(--space-4) var(--space-2);
  }
  .tracks-skeleton {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .row-sk {
    height: 48px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }

  /* Wrapper del Marquee. Si el contenido cabe en una línea, se ve plano;
     si excede, Marquee lo scrollea con pause-on-hover. Antes usábamos
     -webkit-line-clamp: 2 para truncar; ahora preferimos mostrar todo el
     credit con scroll horizontal continuo (más respetuoso con la cita). */
  .record-label {
    margin: var(--space-4) 0 0;
    padding: 0 var(--space-4);
    font-size: var(--text-xs);
    color: var(--text-quaternary);
  }

  .about-card {
    margin: var(--space-5) var(--space-4) 0;
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

  .empty,
  .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
  }
  .error { color: var(--hero-text-secondary); }

  /* En móvil colapsamos a layout vertical centrado (caso degradado del
     side-by-side) — el cover ya no cabe al lado de la meta sin recortar
     gravemente el título. */
  @media (max-width: 768px) {
    .hero {
      grid-template-columns: 1fr;
      text-align: center;
      padding: var(--space-8) var(--space-4) var(--space-6);
      justify-items: center;
    }
    .hero-cover { width: 192px; height: 192px; }
    .hero-meta { justify-items: center; }
    .title {
      font-size: var(--text-3xl);
      justify-content: center;
    }
    .actions { justify-content: center; }
    .about-card {
      margin-left: var(--space-4);
      margin-right: var(--space-4);
      padding: var(--space-5);
    }
    .record-label {
      padding: 0 var(--space-4);
    }
  }
</style>
