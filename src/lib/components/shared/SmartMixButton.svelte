<script lang="ts">
  /**
   * SmartMixButton — port directo del helper `smartMixButton` Swift en
   * PlaylistDetailView (lines 535-620). Mismas reglas de UX:
   *
   *   - idle / error  → círculo 40x40 con icono Sparkle. Tap genera.
   *   - analyzing     → círculo deshabilitado con spinner.
   *   - ready         → cápsula expandida ("SmartMix" label). Tap reproduce.
   *   - isSmartMixContext (cola SmartMix activa para este id):
   *       - playing   → cápsula con icono Pause + label.
   *       - paused    → cápsula con icono Play  + label.
   *       Tap toggle play/pause.
   *
   * El hand-off visual con HeroPlayButton lo gestiona el caller: cuando
   * `collapsePlay` (smartMix ready o sonando) es true, el caller renderiza
   * el Play como círculo en vez de cápsula. Mirror exacto del Swift hero.
   *
   * Props:
   *   - bgColor    color de fondo dinámico del hero (palette del cover).
   *   - playlistId id del contexto que dispara este SmartMix
   *                (album:<id>, playlist:<id>, artist:<id>).
   *   - songs      tracks a analizar/ordenar.
   *   - contextName nombre visible (no usado hoy; reservado para
   *                 Now Playing label cuando el DJ Mixing lo necesite).
   */
  import { Sparkle, Play, Pause, ArrowsClockwise, Warning } from 'phosphor-svelte';
  import { smartMixManager } from '$services/SmartMixManager.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { player } from '$stores/player.svelte';
  import type { NavidromeSong } from '$types/navidrome';

  type Props = {
    bgColor: string;
    playlistId: string;
    songs: NavidromeSong[];
    contextName?: string | undefined;
    disabled?: boolean | undefined;
  };

  let {
    bgColor,
    playlistId,
    songs,
    // contextName reservado para integrar etiqueta en Now Playing cuando se porte
    // DJ Mixing. Por ahora no se renderiza.
    disabled = false
  }: Props = $props();

  // ─── Estado derivado del manager + player ──────────────────────────────
  // El manager solo guarda UN SmartMix activo a la vez; si su `playlistId`
  // no es el nuestro, este botón está idle (no compartimos estado entre
  // playlists distintas).
  const isThisContext = $derived(smartMixManager.playlistId === playlistId);
  const status = $derived(isThisContext ? smartMixManager.status : 'idle');
  const isSmartMixContext = $derived(player.isSmartMixContext(playlistId));
  const isSmartMixPlaying = $derived(isSmartMixContext && player.isPlaying);
  const isExpanded = $derived(status === 'ready' || isSmartMixContext);
  const isDisabled = $derived(disabled || status === 'analyzing' || songs.length === 0);

  // ─── Handler único — mirror del Swift smartMixButton.action ────────────
  function handleClick() {
    console.info('[DJ] SmartMixButton click — status=%s isSmartMixContext=%s', status, isSmartMixContext);
    if (isSmartMixContext) {
      player.toggle();
      return;
    }
    if (status === 'idle' || status === 'error') {
      smartMixManager.generate(playlistId, songs);
      return;
    }
    if (status === 'ready') {
      // Mirror del resto de callers (PlaylistCard / PlaylistDetail / AlbumCard / etc):
      // setear `player.context` ANTES de queueManager.play para que las cards
      // de la playlist base muestren el EqualizerIcon durante el SmartMix.
      // Sin esto, isPlayingFrom('playlist', id) devuelve false durante toda la
      // sesion SmartMix.
      player.context = { type: 'playlist', id: playlistId };
      queueManager.play(smartMixManager.generatedMix, 0, {
        playbackMode: 'dj',
        contextUri: `smartmix:${playlistId}`
      });
    }
  }

  const ariaLabel = $derived.by(() => {
    if (isSmartMixContext) return isSmartMixPlaying ? 'Pausar SmartMix' : 'Reanudar SmartMix';
    if (status === 'analyzing') return 'Analizando SmartMix';
    if (status === 'error') return 'Reintentar SmartMix';
    if (status === 'ready') return 'Reproducir SmartMix';
    return 'Generar SmartMix';
  });
</script>

<button
  type="button"
  class="smartmix"
  class:expanded={isExpanded}
  class:active-context={isSmartMixContext}
  style:--play-bg-dynamic={bgColor}
  disabled={isDisabled}
  aria-label={ariaLabel}
  aria-live="polite"
  onclick={handleClick}
>
  <!-- Icon stack: cinco iconos superpuestos, opacidad/scale por estado.
       Mismo elemento DOM siempre visible — el cross-fade entre estados
       imita el `.transition(.blurReplace)` de iOS PlaylistDetailView. -->
  <span class="icon" aria-hidden="true">
    <span class="icon-slot" class:active={isSmartMixPlaying}>
      <Pause size={15} weight="fill" />
    </span>
    <span class="icon-slot" class:active={isSmartMixContext && !isSmartMixPlaying}>
      <Play size={15} weight="fill" />
    </span>
    <span
      class="icon-slot"
      class:active={!isSmartMixContext && status === 'analyzing'}
    >
      <span class="spinner"><ArrowsClockwise size={15} weight="bold" /></span>
    </span>
    <span class="icon-slot" class:active={!isSmartMixContext && status === 'error'}>
      <Warning size={15} weight="fill" />
    </span>
    <span
      class="icon-slot"
      class:active={!isSmartMixContext && (status === 'idle' || status === 'ready')}
    >
      <Sparkle size={15} weight="fill" />
    </span>
  </span>

  <span class="label" aria-hidden={!isExpanded}>SmartMix</span>
</button>

<style>
  /* ─── Liquid Glass morph círculo ↔ cápsula ────────────────────────────
     Consume los tokens `--morph-*` definidos en tokens/primitives.css
     — las mismas curvas y duraciones que HeroPlayButton para que ambos
     botones progresen al unísono durante el hand-off visual. */
  .smartmix {
    position: relative;
    display: inline-block;
    height: 40px;
    width: 40px;
    flex-shrink: 0;
    overflow: hidden;

    background: var(--play-bg-dynamic);
    color: #fff;
    border: none;
    border-radius: var(--radius-full);

    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;

    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;

    /* Sombra Liquid Glass — base sutil (círculo). Al expandir crece. */
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.18),
      0 2px 8px -3px color-mix(in srgb, var(--play-bg-dynamic) 22%, transparent);

    will-change: width, box-shadow;

    transition:
      width var(--morph-duration) var(--morph-ease),
      box-shadow var(--morph-duration) var(--morph-ease),
      filter var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }

  /* Expanded: cápsula 144px (icon 40 + label ~88 + padding 16) con sombra
     reforzada — cuando promueve a cápsula gana protagonismo visual. */
  .smartmix.expanded {
    width: 144px;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.18),
      0 6px 16px -5px color-mix(in srgb, var(--play-bg-dynamic) 38%, transparent);
  }

  .smartmix:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .smartmix:active:not(:disabled) {
    transform: scale(0.97);
    filter: brightness(0.96);
    transition-duration: var(--duration-instant);
  }
  .smartmix:focus-visible {
    outline: none;
    box-shadow:
      var(--focus-ring),
      0 1px 2px rgb(0 0 0 / 0.18),
      0 4px 12px -4px color-mix(in srgb, var(--play-bg-dynamic) 32%, transparent);
  }
  .smartmix:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  /* Icon centrado absolute en los primeros 40px del botón — sin reflow
     durante el morph. */
  .icon {
    position: absolute;
    top: 50%;
    left: 20px;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    margin-top: -9px;
    pointer-events: none;
  }

  /* Stack de iconos superpuestos — blur-replace SwiftUI canónico.
     Consume tokens --morph-icon-*. */
  .icon-slot {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    opacity: 0;
    transform: scale(var(--morph-icon-scale-from));
    filter: blur(var(--morph-icon-blur));
    pointer-events: none;
    transition:
      opacity var(--morph-icon-out-opacity-duration) var(--ease-ios-default) 0ms,
      transform var(--morph-icon-out-transform-duration) var(--ease-ios-default) 0ms,
      filter var(--morph-icon-out-opacity-duration) var(--ease-ios-default) 0ms;
  }
  .icon-slot.active {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
    transition:
      opacity var(--morph-icon-in-opacity-duration) var(--morph-ease) var(--morph-icon-in-delay),
      transform var(--morph-icon-in-transform-duration) var(--morph-ease) var(--morph-icon-in-delay),
      filter var(--morph-icon-in-opacity-duration) var(--morph-ease) var(--morph-icon-in-delay);
  }

  /* Label slide + fade asimétrico — consume tokens --morph-label-*. */
  .label {
    position: absolute;
    top: 50%;
    left: 40px;
    right: 16px;
    transform: translateY(-50%) translateX(0);
    text-align: left;
    opacity: 1;
    pointer-events: none;
    transition:
      opacity var(--morph-label-in-opacity-duration) var(--morph-ease) var(--morph-label-in-delay),
      transform var(--morph-label-in-transform-duration) var(--morph-ease) var(--morph-label-in-delay);
  }
  .smartmix:not(.expanded) .label {
    opacity: 0;
    transform: translateY(-50%) translateX(calc(var(--morph-label-slide-distance) * -1));
    transition:
      opacity var(--morph-label-out-opacity-duration) var(--ease-ios-default) 0ms,
      transform var(--morph-label-out-transform-duration) var(--ease-ios-default) 0ms;
  }

  /* Spinner del estado analyzing — rotación constante sobre el icono refresh. */
  .spinner {
    display: inline-grid;
    place-items: center;
    animation: smartmix-spin 1s linear infinite;
  }
  @keyframes smartmix-spin {
    to { transform: rotate(360deg); }
  }
</style>
