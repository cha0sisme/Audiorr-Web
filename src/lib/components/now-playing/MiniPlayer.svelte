<script lang="ts">
  import {
    Play, Pause, SkipForward, SkipBack, Shuffle, Repeat,
    MusicNote, Heart, Queue, YoutubeLogo, SpeakerHigh, ArrowsOutSimple,
    Broadcast
  } from 'phosphor-svelte';
  import { coverBlurIn, coverBlurOut } from '$utils/cover-transitions';
  import { formatTime } from '$utils/format';
  import WaveText from '$components/shared/WaveText.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import DevicePicker from '$components/now-playing/DevicePicker.svelte';
  import { connectService } from '$services/ConnectService.svelte';
  import { player } from '$stores/player.svelte';

  type Props = {
    /** True = mini pill compacto. False = wide bar (default). */
    compact?: boolean;
    title: string;
    artist: string;
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
  };

  let {
    compact = false,
    title,
    artist,
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
    onHoverChange = () => {}
  }: Props = $props();

  const pct = $derived(Math.max(0, Math.min(1, progress)) * 100);
  const positionSec = $derived(progress * durationSec);
  const volumePct = $derived(Math.max(0, Math.min(1, volume)) * 100);

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
        {#key coverUrl ?? '__placeholder__'}
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
        <p class="artist">{artist}</p>
      </div>
      <button type="button" class="icon-btn" aria-label="Añadir a favoritos" tabindex={compact ? -1 : 0}>
        <Heart size={18} weight="regular" />
      </button>
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
          aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          tabindex={compact ? -1 : 0}
          onclick={onPlayPause}
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
          class="icon-btn device-btn"
          class:active={deviceActive}
          aria-label="Dispositivos disponibles"
          aria-haspopup="menu"
          aria-expanded={devicePickerOpen}
          tabindex={compact ? -1 : 0}
          onclick={() => (devicePickerOpen = !devicePickerOpen)}
        >
          <Broadcast size={18} weight="regular" />
          {#if deviceActive}
            <span class="device-dot" aria-hidden="true"></span>
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
        class="icon-btn"
        class:active={queueOpen}
        aria-label="Cola"
        aria-pressed={queueOpen}
        tabindex={compact ? -1 : 0}
        onclick={onQueue}
      >
        <Queue size={18} weight="regular" />
      </button>
      <button
        type="button"
        class="icon-btn"
        class:active={canvasOpen}
        aria-label="Canvas"
        aria-pressed={canvasOpen}
        disabled={!canvasAvailable}
        tabindex={compact ? -1 : 0}
        onclick={onCanvas}
      >
        <YoutubeLogo size={18} weight="fill" />
      </button>
      <div class="volume">
        <button type="button" class="icon-btn" aria-label="Volumen" tabindex={compact ? -1 : 0}>
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
      {#key coverUrl ?? '__placeholder__'}
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
      {:else}
        <p class="artist">{artist}</p>
      {/if}
    </div>

    <div class="compact-controls">
      <button
        type="button"
        class="play-pause compact-pp"
        aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
        tabindex={compact ? 0 : -1}
        onclick={onPlayPause}
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
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    /* Padding horizontal grande (16px) porque el pill tiene radius 30px —
       con menos, el cover queda parcialmente clippeado por la curva. */
    padding: 8px 16px;
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
