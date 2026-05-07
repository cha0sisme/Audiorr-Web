<script lang="ts">
  /**
   * RecentContextCard — single tile del carrusel "Volver a escuchar"
   * (Jump Back In) en la home.
   *
   * Renderiza un álbum, playlist, smart mix o artista del feed
   * `/api/stats/recent-contexts` del backend.
   *
   * Layout:
   *   - Tile cuadrado (artist redondo) con cover.
   *   - Hover overlay con icono Play centrado (Apple Music style).
   *   - Título + subtítulo abajo (subtítulo solo en album/playlist).
   *
   * Routing:
   *   - album    → /album/<id>
   *   - playlist → /playlist/<id>
   *   - smartmix → /playlist/<id>  (smart mixes son playlists del backend
   *                                  registradas en Navidrome)
   *   - artist   → /search?q=<name>  (workaround: el backend guarda el nombre
   *                                    en `id` para tipo artist; las rutas
   *                                    de Audiorr Web esperan id Subsonic)
   *   - other    → href '#' sin navegación
   */
  import { Play, MusicNote, Queue, User } from 'phosphor-svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import type { RecentContextItem } from '$types/backend';

  type Props = {
    item: RecentContextItem;
  };

  let { item }: Props = $props();

  const isArtist = $derived(item.type === 'artist');
  const isAlbum = $derived(item.type === 'album');

  const href = $derived.by(() => {
    if (isAlbum) return `/album/${item.id}`;
    if (isArtist) return `/search?q=${encodeURIComponent(item.id)}`;
    if (item.type === 'other') return '#';
    return `/playlist/${item.id}`;
  });

  /** Cover URL — prefiere coverArtId Subsonic. Para artist queda undefined
      (mostramos fallback redondo con icono User). */
  const coverUrl = $derived(
    !isArtist && item.coverArtId ? getCoverArtUrl(item.coverArtId, 300) : undefined
  );

  /** Subtítulo: artist para álbumes, "Playlist"/"Mix" para playlists, vacío
      para artistas (el nombre ya es el título). */
  const subtitle = $derived.by(() => {
    if (isAlbum) return item.artist;
    if (item.type === 'playlist') return 'Playlist';
    if (item.type === 'smartmix') return 'Mix';
    return '';
  });
</script>

<a class="card" {href} class:artist={isArtist}>
  <div class="cover-wrap" class:circle={isArtist}>
    <CoverImage src={coverUrl} alt="" shape={isArtist ? 'circle' : 'square'}>
      {#snippet fallback()}
        {#if isArtist}
          <User size="100%" weight="regular" />
        {:else if item.type === 'playlist' || item.type === 'smartmix'}
          <Queue size="100%" weight="regular" />
        {:else}
          <MusicNote size="100%" weight="regular" />
        {/if}
      {/snippet}
    </CoverImage>

    <div class="overlay" aria-hidden="true">
      <span class="play-pill">
        <Play size={18} weight="fill" />
      </span>
    </div>
  </div>

  <p class="title">{item.title}</p>
  {#if subtitle}
    <p class="subtitle">{subtitle}</p>
  {/if}
</a>

<style>
  .card {
    display: block;
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    outline: none;
    min-width: 0;
  }
  .card:focus-visible .cover-wrap {
    box-shadow: var(--shadow-sm), var(--focus-ring);
  }

  .cover-wrap {
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    margin-bottom: var(--space-3);
    transition: box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .cover-wrap.circle {
    border-radius: var(--radius-full);
  }
  .card:hover .cover-wrap {
    box-shadow: var(--shadow-md);
  }

  /* Overlay scrim + play pill — visible solo en hover/focus de la card. */
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0);
    transition: background var(--duration-fast) var(--ease-ios-default);
    pointer-events: none;
    border-radius: inherit;
  }
  .card:hover .overlay,
  .card:focus-visible .overlay {
    background: var(--scrim-on-art);
  }

  .play-pill {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    background: var(--overlay-on-art-bg);
    color: var(--overlay-on-art-fg);
    display: grid;
    place-items: center;
    box-shadow: var(--overlay-on-art-shadow);
    opacity: 0;
    transform: translateY(4px) scale(0.92);
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .play-pill :global(svg) {
    margin-left: 1px; /* compensa óptico del triángulo */
  }
  .card:hover .play-pill,
  .card:focus-visible .play-pill {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    letter-spacing: var(--tracking-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card.artist .title {
    text-align: center;
  }

  .subtitle {
    margin-top: 2px;
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
