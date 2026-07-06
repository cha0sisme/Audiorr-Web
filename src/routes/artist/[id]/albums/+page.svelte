<script lang="ts">
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import FilterChips from '$components/shared/FilterChips.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import * as nav from '$services/NavidromeService';
  import { albumToCardProps } from '$utils/navidrome-mappers';
  import {
    albumReleaseKind,
    matchesDiscographyFilter,
    parseDiscographyFilter,
    RELEASE_KIND_LABEL,
    type DiscographyFilter
  } from '$utils/release-kind';
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

  // Filtro Todo / Álbumes / Sencillos — mismo criterio que la sección de
  // ArtistDetail (release-kind.ts). El estado inicial viene del `?type=`
  // que arrastra el "Ver todo" de la sección.
  let filter = $state<DiscographyFilter>(
    parseDiscographyFilter(page.url.searchParams.get('type'))
  );

  const hasLongFormats = $derived(
    albums.some((a) => matchesDiscographyFilter(albumReleaseKind(a), 'albums'))
  );
  const hasSingles = $derived(
    albums.some((a) => matchesDiscographyFilter(albumReleaseKind(a), 'singles'))
  );
  const showFilter = $derived(hasLongFormats && hasSingles);

  // Sin chips visibles no hay forma de salir de un filtro — si el `?type=`
  // llega a mano para una discografía de un solo grupo, se ignora.
  const effectiveFilter = $derived(showFilter ? filter : 'all');

  const filteredAlbums = $derived(
    effectiveFilter === 'all'
      ? albums
      : albums.filter((a) => matchesDiscographyFilter(albumReleaseKind(a), effectiveFilter))
  );

  const FILTER_ITEMS: { id: DiscographyFilter; label: string }[] = [
    { id: 'all', label: 'Todo' },
    { id: 'albums', label: 'Álbumes' },
    { id: 'singles', label: 'Sencillos' }
  ];
</script>

<PageTitle segments={[artist?.name ?? 'Artista', 'Discografía']} />

<div class="page">
  <header class="header">
    <p class="kicker">Discografía</p>
    <h1>{artist?.name ?? 'Artista'}</h1>
    {#if albums.length > 0}
      <p class="subtitle">
        {albums.length} {albums.length === 1 ? 'lanzamiento' : 'lanzamientos'}
      </p>
    {/if}
  </header>

  {#if showFilter}
    <FilterChips
      items={FILTER_ITEMS}
      value={filter}
      onChange={(id) => (filter = id)}
      ariaLabel="Filtrar discografía"
    />
  {/if}

  {#if artistQ.isPending}
    <div class="grid-skeleton">
      {#each Array(12) as _}<div class="card-sk"></div>{/each}
    </div>
  {:else if artistQ.isError}
    <p class="error">No se pudo cargar el artista.</p>
  {:else if filteredAlbums.length > 0}
    <VirtualGrid
      items={filteredAlbums}
      minItemWidth={180}
      estimateRowHeight={285}
      getKey={(a) => a.id}
    >
      {#snippet item(a)}
        {@const props = albumToCardProps(a)}
        <AlbumCard
          {...props}
          subtitleMode="year"
          releaseKindLabel={RELEASE_KIND_LABEL[albumReleaseKind(a)]}
        />
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
