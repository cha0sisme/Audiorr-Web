<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { ArrowsClockwise, CaretRight } from 'phosphor-svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import SegmentedControl from '$components/shared/SegmentedControl.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import * as nav from '$services/NavidromeService';
  import { getDailyMixes } from '$services/dailyMixes';
  import { getSmartPlaylists } from '$services/smartPlaylists';
  import { refreshPlaylistCoverHashes } from '$services/playlist-cover-refresh';
  import { DEFAULT_HOMEPAGE_LAYOUT } from '$services/globalSettings';
  import { loadPlaylistsLayout } from '$services/userAffinity';
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
  import CreatePlaylistButton from '$components/shared/CreatePlaylistButton.svelte';
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
  // Artists tab — replica el ArtistsView de iOS:
  //   1. "Más escuchados" — 12 artistas top extraídos de `frequent` albums.
  //   2. "Recientes" — 12 artistas con álbumes recién añadidos (`newest`).
  //   3. "{Genre random}" — 12 artistas de un género aleatorio + botón shuffle.
  //   4. Link al final → /library/artists (lista A-Z completa).
  //
  // Las 3 secciones se cruzan con `getArtists()` por nombre para resolver el
  // ID Subsonic (los álbumes solo traen `artist: string`, no el id). Si el
  // mismo nombre está duplicado en la biblioteca, nos quedamos con el primero.
  // ==========================================================================

  const allArtists = $derived(artistsQ.data ?? []);

  /** Map nombre → primera ocurrencia. Tolera duplicados (Subsonic permite
      varios artistas con el mismo nombre). Ports `artistLookupByName` de iOS. */
  const artistByName = $derived.by(() => {
    const map = new Map<string, NonNullable<typeof artistsQ.data>[number]>();
    for (const a of allArtists) {
      if (!map.has(a.name)) map.set(a.name, a);
    }
    return map;
  });

  // === Featured: top artistas por frecuencia de plays (frequent albums) ===
  const frequentAlbumsForArtistsQ = createQuery(() => ({
    queryKey: ['library', 'artists', 'frequent'],
    queryFn: () => nav.getAlbumList2('frequent', 50),
    enabled: credentials.isConfigured && currentTab === 'artists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const featuredArtists = $derived.by(() => {
    const albums = frequentAlbumsForArtistsQ.data ?? [];
    const counts = new Map<string, number>();
    for (const album of albums) {
      const name = album.artist ?? '';
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name]) => artistByName.get(name))
      .filter((a): a is NonNullable<typeof allArtists[number]> => !!a);
  });

  // === Recent: artistas con álbumes recién añadidos ===
  const newestAlbumsForArtistsQ = createQuery(() => ({
    queryKey: ['library', 'artists', 'newest'],
    queryFn: () => nav.getAlbumList2('newest', 30),
    enabled: credentials.isConfigured && currentTab === 'artists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const recentArtists = $derived.by(() => {
    const albums = newestAlbumsForArtistsQ.data ?? [];
    const seen = new Set<string>();
    const out: NonNullable<typeof allArtists[number]>[] = [];
    for (const album of albums) {
      const name = album.artist ?? '';
      if (!name || seen.has(name)) continue;
      const a = artistByName.get(name);
      if (!a) continue;
      seen.add(name);
      out.push(a);
      if (out.length >= 12) break;
    }
    return out;
  });

  // === Genre random — pool de 3 listas + filter blacklist ===
  let currentGenre = $state<string | null>(null);
  let recentGenres: string[] = [];
  const GENRE_HISTORY_DEPTH = 3;

  /** Pool de albums para extraer géneros. Se carga una vez al entrar al tab. */
  const genrePoolQ = createQuery(() => ({
    queryKey: ['library', 'artists', 'genre-pool'],
    queryFn: async () => {
      const [n, f, r] = await Promise.all([
        nav.getAlbumList2('newest', 100),
        nav.getAlbumList2('frequent', 100),
        nav.getAlbumList2('random', 100)
      ]);
      return [...n, ...f, ...r];
    },
    enabled: credentials.isConfigured && currentTab === 'artists',
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const availableGenres = $derived.by(() => {
    const albums = genrePoolQ.data ?? [];
    const set = new Set<string>();
    for (const album of albums) {
      const g = album.genre ?? '';
      if (!g) continue;
      for (const part of g.split(',')) {
        const trimmed = part.trim();
        if (trimmed) set.add(trimmed);
      }
    }
    return [...set];
  });

  /** Selecciona un género evitando los últimos `GENRE_HISTORY_DEPTH` y el
      actual. Fallback: cualquiera distinto al actual si la lista es chica. */
  function pickGenre(): string | null {
    const genres = availableGenres;
    if (genres.length === 0) return null;
    const blocked = new Set([currentGenre, ...recentGenres].filter(Boolean) as string[]);
    let candidates = genres.filter((g) => !blocked.has(g));
    if (candidates.length === 0) {
      candidates = genres.filter((g) => g !== currentGenre);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
  }

  // Auto-selecciona el primer género cuando el pool llega.
  $effect(() => {
    if (currentTab !== 'artists') return;
    if (currentGenre !== null) return;
    if (availableGenres.length === 0) return;
    const picked = pickGenre();
    if (picked) currentGenre = picked;
  });

  function shuffleGenre() {
    const next = pickGenre();
    if (!next) return;
    if (currentGenre) {
      recentGenres = [currentGenre, ...recentGenres].slice(0, GENRE_HISTORY_DEPTH);
    }
    currentGenre = next;
  }

  const genreAlbumsQ = createQuery(() => ({
    queryKey: ['library', 'artists', 'byGenre', currentGenre ?? ''],
    queryFn: () => nav.getAlbumsByGenre(currentGenre!, 50),
    enabled: credentials.isConfigured && currentTab === 'artists' && !!currentGenre,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  }));

  const genreArtists = $derived.by(() => {
    const albums = genreAlbumsQ.data ?? [];
    const seen = new Set<string>();
    const out: NonNullable<typeof allArtists[number]>[] = [];
    for (const album of albums) {
      const name = album.artist ?? '';
      if (!name || seen.has(name)) continue;
      const a = artistByName.get(name);
      if (!a) continue;
      seen.add(name);
      out.push(a);
      if (out.length >= 12) break;
    }
    return out;
  });

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

  // Intenta `ranked-layout` (orden por afinidad) primero; fail-soft a
  // `homepage_layout` legacy y de ahí a DEFAULT. Las secciones dynamic vienen
  // con las playlists ya ordenadas por `rankPredicted` — no reordenar.
  // queryKey incluye el username porque el orden depende del usuario.
  const layoutQ = createQuery(() => ({
    queryKey: ['playlistsLayout', credentials.current?.username ?? ''],
    queryFn: () => loadPlaylistsLayout(credentials.current?.username),
    enabled: credentials.isConfigured && currentTab === 'playlists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  // Layer 2 (HEAD/ETag) para playlists no cubiertas por dailyMixes/
  // smartPlaylists — editorial, Spotify-synced, "This Is …", del usuario.
  // Mirror PlaylistsView.swift:67. Solo dispara en la tab Playlists para
  // no malgastar requests cuando el user está en Álbumes o Artistas.
  const queryClient = useQueryClient();
  $effect(() => {
    if (!credentials.isConfigured) return;
    if (currentTab !== 'playlists') return;
    void refreshPlaylistCoverHashes(queryClient, credentials.current?.username);
  });

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
    <div class="title-row">
      <h1>Tu librería</h1>
      {#if currentTab === 'playlists'}
        <CreatePlaylistButton />
      {/if}
    </div>
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
      <!-- Tab Artistas — 3 carruseles + link "Todos los artistas". -->
      {#if artistsQ.isPending}
        <div class="grid-skeleton" data-kind="artists">
          {#each Array(12) as _}<div class="card-sk round"></div>{/each}
        </div>
      {:else if allArtists.length > 0}
        <div class="artist-sections">
          {#if featuredArtists.length > 0}
            <HorizontalScrollSection
              title="Más escuchados"
              items={featuredArtists}
              itemMinWidth={140}
              seeAllShape="round"
            >
              {#snippet item(a)}
                {@const props = artistToCardProps(a)}
                <ArtistCard {...props} />
              {/snippet}
            </HorizontalScrollSection>
          {/if}

          {#if recentArtists.length > 0}
            <HorizontalScrollSection
              title="Recientes"
              items={recentArtists}
              itemMinWidth={140}
              seeAllShape="round"
            >
              {#snippet item(a)}
                {@const props = artistToCardProps(a)}
                <ArtistCard {...props} />
              {/snippet}
            </HorizontalScrollSection>
          {/if}

          {#if currentGenre && genreArtists.length > 0}
            <section class="genre-section">
              <header class="genre-header">
                <h2>{currentGenre}</h2>
                <button
                  type="button"
                  class="shuffle-btn"
                  onclick={shuffleGenre}
                  aria-label="Cambiar género"
                  title="Cambiar género"
                >
                  <ArrowsClockwise size={16} weight="bold" />
                </button>
              </header>
              <HorizontalScrollSection
                title=""
                items={genreArtists}
                itemMinWidth={140}
                seeAllShape="round"
              >
                {#snippet item(a)}
                  {@const props = artistToCardProps(a)}
                  <ArtistCard {...props} />
                {/snippet}
              </HorizontalScrollSection>
            </section>
          {/if}

          <a class="all-artists-link" href="/library/artists">
            <span class="all-label">Todos los artistas</span>
            <span class="all-count">{allArtists.length}</span>
            <CaretRight size={14} weight="bold" />
          </a>
        </div>
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
  /* Title row: h1 + acción contextual (Crear playlist en tab Playlists). */
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
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
  .playlist-sections,
  .artist-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    min-width: 0;
  }

  /* === Tab Artistas — sección Genre con shuffle button === */
  .genre-section {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .genre-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-6);
  }
  .genre-header h2 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    line-height: 1.2;
    color: var(--text-primary);
  }
  .shuffle-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .shuffle-btn:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .shuffle-btn:active {
    transform: rotate(120deg);
    transition-duration: var(--duration-instant);
  }
  .shuffle-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* === Link "Todos los artistas (N)" al final del tab Artistas === */
  .all-artists-link {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    margin: 0 var(--space-2);
    border-top: 1px solid var(--separator-subtle);
    color: var(--text-primary);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .all-artists-link:hover {
    background: var(--row-hover);
  }
  .all-artists-link:focus-visible {
    outline: none;
    background: var(--row-hover);
    box-shadow: var(--focus-ring);
  }
  .all-label {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    line-height: 1.2;
  }
  .all-count {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    margin-right: auto;
  }
  .all-artists-link :global(svg) {
    color: var(--text-tertiary);
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
