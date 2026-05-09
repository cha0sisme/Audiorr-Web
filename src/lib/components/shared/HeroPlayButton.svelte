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
   *
   * `collapsed`: muta el botón a círculo 40x40 sin label. Mismo elemento DOM
   * en ambos estados — la transición CSS de width/padding/opacity da el
   * morph fluido (mirror del iOS `.frame(width: isExpanded ? nil : 40)
   * .animation(Anim.moderate, value: collapsePlay)`). Hacer swap
   * condicional con `{#if}` produce flick porque Svelte destruye/recrea el
   * elemento — esto evita el flash y mantiene el ripple/focus continuos.
   */
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import type { Snippet } from 'svelte';
  import { Play } from 'phosphor-svelte';

  type Props = HTMLButtonAttributes & {
    /** Color de fondo. OKLCH recomendado vía playButtonBg(palette, isDark). */
    bgColor: string;
    /** Si true, el botón muta a círculo (40x40) ocultando el label.
        Usado para el hand-off con SmartMixButton — mientras éste expande a
        cápsula, el Play colapsa para mantener prominencia visual. */
    collapsed?: boolean;
    children?: Snippet;
  };

  let {
    bgColor,
    type = 'button',
    disabled,
    collapsed = false,
    children,
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  {disabled}
  {...rest}
  style:--play-bg-dynamic={bgColor}
  class="hero-play"
  class:collapsed
  aria-label={collapsed ? 'Reproducir' : undefined}
>
  <Play size={18} weight="fill" />
  <span class="label" aria-hidden={collapsed}>
    {#if children}{@render children()}{:else}Reproducir{/if}
  </span>
</button>

<style>
  /* ─── Liquid Glass morph cápsula ↔ círculo ────────────────────────────
     Consume los tokens `--morph-*` definidos en tokens/primitives.css.
     Detalles de la receta + lecciones aprendidas (no usar gap, no usar
     max-width, layout absolute para evitar reflow) viven allí. */
  .hero-play {
    position: relative;
    display: inline-block;
    height: 40px;
    width: 140px;

    background: var(--play-bg-dynamic);
    color: #fff;
    border: none;
    border-radius: var(--radius-full);

    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    flex-shrink: 0;

    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;

    /* Sombra Liquid Glass — 2 capas: tight (depth) + soft tinted (lift).
       Al colapsar la capa soft se atenúa: el círculo tiene menos
       "presencia"; mantener la sombra intensa lo haría parecer flotando. */
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.18),
      0 4px 12px -4px color-mix(in srgb, var(--play-bg-dynamic) 35%, transparent);

    will-change: width, box-shadow;

    transition:
      width var(--morph-duration) var(--morph-ease),
      box-shadow var(--morph-duration) var(--morph-ease),
      filter var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }

  .hero-play.collapsed {
    width: 40px;
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.18),
      0 2px 8px -3px color-mix(in srgb, var(--play-bg-dynamic) 22%, transparent);
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

  /* Icon centrado absolute en los primeros 40px del botón. Cuando el
     botón colapsa a 40px de ancho, el icono queda perfectamente centrado
     en el círculo sin reflow ni reposicionamiento. */
  .hero-play :global(svg) {
    position: absolute;
    top: 50%;
    left: 12px;
    transform: translateY(-50%);
    pointer-events: none;
  }

  /* Label slide + fade asimétrico — consume tokens --morph-label-*. */
  .label {
    position: absolute;
    top: 50%;
    left: 38px;
    right: 16px;
    transform: translateY(-50%) translateX(0);
    text-align: left;
    opacity: 1;
    transition:
      opacity var(--morph-label-in-opacity-duration) var(--morph-ease) var(--morph-label-in-delay),
      transform var(--morph-label-in-transform-duration) var(--morph-ease) var(--morph-label-in-delay);
  }
  .hero-play.collapsed .label {
    opacity: 0;
    transform: translateY(-50%) translateX(calc(var(--morph-label-slide-distance) * -1));
    pointer-events: none;
    transition:
      opacity var(--morph-label-out-opacity-duration) var(--ease-ios-default) 0ms,
      transform var(--morph-label-out-transform-duration) var(--ease-ios-default) 0ms;
  }
</style>
