<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import QuickAccessCard from '$components/home/QuickAccessCard.svelte';
  import * as nav from '$services/NavidromeService';
  import {
    albumToCardProps,
    playlistToCardProps,
    artistToCardProps
  } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';

  // Saludo dinámico por hora
  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? 'Buenas noches'
    : hour < 13 ? 'Buenos días'
    : hour < 20 ? 'Buenas tardes'
    : 'Buenas noches';

  // Reactive query options — function form se re-evalúa si credentials cambia
  const recentAlbums = createQuery(() => ({
    queryKey: ['albumList2', 'recent'],
    queryFn: () => nav.getAlbumList2('recent', 30),
    enabled: credentials.isConfigured
  }));

  const newestAlbums = createQuery(() => ({
    queryKey: ['albumList2', 'newest'],
    queryFn: () => nav.getAlbumList2('newest', 30),
    enabled: credentials.isConfigured
  }));

  const frequentAlbums = createQuery(() => ({
    queryKey: ['albumList2', 'frequent'],
    queryFn: () => nav.getAlbumList2('frequent', 30),
    enabled: credentials.isConfigured
  }));

  const randomAlbums = createQuery(() => ({
    queryKey: ['albumList2', 'random'],
    queryFn: () => nav.getAlbumList2('random', 30),
    // random no se cachea fuerte — refetch al volver a la home da variedad
    staleTime: 0,
    enabled: credentials.isConfigured
  }));

  // playlists y artists rara vez cambian durante una sesión y `getArtists`
  // es pesado (devuelve TODOS los artistas indexados — 100-200 KB JSON gzip
  // en bibliotecas grandes). Los retenemos durante toda la sesión.
  const playlistsQ = createQuery(() => ({
    queryKey: ['playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured,
    staleTime: Infinity,
    gcTime: Infinity
  }));

  const artistsQ = createQuery(() => ({
    queryKey: ['artists'],
    queryFn: () => nav.getArtists(),
    enabled: credentials.isConfigured,
    staleTime: Infinity,
    gcTime: Infinity
  }));

  // Quick access usa los albums más recientes (top 8)
  const quickAccess = $derived(recentAlbums.data?.slice(0, 8) ?? []);
</script>

<div class="home">
  <header class="hero">
    <div>
      <p class="eyebrow">{greeting}</p>
      <h1>Bienvenido</h1>
    </div>
    <div class="chips" role="tablist" aria-label="Filtros">
      <button class="chip active" role="tab" aria-selected="true">Todo</button>
      <button class="chip" role="tab" aria-selected="false">Música</button>
      <button class="chip" role="tab" aria-selected="false">Mixes</button>
    </div>
  </header>

  <section class="quick-access">
    {#each quickAccess as a (a.id)}
      {@const props = albumToCardProps(a)}
      <QuickAccessCard
        id={props.id}
        contextType="album"
        title={props.title}
        coverUrl={props.coverUrl}
        href={props.href}
        prefetchHero={props.prefetchHero}
      />
    {/each}
  </section>

  <HorizontalScrollSection
    title="Recientemente añadido"
    items={recentAlbums.data ?? []}
    seeAllHref="/library/recent"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Más escuchado"
    subtitle="Tus álbumes favoritos"
    items={frequentAlbums.data ?? []}
    seeAllHref="/library/most-played"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Tus playlists"
    items={playlistsQ.data ?? []}
    seeAllHref="/library/playlists"
  >
    {#snippet item(p)}
      {@const props = playlistToCardProps(p)}
      <PlaylistCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Artistas"
    items={artistsQ.data ?? []}
    seeAllHref="/library/artists"
    itemMinWidth={140}
    seeAllShape="round"
  >
    {#snippet item(a)}
      {@const props = artistToCardProps(a)}
      <ArtistCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Aleatorio"
    subtitle="Algo distinto cada visita"
    items={randomAlbums.data ?? []}
    seeAllHref="/library/random"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Nuevos lanzamientos"
    items={newestAlbums.data ?? []}
    seeAllHref="/library/newest"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>
</div>

<style>
  .home {
    display: grid;
    gap: var(--space-10);
    padding: var(--space-8) 0 var(--space-12);
  }

  .hero {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-6);
    flex-wrap: wrap;
    padding: 0 var(--space-6);
  }
  .eyebrow {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: var(--space-1);
  }
  h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    line-height: 1.1;
    margin: 0;
  }

  .chips {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .chip {
    padding: var(--space-2) var(--space-4);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .chip:hover:not(.active) {
    background: var(--bg-surface-hover);
  }
  .chip.active {
    background: var(--text-primary);
    color: var(--bg-canvas);
    border-color: var(--text-primary);
  }

  .quick-access {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: var(--space-3);
    padding: 0 var(--space-6);
  }

  @media (max-width: 640px) {
    .home {
      gap: var(--space-8);
    }
    .hero {
      padding: 0 var(--space-4);
    }
    .quick-access {
      padding: 0 var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
    }
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
