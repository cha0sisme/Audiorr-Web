<script lang="ts">
  import { CaretCircleRight } from 'phosphor-svelte';

  type Props = {
    /** Cantidad de elementos restantes que quedan fuera del scroll. */
    remaining: number;
    href: string;
  };

  let { remaining, href }: Props = $props();
</script>

<a class="card" {href}>
  <div class="cover">
    <CaretCircleRight size={32} weight="fill" />
    <span class="count">+{remaining}</span>
  </div>
  <p class="label">Ver todo</p>
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

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    line-height: 1.3;
  }
  .card:hover .label {
    color: var(--text-primary);
  }
</style>
