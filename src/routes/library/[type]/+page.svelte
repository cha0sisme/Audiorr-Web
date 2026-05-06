<script lang="ts">
  import { page } from '$app/state';
  import { error } from '@sveltejs/kit';
  import { createQuery } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import * as nav from '$services/NavidromeService';
  import {
    albumToCardProps,
    playlistToCardProps,
    artistToCardProps
  } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';

  type LibraryType = 'recent' | 'most-played' | 'random' | 'newest' | 'playlists' | 'artists';

  const ROUTES: Record<LibraryType, { title: string; kind: 'album' | 'playlist' | 'artist' }> = {
    'recent':       { title: 'Recientemente añadido', kind: 'album' },
    'most-played':  { title: 'Más escuchado',         kind: 'album' },
    'random':       { title: 'Aleatorio',             kind: 'album' },
    'newest':       { title: 'Nuevos lanzamientos',   kind: 'album' },
    'playlists':    { title: 'Tus playlists',         kind: 'playlist' },
    'artists':      { title: 'Artistas',              kind: 'artist' }
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

  const albumsQ = createQuery(() => ({
    queryKey: ['library-grid', 'albums', albumListType],
    queryFn: () => nav.getAlbumList2(albumListType, 100),
    enabled: credentials.isConfigured && kind === 'album'
  }));

  const playlistsQ = createQuery(() => ({
    queryKey: ['library-grid', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured && kind === 'playlist'
  }));

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
  {:else if kind === 'playlist'}
    {#if playlistsQ.data}
      {#each playlistsQ.data as p (p.id)}
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
