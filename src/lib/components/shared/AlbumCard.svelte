<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { Play, MusicNote } from 'phosphor-svelte';
  import EqualizerIcon from './EqualizerIcon.svelte';
  import ExplicitBadge from './ExplicitBadge.svelte';
  import NewArrivalBadge from './NewArrivalBadge.svelte';
  import CoverImage from './CoverImage.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import * as nav from '$services/NavidromeService';
  import { prefetchRelatedAlbums } from '$services/RelatedAlbumsService';
  import { onDestroy } from 'svelte';

  type Props = HTMLAnchorAttributes & {
    /** ID del álbum — necesario para detectar si el playback viene de aquí
        y mostrar el indicador de equalizer sobre el cover. */
    id: string;
    title: string;
    artist: string;
    coverUrl?: string | undefined;
    href?: string | undefined;
    explicit?: boolean | undefined;
    /** Año del álbum — visible cuando subtitleMode === 'year'. */
    year?: number | undefined;
    /** Subtítulo a mostrar bajo el title. 'artist' (default) → nombre del
        artista. 'year' → año (modo Discografía en ArtistDetail, donde el
        artist es redundante). */
    subtitleMode?: 'artist' | 'year';
    /** Timestamp ISO de cuándo se añadió a la biblioteca. Si está dentro
        de 48h, pinta NewArrivalBadge (HOY / AYER) en la esquina sup-izq
        del cover. */
    createdAt?: string | undefined;
    /** Pre-fetch del hero del cover (size mayor) on hover/focus. El detalle
        renderiza el mismo coverArt a tamaño hero (600 vs 300 de la card)
        — con prefetch, al click el cache HTTP del browser ya tiene la
        imagen y la View Transition card→detail no parpadea. */
    prefetchHero?: () => void;
  };

  let {
    id,
    title,
    artist,
    coverUrl,
    href = '#',
    explicit = false,
    year,
    subtitleMode = 'artist',
    createdAt,
    prefetchHero,
    ...rest
  }: Props = $props();

  const subtitle = $derived(
    subtitleMode === 'year'
      ? year !== undefined
        ? String(year)
        : ''
      : artist
  );

  const isCurrent = $derived(player.isPlayingFrom('album', id));

  let coverEl: HTMLDivElement | undefined = $state();

  /** Hover-intent para el prefetch de álbumes relacionados. A diferencia del
      prefetchHero del cover (barato, dispara inmediato), este calienta la query
      `['relatedAlbums', id]` cuyo cache miss en backend toca Last.fm — caro. Por
      eso solo dispara si el cursor se queda ~200 ms sobre la card (intención real
      de entrar), no en barridos rápidos por una grid. */
  const RELATED_HOVER_INTENT_MS = 200;
  let relatedTimer: ReturnType<typeof setTimeout> | undefined;

  function onPointerEnter() {
    prefetchHero?.();
    clearTimeout(relatedTimer);
    relatedTimer = setTimeout(() => prefetchRelatedAlbums(id), RELATED_HOVER_INTENT_MS);
  }
  function onPointerLeave() {
    clearTimeout(relatedTimer);
  }
  onDestroy(() => clearTimeout(relatedTimer));

  /** Setea view-transition-name SOLO en el cover de ESTA card al click.
      Crítico porque el mismo álbum puede aparecer en varias rows del Home —
      sin esto, múltiples elementos compartirían el mismo name y el browser
      cancelaría la transición. */
  function handleClick() {
    if (coverEl) {
      coverEl.style.viewTransitionName = `album-${id}`;
      // Marca para que el layout limpie el nombre tras navegar. Sin limpieza,
      // un nombre residual en una card que sobrevive (sección persistente,
      // vuelta atrás) puede duplicar el `view-transition-name` del detalle y
      // el browser aborta TODA la transición → el zoom "a veces no aparece".
      coverEl.dataset.vtActive = '';
    }
  }

  /** Click en el botón Play del cover. Detiene la propagación al <a> para
      no navegar al detalle: el botón es para reproducir in-place. Fetch
      lazy del álbum (mismo cache de TanStack Query lo va a hidratar al
      navegar). */
  let loadingPlay = $state(false);
  async function handlePlayClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loadingPlay) return;
    loadingPlay = true;
    try {
      const album = await nav.getAlbum(id);
      const songs = album.song ?? [];
      if (songs.length === 0) return;
      player.context = { type: 'album', id };
      queueManager.play(songs, 0, { contextUri: `album:${id}` });
    } catch {
      // Silencioso — un fallo en la card no debería notificar al usuario.
    } finally {
      loadingPlay = false;
    }
  }
</script>

<a
  class="card"
  {href}
  onclick={handleClick}
  onmouseenter={onPointerEnter}
  onmouseleave={onPointerLeave}
  onfocus={onPointerEnter}
  onblur={onPointerLeave}
  {...rest}
>
  <div class="cover-wrap">
    <div bind:this={coverEl} class="cover">
      <CoverImage
        src={coverUrl}
        alt=""
        priority="low"
        width={300}
        height={300}
      >
        {#snippet fallback()}
          <MusicNote size="100%" weight="regular" />
        {/snippet}
      </CoverImage>

      {#if isCurrent}
        <div class="playing-overlay" aria-hidden="true">
          <EqualizerIcon
            color="#fff"
            height={20}
            barWidth={3}
          />
        </div>
      {/if}
    </div>

    {#if !isCurrent}
      <button
        type="button"
        class="play"
        aria-label={`Reproducir ${title}`}
        onclick={handlePlayClick}
      >
        <Play size={14} weight="fill" />
      </button>
    {/if}
  </div>

  <p class="title">
    <span class="title-name">{title}</span>
    {#if explicit}
      <ExplicitBadge />
    {/if}
    <NewArrivalBadge {createdAt} />
  </p>
  {#if subtitle}
    <p class="artist">{subtitle}</p>
  {/if}
</a>

<style>
  .card {
    display: block;
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    outline: none;
  }
  .card:focus-visible .cover {
    box-shadow: var(--shadow-sm), var(--focus-ring);
  }

  .cover-wrap {
    position: relative;
    margin-bottom: var(--space-3);
  }

  .cover {
    /* aspect-ratio reserva el espacio antes de cargar la imagen → cero
       layout shift. CoverImage rellena el slot. */
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .card:hover .cover {
    box-shadow: var(--shadow-md);
  }

  /* Equalizer overlay cuando es el contexto actual de playback. Scrim
     oscuro + bars blancas centradas. Reemplaza al play overlay (no aparecen
     ambos a la vez). */
  .playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  /* Play overlay: chico, sutil, solo en hover.
     Apple Music usa un círculo blanco con icono oscuro. */
  .play {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--overlay-on-art-bg);
    color: var(--overlay-on-art-fg);
    cursor: pointer;
    box-shadow: var(--overlay-on-art-shadow);

    display: grid;
    place-items: center;

    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .play :global(svg) {
    margin-left: 1px; /* compensa óptico del triángulo */
  }
  .play:hover {
    background: var(--overlay-on-art-bg-hover);
    transform: translateY(0) scale(1.06);
  }
  .play:active {
    transform: translateY(0) scale(0.94);
    transition-duration: var(--duration-instant);
  }
  .card:hover .play,
  .card:focus-within .play {
    opacity: 1;
    transform: translateY(0);
  }

  /* Tipografía tight, weight regular (Apple no usa semibold acá). */
  .title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    letter-spacing: var(--tracking-body);
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }
  .title-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .artist {
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
