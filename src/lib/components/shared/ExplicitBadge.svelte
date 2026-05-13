<script lang="ts">
  /**
   * Badge "E" de contenido explícito.
   *
   * Reemplazado por el SVG path proporcionado por el usuario, que replica el estilo
   * oficial de Apple Music con mayor precisión que un glifo tipográfico.
   *
   * Variantes:
   *   - default → cuadrado gris translúcido + E text-secondary.
   *   - onArt   → cuadrado blanco translúcido + E blanca, theme-agnostic
   *               para fondos coloreados (hero, scrim, cover).
   */
  type Props = {
    /** True cuando el badge va sobre cover art / hero gradient / scrim. */
    onArt?: boolean;
    /** Tamaño del lado del badge. Default: 1em. */
    size?: string;
  };

  let { onArt = false, size = '1em' }: Props = $props();

  const label = 'Contenido explícito';
</script>

<span
  class="badge"
  class:on-art={onArt}
  role="img"
  aria-label={label}
  title={label}
  style:--badge-size={size}
>
  <svg viewBox="0 0 9 9" class="svg-icon" aria-hidden="true">
    <path
      class="bg"
      d="M1.6 0h5.8C8.5 0 9 .5 9 1.6v5.9C9 8.5 8.5 9 7.4 9H1.6C.5 9 0 8.5 0 7.4V1.6C0 .5.5 0 1.6 0z"
    />
    <path
      class="letter"
      d="M3.9 7h1.9c.4 0 .7-.2.7-.5s-.3-.4-.7-.4H4.1V4.9h1.5c.4 0 .7-.1.7-.4 0-.3-.3-.5-.7-.5H4.1V2.9h1.7c.4 0 .7-.2.7-.5 0-.2-.3-.4-.7-.4H3.9c-.6 0-.9.3-.9.7v3.7c0 .3.3.6.9.6z"
    />
  </svg>
</span>

<style>
  .badge {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;

    width: var(--badge-size);
    height: var(--badge-size);

    user-select: none;
    vertical-align: middle;
  }

  .svg-icon {
    width: 100%;
    height: 100%;
    display: block;
  }

  .bg {
    fill: var(--explicit-badge-bg);
  }

  .letter {
    fill: var(--explicit-badge-fg);
  }

  .badge.on-art .bg {
    fill: var(--explicit-badge-bg-on-art);
  }

  .badge.on-art .letter {
    fill: var(--explicit-badge-fg-on-art);
  }
</style>
