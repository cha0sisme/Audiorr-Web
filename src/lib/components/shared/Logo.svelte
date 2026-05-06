<script lang="ts">
  /**
   * Logo inline (no <img>). Renderiza el SVG como nodos DOM reales para que
   * el browser lo redibuje crisp a cualquier tamaño y DPR. Pierde la rasterización
   * one-shot que hace <img>, ganando escalabilidad vector real.
   *
   * Importado vía `?raw` desde src/lib/assets — public/ no está en el module
   * graph de Vite, por eso vive duplicado (public/ para favicons en app.html,
   * src/lib para inline import).
   */
  import logoSvg from '$lib/assets/logo-icon.svg?raw';

  type Props = {
    /** Tamaño en px del lado (logo es cuadrado). */
    size?: number;
    /** Aria-label opcional — si no se pasa, el logo es decorativo. */
    label?: string | undefined;
  };

  let { size = 32, label }: Props = $props();
</script>

<span
  class="logo"
  style:--logo-size="{size}px"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : true}
>
  {@html logoSvg}
</span>

<style>
  .logo {
    display: inline-block;
    width: var(--logo-size);
    height: var(--logo-size);
    line-height: 0;
    flex-shrink: 0;
  }
  /* :global() necesario porque el SVG entra via {@html} sin scope-hash */
  .logo :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
