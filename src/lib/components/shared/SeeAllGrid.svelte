<script lang="ts">
  import type { Snippet } from 'svelte';

  type Kind = 'album' | 'playlist' | 'artist';

  type Props = {
    title: string;
    /** Determina las columnas: album/playlist = 2-5 col flex, artist = 3-7 col más chico. */
    kind: Kind;
    children: Snippet;
  };

  let { title, kind, children }: Props = $props();
</script>

<div class="page">
  <header>
    <h1>{title}</h1>
  </header>

  <div class="grid" data-kind={kind}>
    {@render children()}
  </div>
</div>

<style>
  .page {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }

  header h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
  }

  .grid {
    display: grid;
    gap: var(--space-5);
  }
  .grid[data-kind='album'],
  .grid[data-kind='playlist'] {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }
  .grid[data-kind='artist'] {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-6);
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .grid[data-kind='album'],
    .grid[data-kind='playlist'] {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    }
    .grid[data-kind='artist'] {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    }
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
