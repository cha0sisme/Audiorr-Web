<script lang="ts">
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import * as nav from '$services/NavidromeService';
  import { similarArtistToCardProps } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';
  import type { NavidromeSimilarArtist } from '$types/navidrome';

  const artistId = $derived(page.params.id ?? '');

  const artistQ = createQuery(() => ({
    queryKey: ['artist', artistId],
    queryFn: () => nav.getArtist(artistId),
    enabled: credentials.isConfigured && !!artistId
  }));

  // Similar pide hasta 50 (vs 20 del detail) — al ser una vista dedicada
  // tiene sentido cargar más resultados.
  const artistInfoQ = createQuery(() => ({
    queryKey: ['artistInfo', artistId, 50],
    queryFn: () => nav.getArtistInfo2(artistId, 50),
    enabled: credentials.isConfigured && !!artistId,
    retry: false,
    staleTime: 1000 * 60 * 60
  }));

  const artist = $derived(artistQ.data);
  // Solo similares que existen en la biblioteca (id presente Y albumCount > 0).
  // Sin esa garantía el card lleva al usuario a una vista vacía. Mismo filtro
  // que /artist/[id] (Fans también escuchan).
  const similar = $derived<NavidromeSimilarArtist[]>(
    (artistInfoQ.data?.similarArtist ?? []).filter(
      (a) => a.id && a.id.length > 0 && (a.albumCount ?? 0) > 0
    )
  );
</script>

<PageTitle segments={[artist?.name ?? 'Artista', 'Similares']} />

<div class="page">
  <header class="header">
    <p class="kicker">Fans también escuchan</p>
    <h1>{artist?.name ?? 'Artista'}</h1>
    {#if similar.length > 0}
      <p class="subtitle">{similar.length} {similar.length === 1 ? 'artista' : 'artistas'}</p>
    {/if}
  </header>

  {#if artistInfoQ.isPending}
    <div class="grid-skeleton">
      {#each Array(12) as _}<div class="card-sk round"></div>{/each}
    </div>
  {:else if artistInfoQ.isError}
    <p class="error">No se pudieron cargar los artistas similares.</p>
  {:else if similar.length > 0}
    <VirtualGrid
      items={similar}
      minItemWidth={140}
      estimateRowHeight={230}
      gap={24}
      getKey={(a) => a.id ?? a.name}
    >
      {#snippet item(sa)}
        {@const props = similarArtistToCardProps(sa)}
        <ArtistCard {...props} />
      {/snippet}
    </VirtualGrid>
  {:else}
    <p class="empty">No hay artistas similares para mostrar.</p>
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
    gap: var(--space-6);
    grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
  }
  .card-sk {
    aspect-ratio: 1;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .card-sk.round { border-radius: var(--radius-full); }
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
      grid-template-columns: repeat(auto-fill, minmax(min(110px, 100%), 1fr));
    }
  }
</style>
