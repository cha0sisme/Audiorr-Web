<script lang="ts">
  /**
   * RecentReleaseCard — card horizontal destacada estilo Apple Music
   * "Latest Release". Port de RecentReleaseCard (ArtistDetailView.swift):
   * fecha de lanzamiento como eyebrow en mayúsculas, artwork 96px a la
   * izquierda y título + subtítulo. El subtítulo desambigua: si el
   * lanzamiento es una colaboración ("Aparece en"), muestra el artista
   * titular del álbum; si es propio, "Año · Tipo" (mismo orden que las
   * AlbumCard de Discografía — iOS usa "Tipo · Año").
   */
  import { MusicNote } from 'phosphor-svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { albumReleaseKind, RELEASE_KIND_LABEL } from '$utils/release-kind';
  import type { NavidromeAlbum } from '$types/navidrome';

  type Props = {
    album: NavidromeAlbum;
    /** Fecha REAL de lanzamiento (y+m+d de los tags), ya validada por el
        gate de ventana del call site. */
    date: Date;
    /** Nombre del artista de la página — desambigua colaboraciones. */
    artistName: string;
  };

  let { album, date, artistName }: Props = $props();

  const dateLabel = $derived(
    new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
      .format(date)
      .toUpperCase()
  );

  const subtitle = $derived.by(() => {
    // Colaboración ("Aparece en"): el titular del álbum desambigua — sin
    // él, el usuario cree que el disco es del artista de la página.
    if (album.artist && album.artist !== artistName) {
      return `${album.artist} · Álbum`;
    }
    const kind = RELEASE_KIND_LABEL[albumReleaseKind(album)];
    return album.year !== undefined ? `${album.year} · ${kind}` : kind;
  });

  const isExplicit = $derived(album.explicitStatus === 'explicit');
</script>

<a class="card" href={`/album/${album.id}`}>
  <div class="artwork">
    <CoverImage
      src={album.coverArt ? getCoverArtUrl(album.coverArt, 200) : undefined}
      alt=""
      priority="high"
      lazy={false}
      width={96}
      height={96}
    >
      {#snippet fallback()}
        <MusicNote size="100%" weight="regular" />
      {/snippet}
    </CoverImage>
  </div>

  <div class="meta">
    <p class="eyebrow">{dateLabel}</p>
    <p class="title">
      <span class="title-name">{album.name}</span>
      {#if isExplicit}
        <ExplicitBadge />
      {/if}
    </p>
    <p class="subtitle">{subtitle}</p>
  </div>
</a>

<style>
  .card {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    max-width: 560px;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .card:hover {
    background: var(--bg-surface-hover);
    box-shadow: var(--shadow-sm);
  }
  .card:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .artwork {
    width: 96px;
    height: 96px;
    flex-shrink: 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .meta {
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .eyebrow {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    color: var(--text-secondary);
  }
  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.25;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .title-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
