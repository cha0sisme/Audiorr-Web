<script lang="ts">
  /**
   * NowPlayingFullscreen — viewer estilo Apple Music con Lyrics integradas.
   *
   * Mirror del iOS `NowPlayingViewerView.swift`, adaptado a web:
   *
   * Layout apaisado (≥1024px): split 50/50 permanente — mitad izquierda
   * cover hero (con animated artwork si el álbum lo tiene, como AlbumDetail)
   * + info + transport; mitad derecha las lyrics de la canción, siempre
   * visibles. El botón de lyrics desaparece (no hay nada que togglear).
   *
   * Viewports estrechos (<1024px): dos modos exclusivos como antes
   * (driven por `nowPlayingUI.mode`):
   *   - cover:  artwork hero centrado + info debajo + scrubber + controles.
   *   - lyrics: header compacto + lyrics scrollable + scrubber + controles.
   *
   * Canvas: RETIRADO de esta pantalla a propósito (los vídeos 9:16 quedaban
   * mal en el viewer). El CanvasPanel del shell sigue existiendo — solo
   * este overlay deja de renderizarlos; el modo 'canvas' residual del store
   * se normaliza a 'cover'.
   *
   * Backdrop: cover blurreado + scrim + tinte color-extracted vía
   * `extractPalette()`.
   *
   * Switching de modo (narrow): blur-replace cross-fade (mismo patrón que
   * SmartMix usa para sus iconos — opacity + scale + blur 8px → 0). Cada
   * panel queda layered; solo el activo tiene pointer-events.
   *
   * Apertura/cierre: overlay slide-up + scale del backdrop. Si el browser
   * soporta View Transitions API, el cover del MiniPlayer (44px, name
   * "np-cover") morphea al artwork hero del modo cover (mismo name) —
   * efecto premium iOS-grade. Fallback graceful sin VT.
   *
   * Drag-to-dismiss: touch + mouse. translateY * 0.7 para resistencia,
   * threshold 35% del viewport o velocity > 800px/s. Spring de retorno.
   *
   * Mutex (gestionado en +layout.svelte):
   *   - Al open: shell QueuePanel + CanvasPanel se cierran.
   *   - MiniPlayer del shell: oculto visualmente.
   *   - Inner queue: sheet propio (QueuePanel reutilizado) montado dentro
   *     del fullscreen, slide desde la derecha.
   */
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { coverBlurIn, coverBlurOut } from '$utils/cover-transitions';
  import {
    CaretDown, DotsThree, MusicNote, Star, SkipForward, SkipBack,
    Play, Pause, Shuffle, Repeat, SpeakerHigh, Broadcast,
    Queue as QueueIcon, ListPlus
  } from 'phosphor-svelte';
  import LyricsIcon from '$components/shared/LyricsIcon.svelte';

  import { player } from '$stores/player.svelte';
  import { nowPlayingUI } from '$stores/now-playing-ui.svelte';
  import { lyricsService, EMPTY_LYRICS, type LyricsResult } from '$services/LyricsService.svelte';
  import { addToPlaylistUI } from '$stores/playlist-mutations-ui.svelte';
  import { favorites } from '$stores/favorites.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { connectService } from '$services/ConnectService.svelte';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { fetchAlbumArtwork, resolveArtworkVideoUrl } from '$services/AlbumArtworkService';
  import { extractPalette, type CoverPalette } from '$utils/palette';
  import { videoTeardown } from '$utils/video-cleanup';
  import { formatTime } from '$utils/format';
  import { displayArtistName } from '$utils/artist-format';

  import QueuePanel from '$components/now-playing/QueuePanel.svelte';
  import DevicePicker from '$components/now-playing/DevicePicker.svelte';
  import ArtistLinks from '$components/shared/ArtistLinks.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import WaveText from '$components/shared/WaveText.svelte';

  // ─── Estado derivado del store ──────────────────────────────────────────
  const isOpen = $derived(nowPlayingUI.isOpen);
  // El modo 'canvas' ya no existe en esta pantalla — un residuo del store
  // (sesión antigua, deep-link) se normaliza a cover.
  const mode = $derived(nowPlayingUI.mode === 'canvas' ? 'cover' : nowPlayingUI.mode);
  const innerQueueOpen = $derived(nowPlayingUI.innerQueueOpen);

  const song = $derived(player.currentSong);
  const qmCurrent = $derived(queueManager.currentSong);
  /** Cover en alta resolución para el hero. Preferimos el coverArt id raw
      del queueManager (1200px → re-tile vía getCoverArtUrl) — pero SOLO si
      el id del queueManager coincide con el song actual del player.

      En modo remoto el `player.currentSong` refleja la canción del device
      que controla el playback, mientras que `queueManager.currentSong` se
      queda con la última pista local (que ya no suena). Sin este check, el
      hero quedaba con el cover stale del local mientras escuchamos remoto.
      Con el check, caemos a `song.coverUrl` que viene del remote payload
      a 600px y siempre está al día. */
  const heroCoverUrl = $derived.by(() => {
    if (qmCurrent?.coverArt && qmCurrent.id === song?.id) {
      return getCoverArtUrl(qmCurrent.coverArt, 1200);
    }
    return song?.coverUrl ?? null;
  });

  const isFav = $derived(song !== null && favorites.isSong(song.id));

  // ─── Animated artwork (mirror del hero de AlbumDetail) ─────────────────
  // El albumId solo es fiable cuando el queueManager y el player apuntan a
  // la misma canción (en remoto, qmCurrent puede ser la última pista local
  // — mismo guard que heroCoverUrl). Sin albumId no hay query y el cover
  // estático manda.
  const artworkAlbumId = $derived(
    qmCurrent && qmCurrent.id === song?.id ? (qmCurrent.albumId ?? null) : null
  );
  const artworkQ = createQuery(() => ({
    queryKey: ['albumArtwork', artworkAlbumId ?? ''],
    queryFn: () => fetchAlbumArtwork(artworkAlbumId!),
    enabled: isOpen && !!artworkAlbumId,
    staleTime: 1000 * 60 * 10,
    retry: false
  }));
  const artworkVideoUrl = $derived(resolveArtworkVideoUrl(artworkQ.data ?? null));

  // Referencia imperativa al <video> del motion artwork: el atributo `muted`
  // declarativo de Svelte NO garantiza fijar la PROPIEDAD .muted — sin ella
  // el navegador bloquea el autoplay y el vídeo queda en pausa (invisible).
  // Patrón idéntico al hero de AlbumDetail / CanvasPanel.
  let motionVideoEl: HTMLVideoElement | undefined = $state();
  let motionVideoError = $state(false);
  $effect(() => {
    // Reset del error al cambiar de vídeo (nueva canción/álbum).
    void artworkVideoUrl;
    motionVideoError = false;
  });
  $effect(() => {
    const el = motionVideoEl;
    const url = artworkVideoUrl;
    if (!el || !url) return;
    el.muted = true;
    el.play().catch(() => {});
  });

  // ─── Lyrics fetch ──────────────────────────────────────────────────────
  // Cadena getLyricsBySongId (embedded ID3/.lrc) → LRCLib → getLyrics legacy.
  // Detalle en LyricsService.svelte.ts; aquí solo el wiring + render.
  let lyrics = $state<LyricsResult>(EMPTY_LYRICS);
  let lastLyricsSongId = '';
  $effect(() => {
    const sId = song?.id ?? '';
    const title = song?.title ?? '';
    const artist = song?.artist ?? '';
    if (!sId || sId === lastLyricsSongId) return;
    lastLyricsSongId = sId;
    lyrics = EMPTY_LYRICS;
    void lyricsService.fetch(sId, title, artist).then((r) => {
      // Race-guard: la canción puede haber cambiado mientras LRCLib/Navidrome
      // resolvían (común en SmartMix con tracks cortos).
      if (sId !== lastLyricsSongId) return;
      lyrics = r;
    });
  });
  const hasLyrics = $derived(lyrics.lines.length > 0);

  /** Índice de la línea activa según `player.positionSec`. Solo aplica a
      letras synced — para plain devolvemos null y todas las líneas se
      renderizan al mismo nivel de opacidad. Mismo algoritmo que iOS
      LyricsView.activeLineId (linea binaria-greedy: la última con
      `time <= progress`). */
  const activeLineId = $derived.by(() => {
    if (!lyrics.isSynced) return null;
    const t = player.positionSec;
    let best: number | null = null;
    for (const line of lyrics.lines) {
      if (line.time <= t) best = line.id;
      else break;
    }
    return best;
  });

  function lineOpacity(distance: number): number {
    switch (distance) {
      case 0: return 1.0;
      case 1: return 0.48;
      case 2: return 0.22;
      case 3: return 0.1;
      default: return 0.04;
    }
  }

  /** Click en una línea synced → seek a su tiempo. Para plain no hay tiempo
      asociado y el handler es no-op (el cursor queda default). */
  function onLyricClick(line: { time: number }) {
    if (!lyrics.isSynced || line.time < 0) return;
    const dur = song?.durationSec ?? 0;
    if (dur <= 0) return;
    player.seek(line.time / dur);
  }

  // Auto-scroll a la línea activa. iOS pausa el auto-scroll 3s tras un drag
  // del usuario para que pueda explorar. Replicamos.
  let lyricsListEl: HTMLUListElement | undefined = $state();
  let userIsScrolling = $state(false);
  let scrollResumeTimer: ReturnType<typeof setTimeout> | null = null;

  function scrollActiveIntoView() {
    if (!lyricsListEl || activeLineId === null) return;
    const el = lyricsListEl.querySelector<HTMLElement>(
      `[data-line-id="${activeLineId}"]`
    );
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  $effect(() => {
    // Re-trigger scroll cuando cambia la línea activa Y el usuario no está
    // explorando manualmente.
    activeLineId; // dependency tracking
    if (!userIsScrolling) {
      // Pequeño delay para que el DOM termine de renderizar (LazyVStack-equiv).
      setTimeout(scrollActiveIntoView, 50);
    }
  });

  $effect(() => {
    // Reset al cambiar de canción: vuelve al activo de la nueva canción
    // sin esperar a que el lock se rompa.
    lyrics; // dep
    if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
    userIsScrolling = false;
    setTimeout(scrollActiveIntoView, 60);
  });

  function onLyricsWheel() {
    userIsScrolling = true;
    if (scrollResumeTimer) clearTimeout(scrollResumeTimer);
    scrollResumeTimer = setTimeout(() => {
      userIsScrolling = false;
    }, 3000);
  }

  // ─── Color extraction ──────────────────────────────────────────────────
  let palette = $state<CoverPalette | null>(null);
  let lastPaletteSongId = '';
  $effect(() => {
    if (!isOpen) return;
    const sId = song?.id ?? '';
    if (!sId || sId === lastPaletteSongId) return;
    lastPaletteSongId = sId;
    palette = null;
    const url = song?.coverUrl;
    if (!url) return;
    extractPalette(url).then((p) => {
      // Race-guard: la canción puede haber cambiado mientras Vibrant trabajaba.
      if (sId !== lastPaletteSongId) return;
      palette = p;
    });
  });

  /** Tinte radial usando hue+chroma del cover. Si no hay palette, fallback a
      neutro oscuro (no introducimos color random). */
  const tintGradient = $derived.by(() => {
    if (!palette) {
      return 'radial-gradient(ellipse at top, oklch(0.18 0.01 250 / 0.6), transparent 70%)';
    }
    const { hue, chroma } = palette;
    return [
      `radial-gradient(ellipse 80% 60% at 30% 0%, oklch(0.42 ${chroma} ${hue} / 0.55), transparent 60%)`,
      `radial-gradient(ellipse 80% 50% at 70% 100%, oklch(0.32 ${chroma * 0.85} ${(hue + 25) % 360} / 0.45), transparent 60%)`
    ].join(', ');
  });

  // ─── Keyboard ESC + body scroll lock ────────────────────────────────────
  $effect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (devicePickerOpen) {
          devicePickerOpen = false;
          return;
        }
        if (innerQueueOpen) {
          nowPlayingUI.closeInnerQueue();
          return;
        }
        void handleClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  $effect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  });
  // ─── Drag-to-dismiss (touch + mouse) ────────────────────────────────────
  let dragOffset = $state(0);
  let dragging = $state(false);
  let dragStartY = 0;
  let dragStartT = 0;
  let dragLastY = 0;

  function onPointerDown(e: PointerEvent) {
    // Sólo arrancamos drag si el target es backdrop, grip o info — no en
    // controles/scrubber/buttons.
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, input, .np-no-drag, [role="slider"]')) return;
    dragging = true;
    dragStartY = e.clientY;
    dragLastY = e.clientY;
    dragStartT = performance.now();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    dragLastY = e.clientY;
    const delta = e.clientY - dragStartY;
    dragOffset = delta > 0 ? delta * 0.7 : delta * 0.18;
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const elapsed = performance.now() - dragStartT;
    const distance = dragLastY - dragStartY;
    const velocity = distance / Math.max(1, elapsed) * 1000;
    const vh = window.innerHeight;
    const shouldDismiss = (distance > vh * 0.35) || velocity > 800;
    if (shouldDismiss) {
      // Animar offset hasta vh con pequeña inercia, luego close. No usamos
      // VT aquí — el morph del cover compitiendo con el slide del overlay
      // se siente desincronizado. El drag-to-dismiss es su propia animación.
      dragOffset = vh;
      setTimeout(() => {
        nowPlayingUI.close();
        dragOffset = 0;
      }, 220);
    } else {
      dragOffset = 0;
    }
  }

  // ─── Mode switching helpers ─────────────────────────────────────────────
  /** Cambio de modo. El cross-fade entre panes (.np-pane.active) ya da el
      switch suave con opacity + scale + blur (ver `--morph-*` tokens).

      NOTA: probamos un shared-element morph del cover via View Transitions
      API (name "np-cover" entre hero y thumb), pero VT toma snapshot del
      documento entero — durante la animación se filtraba el contenido del
      shell debajo (la playlist o vista que hubiera abierta) por el "agujero"
      del cover extraído. Para hacerlo correctamente sin contaminar haría
      falta FLIP manual midiendo getBoundingClientRect. Diferido. */
  function setMode(m: 'cover' | 'lyrics') {
    if (m === 'lyrics' && !hasLyrics) {
      // Permitimos abrir el modo lyrics aún sin letras — el modo renderiza
      // un placeholder honesto. Mirror del UX iOS donde el botón está visible
      // pero abre una vista vacía si no hay sync.
    }
    nowPlayingUI.setMode(m);
  }
  function toggleQueueSheet() {
    nowPlayingUI.toggleInnerQueue();
  }

  /** Cerrar con View Transition cuando hay soporte — el artwork hero (con
      view-transition-name "np-cover") morphea al cover del MiniPlayer (mismo
      name) que reaparece al cerrar el fullscreen. Mirror inverso del open. */
  async function handleClose() {
    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      document.startViewTransition(async () => {
        nowPlayingUI.close();
        await tick();
      });
    } else {
      nowPlayingUI.close();
    }
  }

  // ─── Device picker ──────────────────────────────────────────────────────
  let devicePickerOpen = $state(false);
  let deviceBtnEl: HTMLButtonElement | null = $state(null);
  const deviceActive = $derived(
    player.isRemote || connectService.activeDeviceId !== null
  );
  const hasAnyDevice = $derived(
    connectService.connectedDevices.some((d) => !d.isThisDevice) ||
    connectService.lanDevices.length > 0
  );

  // ─── Volumen, scrubber, formatos ────────────────────────────────────────
  const positionSec = $derived(player.positionSec);
  const durationSec = $derived(song?.durationSec ?? 0);
  const progressPct = $derived(
    durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0
  );
  const volumePct = $derived(Math.max(0, Math.min(1, player.volume)) * 100);

  function onSeek(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    player.seek(v / 100);
  }
  function onVolume(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    player.volume = v / 100;
  }

  // ─── Flash feedback (mirror MiniPlayer) ─────────────────────────────────
  // Mismo lenguaje visual que MiniPlayer.flash(): pop+halo diferenciado por
  // botón. Coherencia entre la vista compacta y la fullscreen — el usuario
  // reconoce el feedback como propio de Audiorr, no genérico.
  type FlashKey =
    | 'heart' | 'playpause' | 'skipback' | 'skipforward'
    | 'lyrics' | 'connect' | 'queue' | 'volume';
  let just = $state<Record<FlashKey, boolean>>({
    heart: false, playpause: false, skipback: false, skipforward: false,
    lyrics: false, connect: false, queue: false, volume: false
  });
  const flashTimers: Partial<Record<FlashKey, ReturnType<typeof setTimeout>>> = {};
  function flash(k: FlashKey) {
    just[k] = false;
    if (flashTimers[k]) clearTimeout(flashTimers[k]);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      just[k] = true;
      flashTimers[k] = setTimeout(() => { just[k] = false; }, 760);
    }));
  }

  // ─── Custom transition ──────────────────────────────────────────────────
  // Slide-up + scale para el overlay completo. cubicOut entrando, cubicIn
  // saliendo. Igual sensación que el push iOS de full-screen modals.
  function overlayIn(_node: HTMLElement) {
    return {
      duration: 380,
      easing: cubicOut,
      css: (t: number) => `
        transform: translateY(${(1 - t) * 24}px) scale(${0.985 + t * 0.015});
        opacity: ${t};
      `
    };
  }
  function overlayOut(_node: HTMLElement) {
    return {
      duration: 280,
      easing: cubicIn,
      css: (t: number) => `
        transform: translateY(${(1 - t) * 28}px) scale(${0.985 + t * 0.015});
        opacity: ${t};
      `
    };
  }

  // Inner queue sheet — slide-in derecha, mirror del shell QueuePanel.
  function sheetIn(_n: HTMLElement) {
    return {
      duration: 380,
      easing: cubicOut,
      css: (t: number) => `
        transform: translateX(${(1 - t) * 100}%);
        opacity: ${t};
      `
    };
  }
  function sheetOut(_n: HTMLElement) {
    return {
      duration: 280,
      easing: cubicIn,
      css: (t: number) => `
        transform: translateX(${(1 - t) * 100}%);
        opacity: ${t};
      `
    };
  }

  // ─── Context menu (placeholder MVP) ─────────────────────────────────────
  let menuOpen = $state(false);
  let menuBtnEl: HTMLButtonElement | null = $state(null);
  function navigateAlbum() {
    if (!qmCurrent?.albumId) return;
    menuOpen = false;
    nowPlayingUI.close();
    void goto(`/album/${qmCurrent.albumId}`);
  }
  function navigateArtist() {
    if (!qmCurrent?.artist) return;
    menuOpen = false;
    nowPlayingUI.close();
    // El backend persiste artist como NAME (limitación documentada en
    // memory). Hasta que exponga el id Subsonic real, fallback a search.
    void goto(`/search?q=${encodeURIComponent(qmCurrent.artist)}`);
  }
  function closeMenu(e: MouseEvent) {
    if (!menuBtnEl) return;
    if (menuBtnEl.contains(e.target as Node)) return;
    menuOpen = false;
  }

  /** Click en un link de artista (ArtistLinks) → cerrar el overlay para que
      la navegación al detalle sea visible (el fullscreen es position:fixed
      y taparía la ruta nueva). Delegación: el handler vive en el <p>
      contenedor y solo actúa si el target es un <a>. */
  function onArtistLinkClick(e: MouseEvent) {
    const anchor = (e.target as HTMLElement | null)?.closest('a');
    if (anchor) nowPlayingUI.close();
  }

  // ─── Breakpoint del split apaisado ──────────────────────────────────────
  // ≥1024px: layout 50/50 (cover+transport izquierda, lyrics derecha). El
  // JS lo necesita además del CSS para: ocultar el botón de lyrics (no hay
  // nada que togglear), quitar el header compacto de la región de lyrics y
  // mantener el aria-hidden coherente con lo que realmente se ve.
  let isWide = $state(false);
  $effect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => (isWide = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });
  $effect(() => {
    if (!menuOpen) return;
    window.addEventListener('mousedown', closeMenu);
    return () => window.removeEventListener('mousedown', closeMenu);
  });
</script>

{#if isOpen && song}
  <div
    class="np-root"
    class:dragging
    class:remote={player.isRemote}
    style:--np-drag-offset="{dragOffset}px"
    style:--np-tint={tintGradient}
    in:overlayIn
    out:overlayOut
    role="dialog"
    aria-modal="true"
    aria-label="Reproducción a pantalla completa"
    tabindex={-1}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    <!-- ============================================ BACKDROP
         Cover blurreado + tinte SIEMPRE. Continuidad visual entre modos:
         solo cambia el contenido central, el fondo se mantiene tinted con
         la palette. -->
    <div class="np-backdrop" aria-hidden="true">
      {#key song?.id ?? heroCoverUrl ?? '__placeholder__'}
        {#if heroCoverUrl}
          <img
            class="np-bg-cover"
            src={heroCoverUrl}
            alt=""
            loading="eager"
            decoding="async"
            in:fade={{ duration: 360 }}
            out:fade={{ duration: 280 }}
          />
        {/if}
      {/key}
      <div class="np-bg-tint"></div>
      <div class="np-bg-scrim"></div>
    </div>

    <!-- ============================================ TOP BAR -->
    <header class="np-topbar np-no-drag">
      <button
        type="button"
        class="np-icon-btn np-close"
        aria-label="Cerrar reproducción"
        onclick={handleClose}
      >
        <CaretDown size={22} weight="bold" />
      </button>

      <!-- Drag grip (visual indicator que se puede arrastrar para cerrar) -->
      <div class="np-grip" aria-hidden="true"></div>

      <div class="np-topbar-actions">
        <button
          bind:this={menuBtnEl}
          type="button"
          class="np-icon-btn"
          aria-label="Más opciones"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <DotsThree size={22} weight="bold" />
        </button>
        {#if menuOpen}
          <div class="np-menu" role="menu">
            {#if qmCurrent?.albumId}
              <button class="np-menu-item" role="menuitem" onclick={navigateAlbum}>
                <MusicNote size={16} weight="regular" />
                <span>Ir al álbum</span>
              </button>
            {/if}
            {#if qmCurrent?.artist}
              <button class="np-menu-item" role="menuitem" onclick={navigateArtist}>
                <Broadcast size={16} weight="regular" />
                <span>Buscar artista</span>
              </button>
            {/if}
            {#if song?.id}
              <button
                class="np-menu-item"
                role="menuitem"
                onclick={() => {
                  menuOpen = false;
                  if (song?.id) addToPlaylistUI.open([song.id]);
                }}
              >
                <ListPlus size={16} weight="regular" />
                <span>Añadir a playlist</span>
              </button>
            {/if}
            <button class="np-menu-item" role="menuitem" onclick={() => { menuOpen = false; toggleQueueSheet(); }}>
              <QueueIcon size={16} weight="regular" />
              <span>Ver cola</span>
            </button>
          </div>
        {/if}
      </div>
    </header>

    <!-- ============================================ CONTENT (modo activo) -->
    <main class="np-content">
      <!-- ─── Modo COVER ────────────────────────────────────────────────── -->
      <section
        class="np-pane np-pane-cover"
        class:active={mode === 'cover'}
        aria-hidden={mode !== 'cover'}
      >
        <!-- Artwork hero: el wrapper lleva el view-transition-name (no la
             img directamente) para que cuando coverUrl cambia y se haga el
             cross-fade entre OLD y NEW, no haya dos elementos con el mismo
             VT name simultáneamente. El wrapper también soporta el efecto
             paused (scale 0.88) sin pelearse con el blur de la transition
             interna — el scale lo aplica el wrapper, el blur el cover-img. -->
        <div
          class="np-artwork np-artwork-frame"
          class:paused={!player.isPlaying}
          style:view-transition-name={mode === 'cover' ? 'np-cover' : undefined}
        >
          {#key song?.id ?? heroCoverUrl ?? '__placeholder__'}
            <div class="np-artwork-img" in:coverBlurIn out:coverBlurOut>
              {#if heroCoverUrl}
                <img
                  class="np-artwork-bitmap"
                  src={heroCoverUrl}
                  alt=""
                  loading="eager"
                  decoding="async"
                />
              {:else}
                <div class="np-artwork-bitmap np-artwork-placeholder">
                  <MusicNote size="40%" weight="regular" />
                </div>
              {/if}
            </div>
          {/key}

          <!-- Animated artwork overlay (mirror del hero de AlbumDetail) —
               decorativo, no interactivo. Fade-in con delay para que el
               morph de apertura (VT np-cover) termine primero; el cover
               estático debajo sigue siendo el fallback permanente. -->
          {#if artworkVideoUrl && !motionVideoError}
            {#key artworkVideoUrl}
              <video
                bind:this={motionVideoEl}
                class="np-motion-video"
                src={artworkVideoUrl}
                autoplay
                loop
                muted
                playsinline
                disablePictureInPicture
                aria-hidden="true"
                onerror={() => (motionVideoError = true)}
                use:videoTeardown
              ></video>
            {/key}
          {/if}
        </div>

        <div class="np-info">
          <div class="np-info-text">
            <h1 class="np-title">
              <span class="np-title-name">{song.title}</span>
              {#if song.explicit}
                <ExplicitBadge size="18px" />
              {/if}
            </h1>
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <p class="np-artist" onclick={onArtistLinkClick}>
              <ArtistLinks
                artists={song.artists}
                artist={song.artist}
                artistId={song.artistId}
              />
            </p>
            {#if player.isRemote && player.remoteDeviceName}
              <p class="np-status">
                <span class="np-dot"></span>
                Reproduciendo en {player.remoteDeviceName}
              </p>
            {/if}
          </div>
          <button
            type="button"
            class="np-icon-btn np-heart np-heart-btn"
            class:just-clicked={just.heart}
            class:is-fav={isFav}
            aria-label={isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}
            aria-pressed={isFav}
            onclick={() => {
              flash('heart');
              if (song) void favorites.toggleSong(song.id);
            }}
          >
            <Star size={22} weight={isFav ? 'fill' : 'regular'} />
          </button>
        </div>
      </section>

    </main>

    <!-- ============================================ LYRICS
         Región propia (fuera del main): en el split apaisado (≥1024px) es
         la mitad derecha SIEMPRE visible; en viewports estrechos se comporta
         como el antiguo modo lyrics (overlay sobre el main con blur-replace
         cuando mode === 'lyrics'). Un solo nodo para ambos casos → el
         auto-scroll y el estado de user-scroll no se duplican. -->
    <aside
      class="np-lyrics-region"
      class:active={mode === 'lyrics'}
      aria-hidden={!isWide && mode !== 'lyrics'}
      aria-label="Letras"
    >
        <div class="np-lyrics-wrap">
          <!-- Header iOS-style (solo narrow): cover small + meta. En el
               split sobra — el cover hero ya está a la izquierda. -->
          {#if !isWide}
            <div class="np-lyrics-header">
              {#if heroCoverUrl}
                <img class="np-lyrics-thumb" src={heroCoverUrl} alt="" />
              {/if}
              <div class="np-lyrics-meta">
                <p class="np-lyrics-title">
                  <span>{song.title}</span>
                  {#if song.explicit}
                    <ExplicitBadge size="13px" />
                  {/if}
                </p>
                <p class="np-lyrics-artist">
                  {displayArtistName(song.artists ?? [], song.artist)}
                </p>
              </div>
            </div>
          {/if}

          {#if hasLyrics}
            <ul
              bind:this={lyricsListEl}
              class="np-lyrics-list np-no-drag"
              class:synced={lyrics.isSynced}
              onwheel={onLyricsWheel}
              ontouchmove={onLyricsWheel}
            >
              {#each lyrics.lines as line (line.id)}
                {@const isActive = line.id === activeLineId}
                {@const dist =
                  activeLineId === null ? 0 : Math.abs(line.id - activeLineId)}
                {@const clickable = lyrics.isSynced && line.time >= 0}
                <li data-line-id={line.id} class="np-lyric-row">
                  {#if clickable}
                    <button
                      type="button"
                      class="np-lyric-line clickable"
                      class:active={isActive}
                      style:opacity={isActive ? 1 : lineOpacity(dist)}
                      onclick={() => onLyricClick(line)}
                    >
                      {line.text}
                    </button>
                  {:else}
                    <span
                      class="np-lyric-line"
                      class:active={isActive}
                      style:opacity={isActive ? 1 : lineOpacity(dist)}
                    >
                      {line.text}
                    </span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <div class="np-lyrics-empty">
              <p class="np-empty-title">Letras no disponibles</p>
              <p class="np-empty-sub">
                No hemos encontrado letras para esta canción ni en el archivo
                ni en LRCLib.
              </p>
            </div>
          {/if}
        </div>
    </aside>

    <!-- ============================================ TRANSPORT (siempre) -->
    <div class="np-transport np-no-drag">
      <!-- Scrubber + AutoMix subscript (mirror iOS ProgressBarView).
           El indicador AutoMix vive PEGADO al scrubber, justo debajo del
           track, igual que en MiniPlayer .hint. Altura reservada (12px)
           para que el layout no salte cuando aparece/desaparece. -->
      <div class="np-scrubber-row">
        <span class="np-time">{formatTime(positionSec)}</span>
        <div class="np-scrubber">
          <input
            type="range"
            min="0"
            max="100"
            step="0.05"
            value={progressPct}
            oninput={onSeek}
            aria-label="Posición de reproducción"
            class="np-range"
          />
          <div class="np-track" aria-hidden="true">
            <div class="np-track-fill" style:width="{progressPct}%"></div>
          </div>
        </div>
        <span class="np-time">−{formatTime(Math.max(0, durationSec - positionSec))}</span>
      </div>
      <div
        class="np-automix-hint"
        class:visible={queueManager.djCrossfadeFiring}
        aria-hidden={!queueManager.djCrossfadeFiring}
      >
        <WaveText text="AutoMix" />
      </div>

      <!-- Controls grandes -->
      <div class="np-controls">
        <button type="button" class="np-icon-btn np-secondary-ctl" aria-label="Aleatorio">
          <Shuffle size={20} weight="regular" />
        </button>
        <button
          type="button"
          class="np-icon-btn np-skip np-skipback-btn"
          class:just-clicked={just.skipback}
          aria-label="Anterior"
          onclick={() => { flash('skipback'); player.previous(); }}
        >
          <SkipBack size={28} weight="fill" />
        </button>
        <button
          type="button"
          class="np-play"
          class:just-clicked={just.playpause}
          aria-label={player.isPlaying ? 'Pausar' : 'Reproducir'}
          onclick={() => { flash('playpause'); player.toggle(); }}
        >
          {#if player.isPlaying}
            <Pause size={32} weight="fill" />
          {:else}
            <Play size={32} weight="fill" />
          {/if}
        </button>
        <button
          type="button"
          class="np-icon-btn np-skip np-skipforward-btn"
          class:just-clicked={just.skipforward}
          aria-label="Siguiente"
          onclick={() => { flash('skipforward'); player.next(); }}
        >
          <SkipForward size={28} weight="fill" />
        </button>
        <button type="button" class="np-icon-btn np-secondary-ctl" aria-label="Repetir">
          <Repeat size={20} weight="regular" />
        </button>
      </div>

      <!-- Volumen + bottom actions -->
      <div class="np-bottom-row">
        <div class="np-volume">
          <span class="np-volume-icon np-volume-btn" class:just-clicked={just.volume} aria-hidden="true">
            <SpeakerHigh size={16} weight="regular" />
          </span>
          <div class="np-vol-slider">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={volumePct}
              oninput={onVolume}
              onchange={() => flash('volume')}
              aria-label="Volumen"
              class="np-range"
            />
            <div class="np-track np-track-thin" aria-hidden="true">
              <div class="np-track-fill" style:width="{volumePct}%"></div>
            </div>
          </div>
        </div>

        <div class="np-actions">
          <!-- Toggle de lyrics solo en narrow — en el split apaisado las
               letras están siempre visibles a la derecha. -->
          {#if !isWide}
            <button
              type="button"
              class="np-icon-btn np-lyrics-btn"
              class:active-mode={mode === 'lyrics'}
              class:just-clicked={just.lyrics}
              aria-label="Ver letras"
              aria-pressed={mode === 'lyrics'}
              onclick={() => { flash('lyrics'); setMode(mode === 'lyrics' ? 'cover' : 'lyrics'); }}
            >
              <LyricsIcon size={20} filled={mode === 'lyrics'} />
            </button>
          {/if}
          {#if hasAnyDevice}
            <button
              bind:this={deviceBtnEl}
              type="button"
              class="np-icon-btn np-connect-btn"
              class:active-mode={deviceActive || devicePickerOpen}
              class:just-clicked={just.connect}
              aria-label="Dispositivos"
              onclick={() => { flash('connect'); devicePickerOpen = !devicePickerOpen; }}
            >
              <Broadcast size={20} weight="regular" />
              {#if deviceActive}
                <span class="np-device-dot" aria-hidden="true"></span>
              {/if}
            </button>
            <DevicePicker
              open={devicePickerOpen}
              triggerEl={deviceBtnEl}
              onClose={() => (devicePickerOpen = false)}
            />
          {/if}
          <button
            type="button"
            class="np-icon-btn np-queue-btn"
            class:active-mode={innerQueueOpen}
            class:just-clicked={just.queue}
            aria-label="Cola"
            aria-pressed={innerQueueOpen}
            onclick={() => { flash('queue'); toggleQueueSheet(); }}
          >
            <QueueIcon size={20} weight="regular" />
          </button>
        </div>
      </div>
    </div>

  </div>

  <!-- ============================================ INNER QUEUE SHEET -->
  {#if innerQueueOpen}
    <div
      class="np-queue-shell"
      in:fade={{ duration: 180 }}
      out:fade={{ duration: 140 }}
    >
      <button
        type="button"
        class="np-queue-scrim"
        aria-label="Cerrar cola"
        onclick={() => nowPlayingUI.closeInnerQueue()}
      ></button>
      <div class="np-queue-slot" in:sheetIn out:sheetOut>
        <QueuePanel />
      </div>
    </div>
  {/if}
{/if}

<style>
  /* ============================================================================
     ROOT — overlay full-viewport. z-index sobre todo lo del shell.
     `transform: translateY(--np-drag-offset)` permite que el drag-to-dismiss
     anime sin re-layout.
     ============================================================================ */
  .np-root {
    position: fixed;
    inset: 0;
    z-index: 100;
    overflow: hidden;
    background: #000;
    color: #fff;
    isolation: isolate;
    -webkit-tap-highlight-color: transparent;
    /* Drag-to-dismiss en touch: bloqueamos el scroll del browser en el root
       para que pointermove llegue al handler. Las zonas que necesitan scroll
       interno (lyrics list, controles) llevan `np-no-drag` que reactiva
       touch-action: auto. */
    touch-action: none;
    transform: translateY(var(--np-drag-offset, 0));
    transition: transform var(--duration-normal) var(--ease-spring-soft);
  }
  /* Las zonas marcadas no-drag son interactivas: re-habilitamos touch-action
     para que scroll vertical y taps nativos funcionen. */
  .np-no-drag {
    touch-action: auto;
  }
  .np-root.dragging {
    transition: none;
  }

  /* ============================================================================
     BACKDROP — capa 0. Cover blurreado + tinte.
     Mismo patrón que el iOS NowPlayingViewerView (líneas 47-80).
     ============================================================================ */
  .np-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
  }
  /* Cover blurreado a tamaño hero — saturado para que el color destaque
     pese al blur masivo. scale(1.2) evita ver bordes del blur al moverse. */
  .np-bg-cover {
    position: absolute;
    inset: -10%;
    width: 120%;
    height: 120%;
    object-fit: cover;
    filter: blur(45px) saturate(1.4) brightness(0.55);
    transform: scale(1.05);
  }
  /* Tinte color-extracted multi-layer (consume --np-tint computado por JS). */
  .np-bg-tint {
    position: absolute;
    inset: 0;
    background: var(--np-tint);
    mix-blend-mode: overlay;
    opacity: 0.9;
  }
  /* Scrim global para legibilidad del texto blanco encima. */
  .np-bg-scrim {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg,
        rgba(0,0,0,0.18) 0%,
        rgba(0,0,0,0.0) 18%,
        rgba(0,0,0,0.0) 55%,
        rgba(0,0,0,0.45) 85%,
        rgba(0,0,0,0.7) 100%
      );
  }

  /* ============================================================================
     TOP BAR
     ============================================================================ */
  .np-topbar {
    position: relative;
    z-index: 3;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    column-gap: var(--space-3);
    padding: max(var(--space-4), env(safe-area-inset-top)) var(--space-6) var(--space-2);
  }
  .np-grip {
    justify-self: center;
    width: 40px;
    height: 5px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.4);
  }
  .np-topbar-actions {
    position: relative;
    display: flex;
    gap: var(--space-2);
  }

  /* Layout root: 3 filas (top + content + transport). El root ya tiene
     position:fixed; aquí añadimos el grid sin redeclarar position. */
  .np-root {
    display: grid;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      'top'
      'main'
      'transport';
  }
  .np-topbar { grid-area: top; }
  .np-content { grid-area: main; }
  .np-transport { grid-area: transport; }

  /* ============================================================================
     CONTENT — área central. mode panes layered absolute con blur-replace.
     ============================================================================ */
  .np-content {
    position: relative;
    z-index: 1;
    min-height: 0;
    padding: var(--space-2) var(--space-6) var(--space-4);
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    /* `overflow: visible` — un clip cortaría la sombra del artwork hero.
       Los panes inactivos ya tienen opacity:0 y pointer-events:none durante
       el cross-fade; no sangran visualmente. */
    overflow: visible;
  }

  /* Mode panes: cada uno absolute fill del .np-content. Cross-fade + blur-
     replace mirror SmartMix (consume el patrón --morph-* tokens). */
  .np-pane {
    position: absolute;
    inset: var(--space-2) var(--space-6) var(--space-4);
    display: grid;
    place-items: center;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.96);
    filter: blur(8px);
    transition:
      opacity 280ms var(--ease-ios-default),
      transform 320ms var(--ease-ios-default),
      filter 260ms var(--ease-ios-default);
  }
  .np-pane.active {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
    pointer-events: auto;
    transition:
      opacity 320ms var(--morph-ease) 60ms,
      transform 360ms var(--morph-ease) 60ms,
      filter 280ms var(--morph-ease) 60ms;
  }

  /* ============================================================================
     COVER MODE
     ============================================================================ */
  .np-pane-cover {
    grid-template-rows: 1fr auto;
    align-content: center;
    gap: var(--space-6);
    width: 100%;
  }
  /* Cover hero: hasta 480px o 60vh (lo más restrictivo). aspect-ratio 1:1
     garantizado. scale(0.88) cuando paused (mirror iOS animation .spring).

     Estructura: frame (tamaño + shadow + radius + scale paused) → img-wrap
     (absolute fill + transitions in/out por {#key coverUrl}) → bitmap (img
     o placeholder). Esta separación permite que el cambio de canción haga
     blur cross-fade INTERNO sin pelearse con el scale paused del frame. */
  .np-artwork-frame {
    position: relative;
    width: min(60vh, 480px, calc(100vw - 80px));
    aspect-ratio: 1 / 1;
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow:
      0 20px 60px rgba(0, 0, 0, 0.55),
      0 8px 20px rgba(0, 0, 0, 0.35);
    transform: scale(1);
    transition: transform 550ms var(--ease-spring-soft);
  }
  .np-artwork-frame.paused {
    transform: scale(0.88);
  }
  .np-artwork-img {
    position: absolute;
    inset: 0;
    display: block;
    will-change: opacity, filter, transform;
  }
  .np-artwork-bitmap {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .np-artwork-placeholder {
    background: rgba(255, 255, 255, 0.06);
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.4);
  }

  /* Animated artwork overlay — mirror .hero-motion-video de AlbumDetail.
     Propiedades animation-* individuales, NO shorthand: Chrome/Safari
     rechazan var() como timing-function dentro del shorthand y el elemento
     quedaría en opacity:0 permanente por el fill-mode. */
  .np-motion-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    z-index: 1;
    animation-name: np-motion-fadein;
    animation-duration: var(--duration-normal);
    animation-timing-function: var(--ease-ios-default);
    animation-delay: 350ms;
    animation-fill-mode: both;
    animation-iteration-count: 1;
  }
  @keyframes np-motion-fadein {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* Info bloque debajo del cover */
  .np-info {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: var(--space-4);
    width: min(560px, calc(100vw - 80px));
  }
  .np-info-text { min-width: 0; }
  .np-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-2xl);
    font-weight: 700;
    line-height: 1.18;
    letter-spacing: var(--tracking-display-lg);
    color: #fff;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .np-title-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .np-artist {
    margin: 4px 0 0;
    font-size: var(--text-lg);
    font-weight: 500;
    color: rgba(255, 255, 255, 0.65);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* ArtistLinks hereda color del contenedor; su hover por defecto usa
     --text-primary (oscuro en tema claro) — sobre el backdrop siempre
     oscuro del viewer forzamos blanco. */
  .np-artist :global(.artist-link:hover),
  .np-artist :global(.artist-link:focus-visible) {
    color: #fff;
  }
  .np-status {
    margin: 6px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--status-success);
  }
  .np-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--status-success);
  }
  .np-heart {
    flex-shrink: 0;
    color: rgba(255, 255, 255, 0.7);
  }
  .np-heart.is-fav {
    color: #fff;
  }

  /* ============================================================================
     LYRICS — región dual:
     - Narrow (<1024px): overlay sobre el área main (comparte grid-area con
       np-content) con el mismo blur-replace que los panes de modo.
     - Wide (≥1024px, media query al final): mitad derecha del split,
       siempre visible, estática.
     ============================================================================ */
  .np-lyrics-region {
    grid-area: main;
    position: relative;
    z-index: 2;
    min-height: 0;
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    padding: var(--space-2) var(--space-6) var(--space-4);
    opacity: 0;
    transform: scale(0.96);
    filter: blur(8px);
    pointer-events: none;
    transition:
      opacity 280ms var(--ease-ios-default),
      transform 320ms var(--ease-ios-default),
      filter 260ms var(--ease-ios-default);
  }
  .np-lyrics-region.active {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
    pointer-events: auto;
    transition:
      opacity 320ms var(--morph-ease) 60ms,
      transform 360ms var(--morph-ease) 60ms,
      filter 280ms var(--morph-ease) 60ms;
  }
  .np-lyrics-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    height: 100%;
    min-height: 0;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
  }
  .np-lyrics-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
  }
  .np-lyrics-thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    object-fit: cover;
    flex-shrink: 0;
  }
  .np-lyrics-meta { min-width: 0; }
  .np-lyrics-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: #fff;
    display: flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
  }
  .np-lyrics-title span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .np-lyrics-artist {
    margin: 2px 0 0;
    font-size: var(--text-sm);
    color: rgba(255, 255, 255, 0.5);
  }
  .np-lyrics-list {
    list-style: none;
    margin: 0;
    padding: var(--space-4) 0 var(--space-12);
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    /* Fade vertical mirror iOS (LyricsView .mask). */
    -webkit-mask-image: linear-gradient(180deg,
      transparent 0%, #000 8%, #000 88%, transparent 100%);
            mask-image: linear-gradient(180deg,
      transparent 0%, #000 8%, #000 88%, transparent 100%);
  }
  /* Wrapper <li> de cada línea — solo carries el data-line-id para scroll. */
  .np-lyric-row {
    display: block;
  }
  /* Línea de lyrics. Por defecto secondary weight + scale 0.96. La activa
     se enciende a weight 700 + scale 1.0 + color #fff con transición suave.
     Cuando es clickable (synced + time válido) la línea es un <button>;
     si no, un <span>. CSS aplica a ambos sin distinción. */
  .np-lyric-line {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    text-align: left;
    font-family: inherit;
    font-size: var(--text-2xl);
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: var(--tracking-display);
    color: rgba(255, 255, 255, 0.92);
    padding: var(--space-2) var(--space-1);
    border-radius: var(--radius-sm);
    transform: scale(0.96);
    transform-origin: left center;
    transition:
      opacity 320ms var(--ease-ios-default),
      transform 320ms var(--ease-ios-default),
      color 320ms var(--ease-ios-default),
      background 150ms var(--ease-ios-default);
    will-change: opacity, transform;
    user-select: text;
    -webkit-tap-highlight-color: transparent;
  }
  .np-lyric-line.active {
    color: #fff;
    font-weight: 700;
    transform: scale(1);
  }
  .np-lyric-line.clickable {
    cursor: pointer;
  }
  .np-lyric-line.clickable:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .np-lyric-line.clickable:focus-visible {
    outline: none;
    background: rgba(255, 255, 255, 0.1);
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.45);
  }
  .np-lyrics-empty {
    display: grid;
    place-items: center;
    text-align: center;
    flex: 1;
    color: rgba(255, 255, 255, 0.55);
    padding: var(--space-12) var(--space-6);
  }
  .np-empty-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }
  .np-empty-sub {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: rgba(255, 255, 255, 0.5);
    max-width: 380px;
  }

  /* ============================================================================
     TRANSPORT (siempre visible) — scrubber + controles + volumen + actions
     ============================================================================ */
  .np-transport {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) max(var(--space-6), 28px)
             max(var(--space-5), env(safe-area-inset-bottom)) max(var(--space-6), 28px);
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    box-sizing: border-box;
  }
  .np-scrubber-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
  }
  .np-time {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.65);
    line-height: 1;
    min-width: 38px;
    text-align: center;
  }
  .np-scrubber {
    position: relative;
    height: 16px;
    display: flex;
    align-items: center;
  }
  .np-track {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.18);
    border-radius: var(--radius-full);
    overflow: hidden;
    transition: height var(--duration-fast) var(--ease-ios-default);
  }
  .np-track-thin {
    height: 3px;
  }
  .np-track-fill {
    height: 100%;
    background: rgba(255, 255, 255, 0.92);
    border-radius: inherit;
    transition:
      width 80ms linear,
      background var(--duration-normal) var(--ease-ios-default);
  }
  /* Remote mode: el scrubber de playback (NO el de volumen) cambia a verde
     status-success, en sintonía con el dot/banner "Reproduciendo en {device}".
     El selector excluye .np-vol-slider para que el volumen siga siendo blanco. */
  .np-root.remote .np-scrubber-row .np-track-fill {
    background: var(--status-success);
  }
  .np-scrubber:hover .np-track {
    height: 6px;
  }
  .np-range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
  }

  /* Controles transport: 5 botones, con play 64px */
  .np-controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-5);
  }
  .np-skip {
    width: 48px;
    height: 48px;
    color: #fff;
  }
  .np-secondary-ctl {
    width: 40px;
    height: 40px;
    color: rgba(255, 255, 255, 0.65);
  }
  .np-play {
    width: 64px;
    height: 64px;
    border: none;
    border-radius: 50%;
    background: #fff;
    color: #000;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      transform var(--duration-fast) var(--ease-spring-soft),
      box-shadow var(--duration-fast) var(--ease-ios-default);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  }
  .np-play:hover { transform: scale(1.05); }
  .np-play:active {
    transform: scale(0.95);
    transition-duration: var(--duration-instant);
  }
  .np-play:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 3px rgba(255, 255, 255, 0.55),
      0 6px 20px rgba(0, 0, 0, 0.4);
  }

  .np-bottom-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
  }
  .np-volume {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: rgba(255, 255, 255, 0.65);
  }
  .np-vol-slider {
    position: relative;
    width: 140px;
    height: 16px;
    display: flex;
    align-items: center;
  }
  .np-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    position: relative;
  }

  /* ============================================================================
     ICON BUTTONS — minimalistas, color-only hover, mismo patrón MiniPlayer.
     ============================================================================ */
  .np-icon-btn {
    width: 40px;
    height: 40px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    transition:
      color var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
    position: relative;
  }
  .np-icon-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
  .np-icon-btn:active {
    background: rgba(255, 255, 255, 0.15);
    transition-duration: var(--duration-instant);
  }
  .np-icon-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.55);
  }
  .np-icon-btn.active-mode {
    color: #fff;
    background: rgba(255, 255, 255, 0.18);
  }
  .np-device-dot {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--status-success);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.45);
  }

  /* Context menu */
  .np-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    min-width: 220px;
    background: var(--bg-surface-elevated);
    color: var(--text-primary);
    border-radius: var(--radius-lg);
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.45),
      0 2px 8px rgba(0, 0, 0, 0.25);
    padding: var(--space-1);
    z-index: 10;
    animation: np-menu-in 180ms var(--ease-ios-default);
  }
  @keyframes np-menu-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .np-menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .np-menu-item:hover {
    background: var(--bg-surface-hover);
  }
  .np-menu-item:focus-visible {
    outline: none;
    background: var(--bg-surface-active);
    box-shadow: var(--focus-ring);
  }

  /* AutoMix subscript del scrubber (mirror iOS ProgressBarView).
     Espejo del .hint del MiniPlayer: altura reservada para que el layout no
     salte al mostrar/ocultar; transición fade suave; texto centrado y
     posicionado bajo el track. WaveText del componente shared aporta el
     shimmer animado. */
  .np-automix-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 14px;
    margin-top: -2px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: rgba(255, 255, 255, 0.85);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-ios-default);
    user-select: none;
    pointer-events: none;
  }
  .np-automix-hint.visible {
    opacity: 1;
  }

  /* ============================================================================
     INNER QUEUE SHEET (slide-in derecha, scrim oscuro)
     ============================================================================ */
  .np-queue-shell {
    position: fixed;
    inset: 0;
    z-index: 200;
    pointer-events: auto;
  }
  .np-queue-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .np-queue-slot {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100vw);
  }

  /* ============================================================================
     RESPONSIVE
     ============================================================================ */
  @media (max-width: 768px) {
    .np-content {
      padding: var(--space-2) var(--space-4) var(--space-2);
    }
    .np-lyrics-region {
      padding: var(--space-2) var(--space-4) var(--space-2);
    }
    .np-transport {
      padding: var(--space-2) var(--space-4) max(var(--space-4), env(safe-area-inset-bottom));
    }
    .np-controls {
      gap: var(--space-3);
    }
    .np-bottom-row {
      grid-template-columns: 1fr;
      gap: var(--space-2);
    }
    .np-volume {
      display: none; /* Móviles tienen volumen físico */
    }
    .np-actions {
      justify-content: center;
    }
    .np-info {
      width: calc(100vw - 32px);
    }
  }

  /* ============================================================================
     SPLIT APAISADO (≥1024px) — mitad izquierda cover + info + transport,
     mitad derecha lyrics SIEMPRE visibles. Los modos cover/lyrics dejan de
     aplicar: ambas mitades conviven (el botón de lyrics ya no se renderiza
     en wide — ver markup).
     ============================================================================ */
  @media (min-width: 1024px) {
    .np-root {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas:
        'top top'
        'main lyrics'
        'transport lyrics';
    }
    .np-transport {
      grid-area: transport;
      max-width: 640px;
    }
    /* Mitad derecha: estática, sin blur-replace — siempre visible. */
    .np-lyrics-region {
      grid-area: lyrics;
      opacity: 1;
      transform: none;
      filter: none;
      pointer-events: auto;
      padding: var(--space-2) var(--space-8) var(--space-6) var(--space-4);
      transition: none;
    }
    /* Mitad izquierda: el cover manda pase lo que pase con `mode`. */
    .np-pane-cover {
      opacity: 1;
      transform: scale(1);
      filter: none;
      pointer-events: auto;
    }
    /* Presupuesto vertical del cover: viewport − topbar − info − transport.
       El ancho de columna (50vw) acota en ventanas anchas y bajas. */
    .np-artwork-frame {
      width: min(calc(100vh - 400px), 420px, calc(50vw - 128px));
    }
    .np-info {
      width: min(560px, 100%);
    }
    .np-lyrics-wrap {
      max-width: 640px;
    }
  }

  /* ============================================================================
     FLASH FEEDBACK — mismo lenguaje visual que MiniPlayer.
     Apple/Disney "12 principles": anticipation (squash) → action (overshoot)
     → settling. Multi-stage keyframes con filter brightness/saturate en peak,
     halos con blur sutil. Diferenciación por botón:
       Star (fav)   → pop + halo coral cálido (no accent)
       Play/Pause   → box-shadow tactile (vive dentro, no ring exterior)
       Skip prev/fw → bounce direccional (translateX hacia la dirección)
       Lyrics       → pulse del micro con drop-shadow (encendido)
       Connect      → ondas concéntricas (broadcast emitiendo)
       Queue        → lift + glow inferior (panel emergiendo)
       Volume       → vibration + sonar lateral (membrana altavoz)
     ============================================================================ */

  .np-heart-btn.just-clicked > :global(svg) {
    animation: np-heart-burst 760ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    transform-origin: center;
    will-change: transform, filter;
  }
  .np-heart-btn.just-clicked::before {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: 50%;
    border: 1.5px solid oklch(0.72 0.22 14);
    pointer-events: none;
    opacity: 0;
    animation: np-heart-ring 620ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .np-heart-btn.just-clicked::after {
    content: '';
    position: absolute;
    inset: -12px;
    border-radius: 50%;
    background: radial-gradient(circle at center,
      oklch(0.72 0.22 14 / 0.55) 0%,
      oklch(0.72 0.22 14 / 0.25) 28%,
      transparent 65%);
    filter: blur(2px);
    pointer-events: none;
    animation: np-heart-glow 820ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes np-heart-burst {
    0%   { transform: scale(1); filter: none; }
    14%  { transform: scale(0.62); filter: brightness(0.95); }
    34%  { transform: scale(1.55) rotate(-4deg); filter: brightness(1.25) saturate(1.6) drop-shadow(0 0 8px oklch(0.72 0.22 14 / 0.75)); }
    58%  { transform: scale(0.88) rotate(3deg); filter: brightness(1.08) saturate(1.2); }
    80%  { transform: scale(1.05) rotate(-1deg); filter: none; }
    100% { transform: scale(1); }
  }
  @keyframes np-heart-ring {
    0%   { transform: scale(0.7); opacity: 0; }
    18%  { opacity: 0.95; }
    100% { transform: scale(2.0); opacity: 0; }
  }
  @keyframes np-heart-glow {
    0%   { transform: scale(0.55); opacity: 0; }
    25%  { transform: scale(1.1); opacity: 0.85; }
    100% { transform: scale(2.1); opacity: 0; }
  }

  /* Play/Pause grande (64px disco blanco). Sin ring exterior — el disco YA
     es el límite visual. Spring squash→overshoot→settle con box-shadow
     que crece y se intensifica brevemente, + inset glow que aporta
     sensación de "press into glass". */
  .np-play.just-clicked {
    animation: np-pp-tactile 580ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    will-change: transform, filter, box-shadow;
  }
  @keyframes np-pp-tactile {
    0%   {
      transform: scale(1);
      filter: none;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4), inset 0 0 0 0 transparent;
    }
    16%  {
      transform: scale(0.9);
      filter: brightness(0.95);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.5), inset 0 0 0 0 transparent;
    }
    42%  {
      transform: scale(1.14);
      filter: brightness(1.12) saturate(1.05);
      box-shadow:
        0 14px 38px rgba(0, 0, 0, 0.55),
        0 6px 18px rgba(255, 255, 255, 0.12),
        inset 0 0 14px rgba(255, 255, 255, 0.35);
    }
    66%  {
      transform: scale(0.96);
      filter: brightness(1.05);
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45), inset 0 0 0 0 transparent;
    }
    88%  { transform: scale(1.02); filter: none; }
    100% {
      transform: scale(1);
      filter: none;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4), inset 0 0 0 0 transparent;
    }
  }

  /* Skip prev/forward — bounce direccional. El icono se desplaza hacia su
     dirección (izquierda para back, derecha para forward) con un sutil
     drop-shadow trailing en el peak para sensación de "ímpetu". Más
     sutil que un pop — son secundarios, no protagonistas. */
  .np-skipback-btn.just-clicked > :global(svg) {
    animation: np-skip-back 460ms cubic-bezier(0.32, 1.6, 0.5, 0.95);
    will-change: transform, filter;
  }
  .np-skipforward-btn.just-clicked > :global(svg) {
    animation: np-skip-forward 460ms cubic-bezier(0.32, 1.6, 0.5, 0.95);
    will-change: transform, filter;
  }
  @keyframes np-skip-back {
    0%   { transform: translateX(0) scale(1); filter: none; }
    35%  { transform: translateX(-6px) scale(1.08); filter: brightness(1.15) drop-shadow(2px 0 4px rgba(255,255,255,0.25)); }
    65%  { transform: translateX(2px) scale(0.97); filter: brightness(1.05); }
    100% { transform: translateX(0) scale(1); filter: none; }
  }
  @keyframes np-skip-forward {
    0%   { transform: translateX(0) scale(1); filter: none; }
    35%  { transform: translateX(6px) scale(1.08); filter: brightness(1.15) drop-shadow(-2px 0 4px rgba(255,255,255,0.25)); }
    65%  { transform: translateX(-2px) scale(0.97); filter: brightness(1.05); }
    100% { transform: translateX(0) scale(1); filter: none; }
  }

  /* Lyrics (LyricsIcon) — pulse "encendido" del icono con drop-shadow
     accent. El icono se "ilumina" momentáneamente y el filled toma el
     relevo. El target del animation es `.lyrics-icon` (span con mask-image),
     no un svg, porque el componente LyricsIcon renderiza el SVG via
     `mask-image: url(...)` para poder heredar currentColor. */
  .np-lyrics-btn.just-clicked > :global(.lyrics-icon) {
    animation: np-lyrics-on 520ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    will-change: transform, filter;
  }
  @keyframes np-lyrics-on {
    0%   { transform: scale(1); filter: none; }
    20%  { transform: scale(0.88); filter: brightness(0.92); }
    50%  { transform: scale(1.16); filter: brightness(1.3) saturate(1.4) drop-shadow(0 0 6px rgba(255,255,255,0.8)); }
    75%  { transform: scale(0.96); filter: brightness(1.1); }
    100% { transform: scale(1); filter: none; }
  }

  /* Connect — 2 ondas concéntricas + brightness pulse del icono. */
  .np-connect-btn.just-clicked > :global(svg) {
    animation: np-connect-emit 360ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: filter;
  }
  .np-connect-btn.just-clicked::before,
  .np-connect-btn.just-clicked::after {
    content: '';
    position: absolute;
    inset: 5px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.35);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
  }
  .np-connect-btn.just-clicked::before {
    animation: np-connect-wave 760ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .np-connect-btn.just-clicked::after {
    animation: np-connect-wave 760ms cubic-bezier(0.16, 1, 0.3, 1) 130ms;
  }
  @keyframes np-connect-emit {
    0%, 100% { filter: none; }
    25%      { filter: brightness(1.35) drop-shadow(0 0 6px rgba(255,255,255,0.7)); }
    60%      { filter: brightness(1.1); }
  }
  @keyframes np-connect-wave {
    0%   { transform: scale(0.35); opacity: 0; }
    14%  { opacity: 1; }
    100% { transform: scale(2.0); opacity: 0; }
  }

  /* Queue — lift + glow inferior. */
  .np-queue-btn.just-clicked > :global(svg) {
    animation: np-queue-lift 580ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    will-change: transform, filter;
  }
  .np-queue-btn.just-clicked::after {
    content: '';
    position: absolute;
    bottom: 4px;
    left: 50%;
    width: 28px;
    height: 7px;
    margin-left: -14px;
    border-radius: 50%;
    background: radial-gradient(ellipse at center,
      rgba(255, 255, 255, 0.7) 0%,
      transparent 70%);
    filter: blur(3px);
    pointer-events: none;
    opacity: 0;
    animation: np-queue-glow 520ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes np-queue-lift {
    0%   { transform: translateY(0) rotate(0); filter: none; }
    18%  { transform: translateY(1px) rotate(2deg); }
    44%  { transform: translateY(-5px) rotate(-6deg); filter: brightness(1.2) drop-shadow(0 2px 4px rgba(255,255,255,0.4)); }
    70%  { transform: translateY(1.5px) rotate(3deg); filter: brightness(1.05); }
    100% { transform: translateY(0) rotate(0); filter: none; }
  }
  @keyframes np-queue-glow {
    0%   { opacity: 0; transform: scaleX(0.4); }
    50%  { opacity: 0.9; transform: scaleX(1.3); }
    100% { opacity: 0; transform: scaleX(0.9); }
  }

  /* Volumen — el icono SpeakerHigh vibra + sonar lateral. El span wrapper
     .np-volume-icon es position:relative para anclar el ::after. */
  .np-volume-icon {
    position: relative;
    display: inline-grid;
    place-items: center;
    color: inherit;
  }
  .np-volume-btn.just-clicked > :global(svg) {
    animation: np-volume-vibrate 380ms cubic-bezier(0.36, 0, 0.64, 1);
    will-change: transform, filter;
  }
  .np-volume-btn.just-clicked::before,
  .np-volume-btn.just-clicked::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 75%;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.4);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
  }
  .np-volume-btn.just-clicked::before {
    animation: np-volume-wave 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .np-volume-btn.just-clicked::after {
    animation: np-volume-wave 560ms cubic-bezier(0.22, 1, 0.36, 1) 130ms;
  }
  @keyframes np-volume-vibrate {
    0%, 100% { transform: scale(1) translateX(0); filter: none; }
    20%      { transform: scale(1.1) translateX(-1px); filter: brightness(1.2); }
    45%      { transform: scale(1.05) translateX(1px); filter: brightness(1.08); }
    70%      { transform: scale(1.01) translateX(-0.5px); }
  }
  @keyframes np-volume-wave {
    0%   { transform: scale(0.3) translateX(-2px); opacity: 0; }
    16%  { opacity: 0.95; }
    100% { transform: scale(2.0) translateX(3px); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .np-heart-btn.just-clicked > :global(svg),
    .np-play.just-clicked,
    .np-skipback-btn.just-clicked > :global(svg),
    .np-skipforward-btn.just-clicked > :global(svg),
    .np-lyrics-btn.just-clicked > :global(.lyrics-icon),
    .np-connect-btn.just-clicked > :global(svg),
    .np-queue-btn.just-clicked > :global(svg),
    .np-volume-btn.just-clicked > :global(svg) { animation: none; }
    .np-heart-btn.just-clicked::before,
    .np-heart-btn.just-clicked::after,
    .np-connect-btn.just-clicked::before,
    .np-connect-btn.just-clicked::after,
    .np-queue-btn.just-clicked::after,
    .np-volume-btn.just-clicked::before,
    .np-volume-btn.just-clicked::after { animation: none; opacity: 0; }
  }

  /* Reduced motion: el sistema ya pone --duration-* a 0ms via primitives.
     Aquí garantizamos que las transitions custom también se neutralizan. */
  @media (prefers-reduced-motion: reduce) {
    .np-pane,
    .np-pane.active,
    .np-artwork,
    .np-play {
      transition-duration: 0ms !important;
    }
  }

  /* View Transitions API — el cover comparte view-transition-name "np-cover"
     entre Hero (mode cover) y Thumb (mode lyrics). La default duration es
     250ms; aquí la subimos a 480ms con la curva iOS para que el zoom-out se
     sienta natural y premium (mismo timing que el morph de SmartMix). Solo
     aplica al elemento "np-cover", el resto del fullscreen sigue con la
     cross-fade default que el browser provee. */
  :global(::view-transition-old(np-cover)),
  :global(::view-transition-new(np-cover)) {
    animation-duration: 480ms;
    animation-timing-function: cubic-bezier(0.32, 0.72, 0, 1);
  }
</style>
