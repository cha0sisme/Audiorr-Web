<script lang="ts">
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import * as nav from '$services/NavidromeService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { fetchRelatedAlbums } from '$services/RelatedAlbumsService';
  import { credentials } from '$stores/credentials.svelte';

  const albumId = $derived(page.params.id ?? '');

  // Álbum origen — solo para el nombre del header. Reutiliza la key del detail
  // (['album', id]); si el usuario viene de AlbumDetail ya estará cacheado.
  const albumQ = createQuery(() => ({
    queryKey: ['album', albumId],
    queryFn: () => nav.getAlbum(albumId),
    enabled: credentials.isConfigured && !!albumId
  }));

  // Vista dedicada → pide el máximo (24, cap del backend) en vez de los 12 del
  // footer. Key distinta por el limit (mismo patrón que /artist/[id]/similar).
  const RELATED_FULL_LIMIT = 24;
  const relatedQ = createQuery(() => ({
    queryKey: ['relatedAlbums', albumId, RELATED_FULL_LIMIT],
    queryFn: () => fetchRelatedAlbums(albumId, RELATED_FULL_LIMIT),
    enabled: !!albumId,
    staleTime: 1000 * 60 * 30,
    retry: false
  }));

  const album = $derived(albumQ.data);
  const related = $derived(relatedQ.data ?? []);
</script>

<PageTitle segments={[album?.name ?? 'Álbum', 'Relacionados']} />

<div class="page">
  <header class="header">
    <p class="kicker">Álbumes relacionados</p>
    <h1>{album?.name ?? 'Álbum'}</h1>
    {#if related.length > 0}
      <p class="subtitle">{related.length} {related.length === 1 ? 'álbum' : 'álbumes'}</p>
    {/if}
  </header>

  {#if relatedQ.isPending}
    <div class="grid-skeleton">
      {#each Array(12) as _}<div class="card-sk"></div>{/each}
    </div>
  {:else if relatedQ.isError}
    <p class="error">No se pudieron cargar los álbumes relacionados.</p>
  {:else if related.length > 0}
    <VirtualGrid
      items={related}
      minItemWidth={180}
      estimateRowHeight={285}
      getKey={(ra) => ra.id}
    >
      {#snippet item(ra)}
        <AlbumCard
          id={ra.id}
          title={ra.name}
          artist={ra.artist}
          coverUrl={ra.coverArt ? getCoverArtUrl(ra.coverArt, 300) : undefined}
          href={`/album/${ra.id}`}
          prefetchHero={() => {
            if (ra.coverArt) getCoverArtUrl(ra.coverArt, 600);
          }}
        />
      {/snippet}
    </VirtualGrid>
  {:else}
    <p class="empty">No hay álbumes relacionados para mostrar.</p>
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
