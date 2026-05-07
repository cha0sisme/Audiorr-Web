<script lang="ts">
  import { page } from '$app/state';
  import { error } from '@sveltejs/kit';
  import { createQuery } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
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

  type LibraryType =
    | 'recent'
    | 'most-played'
    | 'random'
    | 'newest'
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

  /** Mapea el type al subsonic albumList type. */
  const albumListType = $derived(
    type === 'recent' ? 'recent'
    : type === 'most-played' ? 'frequent'
    : type === 'newest' ? 'newest'
    : 'random'
  );

  // ============================================================================
  // Albums (recent / most-played / random / newest)
  // ============================================================================
  const albumsQ = createQuery(() => ({
    queryKey: ['library-grid', 'albums', albumListType],
    queryFn: () => nav.getAlbumList2(albumListType, 100),
    enabled: credentials.isConfigured && kind === 'album'
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
</script>

<svelte:head>
  <title>{title} · Audiorr</title>
</svelte:head>

<SeeAllGrid {title} {kind}>
  {#if kind === 'album'}
    {#if albumsQ.data}
      {#each albumsQ.data as a (a.id)}
        {@const props = albumToCardProps(a)}
        <AlbumCard {...props} />
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
  {:else if type === 'my-playlists'}
    {#each myPlaylists as p (p.id)}
      {@const props = playlistToCardProps(p)}
      <PlaylistCard {...props} />
    {/each}
  {:else if type === 'playlists'}
    {#if allPlaylistsQ.data}
      {#each allPlaylistsQ.data as p (p.id)}
        {@const props = playlistToCardProps(p)}
        <PlaylistCard {...props} />
      {/each}
    {/if}
  {:else if kind === 'artist'}
    {#if artistsQ.data}
      {#each artistsQ.data as a (a.id)}
        {@const props = artistToCardProps(a)}
        <ArtistCard {...props} />
      {/each}
    {/if}
  {/if}
</SeeAllGrid>
