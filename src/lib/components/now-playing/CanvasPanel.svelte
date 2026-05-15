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
  import { quintOut, quintIn } from 'svelte/easing';
  import { MusicNoteSimple, CaretDown, Play, MusicNote, SealCheck, Check } from 'phosphor-svelte';
  import { canvas, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH } from '$stores/canvas.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
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

  onMount(() => {
    function onVisibility() {
      if (!videoEl) return;
      if (document.hidden) videoEl.pause();
      else if (player.isPlaying) videoEl.play().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  /** Sincroniza el video con el estado de playback. Si el director pausa
      la canción (sea local o desde Audiorr Connect — el broadcast
      `playback_state_update` actualiza `player.isPlaying`), el canvas
      también se pausa para que la animación no siga sola sobre audio
      mute. Resume cuando vuelve a play. document.hidden tiene prioridad
      (no reproducir si la pestaña está oculta aunque isPlaying=true). */
  $effect(() => {
    if (!videoEl) return;
    const playing = player.isPlaying;
    if (typeof document !== 'undefined' && document.hidden) {
      videoEl.pause();
      return;
    }
    if (playing) {
      videoEl.play().catch(() => {});
    } else {
      videoEl.pause();
    }
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

  /** Lo que está realmente montado en el DOM. Sequencer manual entre
      requested y visible: cuando cambia el `id` solicitado, primero
      ponemos `visibleAnnotation = null` (dispara annOut del actual) y
      sólo después de que el annOut termine asignamos el nuevo target
      (dispara annIn).

      Sin esto, el `{#key}` de Svelte desmonta el viejo y monta el nuevo
      en el mismo frame → annOut (620ms) y annIn (980ms) corren a la
      vez, los boxes se solapan visualmente y "chocan". Crítico al
      cerrar una anotación expandida después de que activeAnnotation
      haya avanzado: cerrar dispararía un cambio de id inmediato.

      Capturamos el target dentro del setTimeout (no la variable local)
      para que zapeos rápidos durante el buffer siempre acaben mostrando
      lo más reciente, no algo stale. */
  let visibleAnnotation = $state<MatchedGeniusAnnotation | null>(null);
  let annSwapTimer: ReturnType<typeof setTimeout> | null = null;
  /** Timestamp en que arrancó el out actual. Si el effect re-corre
      mientras un out está pendiente, NO bypass (no asignar directo el
      nuevo target) — re-programamos el `setTimeout` con el tiempo que
      le quedaba al out. Sin esto, dos cambios rápidos de active
      generaban un mount nuevo mientras el viejo aún estaba saliendo y
      las dos transitions se solapaban visualmente ("chocan"). */
  let outStartedAt: number | null = null;
  const ANN_OUT_MS = 660; // annOut(640) + 20ms buffer

  /** Flag CSS "está expandida" pintado en el DOM. Desacoplado de
      `expandedAnnotation` deliberadamente: si la anotación visible está
      en pleno annOut (saliendo) y el user cierra el expand a la vez (o
      cerrarlo provoca el cambio a la nueva activa), CAMBIAR la class
      .expanded en mid-out dispara la transition CSS (background,
      backdrop-filter, max-height, padding) a la vez que la transition
      svelte de salida → las dos animaciones se solapan visualmente y
      la salida queda con un "tick" estético.

      Regla: durante el cross-fade out→in entre dos anotaciones, NO
      tocamos `displayedExpanded` — el elemento saliente mantiene sus
      clases originales y se va limpio. Solo lo actualizamos cuando:
        - cambia in-place (mismo id antes y después → toggle real)
        - llega el momento de asignar el nuevo `visibleAnnotation` */
  let displayedExpanded = $state(false);

  $effect(() => {
    const target = requestedAnnotation;
    const targetExpanded = expandedAnnotation !== null;

    // Caso A: misma anotación visible (toggle in-place). Sigue el flag
    // directamente para que la transition CSS del overlay (bg, padding,
    // max-height) anime el cambio compact↔expanded.
    if (target?.id === visibleAnnotation?.id) {
      displayedExpanded = target ? targetExpanded : false;
      return;
    }

    // Caso B: cambia el id visible.
    //
    // Sub-caso B.1: hay un out pendiente (otro swap ya en curso). NO
    // hacer bypass — esperar a que termine ese out y luego asignar el
    // target más reciente. Si entrásemos directo (visibleAnnotation =
    // target) montaríamos el nuevo elemento ENCIMA del viejo que aún
    // se está yendo con sus transitions |global activas → choque
    // visual entre annIn nuevo y annOut viejo.
    if (outStartedAt !== null) {
      const elapsed = performance.now() - outStartedAt;
      const remaining = Math.max(0, ANN_OUT_MS - elapsed);
      if (annSwapTimer !== null) clearTimeout(annSwapTimer);
      annSwapTimer = setTimeout(() => {
        const latest = expandedAnnotation ?? activeAnnotation;
        visibleAnnotation = latest;
        displayedExpanded = latest ? expandedAnnotation?.id === latest.id : false;
        annSwapTimer = null;
        outStartedAt = null;
      }, remaining);
      return;
    }

    // Sub-caso B.2: slot vacío de verdad (primer paint, o ya pasó un
    // out limpio). Entrada directa.
    if (visibleAnnotation === null) {
      if (annSwapTimer !== null) {
        clearTimeout(annSwapTimer);
        annSwapTimer = null;
      }
      visibleAnnotation = target;
      displayedExpanded = target ? targetExpanded : false;
      return;
    }

    // Sub-caso B.3: hay algo visible y estable. Arrancar cross-fade:
    // out primero (sin tocar displayedExpanded — el elemento saliente
    // se va con la clase que tenía), in tras ANN_OUT_MS.
    visibleAnnotation = null;
    outStartedAt = performance.now();
    if (annSwapTimer !== null) clearTimeout(annSwapTimer);
    annSwapTimer = setTimeout(() => {
      const latest = expandedAnnotation ?? activeAnnotation;
      visibleAnnotation = latest;
      displayedExpanded = latest ? expandedAnnotation?.id === latest.id : false;
      annSwapTimer = null;
      outStartedAt = null;
    }, ANN_OUT_MS);
  });

  onMount(() => () => {
    if (annSwapTimer !== null) clearTimeout(annSwapTimer);
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

  /** Curiosidad — animación coreografiada en tres fases.
      No es UNA expansión uniforme; son TRES acciones encadenadas que
      dan la sensación de "el icono cobra vida primero, después el
      panel se despliega desde él, finalmente el texto se escribe":

        FASE 1 (0   → 0.32) — solo el icono. Resto invisible.
          • Icono scale 0 → 1.15 → 1 (POP spring)
          • clip-path circle = 24px (solo cubre el icono)

        FASE 2 (0.30 → 0.85) — el card se expande desde el icono.
          • clip-path circle crece de 24px a 420px hacia la derecha
          • El contenido textual sigue oculto

        FASE 3 (0.55 → 1.0) — el texto se materializa.
          • Content opacity 0 → 1
          • Content translateX -6 → 0 (slide-in sutil desde el icono)

      El clip-path se centra en (24px, 50%) — la posición exacta del
      centro del icono Genius. Eso ancla todas las fases al mismo
      origen visual.

      Duración total 880ms — más larga que el lyric banner (480ms)
      porque la curiosidad es un MOMENTO que merece atención
      deliberada, no un cambio fluyendo. */
  /** Animación coreografiada en tres fases BIEN SECUENCIALES:

        FASE 1 (0    → 0.35)  Solo el icono. Pop spring, hold al final.
                              clip-path se mantiene en 14% (solo icono visible).
        FASE 2 (0.40 → 0.78)  Card se desenrolla hacia la derecha
                              (clip-path 14% → 100%). Icono ya estable.
        FASE 3 (0.65 → 1.0)   Texto fade-in con slide sutil desde la
                              izquierda.

      El gap deliberado entre fase 1 y fase 2 (0.35 → 0.40) crea un
      "hold" del icono — el ojo lo registra como "ha aparecido algo",
      luego ve cómo se desenrolla el panel. Sin el hold, el icono y el
      panel parecen una misma acción y se pierde el efecto.

      `clip-path: inset(...)` recorta sin reflow. `transform:
      translateX(-50%)` se incluye en cada frame para no perder el
      centrado del CSS rule (los inline styles ganan sobre rules). */
  /** Tres fases coreografiadas usando `scaleX` + `transform-origin:
      left center` para el unfold. scaleX comprime visualmente el card
      desde la izquierda — mismo efecto que clip-path inset pero usando
      transform, que Svelte 5 maneja sin issues en transitions disparadas
      por setInterval. El icono está fuera del scope del scaleX (es un
      hijo que también escala) — para evitar deformarlo, lo
      contra-escalamos con `transform: scale(1/cardScaleX)` calculado.

      Actually mejor approach: la columna del grid del icono mantiene
      su tamaño (auto-fit). Aplicamos scaleX solo al contenido textual,
      no al overlay completo. El icono nace con su propio scale en su
      column fija. */
  /** ── Entrada coreografiada ────────────────────────────────────────
        FASE 1 (0    → 0.35)  Solo el icono. Pop spring 0 → 1.18 → 1.
                              cardScaleX se mantiene en 0.14 (visualmente
                              solo el icono se ve, el resto del overlay
                              es un cuadrado pequeño del ancho del icono).
        FASE 2 (0.35 → 0.80)  Box unfold: cardScaleX 0.14 → 1.0.
                              Icono ya estable, "ancla" desde donde nace
                              el panel.
        FASE 3 (0.60 → 1.0)   Texto fade-in + slide desde la izquierda. */
  function annIn(_node: Element) {
    // prefers-reduced-motion: degradar a fade simple, sin rotate/scale/spring.
    // Las Svelte transitions JS no son cubiertas por @media (prefers-reduced-motion)
    // del CSS — hay que gatearlo aquí dentro.
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return {
        duration: 220,
        easing: quintOut,
        css: (t: number) => `transform: translateX(-50%); opacity: ${t};`
      };
    }
    return {
      duration: 980,
      easing: quintOut,
      css: (t: number, _u: number) => {
        // Fase 1: icono pop + unrotate (espejo del spin-out del annOut).
        // El icono nace girado -90° y rota hasta 0° mientras hace pop.
        const iconT = Math.max(0, Math.min(1, t / 0.30));
        const iconScale = iconT < 0.65
          ? (iconT / 0.65) * 1.18
          : 1.18 - ((iconT - 0.65) / 0.35) * 0.18;
        const iconRotate = -90 + iconT * 90; // -90deg → 0deg

        // Fase 2: box unfolds
        const cardT = Math.max(0, Math.min(1, (t - 0.35) / 0.45));
        const cardScaleX = 0.14 + cardT * 0.86;

        // Fase 3: content fade
        const contentT = Math.max(0, Math.min(1, (t - 0.60) / 0.40));

        // Overall opacity: muy rápido para que el icono pop sea visible
        // desde el primer frame (sin "wait" inicial).
        const overallOpacity = Math.min(1, t * 7);

        // El wrap usa `translateX(-50%)` en su CSS base para el
        // centrado horizontal (position: absolute; left: 50%). Como
        // la animación setea `transform` inline (que sobrescribe el
        // del CSS), tenemos que incluir el translateX aquí también
        // para no perder el centrado durante el in.
        return `
          transform: translateX(-50%) scaleX(${cardScaleX});
          transform-origin: left center;
          opacity: ${overallOpacity};
          --cp-icon-scale: ${iconScale};
          --cp-icon-rotate: ${iconRotate}deg;
          --cp-icon-counter-scale: ${1 / Math.max(cardScaleX, 0.001)};
          --cp-content-opacity: ${contentT};
          --cp-content-x: ${(1 - contentT) * -8}px;
        `;
      }
    };
  }

  /** ── Salida coreografiada (squash + suction + spin-out) ─────────────
      Tres fases pegajosas/gelatinosas — Apple Music / Disney 12-principles
      "squash & stretch" aplicado a UI:

        FASE 1 (u 0    → 0.35)  Squash: la caja se aplasta antes de
                                contraerse. scaleY 1 → 0.92, scaleX 1 → 0.95.
                                Icono empieza a rotar (0° → -25°) y a
                                crecer (scale 1 → 1.08). Texto fade-out.
        FASE 2 (u 0.35 → 0.75)  Suction: la caja se contrae a la izquierda
                                con stretch vertical invertido (scaleY
                                0.92 → 1.06) — sensación de "ser absorbido"
                                hacia el icono. Icono rota -25° → -60°,
                                scale 1.08 → 1.14.
        FASE 3 (u 0.75 → 1.0)   Spin-out: solo el icono. Rotate -60° → -90°,
                                scale 1.14 → 0 con chasquido. Opacity
                                general 1 → 0 en los últimos 160ms.

      transform-origin: left center se mantiene — el icono ES el centro
      de gravedad, todo colapsa hacia su posición. scaleY del wrap también
      afecta al icono pero el `--cp-icon-counter-scale` solo neutraliza
      el scaleX; el squash/stretch vertical se transmite al icono y
      refuerza la sensación gelatinosa (el icono "respira" con la caja).

      Easings por fase elegidos para que cada momento se sienta distinto:
        F1: quintOut (squash rápido inicial, decelera al final)
        F2: cubic-bezier(0.65, 0, 0.35, 1) (succión simétrica)
        F3: cubic-bezier(0.7, 0, 0.2, 1) (chasquido final) */
  function annOut(_node: Element) {
    // prefers-reduced-motion: degradar a fade simple (igual que annIn).
    // Mantiene el contrato del swap logic — duración suficientemente corta
    // para que ANN_OUT_MS no se quede largo (220ms < 660ms, sin riesgo).
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return {
        duration: 180,
        easing: quintIn,
        css: (t: number) => `transform: translateX(-50%); opacity: ${t};`
      };
    }
    return {
      duration: 640,
      easing: quintIn,
      css: (_t: number, u: number) => {
        // ── Fase 1: Squash (u 0 → 0.35) ──────────────────────────
        const f1Raw = Math.max(0, Math.min(1, u / 0.35));
        const f1 = 1 - Math.pow(1 - f1Raw, 5); // quintOut local

        // ── Fase 2: Suction (u 0.35 → 0.75) ──────────────────────
        const f2Raw = Math.max(0, Math.min(1, (u - 0.35) / 0.40));
        // bezier(0.65, 0, 0.35, 1) aproximada con smoothstep
        const f2 = f2Raw * f2Raw * (3 - 2 * f2Raw);

        // ── Fase 3: Spin-out (u 0.75 → 1.0) ──────────────────────
        const f3Raw = Math.max(0, Math.min(1, (u - 0.75) / 0.25));
        // bezier(0.7, 0, 0.2, 1) — chasquido: arranca lento, acelera fuerte
        const f3 = Math.pow(f3Raw, 1.6);

        // Wrap scale: X contrae monótonamente; Y hace squash → stretch → collapse
        let cardScaleX: number;
        if (u < 0.35) {
          cardScaleX = 1 - f1 * 0.05; // 1 → 0.95
        } else if (u < 0.75) {
          cardScaleX = 0.95 - f2 * 0.81; // 0.95 → 0.14
        } else {
          cardScaleX = 0.14;
        }

        let cardScaleY: number;
        if (u < 0.35) {
          cardScaleY = 1 - f1 * 0.08; // 1 → 0.92 (squash)
        } else if (u < 0.75) {
          cardScaleY = 0.92 + f2 * 0.14; // 0.92 → 1.06 (stretch)
        } else {
          cardScaleY = 1.06 - f3 * 0.46; // 1.06 → 0.60 (collapse)
        }

        // Icon scale: crece suave en F1+F2 (centro de gravedad), colapsa
        // con chasquido en F3.
        let iconScale: number;
        if (u < 0.35) {
          iconScale = 1 + f1 * 0.08; // 1 → 1.08
        } else if (u < 0.75) {
          iconScale = 1.08 + f2 * 0.06; // 1.08 → 1.14
        } else {
          iconScale = 1.14 * (1 - f3); // 1.14 → 0
        }

        // Icon rotate: -25° en F1, -60° en F2, -90° en F3.
        let iconRotate: number;
        if (u < 0.35) {
          iconRotate = -25 * f1;
        } else if (u < 0.75) {
          iconRotate = -25 - 35 * f2;
        } else {
          iconRotate = -60 - 30 * f3;
        }

        // Texto fade-out en F1 (rápido)
        const contentOpacity = Math.max(0, 1 - f1Raw * 3);

        // Overall opacity: 1 hasta últimos 160ms (u > 0.75), donde baja
        // con curva pow para sensación de chasquido.
        const overallOpacity = u < 0.75 ? 1 : 1 - Math.pow(f3, 1.4);

        return `
          transform: translateX(-50%) scaleX(${cardScaleX}) scaleY(${cardScaleY});
          transform-origin: left center;
          opacity: ${overallOpacity};
          --cp-icon-scale: ${iconScale};
          --cp-icon-rotate: ${iconRotate}deg;
          --cp-icon-counter-scale: ${1 / Math.max(cardScaleX, 0.001)};
          --cp-content-opacity: ${contentOpacity};
        `;
      }
    };
  }

  /** Stagger de aparición/cierre de elementos expanded-only (fragment
      citado + atribución). Slide vertical sutil + fade. Duración corta
      (280ms) para que el out termine antes de que el overlay complete
      su shrink (max-height/padding transition ~380ms) — los elementos
      no quedan "atrapados" dentro de un overlay colapsando. */
  function expandFly(_node: Element, opts: { delay?: number; y?: number } = {}) {
    const { delay = 0, y = -4 } = opts;
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
        {#key displayedAnnotation.id}
          <!-- Wrapper que agrupa fragment-anchor (citation header) y
               overlay (caja de curiosidad) como UNA SOLA caja unificada:
               el fragment "cuelga" del overlay compartiendo bg, blur y
               borde — el overlay tiene border-radius solo abajo y el
               fragment border-radius solo arriba, pegados sin gap. El
               wrapper entero es el botón clickable (clic en cualquier
               zona, fragment o body, expande). -->
          <div
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
            <!-- Fragment como "header" pegado al overlay — Apple-Genius
                 style: 1 línea de la letra a la que se refiere la
                 curiosidad, italic semibold, mismo bg/blur que el
                 overlay para que parezca una sola caja unificada.
                 Border-radius solo arriba, ningún gap con el overlay
                 debajo. Al expandir, sin clamp (texto entero visible). -->
            {#if displayedAnnotation.fragment}
              <div class="cp-genius-fragment-anchor" aria-hidden="true">
                <p class="cp-genius-fragment">
                  <span class="cp-genius-quote">&ldquo;</span>{displayedAnnotation.fragment}
                </p>
              </div>
            {/if}

            <div
              class="cp-genius-overlay"
              class:expanded={displayedExpanded}
            >
              <!-- Badge wrapper: contiene el icono Genius + dot
                   verified. El wrapper toma el transform de
                   scale/counter-scale para que el dot se mueva junto
                   al icono y no se descoloque durante la animación de
                   unfold del overlay. -->
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
                <!-- Body con linkify de URLs (YouTube y genéricas). Las
                     URLs van a target="_blank" con stopPropagation para
                     no cerrar el overlay al pinchar el enlace. -->
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
                     minimalista. En expanded mostramos autor + tag
                     verified completo (con texto "Verificada") cuando
                     aplica. Stagger sutil — entra después del body
                     para no competir con él por la atención. -->
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
            </div>
          </div>
        {/key}
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
    display: flex;
    flex-direction: column;
    gap: 3px;
    /* Stagger interno controlado por la transition.
       counter-scale compensa el scaleX del padre overlay durante el
       unfold para que el texto no se aplaste. translateX da el slide-in
       sutil desde la izquierda. opacity gestiona el fade del stagger. */
    opacity: var(--cp-content-opacity, 1);
    transform:
      scaleX(var(--cp-icon-counter-scale, 1))
      translateX(var(--cp-content-x, 0));
    transform-origin: left center;
  }

  /* ─── Fragment header (pegado al overlay, mismo bg via wrap) ──────
     Transparente — el bg/blur/radius vienen del wrap padre. La caja
     visual es UNA sola superficie con el overlay debajo, sin divider
     ni nada que las separe en color. Solo el cambio tipográfico
     (italic semibold vs body medium) marca la jerarquía interna. En
     compact: 1 línea con ellipsis. En expanded: texto entero. */
  .cp-genius-fragment-anchor {
    align-self: stretch;
    /* La animación annIn vive en el WRAP (no en el overlay) y aplica
       `scaleX(cardScaleX)` al wrap entero. Para que el texto del
       fragment no se vea aplastado durante el unfold, le contra-
       escalamos con `--cp-icon-counter-scale` (1/cardScaleX) — mismo
       patrón que `.cp-genius-content` usa. Y le aplicamos el mismo
       `--cp-content-opacity` para que aparezca con stagger fase 3
       (después de que el icono pop + box unfold ya han ocurrido).
       Cuando no hay animación, los defaults son 1 / 1 → identidad. */
    opacity: var(--cp-content-opacity, 1);
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
