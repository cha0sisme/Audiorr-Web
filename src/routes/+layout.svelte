<script lang="ts">
  import '$styles/globals.css';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { browser } from '$app/environment';
  import { onNavigate, afterNavigate, beforeNavigate, goto } from '$app/navigation';
  import { cubicOut, cubicIn } from 'svelte/easing';

  import { setContext } from 'svelte';
  import { page } from '$app/state';
  import Sidebar from '$components/shell/Sidebar.svelte';
  import ToastViewport from '$components/shared/ToastViewport.svelte';
  import MiniPlayer from '$components/now-playing/MiniPlayer.svelte';
  import CanvasPanel from '$components/now-playing/CanvasPanel.svelte';
  import QueuePanel from '$components/now-playing/QueuePanel.svelte';
  import { player } from '$stores/player.svelte';
  import { canvas } from '$stores/canvas.svelte';
  import { queueUI } from '$stores/queue-ui.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { fetchCanvas, resolveCanvasVideoUrl } from '$services/CanvasService';

  /** Rutas que se renderizan SIN shell (sin sidebar, sin mini player).
      Login es full-screen — el shell distrae. */
  const BARE_ROUTES = new Set(['/login']);
  const isBareRoute = $derived(BARE_ROUTES.has(page.url.pathname));

  /** Rutas accesibles SIN credenciales. Todo lo demás requiere login.
      `/design-system` queda público porque es referencia interna de devs. */
  const PUBLIC_ROUTES = new Set(['/login', '/design-system']);

  /** Auth guard — redirige a /login si no hay creds y la ruta es protegida.
      Solo runs en browser ($effect no corre en SSR). El primer paint en una
      ruta protegida puede mostrar contenido brevemente antes del redirect
      (flash aceptable — auth real con cookies sería overkill acá). */
  $effect(() => {
    const path = page.url.pathname;
    if (!credentials.isConfigured && !PUBLIC_ROUTES.has(path)) {
      goto('/login', { replaceState: true });
    }
  });

  let { children } = $props();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Música cambia poco — 5 min staleTime. Override por query si hace falta.
        staleTime: 5 * 60 * 1000,
        // gcTime de 10 min — los detail pages (album/playlist/artist) se
        // mantienen en cache mientras el usuario navega y vuelve dentro de
        // ese intervalo. JSON pesa nada (2-5 KB cada uno) frente al beneficio
        // de no refetchear al hacer back. Listas pesadas (library albums/
        // artists) y palette overridean a gcTime: Infinity individualmente.
        gcTime: 10 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: false,
        enabled: browser
      }
    }
  });

  // ==========================================================================
  // Player adaptive collapse (hover-or-top):
  //   - Scroll por debajo del threshold → compact.
  //   - Vuelve a expanded SOLO si:
  //     a) el usuario scrollea de nuevo arriba (< NEAR_TOP_THRESHOLD), o
  //     b) el ratón entra dentro del contenedor del player (la zona de
  //        hover sigue al tamaño actual del player — compact 380×60 vs
  //        expanded 1200×88, MiniPlayer notifica hover via callback).
  //   - Mientras el ratón esté encima, se mantiene expanded aunque el
  //     usuario scrolee.
  // ==========================================================================
  const NEAR_TOP_THRESHOLD = 60;

  let mainEl = $state<HTMLElement | undefined>();
  let isAtTop = $state(true);
  let isHoveringPlayer = $state(false);
  const isPlayerCompact = $derived(!isAtTop && !isHoveringPlayer);

  // Context para virtualización: cualquier componente descendiente puede pedir
  // el scroll element actual (ej. VirtualGrid) sin prop drilling. Devolvemos
  // una función getter para que el callee siempre lea el valor reactivo
  // (mainEl es $state y puede pasar de undefined→bound al navegar).
  setContext<() => HTMLElement | null>('main-scroll-el', () => mainEl ?? null);

  function handleMainScroll() {
    if (!mainEl) return;
    isAtTop = mainEl.scrollTop < NEAR_TOP_THRESHOLD;
  }

  $effect(() => {
    if (!mainEl) return;
    const el = mainEl;
    isAtTop = el.scrollTop < NEAR_TOP_THRESHOLD;
    el.addEventListener('scroll', handleMainScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleMainScroll);
    };
  });


  // ==========================================================================
  // Canvas auto-show/hide
  // - Watch player.currentSong → fetch canvas → update store
  // - Si hay canvas → panel slide-in. Si no → slide-out.
  // - El usuario puede cerrar manual (canvas.dismiss) — se respeta hasta
  //   que cambie la canción.
  // ==========================================================================
  $effect(() => {
    const song = player.currentSong;
    if (!song) {
      canvas.setForSong('', null);
      return;
    }
    fetchCanvas(song.id).then((entry) => {
      // Confirmar que la canción no cambió mientras el fetch volvía
      if (player.currentSong?.id !== song.id) return;
      canvas.setForSong(song.id, resolveCanvasVideoUrl(entry));
    });
  });

  // ==========================================================================
  // Scroll management — el .main es scroll container custom, SvelteKit solo
  // gestiona el window. Tracking + restore manual:
  //
  // - Forward nav (link click, goto): scroll a top en la nueva página.
  // - Back/forward (popstate): restore a la posición guardada para esa ruta.
  // - beforeNavigate guarda la posición de la ruta SALIENTE antes de irse.
  //
  // Map keyed by pathname (sin querystring) — /library?tab=albums y
  // /library?tab=playlists comparten posición de scroll (es la misma página).
  // ==========================================================================
  const scrollPositions = new Map<string, number>();

  function applyScroll(navType: string | undefined, toPathname: string | undefined) {
    if (!mainEl) return;
    if (navType === 'popstate' && toPathname) {
      const saved = scrollPositions.get(toPathname);
      mainEl.scrollTo({ top: saved ?? 0, left: 0, behavior: 'instant' });
    } else {
      mainEl.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
  }

  beforeNavigate((nav) => {
    if (!mainEl || !nav.from) return;
    scrollPositions.set(nav.from.url.pathname, mainEl.scrollTop);
  });

  // ==========================================================================
  // View Transitions API — shared-element transitions estilo iOS.
  // Wrap cada navegación con document.startViewTransition() para que los
  // elementos con `view-transition-name` matching morphean entre páginas.
  // Browsers sin soporte (Firefox actual): navegación normal sin animación.
  //
  // CRITICAL: el scroll se aplica DENTRO del callback, ANTES de que el
  // browser capture el snapshot NEW. Si no, la animación arranca con la
  // página scrolleada en lugar de mostrarse el hero de arriba.
  // ==========================================================================
  onNavigate((navigation) => {
    if (typeof document === 'undefined') return;
    if (!('startViewTransition' in document)) return;

    // Skip View Transitions cuando es la MISMA pathname (solo cambia ?query).
    // Sin esto, cambiar tabs (ej. ?tab=playlists) dispara un cross-fade del
    // page completo → flash visible. Mantenemos transitions solo para
    // navegación entre rutas distintas (donde el hero zoom tiene sentido).
    if (navigation.from?.url.pathname === navigation.to?.url.pathname) return;

    return new Promise<void>((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
        applyScroll(navigation.type, navigation.to?.url.pathname);
      });
    });
  });

  // Fallback para browsers SIN View Transitions (Firefox actual).
  afterNavigate((nav) => {
    if (typeof document === 'undefined') return;
    if ('startViewTransition' in document) return;
    applyScroll(nav.type, nav.to?.url.pathname);
  });

  /** Toggle del QueuePanel — abrir cierra automáticamente CanvasPanel.
      Mutex visual: queue es overlay, canvas desplaza el main. Tener ambos a
      la vez se vería raro (queue solapando un main ya estrecho). */
  function toggleQueuePanel() {
    if (queueUI.isOpen) {
      queueUI.close();
      return;
    }
    if (canvas.visible) {
      canvas.dismiss(player.currentSong?.id ?? null);
    }
    queueUI.open();
  }

  /** Toggle del CanvasPanel desde el botón del MiniPlayer.
      - Visible → dismiss (recuerda dismiss para esta canción).
      - No visible + hay videoUrl → restore (limpia dismiss y muestra).
      Si el QueuePanel estaba abierto, se cierra primero. */
  function toggleCanvasPanel() {
    if (canvas.visible) {
      canvas.dismiss(player.currentSong?.id ?? null);
      return;
    }
    if (queueUI.isOpen) queueUI.close();
    canvas.restore();
  }

  // Custom transition iOS — slide desde la derecha + fade.
  // Enter usa cubicOut (deceleración suave), exit cubicIn (acelera al salir).
  function panelEnter(_node: HTMLElement) {
    return {
      duration: 380,
      easing: cubicOut,
      css: (t: number) => `
        transform: translateX(${(1 - t) * 100}%);
        opacity: ${t};
      `
    };
  }
  function panelExit(_node: HTMLElement) {
    return {
      duration: 280,
      easing: cubicIn,
      css: (t: number) => `
        transform: translateX(${(1 - t) * 100}%);
        opacity: ${t};
      `
    };
  }
</script>

<QueryClientProvider client={queryClient}>
  {#if isBareRoute}
    <!-- Bare: sin shell. Login (y futuras vistas tipo onboarding) viven aquí. -->
    {@render children()}
  {:else}
    <div
      class="shell"
      class:canvas-displacing={canvas.visible}
      class:dragging-canvas={canvas.isDragging}
      style:--canvas-col-width="{canvas.visible ? canvas.width : 0}px"
      style:--canvas-panel-width="{canvas.width}px"
      style:--side-panel-width="{queueUI.isOpen ? 360 : canvas.visible ? canvas.width : 0}px"
    >
      <Sidebar />

      <main bind:this={mainEl} class="main">
        {@render children()}
      </main>

      {#if player.hasSong && player.currentSong}
        <div
          class="player-dock"
          class:side-panel-open={canvas.visible || queueUI.isOpen}
        >
          <MiniPlayer
            compact={isPlayerCompact}
            title={player.currentSong.title}
            artist={player.currentSong.artist}
            coverUrl={player.currentSong.coverUrl}
            explicit={player.currentSong.explicit ?? false}
            durationSec={player.currentSong.durationSec ?? 0}
            progress={player.progress}
            isPlaying={player.isPlaying}
            volume={player.volume}
            autoMixActive={true}
            queueOpen={queueUI.isOpen}
            canvasOpen={canvas.visible}
            canvasAvailable={canvas.videoUrl !== null || canvas.demoMode}
            onPlayPause={() => player.toggle()}
            onNext={() => player.next()}
            onPrevious={() => player.previous()}
            onVolumeChange={(v) => (player.volume = v)}
            onSeek={(p) => player.seek(p)}
            onQueue={toggleQueuePanel}
            onCanvas={toggleCanvasPanel}
            onHoverChange={(h) => (isHoveringPlayer = h)}
          />
        </div>
      {/if}

      <!-- Canvas como columna 3 del grid — la animación de aparición/desaparición
           viene del transition de grid-template-columns en .shell, no de Svelte. -->
      {#if canvas.visible}
        <CanvasPanel />
      {/if}

      <!-- Queue sigue siendo overlay (slide-in fixed). -->
      {#if queueUI.isOpen}
        <div in:panelEnter out:panelExit>
          <QueuePanel />
        </div>
      {/if}
    </div>
  {/if}

  <!-- ToastViewport siempre montado, también en /login -->
  <ToastViewport />
</QueryClientProvider>

<style>
  /* Shell de 3 columnas. La 3ª (canvas) tiene width 0 cuando canvas no está
     visible y --canvas-col-width cuando sí. La transición en grid-template-
     columns anima el "displace" del main al abrir/cerrar canvas. */
  .shell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) var(--canvas-col-width, 0px);
    grid-template-areas: 'sidebar main canvas';
    height: 100dvh;
    background: var(--bg-canvas);
    transition: grid-template-columns var(--duration-normal) var(--ease-ios-default);
  }
  /* Durante el drag del handle de canvas: respuesta inmediata. */
  .shell.dragging-canvas {
    transition: none;
  }

  .main {
    grid-area: main;
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    /* Bottom space para que el player flotante no tape contenido. */
    padding-bottom: calc(88px + var(--space-8));
  }

  /* Player flotante centrado SOBRE el área de main (no sobre el sidebar).
     pointer-events: none en el wrapper para no interceptar clicks del padding
     que rodea al player; el player en sí tiene pointer-events: auto.
     `right` anima cuando el canvas panel se abre/cierra → el player se
     re-centra suavemente en el área de main visible. */
  .player-dock {
    position: fixed;
    bottom: var(--space-4);
    left: 240px;
    right: 0;
    z-index: var(--z-sticky);
    display: flex;
    justify-content: center;
    pointer-events: none;
    transition: right var(--duration-normal) var(--ease-ios-default);
  }
  .player-dock.side-panel-open {
    right: var(--side-panel-width);
  }
  .player-dock > :global(*) {
    pointer-events: auto;
  }

  @media (max-width: 768px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-areas: 'main';
    }
    /* Móvil + canvas abierto: el canvas ocupa toda la pantalla. Main queda
       colapsado pero sigue en DOM para no perder scroll position al cerrar. */
    .shell.canvas-displacing {
      grid-template-columns: 0fr 1fr;
      grid-template-areas: 'main canvas';
    }
    .main {
      padding-bottom: calc(64px + var(--space-8));
    }
    .player-dock {
      left: 0;
    }
    .player-dock.side-panel-open {
      /* Panel cubre todo → escondemos el dock visualmente sin desmontarlo */
      opacity: 0;
      pointer-events: none;
    }
  }
</style>
