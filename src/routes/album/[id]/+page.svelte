<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { MusicNote, Shuffle, Pause, DotsThree, Plus, ListPlus, User } from 'phosphor-svelte';
  import HeroPlayButton from '$components/shared/HeroPlayButton.svelte';
  import HeroCircleButton from '$components/shared/HeroCircleButton.svelte';
  import SmartMixButton from '$components/shared/SmartMixButton.svelte';
  import { smartMixManager } from '$services/SmartMixManager.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import ImageLightbox from '$components/shared/ImageLightbox.svelte';
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
    isGifUrl,
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

  // GIF detection: covers GIF (raros pero posibles si un usuario sube uno
  // animado) hacen del hero un escenario visual ruidoso si combinamos
  // gradiente diagonal + animación. Con GIF → flat fill, el GIF protagonista.
  const isGifCover = $derived(isGifUrl(coverUrl));
  const heroBg = $derived(
    !coverUrl || isGifCover ? heroBackgroundFlat(palette) : heroBackgroundLayered(palette)
  );

  const isDark = $derived(theme.current === 'dark');
  const playBg = $derived(playButtonBg(palette, isDark));

  // Lightbox state — cover clickeable abre el visor fullscreen.
  let lightboxOpen = $state(false);

  const tracks = $derived(songs.map((s, i) => songToListItem(s, i, false)));

  const notes = $derived(cleanNotes(albumInfoQ.data?.notes));

  // Bio toggle (estilo iOS): por defecto una sola línea con ellipsis,
  // clic en el párrafo lo expande a full text inline.
  let bioExpanded = $state(false);

  const totalDurationSec = $derived(songs.reduce((sum, s) => sum + (s.duration ?? 0), 0));
  const totalDurationFormatted = $derived.by(() => {
    const totalMin = Math.floor(totalDurationSec / 60);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h} h ${m} min`;
  });

  const recordLabels = $derived(album?.recordLabels?.map((l) => l.name).join(', ') ?? '');
  const copyrightYear = $derived(album?.year ?? new Date().getFullYear());

  const isExplicit = $derived(
    album?.explicitStatus === 'explicit' ||
      songs.some((s) => s.explicitStatus === 'explicit')
  );

  const isCurrentAlbum = $derived(player.isPlayingFrom('album', albumId));

  // Estados reactivos de los botones del hero. Cada botón refleja UN modo
  // específico de playback "desde este álbum" — paridad Apple Music:
  //   - Reproducir activo ↔ playback aquí en modo normal (no shuffle, no SM)
  //   - Shuffle activo    ↔ playback aquí con shuffle on (no SM)
  //   - SmartMix activo   ↔ ya gestionado por SmartMixButton internamente
  const isPlayingNormalHere = $derived(
    isCurrentAlbum &&
      !player.isSmartMixContext(albumId) &&
      !queueManager.shuffleMode &&
      player.isPlaying
  );
  const isPlayingShuffleHere = $derived(
    isCurrentAlbum &&
      !player.isSmartMixContext(albumId) &&
      queueManager.shuffleMode &&
      player.isPlaying
  );

  // Nota sobre `contextUri`: lo pasamos formal a queueManager.play (en vez
  // de solo setear player.context). Esto permite que se persista en
  // lastPlayback y que tras un restore el player.context se reconstruya
  // correctamente — sin esto, cards/heroes perdían el EQ icon y los botones
  // Reproducir no mostraban Pause al recuperar sesión.

  function loadTrack(_track: SongListItem, index: number) {
    if (!album) return;
    // Click en row específica = play normal sin shuffle (paridad Apple Music:
    // la canción elegida arranca y la queue sigue en orden secuencial).
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    player.context = { type: 'album', id: album.id };
    queueManager.play(songs, index, { contextUri: `album:${album.id}` });
  }

  function playAll() {
    if (!album || tracks.length === 0) return;
    // Toggle si ya está sonando este modo aquí — Reproducir actúa como
    // play/pause cuando es el modo activo del contexto actual.
    if (isPlayingNormalHere) {
      player.toggle();
      return;
    }
    player.context = { type: 'album', id: album.id };
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    queueManager.play(songs, 0, { contextUri: `album:${album.id}` });
  }

  function shuffleAll() {
    if (!album || tracks.length === 0) return;
    if (isPlayingShuffleHere) {
      player.toggle();
      return;
    }
    player.context = { type: 'album', id: album.id };
    if (!queueManager.shuffleMode) queueManager.toggleShuffle();
    // play() reaplica shuffle si está activo, pinneando startIndex=0.
    queueManager.play(songs, 0, { contextUri: `album:${album.id}` });
  }

  // ─── SmartMix hand-off (mirror iOS PlaylistDetailView lines 420-475) ───
  // Cuando el SmartMix de este album está `ready` o ya está sonando como
  // contexto activo, el botón Play colapsa a círculo y SmartMix expande a
  // cápsula — clean visual hand-off de la prominencia.
  const smartMixReady = $derived(
    smartMixManager.playlistId === albumId && smartMixManager.status === 'ready'
  );
  const isSmartMixContext = $derived(player.isSmartMixContext(albumId));
  const collapsePlay = $derived(smartMixReady || isSmartMixContext);

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
  <header class="hero" style:--hero-bg={heroBg}>
    {#if coverUrl}
      <button
        type="button"
        class="hero-cover hero-cover-btn"
        style:view-transition-name={albumId ? `album-${albumId}` : undefined}
        onclick={() => (lightboxOpen = true)}
        aria-label={album ? `Ampliar portada de ${album.name}` : 'Ampliar portada'}
      >
        <CoverImage src={coverUrl} alt="" lazy={false} priority="high">
          {#snippet fallback()}
            <MusicNote size="100%" weight="regular" />
          {/snippet}
        </CoverImage>
      </button>
    {:else}
      <div
        class="hero-cover"
        style:view-transition-name={albumId ? `album-${albumId}` : undefined}
      >
        <CoverImage src={coverUrl} alt="" lazy={false} priority="high">
          {#snippet fallback()}
            <MusicNote size="100%" weight="regular" />
          {/snippet}
        </CoverImage>
      </div>
    {/if}

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
            {#if album.artist || album.year}<span class="meta-sep">·</span>{/if}<a
              class="meta-link"
              href={`/genre/${encodeURIComponent(album.genre)}`}
            >{album.genre}</a>
          {/if}
        </p>

        {#if albumInfoQ.isPending}
          <p class="bio-line bio-skeleton" aria-busy="true"></p>
        {:else if notes}
          <button
            type="button"
            class="bio-line"
            class:bio-expanded={bioExpanded}
            onclick={() => (bioExpanded = !bioExpanded)}
            aria-expanded={bioExpanded}
          >{notes}</button>
        {/if}

        <div class="actions">
          <HeroPlayButton
            bgColor={playBg}
            onclick={playAll}
            disabled={tracks.length === 0}
            collapsed={collapsePlay}
            isActive={isPlayingNormalHere}
          />
          <HeroCircleButton
            bgColor={playBg}
            onclick={shuffleAll}
            disabled={tracks.length === 0}
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
            playlistId={albumId}
            {songs}
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

  {#if album && tracks.length > 0}
    <p class="end-meta">
      {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'} · {totalDurationFormatted}
    </p>
  {/if}

  {#if recordLabels}
    <div class="record-label">
      <Marquee>
        © {copyrightYear} {recordLabels}
      </Marquee>
    </div>
  {/if}

  <div class="bottom-spacer" aria-hidden="true"></div>
</div>

{#if lightboxOpen && coverUrl}
  <ImageLightbox
    src={coverUrl}
    alt={album?.name ?? ''}
    onClose={() => (lightboxOpen = false)}
  />
{/if}

<style>
  .album-detail {
    min-height: 100%;
  }

  /* === Hero (layout side-by-side, cover izquierda + meta derecha) === */
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
    /* Suaviza el swap de bg cuando la paleta resuelve (placeholder → real). */
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
  /* Variante <button> cuando el cover es clickable (abre lightbox). Reset
     del chrome de button + cursor zoom-in + hover scale sutil. */
  .hero-cover-btn {
    border: none;
    padding: 0;
    background: transparent;
    cursor: zoom-in;
    transition: transform var(--duration-fast) var(--ease-ios-default);
  }
  .hero-cover-btn:hover {
    transform: scale(1.025);
  }
  .hero-cover-btn:active {
    transform: scale(0.98);
    transition-duration: var(--duration-instant);
  }
  .hero-cover-btn:focus-visible {
    outline: none;
    box-shadow:
      var(--shadow-2xl),
      0 0 0 3px rgb(255 255 255 / 0.6);
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

  /* Bio inline en el hero estilo iOS: 1 línea truncada con ellipsis, clic
     expande a full text. `appearance: none` + reset de button styling para
     que se lea como párrafo. */
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
    transition: -webkit-line-clamp var(--duration-normal) var(--ease-ios-default),
                color var(--duration-fast) var(--ease-ios-default);
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

  /* Línea "X canciones · duración" al final del listado (estilo iOS Music). */
  .end-meta {
    margin: var(--space-5) 0 0;
    padding: 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

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
    .bio-line { text-align: center; }
    .end-meta { text-align: center; }
    .record-label {
      padding: 0 var(--space-4);
    }
  }
</style>
