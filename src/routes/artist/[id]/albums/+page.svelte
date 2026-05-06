<script lang="ts">
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import * as nav from '$services/NavidromeService';
  import { albumToCardProps } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';

  const artistId = $derived(page.params.id ?? '');

  const artistQ = createQuery(() => ({
    queryKey: ['artist', artistId],
    queryFn: () => nav.getArtist(artistId),
    enabled: credentials.isConfigured && !!artistId
  }));

  const artist = $derived(artistQ.data);
  // Discografía ordenada por año desc — mismo orden que la sección del detail.
  const albums = $derived(
    artist?.album ? [...artist.album].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)) : []
  );
</script>

<svelte:head>
  <title>{artist?.name ?? 'Artista'} · Discografía · Audiorr</title>
</svelte:head>

<div class="page">
  <header class="header">
    <p class="kicker">Discografía</p>
    <h1>{artist?.name ?? 'Artista'}</h1>
    {#if albums.length > 0}
      <p class="subtitle">{albums.length} {albums.length === 1 ? 'álbum' : 'álbumes'}</p>
    {/if}
  </header>

  {#if artistQ.isPending}
    <div class="grid-skeleton">
      {#each Array(12) as _}<div class="card-sk"></div>{/each}
    </div>
  {:else if artistQ.isError}
    <p class="error">No se pudo cargar el artista.</p>
  {:else if albums.length > 0}
    <VirtualGrid
      items={albums}
      minItemWidth={180}
      estimateRowHeight={250}
      getKey={(a) => a.id}
    >
      {#snippet item(a)}
        {@const props = albumToCardProps(a)}
        <AlbumCard {...props} subtitleMode="year" />
      {/snippet}
    </VirtualGrid>
  {:else}
    <p class="empty">Este artista no tiene álbumes en la biblioteca.</p>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }
  .header {
    display: grid;
    gap: var(--space-1);
  }
  .kicker {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .grid-skeleton {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  }
  .card-sk {
    aspect-ratio: 1;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  .empty,
  .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    h1 {
      font-size: var(--text-2xl);
    }
    .grid-skeleton {
      grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
    }
  }
</style>
