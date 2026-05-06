<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import SegmentedControl from '$components/shared/SegmentedControl.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import * as nav from '$services/NavidromeService';
  import {
    albumToCardProps,
    playlistToCardProps,
    artistToCardProps
  } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';

  type Tab = 'albums' | 'playlists' | 'artists';

  const TABS = [
    { id: 'albums' as const, label: 'Álbumes' },
    { id: 'playlists' as const, label: 'Playlists' },
    { id: 'artists' as const, label: 'Artistas' }
  ];

  const currentTab = $derived<Tab>(
    (page.url.searchParams.get('tab') as Tab | null) ?? 'albums'
  );

  function setTab(t: Tab) {
    const url = new URL(page.url);
    if (t === 'albums') {
      url.searchParams.delete('tab');
    } else {
      url.searchParams.set('tab', t);
    }
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  // Una sola query por tab activa — solo la del tab actual fetchea.
  // gcTime: 30min — la library es la "home" del usuario, vuelve constantemente.
  // Override del default (60s) para evitar refetch al volver tras navegar a un
  // detail. La data en sí es chica (lista de IDs+metadata, ~100KB), no satura.
  const albumsQ = createQuery(() => ({
    queryKey: ['library', 'albums'],
    queryFn: () => nav.getAlbumList2('alphabeticalByName', 500),
    enabled: credentials.isConfigured && currentTab === 'albums',
    gcTime: 30 * 60 * 1000
  }));

  const playlistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured && currentTab === 'playlists',
    gcTime: 30 * 60 * 1000
  }));

  const artistsQ = createQuery(() => ({
    queryKey: ['library', 'artists'],
    queryFn: () => nav.getArtists(),
    enabled: credentials.isConfigured && currentTab === 'artists',
    gcTime: 30 * 60 * 1000
  }));

  const subtitle = $derived.by(() => {
    if (currentTab === 'albums') {
      const n = albumsQ.data?.length ?? 0;
      return `${n} ${n === 1 ? 'álbum' : 'álbumes'}`;
    }
    if (currentTab === 'playlists') {
      const n = playlistsQ.data?.length ?? 0;
      return `${n} ${n === 1 ? 'playlist' : 'playlists'}`;
    }
    const n = artistsQ.data?.length ?? 0;
    return `${n} ${n === 1 ? 'artista' : 'artistas'}`;
  });

  const isPending = $derived(
    currentTab === 'albums' ? albumsQ.isPending :
    currentTab === 'playlists' ? playlistsQ.isPending :
    artistsQ.isPending
  );
</script>

<svelte:head>
  <title>Tu librería · Audiorr</title>
</svelte:head>

<div class="library">
  <header class="header">
    <h1>Tu librería</h1>
    <div class="controls">
      <SegmentedControl
        items={TABS}
        value={currentTab}
        onChange={setTab}
        ariaLabel="Categoría de la librería"
      />
      <p class="subtitle">{isPending ? 'Cargando…' : subtitle}</p>
    </div>
  </header>

  <div
    class="panel"
    data-kind={currentTab}
    role="tabpanel"
    aria-label={TABS.find((t) => t.id === currentTab)?.label}
  >
    {#if currentTab === 'albums'}
      {#if albumsQ.isPending}
        <div class="grid-skeleton">
          {#each Array(12) as _}<div class="card-sk"></div>{/each}
        </div>
      {:else if albumsQ.data}
        <!-- minItemWidth y estimateRowHeight calibrados para 180px cover
             + margin-bottom + 2 líneas de texto (title + artist) ≈ 250px. -->
        <VirtualGrid
          items={albumsQ.data}
          minItemWidth={180}
          estimateRowHeight={250}
          getKey={(a) => a.id}
        >
          {#snippet item(a)}
            {@const props = albumToCardProps(a)}
            <AlbumCard {...props} />
          {/snippet}
        </VirtualGrid>
      {/if}
    {:else if currentTab === 'playlists'}
      {#if playlistsQ.isPending}
        <div class="grid-skeleton">
          {#each Array(8) as _}<div class="card-sk"></div>{/each}
        </div>
      {:else if playlistsQ.data}
        <VirtualGrid
          items={playlistsQ.data}
          minItemWidth={180}
          estimateRowHeight={250}
          getKey={(p) => p.id}
        >
          {#snippet item(p)}
            {@const props = playlistToCardProps(p)}
            <PlaylistCard {...props} />
          {/snippet}
        </VirtualGrid>
      {/if}
    {:else}
      {#if artistsQ.isPending}
        <div class="grid-skeleton" data-kind="artists">
          {#each Array(12) as _}<div class="card-sk round"></div>{/each}
        </div>
      {:else if artistsQ.data}
        <!-- ArtistCard: 140px round + nombre 1 línea ≈ 200px de altura. -->
        <VirtualGrid
          items={artistsQ.data}
          minItemWidth={140}
          estimateRowHeight={200}
          gap={24}
          getKey={(a) => a.id}
        >
          {#snippet item(a)}
            {@const props = artistToCardProps(a)}
            <ArtistCard {...props} />
          {/snippet}
        </VirtualGrid>
      {/if}
    {/if}
  </div>
</div>

<style>
  .library {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }

  .header { display: grid; gap: var(--space-4); }
  .header h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .panel {
    /* VirtualGrid se posiciona absolute internamente; el panel solo provee
       contexto de min-width y permite que el bottom-padding del main no se
       solape con el último row. */
    min-width: 0;
  }

  /* Skeleton estado: usamos CSS grid normal porque no hay datos aún. */
  .grid-skeleton {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  }
  .grid-skeleton[data-kind='artists'] {
    grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
    gap: var(--space-6);
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

  @media (max-width: 640px) {
    .library {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .header h1 {
      font-size: var(--text-2xl);
    }
    .grid-skeleton {
      grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
    }
    .grid-skeleton[data-kind='artists'] {
      grid-template-columns: repeat(auto-fill, minmax(min(110px, 100%), 1fr));
    }
  }
</style>
