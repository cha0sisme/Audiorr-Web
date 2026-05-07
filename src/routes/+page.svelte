<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import QuickAccessCard from '$components/home/QuickAccessCard.svelte';
  import * as nav from '$services/NavidromeService';
  import * as stats from '$services/stats';
  import { getDailyMixes, getPlaylistCoverUrl } from '$services/dailyMixes';
  import { getSmartPlaylists } from '$services/smartPlaylists';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { prefetchCover } from '$utils/cover-cache';
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

  // Jump Back In — feed personal del backend Audiorr (últimos contextos
  // únicos escuchados: álbumes, playlists, smart mixes, artistas).
  // Si el wrapped.db está vacío (instalación nueva sin scrobbles), el
  // backend devuelve [] y la sección se omite del DOM.
  const recentContextsQ = createQuery(() => ({
    queryKey: ['recentContexts', credentials.current?.username ?? ''],
    queryFn: () => stats.getRecentContexts(credentials.current!.username),
    enabled: credentials.isConfigured,
    // 1 min staleTime: el feed actualiza cada vez que el usuario reproduce
    // algo nuevo, pero no tan frecuente como para refetch agresivo.
    staleTime: 60 * 1000
  }));
  const recentContexts = $derived(recentContextsQ.data ?? []);

  // Side effect: pre-cargar los `coverContentHash` de daily mixes + smart
  // playlists en el store global `playlistCovers`. Mirrors
  // `api.refreshPlaylistCoverHashes()` de iOS HomeView.
  // Sin esto, los covers de playlists en Jump Back In se servirían sin
  // `?v=` y caducarían al cabo de 30 min (vs 1 año con el hash).
  // No renderizamos los datos aquí — es solo para hidratar el cache.
  createQuery(() => ({
    queryKey: ['dailyMixes', credentials.current?.username ?? ''],
    queryFn: () => getDailyMixes(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
  createQuery(() => ({
    queryKey: ['smartPlaylists', credentials.current?.username ?? ''],
    queryFn: () => getSmartPlaylists(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
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

  {#if recentContexts.length > 0}
    <!-- Jump Back In ("Volver a escuchar"): carrusel reutilizando los cards
         estándar de la app (AlbumCard / PlaylistCard / ArtistCard) según el
         tipo del contexto. Esto garantiza coherencia visual con el resto
         de carruseles de la home (mismo itemMinWidth=180, mismas medidas
         tipográficas, mismas animaciones).

         Cover por tipo:
           album    → Navidrome (Subsonic) por coverArtId.
           playlist | smartmix → backend personalizado por id.
           artist   → fallback a iniciales (ArtistCard).

         `other` se filtra (sin cover representativo).
         Para artist, ctx.id es el NOMBRE en el shape del backend, así que
         href cae a /search?q=<name>. -->
    <HorizontalScrollSection title="Volver a escuchar" items={recentContexts}>
      {#snippet item(ctx)}
        {#if ctx.type === 'album'}
          <AlbumCard
            id={ctx.id}
            title={ctx.title}
            artist={ctx.artist}
            coverUrl={ctx.coverArtId ? getCoverArtUrl(ctx.coverArtId, 300) : undefined}
            href={`/album/${ctx.id}`}
            prefetchHero={() => prefetchCover(ctx.coverArtId ?? undefined, 600)}
          />
        {:else if ctx.type === 'playlist' || ctx.type === 'smartmix'}
          <PlaylistCard
            id={ctx.id}
            name={ctx.title}
            coverUrl={getPlaylistCoverUrl(ctx.id)}
            href={`/playlist/${ctx.id}`}
            prefetchHero={() => {}}
          />
        {:else if ctx.type === 'artist'}
          <ArtistCard
            id={ctx.id}
            name={ctx.title}
            href={`/search?q=${encodeURIComponent(ctx.title)}`}
            prefetchHero={() => {}}
          />
        {/if}
      {/snippet}
    </HorizontalScrollSection>
  {/if}

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
