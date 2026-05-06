<script lang="ts">
  /**
   * Badge "E" de contenido explícito — réplica del de Apple Music.
   *
   *   - Cuadrado y squircle radius → CSS (`--badge-size`, border-radius 22%
   *     ≈ continuous corner-radius iOS).
   *   - "E" → glifo de Söhne Kraftig (weight 500) renderizado como texto.
   *     Aprovechamos las proporciones tipográficas reales en vez de un
   *     path manual.
   *
   * Variantes:
   *   - default → cuadrado gris translúcido + E text-secondary.
   *   - onArt   → cuadrado blanco translúcido + E blanca, theme-agnostic
   *               para fondos coloreados (hero, scrim, cover).
   */
  type Props = {
    /** True cuando el badge va sobre cover art / hero gradient / scrim. */
    onArt?: boolean;
    /** Tamaño del lado del badge. Default: 1em (igual al font-size del
        contexto — proporción Apple Music inline en cards/listas). Sobreescribir
        para hero (~22px) o cuando el texto sea muy grande. */
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
  <span class="letter" aria-hidden="true">E</span>
</span>

<style>
  .badge {
    /* inline-grid + flex-shrink: 0 → el badge se alinea al baseline del
       texto y no se aplasta dentro de contenedores con ellipsis. */
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;

    width: var(--badge-size);
    height: var(--badge-size);
    /* font-size = badge-size para que la E escale con el cuadrado
       independientemente del font-size heredado del contenedor. */
    font-size: var(--badge-size);

    /* 22% ≈ proporción continua iOS (Apple no usa esquinas circulares
       perfectas; squircle medio entre Material 8% y rounded-full). */
    border-radius: 22%;

    background: var(--explicit-badge-bg);
    color: var(--explicit-badge-fg);

    user-select: none;
    vertical-align: middle;
  }

  .badge.on-art {
    background: var(--explicit-badge-bg-on-art);
    color: var(--explicit-badge-fg-on-art);
  }

  .letter {
    font-family: 'Söhne', var(--font-sans);
    font-weight: 500; /* Kraftig */
    font-size: 0.78em;
    line-height: 1;
    /* Compensación óptica: con line-height: 1 el ink de la E queda
       centrado por su line-box, pero el descender (vacío) ocupa parte
       del em-box y empuja la E ligeramente hacia arriba. ~6% abajo
       devuelve el centro óptico al centro geométrico del cuadrado. */
    transform: translateY(6%);
  }
</style>
