<script lang="ts">
  import { CaretCircleRight } from 'phosphor-svelte';

  type Props = {
    /** Cantidad de elementos restantes que quedan fuera del scroll. */
    remaining: number;
    href: string;
    /** 'square' (covers 1:1, default) | 'wide' (slots apaisados 168:100,
        p. ej. GenreCard) — en wide el label va DENTRO de la card para que
        la altura de fila case con las cards vecinas. */
    shape?: 'square' | 'wide';
  };

  let { remaining, href, shape = 'square' }: Props = $props();
</script>

<a class="card" class:wide={shape === 'wide'} {href}>
  <div class="cover">
    <CaretCircleRight size={shape === 'wide' ? 24 : 32} weight="fill" />
    <span class="count">+{remaining}</span>
    {#if shape === 'wide'}
      <span class="label-inner">Ver todo</span>
    {/if}
  </div>
  {#if shape !== 'wide'}
    <p class="label">Ver todo</p>
  {/if}
</a>

<style>
  .card {
    display: block;
    text-align: center;
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    outline: none;
  }
  .card:focus-visible .cover {
    box-shadow: var(--shadow-sm), var(--focus-ring);
  }

  .cover {
    aspect-ratio: 1;
    width: 100%;
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-3);
    box-shadow: var(--shadow-sm);

    display: grid;
    place-content: center;
    gap: var(--space-2);
    justify-items: center;

    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .card:hover .cover {
    background: var(--bg-surface-active);
    color: var(--text-primary);
    box-shadow: var(--shadow-md);
  }

  .wide .cover {
    aspect-ratio: 168 / 100;
    margin-bottom: 0;
    gap: 2px;
    border-radius: var(--radius-lg);
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .wide .count {
    font-size: var(--text-sm);
  }

  .label,
  .label-inner {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    line-height: 1.3;
  }
  .label-inner {
    font-size: var(--text-xs);
    color: inherit;
  }
  .card:hover .label {
    color: var(--text-primary);
  }
</style>
