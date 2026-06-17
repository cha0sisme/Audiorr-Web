<script lang="ts">
  /**
   * /artist/[id]/appears-in — SeeAllGrid de álbumes donde el artista
   * colabora. Comparte queryKey ['artistCollaborations', artistId] con el
   * detail → si llegas desde el carrusel "Aparece en" la query ya está en
   * cache y la página renderiza instantáneo.
   */
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { albumToCardProps } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';

  const artistId = $derived(page.params.id ?? '');

  const artistQ = createQuery(() => ({
    queryKey: ['artist', artistId],
    queryFn: () => nav.getArtist(artistId),
    enabled: credentials.isConfigured && !!artistId
  }));

  const artist = $derived(artistQ.data);
  const primaryAlbums = $derived(artist?.album ?? []);

  const collabsQ = createQuery(() => ({
    queryKey: ['artistCollaborations', artistId],
    queryFn: () =>
      nav.getArtistCollaborations(
        artistId,
        artist!.name,
        new Set(primaryAlbums.map((a) => a.id))
      ),
    enabled: credentials.isConfigured && !!artist,
    retry: false,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000
  }));

  const items = $derived(collabsQ.data ?? []);
  const title = $derived(artist ? `Aparece en` : 'Aparece en');
</script>

<PageTitle segments={[artist?.name ?? 'Artista', 'Aparece en']} />

{#if collabsQ.isPending || artistQ.isPending}
  <div class="page-loading">
    <div class="header-sk"></div>
    <div class="grid-sk">
      {#each Array(8) as _}<div class="card-sk"></div>{/each}
    </div>
  </div>
{:else if items.length === 0}
  <div class="empty">
    <h1>{title}</h1>
    <p>{artist?.name ?? 'Este artista'} no aparece como colaborador en ningún álbum.</p>
  </div>
{:else}
  <SeeAllGrid {title} kind="album">
    {#each items as album (album.id)}
      {@const props = albumToCardProps(album)}
      <AlbumCard {...props} />
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
    width: 220px;
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
