<script lang="ts">
  import { onMount } from 'svelte';
  import { X, MusicNoteSimple } from 'phosphor-svelte';
  import { canvas, CANVAS_MIN_WIDTH, CANVAS_MAX_WIDTH } from '$stores/canvas.svelte';
  import { player } from '$stores/player.svelte';

  let videoEl: HTMLVideoElement | undefined = $state();

  onMount(() => {
    function onVisibility() {
      if (!videoEl) return;
      if (document.hidden) videoEl.pause();
      else videoEl.play().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  function close() {
    canvas.dismiss(player.currentSong?.id ?? null);
  }

  // Drag-to-resize del borde izquierdo. Desde mouseDown atamos move/up al
  // window — al soltar limpiamos. cursor: ew-resize y user-select: none
  // mientras dragueamos para que no se seleccione texto del fondo.
  let dragging = $state(false);
  function startDrag(e: PointerEvent) {
    e.preventDefault();
    dragging = true;
    canvas.isDragging = true;
    const startX = e.clientX;
    const startWidth = canvas.width;

    function onMove(ev: PointerEvent) {
      // Drag a la izquierda → más ancho. Por eso restamos delta.
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

  // Doble click en el handle → reset al ancho default.
  function resetWidth() {
    canvas.setWidth(320);
  }
</script>

<aside class="canvas-panel" class:dragging aria-label="Canvas del tema actual">
  {#if canvas.videoUrl}
    <video
      bind:this={videoEl}
      class="media"
      src={canvas.videoUrl}
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      disablePictureInPicture
    ></video>
  {:else}
    <div class="media demo-placeholder">
      <MusicNoteSimple size={56} weight="fill" />
    </div>
  {/if}

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

  <div class="controls">
    <button
      type="button"
      class="ctl"
      aria-label="Cerrar canvas"
      onclick={close}
    >
      <X size={14} weight="bold" />
    </button>
  </div>
</aside>

<style>
  /* Panel desplazante: grid item del shell, NO overlay. Llena su columna
     (definida por el shell vía grid-template-columns con --canvas-col-width).
     El video usa object-fit: cover para llenar altura sin bandas, igual que
     en la versión fixed. */
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

  .media {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .demo-placeholder {
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
    background:
      radial-gradient(circle at 30% 20%, oklch(0.5 0.12 280), transparent 60%),
      radial-gradient(circle at 70% 80%, oklch(0.45 0.14 200), transparent 55%),
      linear-gradient(135deg, oklch(0.2 0.05 250), oklch(0.1 0.03 250));
  }

  /* Handle: tira de 6px contra el borde izq, cursor ew-resize. Glow sutil
     al hover para feedback. user-select: none mientras se draguea. */
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

  .controls {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
    display: flex;
    gap: var(--space-2);
    z-index: 2;
  }
  .ctl {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--scroll-arrow-bg);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: var(--scroll-arrow-fg);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .ctl:hover { background: var(--scroll-arrow-bg-hover); }
  .ctl:active {
    transform: scale(0.92);
    transition-duration: var(--duration-instant);
  }
  .ctl:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  @media (max-width: 768px) {
    /* En móvil el shell colapsa a 1-col; el grid ya hace que el canvas
       ocupe todo el ancho de la columna que le toque. Solo escondemos el
       resize handle (no se puede draguear con touch en este UX). */
    .resize-handle { display: none; }
  }
</style>
