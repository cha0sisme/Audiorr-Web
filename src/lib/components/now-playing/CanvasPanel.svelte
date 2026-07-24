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
  import { createQuery } from '@tanstack/svelte-query';
  import { quintOut, quintIn, linear } from 'svelte/easing';
  import { MusicNoteSimple, CaretDown, Play, MusicNote, SealCheck, Check } from 'phosphor-svelte';
  import { canvas, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH } from '$stores/canvas.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { fetchAlbumArtwork, resolveArtworkVideoUrl } from '$services/AlbumArtworkService';
  import { releaseVideo, videoTeardown } from '$utils/video-cleanup';
  import { lyricsService, EMPTY_LYRICS, type LyricsResult } from '$services/LyricsService.svelte';
  import {
    fetchGeniusAnnotations,
    matchAnnotationsToLyrics,
    type MatchedGeniusAnnotation
  } from '$services/GeniusService';
  import {
    getArtist,
    getArtistInfo2,
    getTopSongs,
    getCoverArtUrl,
    search3
  } from '$services/NavidromeService';
  import type {
    NavidromeArtist,
    NavidromeArtistInfo,
    NavidromeSong
  } from '$types/navidrome';

  let videoEl: HTMLVideoElement | undefined = $state();
  let scrollEl: HTMLElement | undefined = $state();
  let infoEl: HTMLElement | undefined = $state();
  /** El <video> falló al cargar la fuente actual → caemos a la carátula. */
  let videoError = $state(false);

  onMount(() => {
    function onVisibility() {
      if (!videoEl) return;
      if (document.hidden) videoEl.pause();
      else if (player.isPlaying) videoEl.play().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  // ─── Lyric banner — línea activa de la letra synced ───────────────────
  // Solo aparece si la canción tiene letras CON timestamps (LRCLib synced,
  // embedded synced o Navidrome plugin con LRC). Para letras plain (sin
  // tiempos) no se muestra — no sabríamos qué línea suena. El cache LRU
  // del LyricsService evita refetch en re-reproducciones.
  let lyrics = $state<LyricsResult>(EMPTY_LYRICS);
  let lastLyricsSongId = '';
  $effect(() => {
    const sId = player.currentSong?.id ?? '';
    const title = player.currentSong?.title ?? '';
    const artist = player.currentSong?.artist ?? '';
    if (!sId || sId === lastLyricsSongId) return;
    lastLyricsSongId = sId;
    lyrics = EMPTY_LYRICS;
    void lyricsService.fetch(sId, title, artist).then((r) => {
      if (sId !== lastLyricsSongId) return;
      lyrics = r;
    });
  });

  /** Índice de la línea activa (binaria-greedy: la última con time <=
      progress). Mismo algoritmo que NowPlayingFullscreen + iOS LyricsView. */
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
  const activeLine = $derived(
    activeLineId !== null ? lyrics.lines[activeLineId] ?? null : null
  );

  /** Font-size dinámico según longitud del texto — patrón Apple Music
      donde las letras cortas se vuelven "hero" y las largas se contienen.
      Cuatro tramos con saltos discretos (mejor que clamp() porque queremos
      diferencias claras de jerarquía visual, no interpolación lineal). */
  const lyricFontSize = $derived.by(() => {
    const len = activeLine?.text.length ?? 0;
    if (len <= 22) return 24;
    if (len <= 48) return 20;
    if (len <= 80) return 17;
    return 15;
  });

  /** Transitions de cambio de línea — secuenciadas, no cross-fade.
      El intento previo de cross-fade casi-simétrico (in 480 / out 380)
      hacía que en mid-transition se vieran las DOS líneas a la vez
      sobre el mismo slot absolute — visualmente "chocaban" ~200ms.

      Nueva estrategia: la línea vieja sale RÁPIDO (220ms) y la nueva
      entra con `delay: 200ms`. Solapamiento real ≤ 20ms, casi cero.
      Cada párrafo se ve solo en su slot, sin invadir al siguiente.

      Cuatro ejes por transición (translateY + opacity + scale + blur)
      siguen aplicándose; lo único que cambia es el timing.

      Trade-off aceptado: hay un brevísimo "vacío" entre out y in
      (~0-20ms), imperceptible en lectura natural. A cambio, la
      sincronía con el audio se siente más nítida — la letra correcta
      es la única visible en cada instante. */
  function lyricIn(_node: Element) {
    return {
      duration: 380,
      delay: 200,
      easing: quintOut,
      css: (t: number, u: number) => `
        transform: translate3d(0, ${u * 14}px, 0) scale(${0.99 + t * 0.01});
        opacity: ${t};
        filter: blur(${u * 1.6}px);
      `
    };
  }
  function lyricOut(_node: Element) {
    return {
      duration: 220,
      easing: quintIn,
      css: (t: number, u: number) => `
        transform: translate3d(0, ${-u * 12}px, 0) scale(${0.99 + t * 0.01});
        opacity: ${t};
        filter: blur(${u * 1.5}px);
      `
    };
  }

  // ─── Genius annotations — curiosidades sincronizadas a las letras ──────
  // El backend devuelve raw annotations (fragment + body + metadata) sin
  // tiempos. El matching contra las líneas LRCLib + cálculo de duración
  // se hace aquí client-side (decisión documentada en
  // genius.routes.ts:13-15: el FE ya tiene LRCLib en cache y no merece
  // duplicar el fetch). Sin letras synced no podemos mostrar nada — el
  // efecto re-dispara cuando llegan (LRCLib puede tardar).
  let annotations = $state<MatchedGeniusAnnotation[]>([]);
  let lastAnnSongId = '';
  $effect(() => {
    const sId = player.currentSong?.id ?? '';
    const title = player.currentSong?.title ?? '';
    const artist = player.currentSong?.artist ?? '';
    if (sId !== lastAnnSongId) {
      annotations = [];
      lastAnnSongId = sId;
    }
    if (!sId || !lyrics.isSynced) return;
    const lines = lyrics.lines;
    void fetchGeniusAnnotations(title, artist).then((r) => {
      if (sId !== lastAnnSongId) return;
      annotations = matchAnnotationsToLyrics(r.annotations, lines);
    });
  });

  /** Anotación activa = la más reciente cuyo `matchedTime <= positionSec`
      y que SIGUE dentro de su ventana de display (`matchedTime + durationMs/1000`).
      Si dos anotaciones tienen ventanas que se solapan, gana la más reciente
      (la siguiente desplaza a la anterior con el cross-fade). */
  const activeAnnotation = $derived.by<MatchedGeniusAnnotation | null>(() => {
    if (annotations.length === 0) return null;
    const t = player.positionSec;
    let best: MatchedGeniusAnnotation | null = null;
    for (const ann of annotations) {
      const start = ann.matchedTime;
      if (start > t) break;
      const end = start + ann.durationMs / 1000;
      if (t < end) best = ann; // sigue activa — candidata
    }
    return best;
  });

  /** Anotación "pineada" por el usuario para leer el texto completo
      sin que el ciclo la reemplace. Cuando es no-null:
        - El ticker pausa (no avanza demoIndex)
        - El card se muestra en modo expanded
        - El texto entero es visible (sin line-clamp)
        - Aparece un botón close (X)
      Click en el card normal la pina con el activeAnnotation actual.
      Click en X la despina y el ciclo resume. */
  let expandedAnnotation = $state<MatchedGeniusAnnotation | null>(null);

  /** Lo que pediríamos mostrar si pudiéramos cambiar libremente. La
      precedencia sigue siendo expanded > active. */
  const requestedAnnotation = $derived<MatchedGeniusAnnotation | null>(
    expandedAnnotation ?? activeAnnotation
  );

  /** Lo que está realmente montado en el DOM.

      Patrón "icon anchor" (Apple Music / Apple TV+): el logo Genius
      ES la identidad del componente y persiste durante swaps entre
      anotaciones consecutivas. El wrap NO se desmonta entre dos
      anotaciones no-null — solo el CONTENIDO interno (fragment + body)
      hace cross-fade con stagger via `{#key displayedAnnotation.id}`
      en el template. La caja vítrea sigue ahí, el icono Genius sigue
      ahí, el texto pivota.

      annIn/annOut (1000ms cada uno) solo se disparan en transición
      null ↔ no-null (montaje real / desaparición real). Como no hay
      out→null→in entre swaps, ya no hay riesgo de choque y se elimina
      el sequencer manual con timer + outStartedAt + ANN_OUT_MS. */
  let visibleAnnotation = $state<MatchedGeniusAnnotation | null>(null);

  /** Flag CSS "está expandida" pintado en el DOM. Se actualiza junto
      con `visibleAnnotation` — sin desacoplar, porque ya no hay un
      "elemento saliendo con clases viejas" del que protegerse. */
  let displayedExpanded = $state(false);

  /** Marca si el wrap se acaba de montar fresh desde null (no swap).
      En ese caso, contentIn aplica delay grande (~700ms) para esperar
      a que la caja se haya desenrollado completamente — sin esto, el
      texto aparece dentro de una caja a medio abrir y se ve feo. En
      swap entre dos anotaciones (wrap persiste), delay corto (200ms)
      es suficiente porque la caja no se mueve.

      El flag se levanta cuando visibleAnnotation pasa de null→no-null
      y se baja con un setTimeout corto (50ms) tras el siguiente flush
      del DOM — tiempo de sobra para que las transitions svelte de
      contentIn se hayan instanciado (corren en el mismo tick del
      mount), pero antes de cualquier siguiente swap. */
  let freshMountInProgress = false;
  let freshMountResetTimer: ReturnType<typeof setTimeout> | null = null;

  /** Referencia al wrap del overlay Genius para animar su altura entre
      swaps de anotación. Sin esto, la altura del wrap salta entre A→B
      cuando A tiene 4 líneas de body y B tiene 1 (o viceversa). */
  let geniusWrapEl: HTMLDivElement | undefined = $state();
  let prevDisplayedId: string | null = null;
  let heightAnimTimers: Array<ReturnType<typeof setTimeout>> = [];

  /** Anima la altura del wrap durante un swap interno (A→B con wrap
      persistente). Workflow:
        1. $effect.pre captura altura del viejo ANTES del DOM update.
        2. Aplica height: <viejoH>px inline + transition: none.
        3. Tras 260ms (contentOut 240ms + buffer), el viejo desmonta y
           solo queda el nuevo en grid-stack.
        4. Liberamos height (auto) un instante para medir altura natural
           del nuevo solo (toH), re-aplicamos viejoH, force reflow.
        5. Aplicamos transition: height + altura target → animación.
        6. Tras 420ms, limpiamos los styles inline (vuelve a auto).

      grid-stack en .cp-genius-content y .cp-genius-fragment-anchor hace
      que ambos elementos coexistan en la misma celda durante el solape;
      esta función gestiona la altura del CONTENEDOR para que no salte. */
  function clearHeightTimers() {
    for (const t of heightAnimTimers) clearTimeout(t);
    heightAnimTimers = [];
  }

  $effect.pre(() => {
    const newId = visibleAnnotation?.id ?? null;
    const prev = prevDisplayedId;
    prevDisplayedId = newId;
    const el = geniusWrapEl;
    if (!el) return;
    // Solo swap interno entre dos no-null distintos. Mount/unmount real
    // los gestionan annIn/annOut del wrap, no esta animación.
    if (prev === null || newId === null || prev === newId) return;
    // En expanded el wrap tiene max-height + overflow auto — el alto ya
    // está cápeado y el cambio de contenido se gestiona vía scroll. Solo
    // animamos en compact donde el alto sigue al contenido.
    if (displayedExpanded) return;

    clearHeightTimers();
    const fromH = el.offsetHeight;
    el.style.height = `${fromH}px`;
    el.style.transition = 'none';

    heightAnimTimers.push(setTimeout(() => {
      if (!el.isConnected) return;
      el.style.height = '';
      const toH = el.offsetHeight;
      if (toH === fromH) {
        el.style.transition = '';
        return;
      }
      el.style.height = `${fromH}px`;
      void el.offsetHeight; // force reflow
      el.style.transition = 'height 380ms cubic-bezier(0.32, 0.72, 0, 1)';
      el.style.height = `${toH}px`;
      heightAnimTimers.push(setTimeout(() => {
        if (!el.isConnected) return;
        el.style.transition = '';
        el.style.height = '';
      }, 420));
    }, 260));
  });

  $effect(() => {
    const target = requestedAnnotation;
    const targetExpanded = expandedAnnotation !== null;
    const wasNull = visibleAnnotation === null;
    // Asignación directa siempre. Si target.id === current.id es no-op
    // de id, solo actualiza el flag expanded. Si cambia el id, el {#key}
    // interno gestiona cross-fade del contenido (el wrap se queda).
    visibleAnnotation = target;
    displayedExpanded = target ? targetExpanded : false;
    if (wasNull && target !== null) {
      freshMountInProgress = true;
      if (freshMountResetTimer !== null) clearTimeout(freshMountResetTimer);
      freshMountResetTimer = setTimeout(() => {
        freshMountInProgress = false;
        freshMountResetTimer = null;
      }, 50);
    }
  });

  onMount(() => () => {
    if (freshMountResetTimer !== null) clearTimeout(freshMountResetTimer);
    clearHeightTimers();
  });

  const displayedAnnotation = $derived<MatchedGeniusAnnotation | null>(visibleAnnotation);

  function toggleExpand(e: MouseEvent) {
    e.stopPropagation();
    if (expandedAnnotation) {
      expandedAnnotation = null;
    } else if (activeAnnotation) {
      expandedAnnotation = activeAnnotation;
    }
  }

  /** Linkifica el body de Genius: detecta URLs http(s) — incluidas las de
      YouTube, que son las que el director pidió tratar como links — y
      devuelve segmentos `text | link` para render condicional con `<a
      target="_blank">`. Evitamos `{@html}` por XSS (el body viene de
      contribuidores anónimos de Genius). El regex acepta el set típico
      de URL chars y corta en whitespace o cierre de paréntesis/coma. */
  type BodySegment =
    | { type: 'text'; value: string }
    | { type: 'link'; href: string; label: string };

  function linkify(text: string): BodySegment[] {
    const out: BodySegment[] = [];
    const rx = /\bhttps?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > last) {
        out.push({ type: 'text', value: text.slice(last, m.index) });
      }
      const href = m[0];
      out.push({ type: 'link', href, label: prettifyUrl(href) });
      last = m.index + href.length;
    }
    if (last < text.length) {
      out.push({ type: 'text', value: text.slice(last) });
    }
    return out;
  }

  /** Acorta una URL para mostrarla más legible: youtu.be/abc123 o
      youtube.com/watch?v=… → "youtube.com · abc123" tipo etiqueta. Para
      URLs genéricas, solo host + path corto. */
  function prettifyUrl(href: string): string {
    try {
      const u = new URL(href);
      const host = u.host.replace(/^www\./, '');
      if (host === 'youtu.be' || host === 'youtube.com' || host === 'm.youtube.com') {
        const id = u.searchParams.get('v') ?? u.pathname.replace(/^\//, '');
        return id ? `youtube.com · ${id.slice(0, 11)}` : 'youtube.com';
      }
      const path = u.pathname.length > 1 ? u.pathname : '';
      return `${host}${path.length > 22 ? path.slice(0, 22) + '…' : path}`;
    } catch {
      return href;
    }
  }

  const bodySegments = $derived(
    displayedAnnotation ? linkify(displayedAnnotation.body) : []
  );

  // ─── Animaciones del wrap Genius ────────────────────────────────────
  // Coreografía 1000ms en 4 keyframes interpolados por smoothstep global.
  // annIn y annOut son ESPEJO TEMPORAL EXACTO: el valor en t=0 de annIn
  // es el valor en u=1 de annOut, y viceversa. Una sola curva (smoothstep
  // dentro de cada segmento) gobierna todas las propiedades — sincronía
  // perfecta entre cardScaleX, cardScaleY, iconScale, iconRotate.
  //
  // Las animaciones del wrap solo se disparan en transiciones null↔no-null
  // (montaje real). Entre dos anotaciones consecutivas el wrap se queda
  // anclado y solo el contenido interno hace cross-fade — ver el {#key}
  // en el template y las transitions contentIn/contentOut más abajo.

  /** Smoothstep: curva C¹-continua (acelera al inicio, decelera al final).
      Aplicada DENTRO de cada segmento de keyframes para evitar las
      discontinuidades de aceleración que generaba el viejo approach
      multi-easing-por-fase. */
  function easeStep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  /** Interpola un valor a lo largo de keyframes ordenados [g, value].
      `g` es el progreso global (0→1). Cada segmento se suaviza con
      smoothstep local, así toda la coreografía respira con una única
      curva — los movimientos se sincronizan visualmente sin parecer
      "fases discretas". */
  function kf(g: number, frames: Array<[number, number]>): number {
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1] = frames[i]!;
      if (g <= t1) {
        const [t0, v0] = frames[i - 1]!;
        const span = t1 - t0;
        if (span === 0) return v1;
        return v0 + (v1 - v0) * easeStep((g - t0) / span);
      }
    }
    return frames[frames.length - 1]![1];
  }

  /** Detección de prefers-reduced-motion. Las Svelte transitions JS no
      son cubiertas por @media (prefers-reduced-motion) del CSS — hay
      que gatearlo aquí. */
  function reducedMotion(): boolean {
    return typeof window !== 'undefined' &&
      !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  /** ── Entrada del wrap (mount real desde null) ─────────────────────
      Espejo temporal exacto del annOut: empieza desde el estado final
      del out (scaleX 0.14, scaleY 0.50, icon rotate -90° scale 0) y
      progresa al reposo (1, 1, 0°, 1). El icono nace girado y se
      despierta haciendo el camino inverso del spin-out. */
  function annIn(_node: Element) {
    if (reducedMotion()) {
      return {
        duration: 220,
        easing: quintOut,
        css: (t: number) => `transform: translateX(-50%); opacity: ${t};`
      };
    }
    return {
      duration: 1000,
      easing: linear, // smoothstep ya está dentro de kf — no aplicar doble curva
      css: (g: number) => {
        const cardScaleX = kf(g, [[0, 0.14], [0.30, 0.14], [0.70, 0.94], [1, 1]]);
        const cardScaleY = kf(g, [[0, 0.50], [0.30, 1.10], [0.70, 0.88], [1, 1]]);
        const iconScale  = kf(g, [[0, 0],    [0.30, 1.16], [0.70, 1.10], [1, 1]]);
        // Rotación horaria: el icono nace girado +90° y desrota a 0°
        // (espejo del annOut que rota 0° → +90°).
        const iconRotate = kf(g, [[0, 90],   [0.30, 68],   [0.70, 30],   [1, 0]]);
        const overallOp  = kf(g, [[0, 0],    [0.30, 1],    [1, 1]]);
        // --cp-content-opacity NO se controla aquí: contentIn/contentOut
        // de los hijos (fragment, text-stack) gobiernan su propia opacidad.
        // Doble control multiplicaba opacities durante mount real.
        return `
          transform: translateX(-50%) scaleX(${cardScaleX}) scaleY(${cardScaleY});
          transform-origin: left center;
          opacity: ${overallOp};
          --cp-icon-scale: ${iconScale};
          --cp-icon-rotate: ${iconRotate}deg;
          --cp-icon-counter-scale: ${1 / Math.max(cardScaleX, 0.001)};
        `;
      }
    };
  }

  /** ── Salida del wrap (unmount real a null) ─────────────────────────
      Coreografía gelatinosa squash → suction → spin-out, 1000ms con
      smoothstep global. Apple Music / Disney squash-&-stretch aplicado
      a UI: la caja primero se aplasta (Y 1→0.88), luego se contrae con
      stretch vertical (Y 0.88→1.10, sensación de "ser absorbido"), y
      finalmente colapsa (Y 1.10→0.50) mientras el icono completa su
      spin-out (rotate -68°→-90°, scale 1.10→0).

      transform-origin: left center → el icono es el centro de gravedad;
      todo colapsa hacia su posición. */
  function annOut(_node: Element) {
    if (reducedMotion()) {
      return {
        duration: 180,
        easing: quintIn,
        css: (t: number) => `transform: translateX(-50%); opacity: ${t};`
      };
    }
    return {
      duration: 1000,
      easing: linear,
      css: (_t: number, u: number) => {
        const cardScaleX = kf(u, [[0, 1],    [0.30, 0.94], [0.70, 0.14], [1, 0.14]]);
        const cardScaleY = kf(u, [[0, 1],    [0.30, 0.88], [0.70, 1.10], [1, 0.50]]);
        const iconScale  = kf(u, [[0, 1],    [0.30, 1.10], [0.70, 1.16], [1, 0]]);
        // Rotación horaria (clockwise): 0° → +90° en lugar de -90°.
        const iconRotate = kf(u, [[0, 0],    [0.30, 30],   [0.70, 68],   [1, 90]]);
        const overallOp  = kf(u, [[0, 1],    [0.70, 1],    [1, 0]]);
        // --cp-content-opacity NO se controla aquí — ver comentario en annIn.
        return `
          transform: translateX(-50%) scaleX(${cardScaleX}) scaleY(${cardScaleY});
          transform-origin: left center;
          opacity: ${overallOp};
          --cp-icon-scale: ${iconScale};
          --cp-icon-rotate: ${iconRotate}deg;
          --cp-icon-counter-scale: ${1 / Math.max(cardScaleX, 0.001)};
        `;
      }
    };
  }

  /** ── Cross-fade del contenido interno (swap entre anotaciones) ─────
      Cuando el wrap NO se desmonta (icon anchor), el contenido interno
      —fragment header y body— se intercambia con stagger sutil. Out
      rápido (240ms) con slight lift, in con delay 200ms (espera a que
      el anterior salga) y settle desde abajo. 440ms total — mucho más
      ágil que los 1000ms del wrap, porque aquí solo cambia el texto. */
  function contentOut(_node: Element) {
    if (reducedMotion()) {
      return { duration: 120, css: (t: number) => `opacity: ${t};` };
    }
    return {
      duration: 240,
      easing: quintIn,
      css: (t: number, u: number) => `
        opacity: ${t};
        transform: translateY(${u * -3}px);
      `
    };
  }
  function contentIn(_node: Element) {
    // Delay condicional: 700ms cuando es mount real (wrap acaba de
    // aparecer desde null — espera a que la caja termine de desenrollarse
    // ~700ms según los keyframes del annIn), 200ms en swap interno (la
    // caja no se mueve, solo cross-fade con stagger). Sin esta distinción,
    // en mount real el texto aparecería dentro de una caja a medio abrir.
    const isFreshMount = freshMountInProgress;
    if (reducedMotion()) {
      return {
        duration: 160,
        delay: isFreshMount ? 600 : 120,
        css: (t: number) => `opacity: ${t};`
      };
    }
    return {
      duration: isFreshMount ? 280 : 320,
      delay: isFreshMount ? 700 : 200,
      easing: quintOut,
      css: (t: number, u: number) => `
        opacity: ${t};
        transform: translateY(${u * 4}px);
      `
    };
  }

  /** Stagger de aparición/cierre de elementos expanded-only (fragment
      citado + atribución). Slide vertical sutil + fade. Duración corta
      (280ms) para que el out termine antes de que el overlay complete
      su shrink (max-height/padding transition ~380ms) — los elementos
      no quedan "atrapados" dentro de un overlay colapsando. */
  function expandFly(_node: Element, opts: { delay?: number; y?: number } = {}) {
    const { delay = 0, y = -4 } = opts;
    if (reducedMotion()) {
      return { duration: 140, delay, css: (t: number) => `opacity: ${t};` };
    }
    return {
      duration: 280,
      delay,
      easing: quintOut,
      css: (t: number, u: number) => `
        opacity: ${t};
        transform: translate3d(0, ${u * y}px, 0);
      `
    };
  }

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
  // `player.currentSong` es la fuente de verdad del "qué suena ahora", tanto
  // en local como en Audiorr Connect (en remoto, `track_change` la actualiza
  // pero `queueManager.currentIndex` no avanza track-a-track, así que
  // `qmCurrent` queda stale apuntando a la canción inicial de la queue).
  // El `qmCurrent.artistId` solo lo usamos como atajo cuando coincide con
  // la canción que de verdad suena — evita el search3 redundante en local
  // sin arrastrar artist names obsoletos en remoto.
  const qmCurrent = $derived(queueManager.currentSong);
  const playerSong = $derived(player.currentSong);
  const artistName = $derived(playerSong?.artist ?? '');
  const directArtistId = $derived(
    qmCurrent && qmCurrent.id === playerSong?.id ? (qmCurrent.artistId ?? '') : ''
  );

  // ─── Fuente del stage: canvas → motion artwork → carátula ──────────────
  // El canvas de la canción manda. Si no hay, caemos al motion artwork del
  // álbum (Apple Music-style). Si tampoco, a la carátula estática. Así el
  // panel SIEMPRE tiene algo que enseñar y no hace falta cerrarlo al saltar
  // a una canción sin canvas — mismo modelo que el right rail de Spotify.
  const canvasVideoUrl = $derived(canvas.videoUrl);

  // albumId fiable solo cuando queueManager y player apuntan a la misma
  // canción (en remoto qmCurrent queda stale — mismo guard que artistId).
  const artworkAlbumId = $derived(
    qmCurrent && qmCurrent.id === playerSong?.id ? (qmCurrent.albumId ?? null) : null
  );
  // Solo pedimos motion artwork cuando NO hay canvas (evita fetch inútil).
  const artworkQ = createQuery(() => ({
    queryKey: ['albumArtwork', artworkAlbumId ?? ''],
    queryFn: () => fetchAlbumArtwork(artworkAlbumId!),
    enabled: !canvasVideoUrl && !!artworkAlbumId,
    staleTime: 1000 * 60 * 10,
    retry: false
  }));
  const motionVideoUrl = $derived(
    canvasVideoUrl ? null : resolveArtworkVideoUrl(artworkQ.data ?? null)
  );

  /** Vídeo a reproducir en el stage (canvas o motion artwork). null → carátula. */
  const displayVideoUrl = $derived(canvasVideoUrl ?? motionVideoUrl);

  /** Carátula estática de fallback ("canvas álbum"). Mismo criterio que el hero
      del NowPlaying: id raw del queueManager (retina 640px) solo si coincide con
      la canción que suena; si no, el coverUrl del player (payload local/remoto). */
  const coverFallbackUrl = $derived.by(() => {
    if (qmCurrent?.coverArt && qmCurrent.id === playerSong?.id) {
      return getCoverArtUrl(qmCurrent.coverArt, 640);
    }
    return playerSong?.coverUrl ?? null;
  });

  /** true → se muestra la carátula estática en vez de un <video>. */
  const showCover = $derived(!displayVideoUrl || videoError);

  // Reset del flag de error al cambiar de fuente de vídeo.
  $effect(() => {
    void displayVideoUrl;
    videoError = false;
  });

  // Gestión imperativa del <video> ÚNICO reutilizado: fija/actualiza el src y
  // sincroniza play/pausa (local o Audiorr Connect vía player.isPlaying). Al
  // cambiar de fuente, load() suelta el recurso anterior; sin fuente (carátula)
  // liberamos del todo con releaseVideo → un solo decoder vivo, la memoria no
  // crece aunque pasen muchas canciones. document.hidden tiene prioridad.
  $effect(() => {
    const el = videoEl;
    const url = displayVideoUrl;
    if (!el) return;
    if (!url || videoError) {
      releaseVideo(el);
      return;
    }
    if (el.getAttribute('src') !== url) {
      el.src = url;
      el.load();
    }
    el.muted = true;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (player.isPlaying && !hidden) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  });

  let artist = $state<NavidromeArtist | null>(null);
  let artistInfo = $state<NavidromeArtistInfo | null>(null);
  let topSongs = $state<NavidromeSong[]>([]);
  /** Cache simple en componente para no resolver el mismo name dos veces. */
  let resolvedArtistId = $state('');
  /** Guards para no re-fetch cuando los effects se re-disparan. */
  let lastFetchedArtistId = '';
  let lastFetchedArtistName = '';
  let lastResolvedFromName = '';

  /** Resolve cadena: si tenemos artistId directo del queueManager, lo usamos.
      Si no, miramos `lastResolvedFromName` (cache) y si no, hacemos
      search3 con el name. Solo busca cuando el name cambió. */
  $effect(() => {
    if (directArtistId) {
      resolvedArtistId = directArtistId;
      return;
    }
    const name = artistName;
    if (!name) {
      resolvedArtistId = '';
      return;
    }
    if (name === lastResolvedFromName) return;
    lastResolvedFromName = name;
    // Cap a artistCount=3 — búsqueda barata, suficiente para encontrar
    // match exacto. Si Subsonic no devuelve nada, queda en cadena vacía
    // (el efecto de fetch no disparará y no se renderiza la sección).
    void search3(name, { artistCount: 3, albumCount: 0, songCount: 0 })
      .then((res) => {
        if (name !== lastResolvedFromName) return;
        const exact = res.artists.find(
          (a) => a.name.toLowerCase() === name.toLowerCase()
        );
        const chosen = exact ?? res.artists[0];
        if (chosen) resolvedArtistId = chosen.id;
      })
      .catch(() => {});
  });

  $effect(() => {
    const id = resolvedArtistId;
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

  /** Si el `<img>` del avatar falla la carga (URL rota, 404, CORS),
      caemos al placeholder en lugar de dejar el icono de imagen rota.
      Se resetea cada vez que cambia la URL para volver a intentar. */
  let artistImageBroken = $state(false);
  $effect(() => {
    artistImageUrl;
    artistImageBroken = false;
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
      <!-- <video> ÚNICO y persistente: el src lo gestiona un $effect imperativo
           para poder liberar el recurso al cambiar de fuente / desmontar. Se
           oculta (no se desmonta) cuando toca carátula, para reutilizar el mismo
           decoder. use:videoTeardown lo libera al desmontar el panel. -->
      <video
        bind:this={videoEl}
        class="cp-video"
        class:cp-hidden={showCover}
        muted
        loop
        playsinline
        preload="auto"
        disablePictureInPicture
        aria-hidden="true"
        onerror={() => (videoError = true)}
        use:videoTeardown
      ></video>
      {#if showCover}
        {#if coverFallbackUrl}
          <!-- "Canvas álbum": la carátula estática cuando no hay canvas ni
               motion artwork, para que el panel no se cierre entre canciones. -->
          <img class="cp-cover" src={coverFallbackUrl} alt="" />
        {:else}
          <div class="cp-placeholder" aria-hidden="true">
            <MusicNoteSimple size={56} weight="fill" />
          </div>
        {/if}
      {/if}

      <!-- ─── Lyric banner: línea activa con vertical swap ─────────────
           Vive en absolute top del stage, sobre el video. Se muestra solo
           cuando la letra es synced (sino no sabemos qué línea suena).
           {#key activeLine.id} fuerza desmount/mount cuando cambia la
           línea — la antigua sale hacia arriba con fade, la nueva entra
           desde abajo. Stage absolute con altura fija para permitir el
           overlap (ambas comparten posición durante 100ms). -->
      {#if activeLine}
        <div class="cp-lyric-stage" aria-live="polite" aria-atomic="true">
          {#key activeLine.id}
            <p
              class="cp-lyric-line"
              in:lyricIn
              out:lyricOut
            >
              <span class="cp-lyric-text" style:font-size="{lyricFontSize}px">
                {activeLine.text}
              </span>
            </p>
          {/key}
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

      <!-- ─── Curiosidad de Genius — overlay flotante ─────────────────
           Vive sobre el video, cuadrante inferior, encima del peek
           hint. La animación es un `clip-path` radial que crece desde
           el icono Genius hacia fuera — sensación de "punto que se
           expande", no scale uniforme. El icono Genius amarillo es la
           firma identificable; el texto aparece después con stagger
           interno (CSS var controlada por la transition).

           Sin caja sólida pronunciada — el bg es casi transparente
           para no romper la estética cinematográfica del canvas. La
           legibilidad la da el text-shadow del contenido, no un panel
           oscuro plantado encima del video. -->
      {#if displayedAnnotation}
        <!-- Wrapper que agrupa fragment-anchor (citation header) y
             overlay (caja de curiosidad) como UNA SOLA caja unificada.
             Patrón ICON ANCHOR: el wrap NO se desmonta cuando cambia
             displayedAnnotation.id entre dos no-null — solo el contenido
             textual interno (envuelto en {#key}) hace cross-fade. El
             logo Genius persiste como identidad. annIn/annOut solo
             corren en mount/unmount real (null↔no-null). -->
        <div
          bind:this={geniusWrapEl}
          class="cp-genius-wrap"
          class:expanded={displayedExpanded}
          class:has-fragment={!!displayedAnnotation.fragment}
          role="button"
          tabindex="0"
          aria-live="polite"
          aria-label={displayedExpanded
            ? 'Anotación expandida — toca para cerrar'
            : 'Anotación — toca para leer entera'}
          onclick={toggleExpand}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpand(e as unknown as MouseEvent);
            }
          }}
          in:annIn|global
          out:annOut|global
        >
          <!-- Fragment "header" — cross-fade interno por id en swaps.
               Border-radius solo arriba, pegado al overlay sin gap.
               Al expandir, sin clamp (texto entero visible). El {#key}
               envuelve solo el <p> para que el .cp-genius-fragment-anchor
               (contenedor) persista junto con el wrap. -->
          <div class="cp-genius-fragment-anchor" aria-hidden="true">
            {#key displayedAnnotation.id}
              {#if displayedAnnotation.fragment}
                <p
                  class="cp-genius-fragment"
                  in:contentIn|global
                  out:contentOut|global
                >
                  <span class="cp-genius-quote">&ldquo;</span>{displayedAnnotation.fragment}
                </p>
              {/if}
            {/key}
          </div>

          <div
            class="cp-genius-overlay"
            class:expanded={displayedExpanded}
          >
            <!-- Badge wrapper: PERSISTENTE (fuera del {#key}). Logo
                 Genius como identidad del componente. El dot verified
                 también persiste — su visibilidad puede cambiar entre
                 anotaciones con/sin verified, lo aceptamos como pop
                 sutil. -->
            <span class="cp-genius-badge" aria-hidden="true">
              <span class="cp-genius-icon"></span>
              {#if displayedAnnotation.verified}
                <span
                  class="cp-genius-verified-dot"
                  title="Verificada por Genius"
                  aria-label="Verificada por Genius"
                >
                  <Check size={8} weight="bold" />
                </span>
              {/if}
            </span>
            <div class="cp-genius-content">
              <!-- Body + attribution con cross-fade por id en swaps.
                   Stagger: contentOut 240ms del actual, contentIn 320ms
                   con delay 200ms (espera salida) del nuevo. Total swap
                   interno ~440ms vs los 1000ms del wrap completo. -->
              {#key displayedAnnotation.id}
                <div
                  class="cp-genius-text-stack"
                  in:contentIn|global
                  out:contentOut|global
                >
                  <!-- Body con linkify de URLs (YouTube y genéricas).
                       Las URLs van a target="_blank" con stopPropagation
                       para no cerrar el overlay al pinchar el enlace. -->
                  <p class="cp-genius-body">
                    {#each bodySegments as seg, i (i)}
                      {#if seg.type === 'link'}
                        <a
                          class="cp-genius-link"
                          href={seg.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onclick={(e) => e.stopPropagation()}
                        >{seg.label}</a>
                      {:else}{seg.value}{/if}
                    {/each}
                  </p>
                  <!-- Atribución SOLO en expanded — el normal queda
                       minimalista. Stagger sutil con expandFly. -->
                  {#if displayedExpanded && displayedAnnotation.authorName}
                    <p
                      class="cp-genius-attr"
                      transition:expandFly={{ delay: 180, y: 4 }}
                    >
                      <span class="cp-genius-author">— {displayedAnnotation.authorName}</span>
                        {#if displayedAnnotation.verified}
                          <span class="cp-genius-verified-tag">
                            <SealCheck size={11} weight="fill" />
                            Verificada
                          </span>
                        {/if}
                      </p>
                    {/if}
                  </div>
                {/key}
              </div>
            </div>
          </div>
      {/if}
    </div>

    <!-- ─── ARTIST INFO: cards diferenciadas estilo Spotify right rail ─
         El bloque entero scroll-reveal queda lurking 60px abajo del video.
         Cada card tiene su propio bg sólido + border + radius para que se
         distingan visualmente del fondo dark del panel. -->
    {#if artist || artistInfo || topSongs.length > 0}
      <div bind:this={infoEl} class="cp-info-wrap">
        <!-- ─── Card 1: About the artist ──────────────────────────────
             Hero card mirror Spotify "About the artist": avatar full-width
             como image-banner, kicker + nombre + bio debajo. -->
        <article class="cp-card cp-about">
          <svelte:element
            this={resolvedArtistId ? 'a' : 'div'}
            class="cp-about-cover"
            class:linked={!!resolvedArtistId}
            href={resolvedArtistId ? `/artist/${resolvedArtistId}` : undefined}
            aria-label={resolvedArtistId
              ? `Ir al perfil de ${artist?.name ?? artistName}`
              : undefined}
          >
            {#if artistImageUrl && !artistImageBroken}
              <img
                class="cp-about-img"
                src={artistImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onerror={() => (artistImageBroken = true)}
              />
            {:else}
              <div class="cp-about-placeholder" aria-hidden="true">
                <MusicNoteSimple size={48} weight="fill" />
              </div>
            {/if}
            <div class="cp-about-scrim"></div>
            <div class="cp-about-overlay">
              <span class="cp-card-kicker">Acerca del artista</span>
              <h3 class="cp-about-name">{artist?.name ?? artistName}</h3>
            </div>
          </svelte:element>
          {#if cleanBio}
            <p class="cp-about-bio">{cleanBio}</p>
          {/if}
        </article>

        <!-- ─── Card 2: Populares ─────────────────────────────────────
             Lista de top tracks por nombre del artista (Last.fm via
             Subsonic getTopSongs). Click reproduce inmediato sin perder
             la cola actual (insertNext + skipNext). -->
        {#if topSongs.length > 0}
          <article class="cp-card cp-populars">
            <header class="cp-card-head">
              <span class="cp-card-kicker">Populares</span>
            </header>
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
          </article>
        {/if}
      </div>
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
     + clip) mientras el contenido scrollea internamente.

     `--cp-base-bg` es el color base compartido entre el stage y la zona de
     info para que la transición video → cards no muestre un step de color.
     El video usa mask-image que desvanece sus 80px finales, exponiendo
     este bg de forma uniforme en toda la franja del fade. */
  .canvas-panel {
    --cp-base-bg: rgb(8, 10, 14);
    grid-area: canvas;
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    background: var(--cp-base-bg);
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

  /* Stage del video: altura EXACTA del viewport scroll menos el peek de
     60px que invita al scroll-reveal. `height` (no min-height) garantiza
     que el video pegue exactamente al top sin franja negra arriba.

     Display block + position relative + media en absolute inset:0 fuerza
     que el video llene 100% sin posibilidad de centrado vertical raro
     que el flex+align-items podía dejar.

     bg comparte el mismo color que el wrap (--cp-base-bg) para que la
     transición video → info sea sobre fondo continuo. */
  .cp-stage {
    position: relative;
    width: 100%;
    height: calc(100% - 60px);
    overflow: hidden;
    background: var(--cp-base-bg);
  }
  /* La media (video o placeholder) se desvanece a transparente en sus
     últimos ~80px con mask-image. El bg común del stage queda visible en
     esa zona, fundiendo de forma natural con el wrap de info que viene
     debajo. Resultado: ya no hay un corte recto entre el video y la zona
     de cards — la transición es suave, casi imperceptible. */
  .cp-video,
  .cp-cover,
  .cp-placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    -webkit-mask-image: linear-gradient(
      180deg,
      #000 0%,
      #000 calc(100% - 80px),
      transparent 100%
    );
    mask-image: linear-gradient(
      180deg,
      #000 0%,
      #000 calc(100% - 80px),
      transparent 100%
    );
  }
  /* Vídeo reutilizado: oculto (no desmontado) cuando toca carátula. */
  .cp-video.cp-hidden {
    display: none;
  }
  .cp-placeholder {
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
    background:
      radial-gradient(circle at 30% 20%, oklch(0.5 0.12 280), transparent 60%),
      radial-gradient(circle at 70% 80%, oklch(0.45 0.14 200), transparent 55%),
      linear-gradient(135deg, oklch(0.2 0.05 250), oklch(0.1 0.03 250));
  }

  /* ─── Lyric banner ──────────────────────────────────────────────────
     "Vertical text swap" estilo Apple Music. SIN glass background — la
     letra vive directamente sobre el video. La legibilidad la garantizan
     dos capas de text-shadow: una tight oscura para definir el borde de
     cada glifo, otra larga difusa que crea un halo soft que ayuda en
     frames muy claros del video.

     Tamaño dinámico (lyricFontSize): cortas → hero grande, largas →
     contenidas. Patrón Apple Music donde "Take on me" se ve enorme y
     una bridge de 12 palabras se ajusta.

     Al cambiar de línea, la antigua sale hacia arriba con fade y la
     nueva entra desde abajo, con overlap natural durante ~140ms (in:
     460ms cubicOut, out: 320ms cubicIn — el entrante es más lento que
     el saliente para que la atención del ojo aterrice en la nueva
     línea, principio Apple).

     `aria-live="polite"` anuncia el cambio a screen readers sin
     interrumpir lectura en curso. */
  .cp-lyric-stage {
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    width: calc(100% - 32px);
    max-width: 360px;
    /* Altura fija para permitir hasta 2 líneas del tamaño más grande
       sin layout shift. Las posiciones absolute internas hacen overlap
       durante el swap sin empujarse mutuamente. */
    min-height: 72px;
    pointer-events: none;
    z-index: 2;
  }
  .cp-lyric-line {
    position: absolute;
    inset: 0;
    margin: 0;
    /* Flex container para centrar el .cp-lyric-text vertical y
       horizontalmente sea cual sea su altura (1 o 2 líneas). */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    will-change: transform, opacity;
  }
  .cp-lyric-text {
    /* Wrap a 2 líneas máx con line-clamp. La gran mayoría de letras
       caben en 1, pero alguna bridge larga necesita la 2ª. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: center;
    color: #fff;
    font-family: var(--font-sans);
    /* font-size inyectado via style inline (dinámico según longitud) */
    font-weight: 600;
    letter-spacing: var(--tracking-snug);
    line-height: 1.25;
    /* `filter: drop-shadow` produce un blur gaussiano REAL sobre la
       silueta del texto — a diferencia de text-shadow, no genera
       "duplicados" desplazados que recortan visualmente cuando el blur
       es bajo. Dos capas grandes muy difusas dan una "atmósfera oscura"
       alrededor de las letras sin contornos duros. Ideal para overlay
       sobre video con frames impredecibles.

       Capa 1: cerca (8px) y opaca = define la silueta
       Capa 2: lejana (24px) y suave = halo atmosférico amplio
       Sin capa de 1-2px que es la que recortaba antes. */
    filter:
      drop-shadow(0 2px 8px rgba(0, 0, 0, 0.55))
      drop-shadow(0 4px 24px rgba(0, 0, 0, 0.35));
  }

  @media (prefers-reduced-motion: reduce) {
    .cp-lyric-line {
      transition: none;
    }
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

  /* ─── ARTIST INFO WRAP ───────────────────────────────────────────────
     Container del scroll-reveal. Padding generoso, gap entre cards. NO
     necesita gradient propio — el bg base del panel es el mismo que se
     ve durante el fade del video (mask-image en .cp-video). La transición
     queda continua y sin step. Cada card hija tiene SU PROPIO bg sólido
     (cp-card) para distinguirse del backdrop común. */
  .cp-info-wrap {
    padding: var(--space-5) var(--space-4) var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    color: rgba(255, 255, 255, 0.92);
  }

  /* ─── Card base ─────────────────────────────────────────────────────
     Surface elevada con border, radius lg. Patrón Spotify: cada bloque
     informativo es una caja clara, fácil de escanear. Bg con leve
     elevation sobre el wrap dark. */
  .cp-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: var(--radius-lg);
    overflow: hidden;
    isolation: isolate;
  }
  .cp-card-head {
    padding: var(--space-3) var(--space-4) 0;
  }
  .cp-card-kicker {
    display: block;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(255, 255, 255, 0.6);
  }

  /* ─── Card "About the artist" ───────────────────────────────────────
     Cover image full-width como hero (similar a Spotify "About the
     artist"). Scrim oscuro abajo + overlay con kicker + nombre Söhne 700.
     Bio debajo, clamp 6 líneas con fade. */
  .cp-about-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.04);
    display: block;
  }
  /* Variante linked: el bloque se convierte en <a> al perfil del artista
     (cuando resolvedArtistId existe). Sin underline ni cambio de color de
     texto — el feedback visual es un zoom sutil de la imagen + leve lift
     del scrim (mismo lenguaje que las cards de artista del home). */
  .cp-about-cover.linked {
    cursor: pointer;
    text-decoration: none;
    color: inherit;
  }
  .cp-about-cover.linked .cp-about-img,
  .cp-about-cover.linked .cp-about-placeholder {
    transition: transform var(--duration-normal) var(--ease-ios-default);
  }
  .cp-about-cover.linked:hover .cp-about-img,
  .cp-about-cover.linked:hover .cp-about-placeholder {
    transform: scale(1.04);
  }
  .cp-about-cover.linked:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .cp-about-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cp-about-placeholder {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.3);
    background:
      radial-gradient(circle at 30% 30%, oklch(0.4 0.1 280), transparent 60%),
      radial-gradient(circle at 70% 70%, oklch(0.35 0.12 200), transparent 55%);
  }
  /* Scrim degradado al fondo de la cover para que el overlay de texto
     blanco lea sobre cualquier imagen. */
  .cp-about-scrim {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      transparent 35%,
      rgba(0, 0, 0, 0.55) 70%,
      rgba(0, 0, 0, 0.85) 100%
    );
  }
  .cp-about-overlay {
    position: absolute;
    left: var(--space-4);
    right: var(--space-4);
    bottom: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cp-about-overlay .cp-card-kicker {
    color: rgba(255, 255, 255, 0.85);
  }
  .cp-about-name {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: #fff;
    line-height: 1.15;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cp-about-bio {
    margin: 0;
    padding: var(--space-3) var(--space-4) var(--space-4);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.72);
    /* Clamp 6 líneas — Spotify tampoco muestra biografías enteras inline.
       Si quieres leer todo, vas al artist page. */
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* ─── Curiosidad de Genius — overlay flotante sobre el video ─────────
     Wrapper que agrupa el fragment-anchor (pull-quote citada de la
     letra) y el overlay (la curiosidad propiamente). Centrado abajo
     del stage; al expandir el overlay, el wrapper crece hacia arriba
     y el fragment-anchor sube con él como una sola unidad visual.

     Filosofía del overlay: NO dominar el video — el canvas YA tiene su
     lyric flotante arriba, su peek hint abajo, y el propio video como
     protagonista. Esta capa debe sentirse "respirando con" el entorno,
     no "puesta encima de él". */
  .cp-genius-wrap {
    position: absolute;
    /* 76px = espacio para el peek hint (18+26+32) */
    bottom: 76px;
    left: 50%;
    transform: translateX(-50%);
    width: calc(100% - 24px);
    max-width: 340px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    /* Sin gap: fragment-anchor y overlay viven pegados, comparten bg
       y bordes — son una sola caja visual unificada. */
    gap: 0;
    z-index: 3;
    pointer-events: auto;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    /* UNA SOLA superficie: bg + blur + radius viven AQUÍ. Los hijos
       (fragment + overlay) son transparentes, así no hay dos blurs
       solapados ni dos bgs con leves diferencias de tinte. Apple-grade
       cohesion: la caja es una y solo una. Bg a 0.48 → el panel ES la
       legibilidad (Apple Music/Spotify Canvas pattern); por eso el
       body NO lleva drop-shadow — el material vítreo basta. */
    background: rgba(0, 0, 0, 0.48);
    backdrop-filter: blur(16px) saturate(1.4);
    -webkit-backdrop-filter: blur(16px) saturate(1.4);
    border-radius: 14px;
    color: #fff;
    /* `overflow: hidden` clippea cualquier sangrado de hijos al radius
       y permite el scroll interno cuando .expanded sin perder bordes. */
    overflow: hidden;
    will-change: transform, opacity;

    /* Toggle compact↔expanded animado por CSS: bg/blur/padding/altura.
       Las transitions svelte (annIn/annOut) son SOLO entrada/salida de
       la caja entera; el compact↔expanded de la misma anotación vive
       acá para que no se solape con annIn|out durante swaps. */
    transition:
      background 280ms var(--ease-ios-default, ease),
      backdrop-filter 280ms var(--ease-ios-default, ease),
      -webkit-backdrop-filter 280ms var(--ease-ios-default, ease),
      max-height 380ms var(--ease-ios-default, ease);
  }
  .cp-genius-wrap:hover:not(.expanded) {
    background: rgba(0, 0, 0, 0.55);
  }
  .cp-genius-wrap.expanded {
    background: rgba(0, 0, 0, 0.78);
    backdrop-filter: blur(28px) saturate(1.6);
    -webkit-backdrop-filter: blur(28px) saturate(1.6);
    /* Reserva top ~280px para no invadir el lyric banner sincronizado.
       overflow-y auto deja scrollear si el body es muy largo. */
    max-height: calc(100vh - 280px);
    overflow-y: auto;
    overflow-x: hidden;
  }
  .cp-genius-wrap:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.3);
  }

  .cp-genius-overlay {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    /* `align-items: flex-start` mantiene el icono arriba-izq incluso
       cuando el texto es largo (3-4 líneas). Antes con center, el icono
       se hundía al medio del texto largo y quedaba desbalanceado. */
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px 12px 10px;
    box-sizing: border-box;
    /* Sin bg/blur/radius propios — los aporta el wrap padre como una
       sola superficie. Transparente para que la unidad visual sea
       fragment+overlay sobre el mismo bg. */
    background: transparent;
    color: #fff;
    transition: padding 380ms var(--ease-ios-default, ease);
  }
  /* Pequeño margin top en el badge wrapper para que con texto de 1
     línea quede equilibrado vertical; con texto multi-línea, el icono
     queda en su posición top-aligned (style "callout"). */
  .cp-genius-badge {
    margin-top: 2px;
  }
  /* Estado expanded del overlay: solo padding cambia (más respiración).
     bg/blur/altura los gestiona el wrap padre. */
  .cp-genius-overlay.expanded {
    padding: 14px 14px 14px 12px;
  }
  .cp-genius-overlay.expanded .cp-genius-body {
    /* Sin clamp: texto completo visible. */
    -webkit-line-clamp: unset;
    line-clamp: unset;
    display: block;
  }
  /* Indicador "..." al final del body cuando NO está expanded y el
     texto fue clampeado. Sutil — solo se ve si hay overflow. */
  .cp-genius-body {
    position: relative;
  }

  /* Link inline dentro del body — apariencia minimal, accent color del
     producto (no el rojo de YouTube por coherencia con la paleta del
     panel). Subrayado solo en hover para no romper la legibilidad del
     párrafo. Padding-y de 1px hace target táctil decente sin alterar
     la línea base. */
  .cp-genius-link {
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
    word-break: break-word;
    transition: color var(--duration-fast, 200ms) ease;
  }
  .cp-genius-link:hover {
    color: #fff;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .cp-genius-link:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
    border-radius: 3px;
  }

  /* Icono Genius — SVG real de /public/genius.svg recortado via
     `mask-image` para heredar color. Sin fondo amarillo separado —
     respeta la estética minimal del canvas, el icono blanco lee
     limpiamente sobre dark/video con un drop-shadow para destacar.

     `transform: scale(var(--cp-icon-scale))` controlado por la
     transition de entrada — fase 1 lo hace nacer con spring. */
  /* Wrapper del icono Genius + dot verified opcional. Mantiene el
     transform (counter-scale + icon-scale spring) para que ambos
     elementos se muevan juntos durante la animación. */
  .cp-genius-badge {
    position: relative;
    display: inline-block;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    /* Orden de transforms importante: counter-scale (deshace el scaleX
       del wrap) → scale (pop spring) → rotate (spin-out). Si rotate
       fuera ANTES del counter-scale, el eje de rotación quedaría
       deformado por el scaleX del padre y el icono "se torcería" en
       lugar de girar limpio. */
    transform:
      scaleX(var(--cp-icon-counter-scale, 1))
      scale(var(--cp-icon-scale, 1))
      rotate(var(--cp-icon-rotate, 0deg));
    transform-origin: center;
    will-change: transform;
  }
  .cp-genius-icon {
    display: block;
    width: 100%;
    height: 100%;
    background: #fff;
    /* mask-size 70% deja un anillo de respiración alrededor de la "G"
       — el SVG ocupa todo su viewBox (la letra toca los bordes) y
       contain hacía que la G rozara los bordes del badge. 70% le
       devuelve la "área de etiqueta" estándar del logo Genius. */
    -webkit-mask: url(/genius.svg) no-repeat center / 70% 70%;
            mask: url(/genius.svg) no-repeat center / 70% 70%;
    filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.65));
  }
  /* Dot verified: pequeño círculo accent con check, posicionado en la
     esquina inferior derecha del icono Genius. Parece el badge de
     "verified" estilo Twitter/Apple Music — indica que la anotación
     está revisada sin gritarlo. Outline negro (box-shadow) lo separa
     del icono blanco para mantener legibilidad. */
  .cp-genius-verified-dot {
    position: absolute;
    bottom: -3px;
    right: -3px;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.7);
    /* El padre tiene transform — sin esto el dot no respetaría el
       counter-scale y se vería deformado. */
    transform-origin: center;
  }
  .cp-genius-verified-dot :global(svg) {
    flex-shrink: 0;
  }
  .cp-genius-content {
    min-width: 0;
    /* Grid de UNA celda con grid-template "1 / 1" implícito — durante
       un swap entre anotaciones, dos `.cp-genius-text-stack` coexisten
       brevemente (viejo saliendo + nuevo entrando) por culpa del
       {#key annotation.id}. Sin grid-stack se apilarían verticalmente
       y el wrap haría jitter de altura. Con `grid-area: 1/1` en cada
       text-stack se solapan en la misma celda → cross-fade limpio sin
       reflow. */
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* counter-scale compensa el scaleX del padre overlay durante el
       unfold para que el texto no se aplaste. translateX da el slide-in
       sutil desde la izquierda. opacity ya NO se controla aquí — la
       gobiernan contentIn/contentOut de los hijos. */
    transform:
      scaleX(var(--cp-icon-counter-scale, 1))
      translateX(var(--cp-content-x, 0));
    transform-origin: left center;
  }
  /* Sub-contenedor envuelto por {#key annotation.id} para el cross-fade
     interno durante swaps entre anotaciones. grid-area 1/1 → todos los
     text-stacks (viejo y nuevo durante swap) ocupan la misma celda y
     se solapan en lugar de apilarse. Debe ser un box real (no
     display:contents) para que las transitions svelte de opacity +
     translateY surtan efecto. */
  .cp-genius-text-stack {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  /* ─── Fragment header (pegado al overlay, mismo bg via wrap) ──────
     Transparente — el bg/blur/radius vienen del wrap padre. La caja
     visual es UNA sola superficie con el overlay debajo, sin divider
     ni nada que las separe en color. Solo el cambio tipográfico
     (italic semibold vs body medium) marca la jerarquía interna. En
     compact: 1 línea con ellipsis. En expanded: texto entero. */
  .cp-genius-fragment-anchor {
    align-self: stretch;
    /* Grid-stack igual que `.cp-genius-content` — durante swap, viejo
       y nuevo <p class="cp-genius-fragment"> coexisten brevemente por
       el {#key}; con grid-area 1/1 se solapan en lugar de apilarse. */
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* counter-scale compensa el scaleX del wrap durante annIn/annOut
       para que el texto no se aplaste. Opacidad gobernada por
       contentIn/contentOut del <p> interno, no por var. */
    transform:
      scaleX(var(--cp-icon-counter-scale, 1))
      translateX(var(--cp-content-x, 0));
    transform-origin: left center;
  }
  .cp-genius-fragment {
    /* Pull-quote: cita textual de la letra. Header del panel — debe
       pesar más que el body. 15px / Halbfett (600) + line-height 1.35:
       en Söhne (Klim) la salto Kraftig→Halbfett da un escalón claro
       de jerarquía sin entrar en Dreiviertelfett (700) que ya gritaría
       sobre el body. La comilla va inline al inicio del texto
       (.cp-genius-quote) — sin decoración absoluta que compita con el
       logo Genius. */
    grid-area: 1 / 1;
    margin: 0;
    padding: 9px 14px 8px;
    background: transparent;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.35;
    letter-spacing: var(--tracking-snug);
    color: rgba(255, 255, 255, 0.98);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: padding 380ms var(--ease-ios-default, ease);
  }
  .cp-genius-quote {
    font-family: Georgia, 'Times New Roman', var(--font-sans);
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    margin-right: 2px;
    /* Sin font-size grande ni position absolute — la comilla fluye con
       el texto. Apenas se nota pero da la pista tipográfica de que es
       una cita literal. */
  }
  /* Expanded: sin clamp 1, texto entero del fragment con justify. */
  .cp-genius-wrap.expanded .cp-genius-fragment {
    padding: 11px 14px 9px;
    white-space: normal;
    text-align: justify;
    text-align-last: left;
    overflow-wrap: break-word;
  }

  .cp-genius-body {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500; /* Söhne Kraftig — densa de fábrica, lee correcto
                         sobre overlay sin necesidad de subir peso. */
    line-height: 1.45;
    color: #fff;
    /* Sin drop-shadow: el wrap padre ya provee material vítreo (bg
       rgba 0.48 + backdrop-blur 16px saturate 1.4). Apple Music /
       Spotify Canvas pattern: el panel es la legibilidad, no halos
       sobre los glyphs. Los drop-shadow filter ensucian hairlines en
       tamaños pequeños y cuestan GPU. */
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    letter-spacing: var(--tracking-snug);
    /* `justify` evita el "borde derecho desigual" cuando el texto es
       largo — el body de Genius suele tener líneas de longitudes muy
       distintas (incluyendo URLs que ahora son links). `align-last:
       left` impide que la última línea se estire feo. `hyphens` y
       `overflow-wrap` rompen palabras kilométricas (incl. URLs sin
       espacios) en lugar de salirse del box. */
    text-align: justify;
    text-align-last: left;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  /* Atribución (solo visible en expanded). Padding-top da respiración
     después del body de la anotación. inline-flex para alinear nombre
     + tag verified horizontalmente. */
  .cp-genius-attr {
    margin: 8px 0 0;
    padding-top: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: var(--tracking-snug);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
  .cp-genius-author {
    color: rgba(255, 255, 255, 0.6);
  }
  /* Tag "Verificada" — pill accent con icono SealCheck. Inspirado en
     los badges verified de Apple Music / X. Bg con accent tinted, color
     del texto accent vivo. Pequeño pero claramente identificable. */
  .cp-genius-verified-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 6px;
    border-radius: 999px;
    background: color-mix(in oklch, var(--accent) 20%, transparent);
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
  .cp-genius-verified-tag :global(svg) {
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .cp-genius-overlay,
    .cp-genius-fragment-anchor {
      animation: none;
      transition: none;
    }
  }

  /* ─── Card "Populares" ─────────────────────────────────────────────── */
  .cp-populars {
    padding-bottom: var(--space-2);
  }

  /* Lista de canciones populares — fila tap-friendly, hover bg sutil.
     Vive dentro de la card .cp-populars con padding del card en lugar
     de inline. */
  .cp-songs-list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
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
