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
  import { createPlaylistUI } from '$stores/playlist-mutations-ui.svelte';
  import { Plus } from 'phosphor-svelte';

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
      que es lo que la home también consume. */
  const albumListType = $derived(
    type === 'recent' ? 'recent'
    : type === 'most-played' ? 'frequent'
    : type === 'newest' ? 'newest'
    : 'random'
  );

  const currentYear = new Date().getFullYear();

  // ============================================================================
  // Albums (recent / most-played / random / newest / new-releases)
  // ============================================================================
  const albumsQ = createQuery(() => ({
    queryKey:
      type === 'new-releases'
        ? ['library-grid', 'albums', 'byYear', currentYear]
        : ['library-grid', 'albums', albumListType],
    queryFn: () =>
      type === 'new-releases'
        ? nav.getAlbumsByYear(currentYear, currentYear, 100)
        : nav.getAlbumList2(albumListType, 100),
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
</script>

<svelte:head>
  <title>{title} · Audiorr</title>
</svelte:head>

{#snippet createPlaylistAction()}
  <button
    type="button"
    class="lib-create-btn"
    onclick={() => createPlaylistUI.open()}
    aria-label="Crear nueva playlist"
  >
    <Plus size={14} weight="bold" />
    <span>Crear playlist</span>
  </button>
{/snippet}

<SeeAllGrid
  {title}
  {kind}
  headerAction={type === 'playlists' || type === 'my-playlists'
    ? createPlaylistAction
    : undefined}
>
  {#if kind === 'album'}
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

<style>
  /* Botón "Crear playlist" — pill alineado a la derecha del título de
     SeeAllGrid. Estilo cuasi-CTA: bg accent suave + border-radius full,
     mismo lenguaje que los chips del Diagnostics y el botón "Crear" del
     dialog. Compacto para no robar protagonismo al título. */
  .lib-create-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .lib-create-btn:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .lib-create-btn:active {
    transform: scale(0.97);
    transition-duration: var(--duration-instant);
  }
  .lib-create-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
