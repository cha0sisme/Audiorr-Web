<script lang="ts">
  /**
   * /artist/[id]/playlists — SeeAllGrid de "Playlists con {artist}".
   *
   * Reusa exactamente la misma queryKey ['artistPlaylists', name] que el
   * detail del artista, así que si el usuario llega aquí desde el carrusel
   * la query ya está en cache y se renderiza instantáneo.
   */
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { playlistToCardProps } from '$utils/navidrome-mappers';
  import { findPlaylistsByArtist } from '$utils/playlists-by-artist';
  import { credentials } from '$stores/credentials.svelte';

  const artistId = $derived(page.params.id ?? '');
  const queryClient = useQueryClient();

  const artistQ = createQuery(() => ({
    queryKey: ['artist', artistId],
    queryFn: () => nav.getArtist(artistId),
    enabled: credentials.isConfigured && !!artistId
  }));

  const artist = $derived(artistQ.data);

  const artistPlaylistsQ = createQuery(() => ({
    queryKey: ['artistPlaylists', artist?.name ?? ''],
    queryFn: async () => {
      const all = await queryClient.fetchQuery({
        queryKey: ['library', 'playlists'],
        queryFn: () => nav.getPlaylists(),
        staleTime: 5 * 60 * 1000
      });
      return findPlaylistsByArtist(artist!.name, all, (id) => nav.getPlaylist(id));
    },
    enabled: credentials.isConfigured && !!artist?.name,
    retry: false,
    staleTime: 15 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const items = $derived(artistPlaylistsQ.data ?? []);
  const title = $derived(artist ? `Playlists con ${artist.name}` : 'Playlists');
</script>

<PageTitle segments={[artist?.name ?? 'Artista', 'Listas']} />

{#if artistPlaylistsQ.isPending || artistQ.isPending}
  <div class="page-loading">
    <div class="header-sk"></div>
    <div class="grid-sk">
      {#each Array(8) as _}<div class="card-sk"></div>{/each}
    </div>
  </div>
{:else if items.length === 0}
  <div class="empty">
    <h1>{title}</h1>
    <p>No hay playlists con {artist?.name ?? 'este artista'} todavía.</p>
  </div>
{:else}
  <SeeAllGrid {title} kind="playlist">
    {#each items as p (p.id)}
      {@const props = playlistToCardProps(p)}
      <PlaylistCard {...props} />
    {/each}
  </SeeAllGrid>
{/if}

<style>
  .page-loading {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }
  .header-sk {
    height: 36px;
    width: 280px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .grid-sk {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
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

  .empty {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-3);
  }
  .empty h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
  }
  .empty p {
    margin: 0;
    color: var(--text-secondary);
  }

  @media (max-width: 640px) {
    .page-loading,
    .empty {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .grid-sk {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    }
  }
</style>
