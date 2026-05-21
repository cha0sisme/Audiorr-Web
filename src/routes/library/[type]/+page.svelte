<script lang="ts">
  import { page } from '$app/state';
  import { error } from '@sveltejs/kit';
  import { createQuery } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { getDailyMixes } from '$services/dailyMixes';
  import { getSmartPlaylists } from '$services/smartPlaylists';
  import {
    albumToCardProps,
    playlistToCardProps,
    artistToCardProps
  } from '$utils/navidrome-mappers';
  import {
    dailyMixToProps,
    smartPlaylistToProps,
    filterMyPlaylists
  } from '$utils/playlist-section-mappers';
  import { credentials } from '$stores/credentials.svelte';
  import CreatePlaylistButton from '$components/shared/CreatePlaylistButton.svelte';

  type LibraryType =
    | 'recent'
    | 'most-played'
    | 'random'
    | 'newest'
    | 'new-releases'
    | 'playlists'
    | 'artists'
    | 'daily-mixes'
    | 'smart-playlists'
    | 'my-playlists';

  type Kind = 'album' | 'playlist' | 'artist';

  const ROUTES: Record<LibraryType, { title: string; kind: Kind }> = {
    'recent':           { title: 'Recientemente añadido',     kind: 'album' },
    'most-played':      { title: 'Más escuchado',             kind: 'album' },
    'random':           { title: 'Aleatorio',                 kind: 'album' },
    'newest':           { title: 'Nuevos lanzamientos',       kind: 'album' },
    'new-releases':     { title: 'Nuevos lanzamientos',       kind: 'album' },
    'playlists':        { title: 'Tus playlists',             kind: 'playlist' },
    'artists':          { title: 'Artistas',                  kind: 'artist' },
    'daily-mixes':      { title: 'Tus mixes diarios',         kind: 'playlist' },
    'smart-playlists':  { title: 'Hecho especialmente para ti', kind: 'playlist' },
    'my-playlists':     { title: 'Mis playlists',             kind: 'playlist' }
  };

  const type = $derived(page.params.type as LibraryType);

  // Validación: si type no existe en nuestro mapa, 404
  $effect(() => {
    if (type && !ROUTES[type]) {
      error(404, `Tipo de librería desconocido: ${type}`);
    }
  });

  const route = $derived(ROUTES[type]);
  const title = $derived(route?.title ?? '');
  const kind = $derived(route?.kind ?? 'album');

  /** Mapea el type al subsonic albumList type. `new-releases` no usa
      `getAlbumList2` directamente — usa `getAlbumsByYear` con el año actual,
      que es lo que la home también consume.

      Ojo: URL `/library/recent` (= "Recientemente añadido") debe pedir
      `newest` a Subsonic — `recent` en el spec significa recently PLAYED,
      no recently ADDED, y eso no es lo que la home consume bajo ese
      título. */
  const albumListType = $derived(
    type === 'recent' ? 'newest'
    : type === 'most-played' ? 'frequent'
    : type === 'newest' ? 'newest'
    : 'random'
  );

  const currentYear = new Date().getFullYear();

  // ============================================================================
  // Albums (recent / most-played / random / newest / new-releases)
  //
  // QueryKey + size alineados con los que usa la home (`+page.svelte`):
  //   - 'newest'    → ['albumList2', 'newest']          size 30
  //   - 'frequent'  → ['albumList2', 'frequent']        size 30
  //   - 'random'    → ['albumList2', 'random']          size 30
  //   - 'byYear'    → ['albumList2', 'byYear', year]    size 30
  //
  // Si pedimos un size distinto o una key distinta, el "Ver todo" carga
  // OTRO set de álbumes — eso era el bug: el contador "+25" de SeeAllCard
  // prometía 25 elementos extra (los que no entraban en el carrusel) y al
  // entrar a /library/random aparecían 100 random DISTINTOS porque se
  // disparaba un fetch fresco con otra queryKey. Reusando la cache, el
  // usuario ve exactamente los mismos N items que el carrusel anunciaba.
  // ============================================================================
  const HOME_SIZE = 30;
  const albumsQ = createQuery(() => ({
    queryKey:
      type === 'new-releases'
        ? ['albumList2', 'byYear', currentYear]
        : ['albumList2', albumListType],
    queryFn: () =>
      type === 'new-releases'
        ? nav.getAlbumsByYear(currentYear, currentYear, HOME_SIZE)
        : nav.getAlbumList2(albumListType, HOME_SIZE),
    enabled: credentials.isConfigured && kind === 'album',
    staleTime: type === 'new-releases' ? 60 * 60 * 1000 : 0
  }));

  // ============================================================================
  // Playlists — múltiples sub-tipos.
  // ============================================================================

  /** "playlists" legacy: lista raw de Navidrome (todas). Mantenemos por
      backward-compat con `seeAllHref` que aún usa /library/playlists desde
      la home. Las nuevas vistas dedicadas (daily-mixes, etc) tienen su
      propio query. */
  const allPlaylistsQ = createQuery(() => ({
    queryKey: ['library-grid', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled:
      credentials.isConfigured && (type === 'playlists' || type === 'my-playlists')
  }));

  const dailyMixesQ = createQuery(() => ({
    queryKey: ['dailyMixes', credentials.current?.username ?? ''],
    queryFn: () => getDailyMixes(credentials.current!.username),
    enabled: credentials.isConfigured && type === 'daily-mixes',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const smartPlaylistsQ = createQuery(() => ({
    queryKey: ['smartPlaylists', credentials.current?.username ?? ''],
    queryFn: () => getSmartPlaylists(credentials.current!.username),
    enabled: credentials.isConfigured && type === 'smart-playlists',
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  /** my-playlists usa el mismo filter que el tab playlists del library. */
  const myPlaylists = $derived(
    type === 'my-playlists'
      ? filterMyPlaylists(allPlaylistsQ.data ?? [], credentials.current?.username)
      : []
  );

  // ============================================================================
  // Artists
  // ============================================================================
  const artistsQ = createQuery(() => ({
    queryKey: ['library-grid', 'artists'],
    queryFn: () => nav.getArtists(),
    enabled: credentials.isConfigured && kind === 'artist'
  }));

  // Para vistas con N potencialmente grande (cientos de items) virtualizamos
  // — bibliotecas serias pueden tener 500+ playlists o artistas. Para los
  // tipos cap-30 (recent, most-played, etc.) un grid normal es suficiente
  // y evita el overhead arquitectural del VirtualGrid.
  const shouldVirtualize = $derived(
    type === 'playlists' || type === 'my-playlists' || kind === 'artist'
  );
</script>

<svelte:head>
  <title>{title} · Audiorr</title>
</svelte:head>

{#snippet createPlaylistAction()}
  <CreatePlaylistButton />
{/snippet}

<SeeAllGrid
  {title}
  {kind}
  wrapper={shouldVirtualize ? 'plain' : 'grid'}
  headerAction={type === 'playlists' || type === 'my-playlists'
    ? createPlaylistAction
    : undefined}
>
  {#if type === 'playlists' && allPlaylistsQ.data}
    <VirtualGrid
      items={allPlaylistsQ.data}
      minItemWidth={180}
      estimateRowHeight={285}
      getKey={(p) => p.id}
    >
      {#snippet item(p)}
        {@const props = playlistToCardProps(p)}
        <PlaylistCard {...props} />
      {/snippet}
    </VirtualGrid>
  {:else if type === 'my-playlists'}
    <VirtualGrid
      items={myPlaylists}
      minItemWidth={180}
      estimateRowHeight={285}
      getKey={(p) => p.id}
    >
      {#snippet item(p)}
        {@const props = playlistToCardProps(p)}
        <PlaylistCard {...props} />
      {/snippet}
    </VirtualGrid>
  {:else if kind === 'artist' && artistsQ.data}
    <VirtualGrid
      items={artistsQ.data}
      minItemWidth={140}
      estimateRowHeight={230}
      gap={24}
      getKey={(a) => a.id}
    >
      {#snippet item(a)}
        {@const props = artistToCardProps(a)}
        <ArtistCard {...props} />
      {/snippet}
    </VirtualGrid>
  {:else if kind === 'album'}
    {#if albumsQ.data}
      {#each albumsQ.data as a (a.id)}
        {@const props = albumToCardProps(a)}
        <AlbumCard
          {...props}
          subtitleMode={type === 'new-releases' ? 'year' : 'artist'}
        />
      {/each}
    {/if}
  {:else if type === 'daily-mixes'}
    {#if dailyMixesQ.data}
      {#each dailyMixesQ.data as mix (mix.navidromeId ?? mix.mixNumber)}
        {@const props = dailyMixToProps(mix)}
        <PlaylistCard {...props} />
      {/each}
    {/if}
  {:else if type === 'smart-playlists'}
    {#if smartPlaylistsQ.data}
      {#each smartPlaylistsQ.data as sp (sp.navidromeId ?? sp.playlistKey)}
        {@const props = smartPlaylistToProps(sp)}
        <PlaylistCard {...props} />
      {/each}
    {/if}
  {/if}
</SeeAllGrid>

