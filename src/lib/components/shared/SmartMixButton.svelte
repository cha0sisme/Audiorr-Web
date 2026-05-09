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
    if (isSmartMixContext) {
      player.toggle();
      return;
    }
    if (status === 'idle' || status === 'error') {
      smartMixManager.generate(playlistId, songs);
      return;
    }
    if (status === 'ready') {
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
  <span class="icon" aria-hidden="true">
    {#if isSmartMixPlaying}
      <Pause size={15} weight="fill" />
    {:else if isSmartMixContext}
      <Play size={15} weight="fill" />
    {:else if status === 'analyzing'}
      <span class="spinner"><ArrowsClockwise size={15} weight="bold" /></span>
    {:else if status === 'error'}
      <Warning size={15} weight="fill" />
    {:else}
      <Sparkle size={15} weight="fill" />
    {/if}
  </span>

  {#if isExpanded}
    <span class="label">SmartMix</span>
  {/if}
</button>

<style>
  /* Mismo ancho/alto base que HeroPlayButton/HeroCircleButton para alinear
     verticalmente la fila de actions. La cápsula se expande añadiendo
     padding lateral + label, exactamente como en iOS. */
  .smartmix {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 40px;
    width: 40px;
    padding: 0;
    flex-shrink: 0;

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
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);

    transition:
      width var(--duration-base) var(--ease-ios-default),
      padding var(--duration-base) var(--ease-ios-default),
      filter var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-fast) var(--ease-ios-default);
  }

  .smartmix.expanded {
    width: auto;
    padding: 0 var(--space-5);
  }

  .smartmix:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.22);
  }
  .smartmix:active:not(:disabled) {
    transform: scale(0.97);
    filter: brightness(0.96);
    transition-duration: var(--duration-instant);
  }
  .smartmix:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), 0 1px 2px rgb(0 0 0 / 0.18);
  }
  .smartmix:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .icon {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .label {
    display: inline-flex;
    align-items: center;
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
