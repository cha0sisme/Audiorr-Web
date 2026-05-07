<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import SegmentedControl from '$components/shared/SegmentedControl.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import * as nav from '$services/NavidromeService';
  import { getDailyMixes } from '$services/dailyMixes';
  import { getSmartPlaylists } from '$services/smartPlaylists';
  import {
    getHomepageLayout,
    DEFAULT_HOMEPAGE_LAYOUT
  } from '$services/globalSettings';
  import {
    albumToCardProps,
    playlistToCardProps,
    artistToCardProps
  } from '$utils/navidrome-mappers';
  import {
    dailyMixToProps,
    smartPlaylistToProps,
    filterMyPlaylists,
    isSmartPlaylistName
  } from '$utils/playlist-section-mappers';
  import { credentials } from '$stores/credentials.svelte';
  import type { PlaylistSection } from '$types/backend';
  import type { NavidromePlaylist } from '$types/navidrome';

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

  // ==========================================================================
  // Albums + Artists — sin cambios.
  // ==========================================================================
  const albumsQ = createQuery(() => ({
    queryKey: ['library', 'albums'],
    queryFn: () => nav.getAlbumList2('alphabeticalByName', 500),
    enabled: credentials.isConfigured && currentTab === 'albums',
    gcTime: 30 * 60 * 1000
  }));

  const artistsQ = createQuery(() => ({
    queryKey: ['library', 'artists'],
    queryFn: () => nav.getArtists(),
    enabled: credentials.isConfigured && currentTab === 'artists',
    gcTime: 30 * 60 * 1000
  }));

  // ==========================================================================
  // Playlists tab — replica el layout completo del legacy PlaylistsPage:
  //
  //   1. Cargamos `homepage_layout` del backend (admin-configurable). Si no
  //      existe, usamos DEFAULT_HOMEPAGE_LAYOUT (daily + smart + user).
  //   2. Cargamos en paralelo: daily mixes, smart playlists, todas las
  //      playlists de Navidrome.
  //   3. Renderizamos las secciones EN ORDEN según el layout. Cada `type` se
  //      resuelve a su data source:
  //        fixed_daily  → dailyMixesQ.data
  //        fixed_smart  → smartPlaylistsQ.data
  //        fixed_user   → playlists Navidrome filtradas (owner=username y
  //                       no editorial/spotify/smart/daily-mix)
  //        dynamic      → playlists con IDs explícitos de section.playlists
  //                       (editoriales, spotify-synced, agrupaciones temáticas
  //                       como "Fiesta Latina" curadas por el admin).
  //
  // Cover de cada PlaylistCard SIEMPRE viene del backend personalizado
  // (`/api/playlists/<id>/cover.png`) — nunca cover original de Navidrome.
  // El store `playlistCovers` se hidrata como side effect de getDailyMixes
  // y getSmartPlaylists para que las URLs lleven `?v=<contentHash>` y el
  // backend responda con `Cache-Control: immutable` 1 año.
  // ==========================================================================

  const allPlaylistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured && currentTab === 'playlists',
    gcTime: 30 * 60 * 1000
  }));

  const dailyMixesQ = createQuery(() => ({
    queryKey: ['dailyMixes', credentials.current?.username ?? ''],
    queryFn: () => getDailyMixes(credentials.current!.username),
    enabled: credentials.isConfigured && currentTab === 'playlists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const smartPlaylistsQ = createQuery(() => ({
    queryKey: ['smartPlaylists', credentials.current?.username ?? ''],
    queryFn: () => getSmartPlaylists(credentials.current!.username),
    enabled: credentials.isConfigured && currentTab === 'playlists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const layoutQ = createQuery(() => ({
    queryKey: ['homepageLayout'],
    queryFn: () => getHomepageLayout(),
    enabled: credentials.isConfigured && currentTab === 'playlists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const layout = $derived<PlaylistSection[]>(layoutQ.data ?? DEFAULT_HOMEPAGE_LAYOUT);
  const allPlaylists = $derived<NavidromePlaylist[]>(allPlaylistsQ.data ?? []);

  /** Map id → playlist Navidrome. Usado para resolver IDs explícitos de
      `dynamic` sections. */
  const playlistMap = $derived.by(() => {
    const map = new Map<string, NavidromePlaylist>();
    for (const p of allPlaylists) map.set(p.id, p);
    return map;
  });

  /** Playlists del usuario para `fixed_user` (filtros legacy). */
  const myPlaylists = $derived(
    filterMyPlaylists(allPlaylists, credentials.current?.username)
  );

  /** Resuelve los items concretos para una sección dynamic — IDs → playlists
      Navidrome (filtra los que ya no existen y, por seguridad, las que el
      admin no debería estar mezclando aquí: smart playlists). */
  function dynamicSectionItems(section: PlaylistSection): NavidromePlaylist[] {
    return (section.playlists ?? [])
      .map((id) => playlistMap.get(id))
      .filter((p): p is NavidromePlaylist => !!p && !isSmartPlaylistName(p));
  }

  /** Href del SeeAllGrid de una sección. fixed_* van a rutas dedicadas;
      dynamic comparte la ruta /library/section/<id> (recibe el id y
      resuelve la sección desde el layout). */
  function seeAllHrefFor(section: PlaylistSection): string {
    switch (section.type) {
      case 'fixed_daily':
        return '/library/daily-mixes';
      case 'fixed_smart':
        return '/library/smart-playlists';
      case 'fixed_user':
        return '/library/my-playlists';
      case 'dynamic':
        return `/library/section/${encodeURIComponent(section.id)}`;
    }
  }

  // ==========================================================================
  // Subtitle / pending — sumamos los conteos de todas las secciones que se
  // van a renderizar para reflejar el total real visible.
  // ==========================================================================
  const playlistsTotal = $derived.by(() => {
    let n = 0;
    for (const section of layout) {
      switch (section.type) {
        case 'fixed_daily':
          n += dailyMixesQ.data?.length ?? 0;
          break;
        case 'fixed_smart':
          n += smartPlaylistsQ.data?.length ?? 0;
          break;
        case 'fixed_user':
          n += myPlaylists.length;
          break;
        case 'dynamic':
          n += dynamicSectionItems(section).length;
          break;
      }
    }
    return n;
  });

  const subtitle = $derived.by(() => {
    if (currentTab === 'albums') {
      const n = albumsQ.data?.length ?? 0;
      return `${n} ${n === 1 ? 'álbum' : 'álbumes'}`;
    }
    if (currentTab === 'playlists') {
      return `${playlistsTotal} ${playlistsTotal === 1 ? 'playlist' : 'playlists'}`;
    }
    const n = artistsQ.data?.length ?? 0;
    return `${n} ${n === 1 ? 'artista' : 'artistas'}`;
  });

  /** Pending del tab playlists: hasta que las 3 fuentes principales (daily,
      smart, allPlaylists) tengan respuesta o error, mostramos skeleton. */
  const playlistsPending = $derived(
    dailyMixesQ.isPending || smartPlaylistsQ.isPending || allPlaylistsQ.isPending
  );

  const isPending = $derived(
    currentTab === 'albums'
      ? albumsQ.isPending
      : currentTab === 'playlists'
        ? playlistsPending
        : artistsQ.isPending
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
      {#if playlistsPending}
        <div class="grid-skeleton">
          {#each Array(12) as _}<div class="card-sk"></div>{/each}
        </div>
      {:else}
        <!-- Todas las secciones son carruseles HorizontalScrollSection con
             seeAllHref. Si los items caben, no aparece SeeAllCard; si no,
             aparece "+N Ver todo" al final → /library/<route> que renderiza
             un SeeAllGrid con todos los items. -->
        <div class="playlist-sections">
          {#each layout as section (section.id)}
            {#if section.type === 'fixed_daily' && (dailyMixesQ.data ?? []).length > 0}
              <HorizontalScrollSection
                title={section.title}
                items={dailyMixesQ.data ?? []}
                seeAllHref={seeAllHrefFor(section)}
              >
                {#snippet item(mix)}
                  {@const props = dailyMixToProps(mix)}
                  <PlaylistCard {...props} />
                {/snippet}
              </HorizontalScrollSection>
            {:else if section.type === 'fixed_smart' && (smartPlaylistsQ.data ?? []).length > 0}
              <HorizontalScrollSection
                title={section.title}
                items={smartPlaylistsQ.data ?? []}
                seeAllHref={seeAllHrefFor(section)}
              >
                {#snippet item(sp)}
                  {@const props = smartPlaylistToProps(sp)}
                  <PlaylistCard {...props} />
                {/snippet}
              </HorizontalScrollSection>
            {:else if section.type === 'fixed_user' && myPlaylists.length > 0}
              <HorizontalScrollSection
                title={section.title}
                items={myPlaylists}
                seeAllHref={seeAllHrefFor(section)}
              >
                {#snippet item(p)}
                  {@const props = playlistToCardProps(p)}
                  <PlaylistCard {...props} />
                {/snippet}
              </HorizontalScrollSection>
            {:else if section.type === 'dynamic'}
              {@const items = dynamicSectionItems(section)}
              {#if items.length > 0}
                <HorizontalScrollSection
                  title={section.title}
                  {items}
                  seeAllHref={seeAllHrefFor(section)}
                >
                  {#snippet item(p)}
                    {@const props = playlistToCardProps(p)}
                    <PlaylistCard {...props} />
                  {/snippet}
                </HorizontalScrollSection>
              {/if}
            {/if}
          {/each}

          {#if playlistsTotal === 0}
            <p class="empty">No hay playlists que mostrar.</p>
          {/if}
        </div>
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

  /* Layout del tab playlists: stack vertical de las secciones del layout
     configurado por admin (daily, smart, user, dynamic). Cada sección es
     un carrusel HorizontalScrollSection con seeAllHref. */
  .playlist-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    min-width: 0;
  }

  .empty {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
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
