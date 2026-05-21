<script lang="ts">
  /**
   * Vista de género — todos los álbumes etiquetados con un género concreto.
   * Entrada típica: link del meta-line en AlbumDetail ("Pop", "Hip-Hop"...).
   *
   * Header muestra counts agregados (X álbumes · Y canciones) y un selector
   * de orden (Año descendente por defecto / Nombre alfabético). Subsonic
   * `getAlbumList2?type=byGenre` no expone parámetros de orden, así que el
   * sort lo hacemos cliente (datasets <= 100 álbumes — trivial).
   */
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
  import VirtualGrid from '$components/shared/VirtualGrid.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { albumToCardProps } from '$utils/navidrome-mappers';
  import { credentials } from '$stores/credentials.svelte';
  import type { NavidromeAlbum } from '$types/navidrome';

  type SortBy = 'year' | 'name';

  const genre = $derived(decodeURIComponent(page.params.name ?? ''));

  /** Default 'year' descendente — más recientes primero (paridad Apple
      Music: las vistas de género abren con los nuevos arriba). */
  let sortBy = $state<SortBy>('year');

  // Cap 500: géneros populares (Pop, Rock, Hip-Hop) pueden tener cientos
  // de álbumes en bibliotecas serias. Subsonic getAlbumList2 acepta hasta
  // 500 por request. La virtualización (VirtualGrid) mantiene el DOM
  // acotado al viewport, así que 500 items no penalizan RAM.
  const albumsQ = createQuery(() => ({
    queryKey: ['albumsByGenre', genre],
    queryFn: () => nav.getAlbumsByGenre(genre, 500),
    enabled: credentials.isConfigured && genre.length > 0,
    staleTime: 5 * 60 * 1000
  }));

  const albums = $derived<NavidromeAlbum[]>(albumsQ.data ?? []);

  const sortedAlbums = $derived.by<NavidromeAlbum[]>(() => {
    if (sortBy === 'year') {
      // Año desc; sin año al final (Subsonic devuelve undefined cuando el
      // tag no está). `localeCompare` como tie-breaker para estabilidad
      // entre álbumes del mismo año.
      return [...albums].sort((a, b) => {
        const ya = a.year ?? -Infinity;
        const yb = b.year ?? -Infinity;
        if (ya !== yb) return yb - ya;
        return a.name.localeCompare(b.name, 'es');
      });
    }
    return [...albums].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  });

  const albumCount = $derived(albums.length);
  const songCount = $derived(
    albums.reduce((sum, a) => sum + (a.songCount ?? 0), 0)
  );

  const subtitle = $derived.by(() => {
    if (albumCount === 0) return undefined;
    const albumsLabel = `${albumCount} ${albumCount === 1 ? 'álbum' : 'álbumes'}`;
    if (songCount === 0) return albumsLabel;
    const songsLabel = `${songCount} ${songCount === 1 ? 'canción' : 'canciones'}`;
    return `${albumsLabel} · ${songsLabel}`;
  });
</script>

<svelte:head>
  <title>{genre} · Audiorr</title>
</svelte:head>

{#snippet sortAction()}
  <label class="sort">
    <span class="sort-label">Ordenar</span>
    <select bind:value={sortBy} class="sort-select" aria-label="Ordenar álbumes">
      <option value="year">Fecha de lanzamiento</option>
      <option value="name">Nombre</option>
    </select>
  </label>
{/snippet}

<SeeAllGrid
  title={genre}
  {subtitle}
  kind="album"
  wrapper="plain"
  headerAction={albums.length > 0 ? sortAction : undefined}
>
  {#if sortedAlbums.length > 0}
    <VirtualGrid
      items={sortedAlbums}
      minItemWidth={180}
      estimateRowHeight={285}
      getKey={(a) => a.id}
    >
      {#snippet item(a)}
        {@const props = albumToCardProps(a)}
        <AlbumCard {...props} subtitleMode={sortBy === 'year' ? 'year' : 'artist'} />
      {/snippet}
    </VirtualGrid>
  {/if}
</SeeAllGrid>

<style>
  .sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .sort-label {
    font-weight: 500;
  }
  /* Select nativo estilizado — accesible y consistente con otros controles
     pequeños. Conserva el comportamiento nativo del browser (mejor UX en
     mobile que un dropdown custom). */
  .sort-select {
    appearance: none;
    -webkit-appearance: none;
    padding: var(--space-2) var(--space-7) var(--space-2) var(--space-3);
    background-color: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    /* Chevron SVG inline — currentColor desactualizado, usar fill directo del
       text-secondary token convertido en string en runtime no es trivial.
       Aquí un chevron neutro funciona bien sobre los dos temas. */
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
    background-repeat: no-repeat;
    background-position: right var(--space-3) center;
    transition:
      background-color var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default);
  }
  .sort-select:hover {
    background-color: var(--bg-surface-hover);
    border-color: var(--border-strong);
  }
  .sort-select:focus-visible {
    outline: none;
    border-color: var(--border-strong);
    box-shadow: var(--focus-ring);
  }
</style>
