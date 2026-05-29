<script lang="ts">
  /**
   * ImageLightbox — visor full-screen para covers / avatares.
   *
   * Pattern Apple Music: tap en cover abre fullscreen viewer con backdrop
   * blur, imagen centrada con max-size del viewport, click fuera / ESC /
   * botón close para cerrar. Sin pinch-zoom (overkill — Apple lo soporta
   * en touch porque tiene gesture recognizers nativos; en web el usuario
   * puede zoom del browser si necesita).
   *
   * Backdrop blur intenso + scrim oscuro → la imagen queda como "elevada"
   * sobre el contenido difuminado de fondo, igual que el iOS Photos viewer.
   */
  import { X } from 'phosphor-svelte';
  import { onMount } from 'svelte';

  type Props = {
    src: string;
    alt: string;
    onClose: () => void;
  };

  let { src, alt, onClose }: Props = $props();

  // Body scroll lock + ESC handler mientras el lightbox está abierto.
  onMount(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div
  class="lightbox"
  role="dialog"
  aria-modal="true"
  aria-label="Imagen ampliada"
>
  <button
    class="backdrop"
    onclick={onClose}
    aria-label="Cerrar imagen ampliada"
  ></button>
  <img class="image" {src} {alt} />
  <button class="close" onclick={onClose} aria-label="Cerrar">
    <X size={20} weight="bold" />
  </button>
</div>

<style>
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    animation: lightbox-fade-in 200ms var(--ease-ios-default);
  }

  /* Backdrop: scrim oscuro + blur fuerte sobre el contenido detrás.
     Es un <button> en lugar de <div> para a) recibir click sin event
     handlers manuales en otros nodos, b) accesibilidad — el screen reader
     lo lee como "Cerrar imagen ampliada", c) cursor zoom-out indica al
     usuario que clic fuera cierra. */
  .backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background: rgb(0 0 0 / 0.82);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border: none;
    padding: 0;
    margin: 0;
    cursor: zoom-out;
  }

  .image {
    position: relative;
    max-width: min(92vw, 1200px);
    max-height: 88vh;
    object-fit: contain;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2xl);
    pointer-events: none;
    animation: lightbox-image-in 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .close {
    position: absolute;
    top: var(--space-5);
    right: var(--space-5);
    width: 40px;
    height: 40px;
    border: none;
    border-radius: var(--radius-full);
    background: rgb(255 255 255 / 0.16);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #fff;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .close:hover {
    background: rgb(255 255 255 / 0.28);
  }
  .close:active {
    transform: scale(0.94);
    transition-duration: var(--duration-instant);
  }
  .close:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgb(255 255 255 / 0.6);
  }

  @keyframes lightbox-fade-in {
    from { opacity: 0; }
  }
  @keyframes lightbox-image-in {
    from { opacity: 0; transform: scale(0.92); }
  }

  @media (prefers-reduced-motion: reduce) {
    .lightbox,
    .image {
      animation: none;
    }
  }
</style>
