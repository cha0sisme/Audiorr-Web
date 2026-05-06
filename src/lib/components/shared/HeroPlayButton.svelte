<script lang="ts">
  /**
   * Botón "Reproducir" del hero de AlbumDetail / PlaylistDetail / ArtistDetail.
   *
   * NO usa los tokens de color del design system (--bg-accent, etc) porque su
   * razón de ser es justo lo contrario: el color es único por álbum, derivado
   * del cover art. El componente recibe `bgColor` ya calculado (OKLCH) y se
   * limita a aplicarlo + asegurar contraste con el texto blanco.
   *
   * Por qué texto blanco siempre:
   *   - playButtonBg() en $utils/palette fuerza L=0.55 en dark y L=0.45 en
   *     light, con chroma máx 0.18. Esos rangos garantizan ratio ≥ 4.5:1
   *     contra blanco para cualquier hue (verificado en OKLCH gamut).
   *   - Si en el futuro queremos texto adaptativo, calcularlo aquí y no en
   *     el caller (la decisión depende de la L del bg).
   *
   * El fallback (cuando palette extraction falla) lo decide el caller pasando
   * el color del hue-por-hash como bgColor.
   */
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { Play } from 'phosphor-svelte';

  type Props = HTMLButtonAttributes & {
    /** Color de fondo. OKLCH recomendado vía playButtonBg(palette, isDark). */
    bgColor: string;
    children?: Snippet;
  };

  let { bgColor, type = 'button', disabled, children, ...rest }: Props = $props();
</script>

<button
  {type}
  {disabled}
  {...rest}
  style:--play-bg-dynamic={bgColor}
  class="hero-play"
>
  <Play size={18} weight="fill" />
  <span class="label">
    {#if children}{@render children()}{:else}Reproducir{/if}
  </span>
</button>

<style>
  .hero-play {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);

    height: 40px;
    padding: 0 var(--space-5);

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

    /* Sombra coloreada sutil — refuerza el "color del álbum" sin gritar.
       black/30 directo se vería plano sobre el gradient ya tintado del hero. */
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);

    transition:
      filter var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-fast) var(--ease-ios-default);
  }

  /* Hover: brillo +6% en lugar de tocar el bg (mantiene el color exacto del
     álbum y solo sube luminosidad — más fiel a iOS Music). */
  .hero-play:hover:not(:disabled) {
    filter: brightness(1.08);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.22);
  }
  .hero-play:active:not(:disabled) {
    transform: scale(0.97);
    filter: brightness(0.96);
    transition-duration: var(--duration-instant);
  }
  .hero-play:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring), 0 1px 2px rgb(0 0 0 / 0.18);
  }
  .hero-play:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .label {
    display: inline-flex;
    align-items: center;
  }
</style>
