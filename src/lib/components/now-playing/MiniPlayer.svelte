<script lang="ts">
  import {
    Play, Pause, SkipForward, SkipBack, Shuffle, Repeat,
    MusicNote, Queue, YoutubeLogo, SpeakerHigh, ArrowsOutSimple,
    Broadcast
  } from 'phosphor-svelte';
  import { coverBlurIn, coverBlurOut } from '$utils/cover-transitions';
  import { formatTime } from '$utils/format';
  import WaveText from '$components/shared/WaveText.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import EqualizerIcon from '$components/shared/EqualizerIcon.svelte';
  import DevicePicker from '$components/now-playing/DevicePicker.svelte';
  import { connectService } from '$services/ConnectService.svelte';
  import { player } from '$stores/player.svelte';

  type Props = {
    /** True = mini pill compacto. False = wide bar (default). */
    compact?: boolean;
    /** Id único de la canción actual. Sirve como key del cross-fade del cover
        ({#key songId}) — más robusto que keyear por coverUrl porque dos
        canciones del mismo álbum comparten URL y no dispararían animación. */
    songId?: string | undefined;
    title: string;
    artist: string;
    /** Id de Subsonic del artista — cuando viene, el nombre del artista en
        el MiniPlayer se renderiza como link a `/artist/<id>`. Sin él, sigue
        siendo texto plano (no inferimos `/search?q=<name>` aquí — UX raro
        desde un mini-player). */
    artistId?: string | undefined;
    coverUrl?: string | undefined;
    explicit?: boolean;
    progress?: number;
    durationSec?: number;
    isPlaying?: boolean;
    volume?: number;
    /** True = el CrossfadeEngine está mezclando esta canción. Muestra el
        indicador "AutoMix" debajo del scrubber. */
    autoMixActive?: boolean;
    onPlayPause?: (() => void) | undefined;
    onNext?: (() => void) | undefined;
    onPrevious?: (() => void) | undefined;
    onVolumeChange?: ((v: number) => void) | undefined;
    onSeek?: ((p: number) => void) | undefined;
    onQueue?: (() => void) | undefined;
    /** Estado abierto del QueuePanel — para reflejar pressed en el botón. */
    queueOpen?: boolean;
    onCanvas?: (() => void) | undefined;
    /** Estado abierto del CanvasPanel — pressed en el botón. */
    canvasOpen?: boolean;
    /** Disabled en el botón de canvas si no hay video disponible para la
        canción actual (no se ha podido fetchear o no existe). */
    canvasAvailable?: boolean;
    /** Abre el Now Playing fullscreen viewer. Disparado por el botón
        ArrowsOutSimple en expanded y por click en el cover. */
    onExpand?: (() => void) | undefined;
    /** Notificación de hover sobre el player. El layout lo usa para mantener
        el player expandido mientras el ratón está dentro del contenedor (la
        zona de hover sigue al tamaño del contenedor: compact ≠ expanded). */
    onHoverChange?: ((hovering: boolean) => void) | undefined;
    /** Notificación cuando el DevicePicker se abre/cierra. El layout lo usa
        para mantener el player expandido mientras el picker esté abierto —
        sin esto, mover el ratón al popover (que vive en top-layer fuera del
        contenedor del player) cuenta como hover-leave y el player se contrae
        dejando el picker huérfano. */
    onDevicePickerOpenChange?: ((open: boolean) => void) | undefined;
  };

  let {
    compact = false,
    songId,
    title,
    artist,
    artistId,
    coverUrl,
    explicit = false,
    progress = 0,
    durationSec = 0,
    isPlaying = false,
    volume = 1,
    autoMixActive = false,
    onPlayPause = () => {},
    onNext = () => {},
    onPrevious = () => {},
    onVolumeChange = () => {},
    onSeek = () => {},
    onQueue = () => {},
    queueOpen = false,
    onCanvas = () => {},
    canvasOpen = false,
    canvasAvailable = false,
    onExpand = () => {},
    onHoverChange = () => {},
    onDevicePickerOpenChange = () => {}
  }: Props = $props();

  const pct = $derived(Math.max(0, Math.min(1, progress)) * 100);
  const positionSec = $derived(progress * durationSec);
  const volumePct = $derived(Math.max(0, Math.min(1, volume)) * 100);

  // Flash pop+halo al activar un control. Reutiliza el lenguaje visual del
  // panel de diagnostics ("just rated"). Cada key se resetea a 700ms para
  // dejar terminar el keyframe antes de poder repetirlo.
  type FlashKey = 'playpause' | 'connect' | 'queue' | 'canvas' | 'volume';
  let just = $state<Record<FlashKey, boolean>>({
    playpause: false, connect: false, queue: false, canvas: false, volume: false
  });
  const flashTimers: Partial<Record<FlashKey, ReturnType<typeof setTimeout>>> = {};
  function flash(k: FlashKey) {
    just[k] = false;
    if (flashTimers[k]) clearTimeout(flashTimers[k]);
    // Doble rAF para reiniciar el keyframe si el botón se vuelve a pulsar
    // mientras la animación anterior aún no ha terminado.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      just[k] = true;
      flashTimers[k] = setTimeout(() => { just[k] = false; }, 750);
    }));
  }

  // Device picker state — local al MiniPlayer (no necesita prop drill).
  let devicePickerOpen = $state(false);
  let deviceBtnEl: HTMLButtonElement | null = $state(null);
  /** Indicador verde en el botón cuando hay un device activo distinto al
      local (estamos viendo remote o casteando). */
  const deviceActive = $derived(
    player.isRemote || connectService.activeDeviceId !== null
  );
  /** El picker solo tiene contenido cuando hay otros devices o LAN. Si la
      web está sola (caso típico del director sin iOS abierto), el botón
      queda oculto para no añadir ruido visual. */
  const hasAnyDevice = $derived(
    connectService.connectedDevices.some((d) => !d.isThisDevice) ||
    connectService.lanDevices.length > 0
  );
</script>

<div
  class="player"
  class:compact
  class:remote={player.isRemote}
  role="region"
  aria-label="Reproductor"
  onmouseenter={() => onHoverChange(true)}
  onmouseleave={() => onHoverChange(false)}
>
  <!-- Hairline progress: visible siempre como anchor visual durante el morph.
       En expanded queda detrás de la UI (no se ve), en compact es la única
       indicación de progreso. En remote, el fill cambia a verde para dar
       continuidad con el dot del DevicePicker y el texto del status. -->
  <div class="hairline" aria-hidden="true">
    <div class="hairline-fill" style:width="{pct}%"></div>
  </div>

  <!-- ============================================ EXPANDED LAYER -->
  <div class="layer expanded-layer" aria-hidden={compact}>
    <div class="track">
      <button
        type="button"
        class="cover cover-expanded cover-btn"
        aria-label="Abrir reproducción a pantalla completa"
        tabindex={compact ? -1 : 0}
        onclick={onExpand}
        style:view-transition-name={!compact ? 'np-cover' : undefined}
      >
        {#key songId ?? coverUrl ?? '__placeholder__'}
          <div class="cover-img-wrap" in:coverBlurIn out:coverBlurOut>
            {#if coverUrl}
              <img src={coverUrl} alt="" loading="lazy" decoding="async" />
            {:else}
              <div class="cover-placeholder" aria-hidden="true">
                <MusicNote size="55%" weight="regular" />
              </div>
            {/if}
          </div>
        {/key}
      </button>
      <div class="meta">
        <p class="title">
          <span class="title-name">{title}</span>
          {#if explicit}
            <ExplicitBadge size="13px" />
          {/if}
        </p>
        {#if artistId}
          <a class="artist artist-link" href="/artist/{artistId}">{artist}</a>
        {:else}
          <p class="artist">{artist}</p>
        {/if}
      </div>
      <!-- EqualizerIcon: indicador visual del audio en vivo. Reactivo al
           AnalyserNode del AudioEngine; coste compartido entre todas las
           instancias de la app (1 FFT global, no por componente). Mirror
           del Now Playing Indicator de iOS Music — 3 barras delgadas,
           bottom-anchored, envelope follower con release lento. -->
      <span class="eq-slot" aria-hidden={!isPlaying}>
        <EqualizerIcon bars={4} height={19} barWidth={3} />
      </span>
    </div>

    <div class="center">
      <div class="controls">
        <button type="button" class="icon-btn" aria-label="Aleatorio" tabindex={compact ? -1 : 0}>
          <Shuffle size={18} weight="regular" />
        </button>
        <button type="button" class="icon-btn" aria-label="Anterior" tabindex={compact ? -1 : 0} onclick={onPrevious}>
          <SkipBack size={20} weight="fill" />
        </button>
        <button
          type="button"
          class="play-pause"
          class:just-clicked={just.playpause}
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          tabindex={compact ? -1 : 0}
          onclick={() => { flash('playpause'); onPlayPause(); }}
        >
          {#if isPlaying}
            <Pause size={20} weight="fill" />
          {:else}
            <Play size={20} weight="fill" />
          {/if}
        </button>
        <button type="button" class="icon-btn" aria-label="Siguiente" tabindex={compact ? -1 : 0} onclick={onNext}>
          <SkipForward size={20} weight="fill" />
        </button>
        <button type="button" class="icon-btn" aria-label="Repetir" tabindex={compact ? -1 : 0}>
          <Repeat size={18} weight="regular" />
        </button>
      </div>

      <div class="scrubber-row">
        <span class="time">{formatTime(positionSec)}</span>
        <div class="scrubber">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={pct}
            tabindex={compact ? -1 : 0}
            oninput={(e) => onSeek(Number(e.currentTarget.value) / 100)}
            aria-label="Posición de reproducción"
            class="range-input"
          />
          <div class="track-line" aria-hidden="true">
            <div class="track-fill" style:width="{pct}%"></div>
          </div>
        </div>
        <span class="time">{formatTime(durationSec)}</span>
      </div>

      <!-- Slot de AutoMix: altura reservada (no salta layout cuando aparece).
           Visible cuando el CrossfadeEngine está procesando esta canción.
           Texto con efecto wave (port del WaveText.swift de iOS). -->
      <div class="hint" class:visible={autoMixActive} aria-hidden={!autoMixActive}>
        <WaveText text="AutoMix" />
      </div>
    </div>

    <div class="extras">
      {#if hasAnyDevice}
        <button
          bind:this={deviceBtnEl}
          type="button"
          class="icon-btn device-btn connect-btn"
          class:active={deviceActive || devicePickerOpen}
          class:just-clicked={just.connect}
          aria-label="Dispositivos disponibles"
          aria-haspopup="menu"
          aria-expanded={devicePickerOpen}
          tabindex={compact ? -1 : 0}
          onclick={() => {
            flash('connect');
            devicePickerOpen = !devicePickerOpen;
            onDevicePickerOpenChange(devicePickerOpen);
          }}
        >
          <Broadcast size={18} weight="regular" />
          {#if deviceActive}
            <span class="device-dot" aria-hidden="true"></span>
          {/if}
        </button>
        <DevicePicker
          open={devicePickerOpen}
          triggerEl={deviceBtnEl}
          onClose={() => {
            devicePickerOpen = false;
            onDevicePickerOpenChange(false);
          }}
        />
      {/if}
      <button
        type="button"
        class="icon-btn queue-btn"
        class:active={queueOpen}
        class:just-clicked={just.queue}
        aria-label="Cola"
        aria-pressed={queueOpen}
        tabindex={compact ? -1 : 0}
        onclick={() => { flash('queue'); onQueue(); }}
      >
        <Queue size={18} weight="regular" />
      </button>
      <button
        type="button"
        class="icon-btn canvas-btn"
        class:active={canvasOpen}
        class:just-clicked={just.canvas}
        aria-label="Canvas"
        aria-pressed={canvasOpen}
        disabled={!canvasAvailable}
        tabindex={compact ? -1 : 0}
        onclick={() => { flash('canvas'); onCanvas(); }}
      >
        <YoutubeLogo size={18} weight="fill" />
      </button>
      <div class="volume">
        <button
          type="button"
          class="icon-btn volume-btn"
          class:just-clicked={just.volume}
          aria-label="Volumen"
          tabindex={compact ? -1 : 0}
        >
          <SpeakerHigh size={18} weight="regular" />
        </button>
        <div class="volume-slider">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={volumePct}
            tabindex={compact ? -1 : 0}
            oninput={(e) => onVolumeChange(Number(e.currentTarget.value) / 100)}
            onchange={() => flash('volume')}
            aria-label="Volumen"
            class="range-input"
          />
          <div class="track-line" aria-hidden="true">
            <div class="track-fill" style:width="{volumePct}%"></div>
          </div>
        </div>
      </div>
      <button
        type="button"
        class="icon-btn"
        aria-label="Pantalla completa"
        tabindex={compact ? -1 : 0}
        onclick={onExpand}
      >
        <ArrowsOutSimple size={18} weight="regular" />
      </button>
    </div>
  </div>

  <!-- ============================================ COMPACT LAYER -->
  <div class="layer compact-layer" aria-hidden={!compact}>
    <button
      type="button"
      class="cover cover-compact cover-btn"
      aria-label="Abrir reproducción a pantalla completa"
      tabindex={compact ? 0 : -1}
      onclick={onExpand}
      style:view-transition-name={compact ? 'np-cover' : undefined}
    >
      {#key songId ?? coverUrl ?? '__placeholder__'}
        <div class="cover-img-wrap" in:coverBlurIn out:coverBlurOut>
          {#if coverUrl}
            <img src={coverUrl} alt="" loading="lazy" decoding="async" />
          {:else}
            <div class="cover-placeholder" aria-hidden="true">
              <MusicNote size="55%" weight="regular" />
            </div>
          {/if}
        </div>
      {/key}
    </button>

    <div class="meta-compact">
      <p class="title">
        <span class="title-name">{title}</span>
        {#if explicit}
          <ExplicitBadge size="11px" />
        {/if}
      </p>
      {#if autoMixActive}
        <p class="auto-mix-line">
          <WaveText text="AutoMix" />
        </p>
      {:else if artistId}
        <a class="artist artist-link" href="/artist/{artistId}">{artist}</a>
      {:else}
        <p class="artist">{artist}</p>
      {/if}
    </div>

    <!-- EQ icon en compact también — paridad iOS Control Center pill, donde
         el indicador sigue visible aunque el player esté minimizado.
         Tamaño un poco menor que en expanded para que case con el footprint
         del pill (60px tall). -->
    <span class="eq-slot eq-slot-compact" aria-hidden={!isPlaying}>
      <EqualizerIcon bars={4} height={14} barWidth={2} />
    </span>

    <div class="compact-controls">
      <button
        type="button"
        class="play-pause compact-pp"
        class:just-clicked={just.playpause}
        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        tabindex={compact ? 0 : -1}
        onclick={() => { flash('playpause'); onPlayPause(); }}
      >
        {#if isPlaying}
          <Pause size={18} weight="fill" />
        {:else}
          <Play size={18} weight="fill" />
        {/if}
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Siguiente"
        tabindex={compact ? 0 : -1}
        onclick={onNext}
      >
        <SkipForward size={18} weight="fill" />
      </button>
    </div>
  </div>
</div>

<style>
  /* ==========================================================================
     PLAYER SHELL
     - Glass treatment (Liquid Glass — chrome flotante)
     - width/height/border-radius transition para morph entre estados
     - Posicionado por el .player-dock del layout (centered)
     ========================================================================== */
  .player {
    position: relative;
    width: min(1200px, calc(100vw - 240px - var(--space-8)));
    height: 88px;
    border-radius: var(--radius-2xl);

    /* `--bg-glass-solid`: theme-aware vía color-mix sobre gray-2 al 82%.
       Frosted-dark en dark mode, frosted-light en light mode. Glass real
       mantenido por backdrop-filter blur+saturate. */
    background: var(--bg-glass-solid);
    backdrop-filter: var(--blur-lg);
    -webkit-backdrop-filter: var(--blur-lg);
    box-shadow: var(--shadow-glass-floating);

    overflow: hidden;
    isolation: isolate;
    -webkit-tap-highlight-color: transparent;

    transition:
      width var(--duration-normal) var(--ease-ios-default),
      height var(--duration-normal) var(--ease-ios-default),
      border-radius var(--duration-normal) var(--ease-ios-default);
  }
  .player.compact {
    width: min(380px, calc(100vw - 240px - var(--space-8)));
    height: 60px;
    border-radius: 30px;
  }

  @media (max-width: 768px) {
    .player {
      width: min(1200px, calc(100vw - var(--space-6)));
    }
    .player.compact {
      width: min(380px, calc(100vw - var(--space-6)));
    }
  }

  /* Hairline progress siempre presente — anchor visual durante el morph.
     En expanded queda en el borde superior pero detrás de la UI principal,
     casi imperceptible. En compact es la única señal de progreso. */
  .hairline {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--player-progress-bg);
    z-index: 3;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-ios-default);
  }
  .player.compact .hairline {
    opacity: 1;
  }
  .hairline-fill {
    height: 100%;
    background: var(--text-primary);
    transition:
      width var(--duration-fast) var(--ease-linear),
      background var(--duration-normal) var(--ease-ios-default);
  }
  /* Remote mode: hairline + scrubber fill toman el verde del status-success
     (mismo verde que el dot del DevicePicker activo). Coherencia visual. */
  .player.remote .hairline-fill,
  .player.remote .scrubber .track-fill {
    background: var(--player-progress-fill-remote);
  }
  /* En remote, hover del scrubber NO sobrescribe el verde con accent — el
     usuario sigue viendo el indicador remoto durante el seek. */
  .player.remote .scrubber:hover .track-fill {
    background: var(--player-progress-fill-remote);
  }

  /* ==========================================================================
     LAYERS — crossfade con stagger.
     Ambos siempre en el DOM. Solo uno visible. pointer-events follow opacity.
     ========================================================================== */
  .layer {
    position: absolute;
    inset: 0;
    transition: opacity 180ms var(--ease-ios-default);
  }
  .expanded-layer {
    opacity: 1;
    pointer-events: auto;
  }
  .compact-layer {
    opacity: 0;
    pointer-events: none;
  }
  .player.compact .expanded-layer {
    opacity: 0;
    pointer-events: none;
  }
  .player.compact .compact-layer {
    opacity: 1;
    pointer-events: auto;
  }

  /* ==========================================================================
     EXPANDED LAYOUT (88px tall, 840px wide)
     ========================================================================== */
  .expanded-layer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(420px, 2fr) minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-6);
    padding: 0 var(--space-5);
  }

  .track {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    min-width: 0;
  }
  .cover-expanded {
    width: 56px;
    height: 56px;
  }
  .meta {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .title {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.25;
    letter-spacing: var(--tracking-body);
    color: var(--text-primary);
    /* Inline-flex en vez de bloque: badge "E" + nombre alineados al
       baseline. Ellipsis aplica al .title-name interno (no al badge). */
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }
  .title-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .artist {
    font-size: 12px;
    font-weight: 400;
    line-height: 1.25;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Variante <a>: que el hit-area se limite al ancho del propio texto (no
     toda la franja del meta). `inline-block` + `max-width: 100%` colapsa
     al contenido pero sigue permitiendo ellipsis cuando overflowa. */
  .artist-link {
    display: inline-block;
    max-width: 100%;
    color: var(--text-secondary);
    text-decoration: none;
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .artist-link:hover {
    color: var(--text-primary);
  }
  .artist-link:focus-visible {
    outline: none;
    color: var(--text-primary);
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-xs);
  }

  /* Flex column con márgenes específicos en lugar de grid gap uniforme:
     controls↔scrubber necesita respiro (8px), pero scrubber↔hint debe ser
     tight (hint es subscript del scrubber, una unidad visual). */
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .scrubber-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    max-width: 720px;
    margin-top: var(--space-2);
  }

  /* AutoMix indicator: subscript del scrubber. Casi pegado (margin-top 2px)
     porque pertenece al mismo grupo visual. Altura reservada (12px) para
     que el layout no salte al mostrar/ocultar. Casing literal "AutoMix",
     sin uppercase ni letter-spacing — el indicador es texto, no badge. */
  /* Tipografía espejo de .artist — mismo size+weight para que el subscript
     no compita visualmente con el resto del player. Solo el color cambia
     (--automix-text) para señalar que es un indicador de estado. */
  .hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 12px;
    margin-top: 2px;
    font-size: 12px;
    font-weight: 400;
    color: var(--automix-text);
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-ios-default);
    user-select: none;
  }
  .hint.visible {
    opacity: 1;
  }
  .time {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
    line-height: 1;
    min-width: 32px;
    text-align: center;
  }

  .extras {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    min-width: 0;
  }
  .volume {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* ==========================================================================
     COMPACT LAYOUT (60px tall, 380px wide)
     ========================================================================== */
  .compact-layer {
    display: grid;
    /* 4 cols: cover | meta | EQ indicator | controls. */
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    column-gap: var(--space-3);
    /* Padding horizontal grande (16px) porque el pill tiene radius 30px —
       con menos, el cover queda parcialmente clippeado por la curva. */
    padding: 8px 16px;
  }
  /* Compact EQ: gap reducido respecto a controls para que se agrupe
     visualmente con el meta-text (es indicator del título, no control). */
  .eq-slot-compact {
    width: 18px;
    height: 18px;
    margin-right: calc(-1 * var(--space-1));
  }
  .cover-compact {
    width: 44px;
    height: 44px;
  }
  .meta-compact {
    min-width: 0;
    display: grid;
    gap: 1px;
  }
  .meta-compact .title {
    font-size: 13px;
    font-weight: 500;
  }
  .meta-compact .artist {
    font-size: 11px;
  }
  /* AutoMix line en compact: reemplaza al artist mientras dura el crossfade.
     Mismo tamaño que artist (11px) para no romper la jerarquía visual del
     pill. Color accent + Sparkle icon + weight 600 para que destaque sutil. */
  /* Compact: espejo exacto de .meta-compact .artist (11px, 400, line-height
     1.25). Color --automix-text como única diferencia. */
  .meta-compact .auto-mix-line {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.25;
    color: var(--automix-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .compact-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .compact-pp {
    width: 32px;
    height: 32px;
  }

  /* ==========================================================================
     COVER (compartido entre layouts; tamaño se setea por modificador)
     Es un <button> ahora (clickable → expand a fullscreen). Reset de border/
     padding y cursor pointer; el resto sigue siendo el cover de siempre.
     ========================================================================== */
  .cover {
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--artwork-placeholder-bg);
    box-shadow: var(--shadow-sm);
    flex-shrink: 0;
    transition:
      width var(--duration-normal) var(--ease-ios-default),
      height var(--duration-normal) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .cover-btn {
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
    position: relative;
  }
  .cover-btn:hover {
    transform: scale(1.04);
  }
  .cover-btn:active {
    transform: scale(0.96);
    transition-duration: var(--duration-instant);
  }
  .cover-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), var(--shadow-sm);
  }
  /* cover-img-wrap: contenedor absoluto para que OLD y NEW puedan coexistir
     superpuestos durante el cross-fade del cambio de canción ({#key coverUrl}).
     Sin position: absolute, ambos ocuparían altura y el botón "saltaría" durante
     la transición. */
  .cover-img-wrap {
    position: absolute;
    inset: 0;
    display: block;
    will-change: opacity, filter, transform;
  }
  .cover img,
  .cover-placeholder {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .cover-placeholder {
    display: grid;
    place-items: center;
    color: var(--artwork-placeholder-fg);
  }

  /* ==========================================================================
     SCRUBBER + VOLUME — slider transparente sobre track visual.
     Ambos comparten el patrón: hover → track engorda + fill se pone accent.
     ========================================================================== */
  .scrubber,
  .volume-slider {
    position: relative;
    display: flex;
    align-items: center;
    height: 16px;
  }
  .scrubber {
    width: 100%;
  }
  .volume-slider {
    width: 100px;
  }
  .range-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
  }
  .track-line {
    width: 100%;
    height: 4px;
    background: var(--player-progress-bg);
    border-radius: var(--radius-full);
    overflow: hidden;
    transition: height var(--duration-fast) var(--ease-ios-default);
  }
  .track-fill {
    height: 100%;
    background: var(--text-primary);
    border-radius: inherit;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .scrubber:hover .track-line,
  .volume-slider:hover .track-line {
    height: 6px;
  }
  .scrubber:hover .track-fill,
  .volume-slider:hover .track-fill {
    background: var(--accent);
  }

  /* ==========================================================================
     ICON BUTTONS
     ========================================================================== */
  /* Hover minimalista: SOLO el icono cambia color (a primary).
     Sin bg fill — más Apple Music macOS / Linear, menos web genérico. */
  .icon-btn {
    position: relative;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    border-radius: var(--radius-full);
    transition:
      color var(--duration-fast) var(--ease-ios-default),
      opacity var(--duration-fast) var(--ease-ios-default);
  }
  .icon-btn:hover {
    color: var(--text-primary);
  }
  .icon-btn:active {
    color: var(--text-primary);
    opacity: 0.6;
    transition-duration: var(--duration-instant);
  }
  .icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  /* Estado "abierto" — botón pressed (Cola activa). Color accent + suave
     fondo para que el usuario sepa qué panel está visible. */
  .icon-btn.active {
    color: var(--accent);
    background: var(--bg-surface-hover);
  }
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }

  /* Botón de devices con position:relative para anclar el dot indicador.
     El popover propiamente se renderiza con position:fixed (DevicePicker)
     calculando su anchor desde getBoundingClientRect del botón — eso le
     permite escapar del `overflow: hidden` del .player. */
  .device-btn {
    position: relative;
  }
  /* Indicador verde — un dot pequeño en la esquina sup-der del icono
     cuando hay device activo (remote o casting). Imita el "play indicator"
     de iOS. */
  .device-dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--status-success, #22c55e);
    box-shadow: 0 0 0 2px var(--bg-glass-solid);
  }

  .play-pause {
    position: relative;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--text-primary);
    color: var(--bg-canvas);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      transform var(--duration-fast) var(--ease-ios-default),
      opacity var(--duration-fast) var(--ease-ios-default);
  }
  .play-pause:hover {
    transform: scale(1.06);
  }
  .play-pause:active {
    transform: scale(0.94);
    transition-duration: var(--duration-instant);
  }
  .play-pause:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ==========================================================================
     Feedback de interacción por botón — cada control tiene su propio gesto
     visual. Construido con principio Disney "12 principles": anticipation
     (squash pre-burst) → action (overshoot) → settling (oscilación amortiguada).
     Curvas spring custom no estándar, filter brightness/saturate en el peak,
     halos multi-stop con blur sutil para profundidad. Sin transition-curves
     planas — cada keyframe respira distinto.

     `will-change` en los animados activa composición GPU (transform/opacity)
     evitando jank durante el spring. Se limpia automáticamente al terminar.
     ========================================================================== */

  /* ── EqualizerIcon slot ─────────────────────────────────────────────────
     Ocupa el mismo footprint que ocupaba el .heart-btn (32x32) para no
     romper el rytmo visual del .track. Color hereda de text-secondary →
     primary on hover del player, mismo lenguaje que los .icon-btn. */
  .eq-slot {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    color: var(--text-secondary);
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .player:hover .eq-slot {
    color: var(--text-primary);
  }

  /* ── Play/Pause "tactile pulse" ─────────────────────────────────────────
     Ancla principal: el botón YA es el límite visual (disco blanco sobre
     glass). Un ring outline saliendo de él rompería el lenguaje del disco
     compacto — el feedback debe vivir DENTRO del propio botón. Spring con
     squash→overshoot→settle + box-shadow que se intensifica brevemente
     (sugiere "press into glass" como en iOS) + inner glow sutil que
     refuerza el peak sin añadir cromo externo.
     -------------------------------------------------------------------- */
  .play-pause.just-clicked {
    animation: mp-pp-tactile 560ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    will-change: transform, filter, box-shadow;
  }
  @keyframes mp-pp-tactile {
    0%   {
      transform: scale(1);
      filter: none;
      box-shadow: 0 0 0 0 transparent, inset 0 0 0 0 transparent;
    }
    16%  {
      transform: scale(0.9);
      filter: brightness(0.95);
      box-shadow: 0 2px 6px color-mix(in srgb, var(--text-primary) 18%, transparent), inset 0 0 0 0 transparent;
    }
    42%  {
      transform: scale(1.16);
      filter: brightness(1.18) saturate(1.05);
      box-shadow:
        0 6px 16px color-mix(in srgb, var(--text-primary) 30%, transparent),
        inset 0 0 8px color-mix(in srgb, var(--text-primary) 25%, transparent);
    }
    66%  {
      transform: scale(0.97);
      filter: brightness(1.06);
      box-shadow:
        0 3px 8px color-mix(in srgb, var(--text-primary) 18%, transparent),
        inset 0 0 0 0 transparent;
    }
    88%  { transform: scale(1.02); filter: none; }
    100% {
      transform: scale(1);
      filter: none;
      box-shadow: 0 0 0 0 transparent, inset 0 0 0 0 transparent;
    }
  }

  /* ── Connect "broadcast pulse" ──────────────────────────────────────────
     Dos ondas concéntricas con stagger 130ms — cada onda nace pequeña,
     escala rápido (ease-out fuerte) y desvanece lento (asimetría natural
     del sonido propagándose). El icono pulsa brightness durante la
     primera onda para sugerir "emisión activa".
     -------------------------------------------------------------------- */
  .connect-btn.just-clicked > :global(svg) {
    animation: mp-connect-emit 360ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: filter;
  }
  .connect-btn.just-clicked::before,
  .connect-btn.just-clicked::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: var(--radius-full);
    border: 1.5px solid color-mix(in srgb, var(--accent) 85%, transparent);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 35%, transparent);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
  }
  .connect-btn.just-clicked::before {
    animation: mp-connect-wave 760ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .connect-btn.just-clicked::after {
    animation: mp-connect-wave 760ms cubic-bezier(0.16, 1, 0.3, 1) 130ms;
  }
  @keyframes mp-connect-emit {
    0%, 100% { filter: none; }
    25%      { filter: brightness(1.3) drop-shadow(0 0 4px color-mix(in srgb, var(--accent) 60%, transparent)); }
    60%      { filter: brightness(1.1); }
  }
  @keyframes mp-connect-wave {
    0%   { transform: scale(0.35); opacity: 0; }
    14%  { opacity: 1; }
    100% { transform: scale(2.1); opacity: 0; }
  }

  /* ── Queue "stack reveal" ───────────────────────────────────────────────
     El icono se eleva con bounce + ligera rotación direccional (sugiere
     algo se "abre"). Un glow accent aparece DEBAJO del icono mientras está
     elevado — sugiere visualmente que algo emerge desde abajo. La rotación
     es contra-direccional al lift (anticipación de Disney).
     -------------------------------------------------------------------- */
  .queue-btn.just-clicked > :global(svg) {
    animation: mp-queue-lift 580ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    will-change: transform, filter;
  }
  .queue-btn.just-clicked::after {
    content: '';
    position: absolute;
    bottom: 2px;
    left: 50%;
    width: 24px;
    height: 6px;
    margin-left: -12px;
    border-radius: 50%;
    background: radial-gradient(ellipse at center,
      color-mix(in srgb, var(--accent) 70%, transparent) 0%,
      transparent 70%);
    filter: blur(3px);
    pointer-events: none;
    opacity: 0;
    animation: mp-queue-glow 520ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes mp-queue-lift {
    0%   { transform: translateY(0) rotate(0); filter: none; }
    18%  { transform: translateY(1px) rotate(2deg); }
    44%  { transform: translateY(-5px) rotate(-6deg); filter: brightness(1.2) drop-shadow(0 2px 4px color-mix(in srgb, var(--accent) 40%, transparent)); }
    70%  { transform: translateY(1.5px) rotate(3deg); filter: brightness(1.05); }
    100% { transform: translateY(0) rotate(0); filter: none; }
  }
  @keyframes mp-queue-glow {
    0%   { opacity: 0; transform: scaleX(0.4); }
    50%  { opacity: 0.85; transform: scaleX(1.2); }
    100% { opacity: 0; transform: scaleX(0.9); }
  }

  /* ── Canvas "iris focus" ────────────────────────────────────────────────
     Apertura de iris fotográfico. Pre-contracción (anticipation) → expand
     overshoot con saturate boost (es video/audiovisual, debería saturarse
     en el peak) → settle. Ring outline acompaña el iris desde dentro hacia
     fuera, simulando la apertura de un diafragma. Dos rings stagger para
     reforzar la sensación de "focus encontrado".
     -------------------------------------------------------------------- */
  .canvas-btn.just-clicked > :global(svg) {
    animation: mp-canvas-focus 540ms cubic-bezier(0.32, 1.7, 0.45, 0.95);
    will-change: transform, filter;
  }
  .canvas-btn.just-clicked::before,
  .canvas-btn.just-clicked::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: var(--radius-full);
    border: 2px solid color-mix(in srgb, var(--accent) 75%, transparent);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
  }
  .canvas-btn.just-clicked::before {
    animation: mp-canvas-ring 580ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  .canvas-btn.just-clicked::after {
    animation: mp-canvas-ring 580ms cubic-bezier(0.16, 1, 0.3, 1) 90ms;
  }
  @keyframes mp-canvas-focus {
    0%   { transform: scale(1); filter: none; }
    20%  { transform: scale(0.78); filter: saturate(1.5) brightness(0.85); }
    50%  { transform: scale(1.2); filter: saturate(1.8) brightness(1.3) drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)); }
    75%  { transform: scale(0.96); filter: saturate(1.2); }
    100% { transform: scale(1); filter: none; }
  }
  @keyframes mp-canvas-ring {
    0%   { transform: scale(0.5); opacity: 0; }
    20%  { opacity: 0.9; }
    100% { transform: scale(2.0); opacity: 0; }
  }

  /* ── Volumen "sonar emit" ───────────────────────────────────────────────
     El icono SpeakerHigh apunta a la derecha → las ondas salen desde el
     borde derecho del icono. Mini vibración del SVG (translateX 1px+-)
     simula la membrana del altavoz al recibir señal. Dos ondas con
     stagger reforzando "emisión continua". Originadas en left:70% para
     que el centro de cada ring quede al lado del cono, no en el centro.
     -------------------------------------------------------------------- */
  .volume-btn.just-clicked > :global(svg) {
    animation: mp-volume-vibrate 380ms cubic-bezier(0.36, 0, 0.64, 1);
    will-change: transform, filter;
  }
  .just-clicked.volume-btn::before,
  .just-clicked.volume-btn::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 68%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: var(--radius-full);
    border: 1.5px solid color-mix(in srgb, var(--accent) 80%, transparent);
    box-shadow: 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
    pointer-events: none;
    opacity: 0;
    will-change: transform, opacity;
  }
  .just-clicked.volume-btn::before {
    animation: mp-volume-wave 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .just-clicked.volume-btn::after {
    animation: mp-volume-wave 560ms cubic-bezier(0.22, 1, 0.36, 1) 130ms;
  }
  @keyframes mp-volume-vibrate {
    0%, 100% { transform: scale(1) translateX(0); filter: none; }
    20%      { transform: scale(1.08) translateX(-1px); filter: brightness(1.18); }
    45%      { transform: scale(1.04) translateX(1px); filter: brightness(1.08); }
    70%      { transform: scale(1.01) translateX(-0.5px); }
  }
  @keyframes mp-volume-wave {
    0%   { transform: scale(0.3) translateX(-2px); opacity: 0; }
    16%  { opacity: 0.95; }
    100% { transform: scale(2.0) translateX(3px); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .play-pause.just-clicked,
    .connect-btn.just-clicked > :global(svg),
    .queue-btn.just-clicked > :global(svg),
    .canvas-btn.just-clicked > :global(svg),
    .volume-btn.just-clicked > :global(svg) { animation: none; }
    .connect-btn.just-clicked::before,
    .connect-btn.just-clicked::after,
    .queue-btn.just-clicked::after,
    .canvas-btn.just-clicked::before,
    .canvas-btn.just-clicked::after,
    .just-clicked.volume-btn::before,
    .just-clicked.volume-btn::after { animation: none; opacity: 0; }
  }

  /* ==========================================================================
     RESPONSIVE
     ========================================================================== */
  @media (max-width: 1024px) {
    .expanded-layer {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr) auto;
    }
    .extras {
      gap: 0;
    }
    .volume-slider {
      display: none;
    }
  }
</style>
