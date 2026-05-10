<script lang="ts">
  /**
   * CanvasPanel — panel lateral derecho con el Canvas (video vertical) y
   * info del artista debajo, estilo Spotify Now Playing right rail.
   *
   * Layout:
   *   - Stage (video) ocupa min-height 100% del scroll container, así que
   *     en el primer viewport solo se ve el video. La sección de artista
   *     queda "lurking" 60px abajo — pista visual + scroll reveal.
   *   - Peek hint (chevron + label) flota al fondo del stage para
   *     indicar que hay más contenido scroll-down.
   *   - Artist section: avatar + nombre + bio Last.fm + 4 top songs
   *     (Subsonic getTopSongs by name).
   *
   * Mutex con QueuePanel: gestionado por el shell vía
   * `canvas.visible && !queueUI.isOpen`.
   *
   * Sin botón cerrar — el toggle vive en el botón canvas del MiniPlayer
   * (más Apple-grade: el panel no tiene chrome propio, se controla desde
   * fuera). El handle de resize sigue siendo el único affordance del panel.
   */
  import { onMount } from 'svelte';
  import { MusicNoteSimple, CaretDown, Play, MusicNote } from 'phosphor-svelte';
  import { canvas, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH } from '$stores/canvas.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import {
    getArtist,
    getArtistInfo2,
    getTopSongs,
    getCoverArtUrl
  } from '$services/NavidromeService';
  import type {
    NavidromeArtist,
    NavidromeArtistInfo,
    NavidromeSong
  } from '$types/navidrome';

  let videoEl: HTMLVideoElement | undefined = $state();
  let scrollEl: HTMLElement | undefined = $state();
  let infoEl: HTMLElement | undefined = $state();

  onMount(() => {
    function onVisibility() {
      if (!videoEl) return;
      if (document.hidden) videoEl.pause();
      else videoEl.play().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  // ─── Drag-to-resize del borde izquierdo ────────────────────────────────
  let dragging = $state(false);
  function startDrag(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    canvas.isDragging = true;
    const startX = e.clientX;
    const startWidth = canvas.width;

    function onMove(ev: PointerEvent) {
      const next = startWidth - (ev.clientX - startX);
      canvas.setWidth(next);
    }
    function onUp() {
      dragging = false;
      canvas.isDragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }
  function resetWidth() {
    canvas.setWidth(320);
  }

  // ─── Artist info fetch ─────────────────────────────────────────────────
  const qmCurrent = $derived(queueManager.currentSong);
  const artistId = $derived(qmCurrent?.artistId ?? '');
  const artistName = $derived(qmCurrent?.artist ?? '');

  let artist = $state<NavidromeArtist | null>(null);
  let artistInfo = $state<NavidromeArtistInfo | null>(null);
  let topSongs = $state<NavidromeSong[]>([]);
  let lastFetchedArtistId = '';
  let lastFetchedArtistName = '';

  $effect(() => {
    const id = artistId;
    const name = artistName;
    if (!id || id === lastFetchedArtistId) return;
    lastFetchedArtistId = id;
    lastFetchedArtistName = name;
    artist = null;
    artistInfo = null;
    topSongs = [];

    void getArtist(id).then((a) => {
      if (id !== lastFetchedArtistId) return;
      artist = a;
    }).catch(() => {});
    void getArtistInfo2(id, 5, false).then((i) => {
      if (id !== lastFetchedArtistId) return;
      artistInfo = i;
    }).catch(() => {});
    if (name) {
      void getTopSongs(name, 4).then((s) => {
        if (name !== lastFetchedArtistName) return;
        topSongs = s;
      }).catch(() => {});
    }
  });

  /** URL de avatar del artista — preferimos large > medium > small del
      ArtistInfo (Last.fm), fallback al cover del propio artist (Navidrome
      derivado de un álbum suyo). null si nada disponible. */
  const artistImageUrl = $derived.by(() => {
    if (artistInfo?.largeImageUrl) return artistInfo.largeImageUrl;
    if (artistInfo?.mediumImageUrl) return artistInfo.mediumImageUrl;
    if (artistInfo?.smallImageUrl) return artistInfo.smallImageUrl;
    if (artist?.coverArt) return getCoverArtUrl(artist.coverArt, 200);
    return null;
  });

  /** Bio cleaning: Last.fm devuelve HTML con `<a href="...">read more</a>`
      embebido. Stripamos tags y trailing "Read more on Last.fm". */
  const cleanBio = $derived.by(() => {
    const raw = artistInfo?.biography;
    if (!raw) return '';
    return raw
      .replace(/<[^>]*>/g, '')
      .replace(/Read more on Last\.fm.*$/, '')
      .trim();
  });

  function scrollToInfo() {
    if (!infoEl || !scrollEl) return;
    infoEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Click en una popular — insertNext + skipNext = "play this now" sin
      perder la cola actual. insertNext acepta NavidromeSong directamente,
      el manager hace el mapeo a PersistableSong internamente. */
  function playSong(song: NavidromeSong) {
    queueManager.insertNext(song);
    queueManager.skipNext();
  }
</script>

<aside class="canvas-panel" class:dragging aria-label="Canvas del tema actual">
  <div bind:this={scrollEl} class="cp-scroll">
    <!-- ─── STAGE: video sticky top con phone-frame fit ──────────────── -->
    <div class="cp-stage">
      {#if canvas.videoUrl}
        <video
          bind:this={videoEl}
          class="cp-video"
          src={canvas.videoUrl}
          autoplay
          muted
          loop
          playsinline
          preload="auto"
          disablePictureInPicture
        ></video>
      {:else}
        <div class="cp-placeholder" aria-hidden="true">
          <MusicNoteSimple size={56} weight="fill" />
        </div>
      {/if}

      <!-- Peek hint: pill semi-translúcida abajo, indica scroll/click para
           descubrir info del artista. Solo se renderiza si hay datos para
           mostrar (evitamos invitar a un scroll vacío). -->
      {#if artist || artistInfo || topSongs.length > 0}
        <button
          type="button"
          class="cp-peek-hint"
          onclick={scrollToInfo}
          aria-label="Mostrar información del artista"
        >
          <span class="cp-peek-label">
            {#if artistName}
              Sobre {artistName}
            {:else}
              Más
            {/if}
          </span>
          <CaretDown size={12} weight="bold" />
        </button>
      {/if}
    </div>

    <!-- ─── ARTIST INFO: revelado con scroll ─────────────────────────── -->
    {#if artist || artistInfo || topSongs.length > 0}
      <section bind:this={infoEl} class="cp-artist-section">
        <header class="cp-artist-header">
          {#if artistImageUrl}
            <img
              class="cp-artist-avatar"
              src={artistImageUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          {:else}
            <div class="cp-artist-avatar cp-avatar-placeholder" aria-hidden="true">
              <MusicNoteSimple size={28} weight="regular" />
            </div>
          {/if}
          <div class="cp-artist-meta">
            <span class="cp-kicker">Artista</span>
            <h3 class="cp-artist-name">{artist?.name ?? artistName}</h3>
          </div>
        </header>

        {#if cleanBio}
          <p class="cp-artist-bio">{cleanBio}</p>
        {/if}

        {#if topSongs.length > 0}
          <h4 class="cp-section-title">Populares</h4>
          <ul class="cp-songs-list">
            {#each topSongs as song (song.id)}
              <li>
                <button
                  type="button"
                  class="cp-song-row"
                  onclick={() => playSong(song)}
                >
                  <span class="cp-song-thumb">
                    {#if song.coverArt}
                      <img
                        src={getCoverArtUrl(song.coverArt, 80)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    {:else}
                      <span class="cp-song-thumb-placeholder">
                        <MusicNote size={18} weight="regular" />
                      </span>
                    {/if}
                  </span>
                  <span class="cp-song-meta">
                    <span class="cp-song-title">{song.title}</span>
                    <span class="cp-song-album">{song.album ?? ''}</span>
                  </span>
                  <span class="cp-song-play" aria-hidden="true">
                    <Play size={14} weight="fill" />
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>

  <!-- Drag handle: invisible pero con cursor de resize. -->
  <div
    class="resize-handle"
    role="separator"
    aria-label="Redimensionar canvas"
    aria-valuemin={CANVAS_MIN_WIDTH}
    aria-valuemax={CANVAS_MAX_WIDTH}
    aria-valuenow={canvas.width}
    aria-orientation="vertical"
    onpointerdown={startDrag}
    ondblclick={resetWidth}
  ></div>
</aside>

<style>
  /* Panel desplazante: grid item del shell. El scroll vive en `.cp-scroll`
     interior — el `.canvas-panel` actúa como container fijo (resize handle
     + clip) mientras el contenido scrollea internamente. */
  .canvas-panel {
    grid-area: canvas;
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    background: #000;
    box-shadow: -8px 0 32px var(--shadow-color-lg);
    isolation: isolate;
    -webkit-tap-highlight-color: transparent;
  }

  /* Scroll container — Spotify-style "video arriba, info debajo" pattern.
     overscroll-behavior contain evita que el scroll del panel propague al
     <main> del shell (UX nasty al tocar el límite). */
  .cp-scroll {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Scrollbar fina y discreta para no romper la limpieza del panel. */
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
  }
  .cp-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .cp-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.18);
    border-radius: 3px;
  }
  .cp-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  /* Stage del video: ocupa min-height 100% MENOS el peek (60px) — así la
     sección artist queda "lurking" justo debajo, visible sin scroll pero
     invitando a explorar más. Patrón Spotify/Apple Music right-rail. */
  .cp-stage {
    position: relative;
    width: 100%;
    min-height: calc(100% - 60px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }
  .cp-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cp-placeholder {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: var(--text-tertiary);
    background:
      radial-gradient(circle at 30% 20%, oklch(0.5 0.12 280), transparent 60%),
      radial-gradient(circle at 70% 80%, oklch(0.45 0.14 200), transparent 55%),
      linear-gradient(135deg, oklch(0.2 0.05 250), oklch(0.1 0.03 250));
  }

  /* Peek hint: pill glass al fondo del stage. Hover/active gentle scale.
     Click → scrollIntoView smooth a la artist section. */
  .cp-peek-hint {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    border-radius: var(--radius-full);
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(18px) saturate(1.6);
    -webkit-backdrop-filter: blur(18px) saturate(1.6);
    color: rgba(255, 255, 255, 0.92);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-snug);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition:
      transform var(--duration-fast) var(--ease-spring-soft),
      background var(--duration-fast) var(--ease-ios-default);
    animation: cp-peek-bob 2.4s ease-in-out infinite;
    max-width: calc(100% - 32px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cp-peek-hint:hover {
    transform: translateX(-50%) scale(1.04);
    background: rgba(0, 0, 0, 0.7);
    animation-play-state: paused;
  }
  .cp-peek-hint:active {
    transform: translateX(-50%) scale(0.96);
    transition-duration: var(--duration-instant);
  }
  .cp-peek-hint:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5), 0 4px 12px rgba(0, 0, 0, 0.35);
  }
  .cp-peek-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }
  /* Bob sutil — invita a la exploración sin gritar. */
  @keyframes cp-peek-bob {
    0%, 100% { transform: translateX(-50%) translateY(0); }
    50%      { transform: translateX(-50%) translateY(-3px); }
  }

  /* ─── ARTIST SECTION ─────────────────────────────────────────────────
     Background con leve gradiente vertical para destacar transición video→
     info. Padding generoso para respirar en wide. Scroll-margin-top facilita
     el scrollIntoView (la sección queda alineada al top tras click). */
  .cp-artist-section {
    padding: var(--space-6) var(--space-5) var(--space-8);
    background:
      linear-gradient(180deg,
        rgba(0, 0, 0, 0.85) 0%,
        rgba(8, 10, 14, 0.96) 40%,
        rgba(8, 10, 14, 1) 100%
      );
    color: rgba(255, 255, 255, 0.92);
    scroll-margin-top: 0;
  }

  .cp-artist-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .cp-artist-avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    object-fit: cover;
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }
  .cp-avatar-placeholder {
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.45);
  }
  .cp-artist-meta {
    min-width: 0;
  }
  .cp-kicker {
    display: block;
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(255, 255, 255, 0.55);
    margin-bottom: 2px;
  }
  .cp-artist-name {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: var(--tracking-display);
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cp-artist-bio {
    margin: 0 0 var(--space-5);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.72);
    /* Limita la bio a 6 líneas con fade — Spotify tampoco muestra biografías
       enteras inline; si quieres leer todo, hay otros lugares (artist page). */
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cp-section-title {
    margin: 0 0 var(--space-3);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(255, 255, 255, 0.55);
  }

  /* Lista de canciones populares — fila tap-friendly, hover bg sutil. */
  .cp-songs-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cp-song-row {
    width: 100%;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    padding: var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .cp-song-row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .cp-song-row:focus-visible {
    outline: none;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
  }
  .cp-song-thumb {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
    display: block;
  }
  .cp-song-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cp-song-thumb-placeholder {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.4);
  }
  .cp-song-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cp-song-title {
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.25;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-song-album {
    font-size: var(--text-xs);
    color: rgba(255, 255, 255, 0.55);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-song-play {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    opacity: 0;
    transform: scale(0.85);
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-spring-soft);
  }
  .cp-song-row:hover .cp-song-play,
  .cp-song-row:focus-visible .cp-song-play {
    opacity: 1;
    transform: scale(1);
  }

  /* ─── RESIZE HANDLE ────────────────────────────────────────────────── */
  .resize-handle {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
    z-index: 3;
    background: transparent;
    transition: background var(--duration-fast) var(--ease-ios-default);
    touch-action: none;
  }
  .resize-handle:hover,
  .canvas-panel.dragging .resize-handle {
    background: rgba(255, 255, 255, 0.18);
  }

  @media (max-width: 768px) {
    .resize-handle { display: none; }
    /* En móvil el peek hint se ve más arriba para no chocar con safe-area
       inferior del browser. */
    .cp-peek-hint {
      bottom: 24px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cp-peek-hint {
      animation: none;
    }
  }
</style>
