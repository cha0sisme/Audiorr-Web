<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { User } from 'phosphor-svelte';
  import EqualizerIcon from './EqualizerIcon.svelte';
  import CoverImage from './CoverImage.svelte';
  import { player } from '$stores/player.svelte';
  import { artistCountsLabel } from '$utils/artist-counts';

  type Props = HTMLAnchorAttributes & {
    /** ID del artista — para detectar si el playback viene de aquí. */
    id: string;
    name: string;
    albumCount?: number | undefined;
    /** Nº de álbumes donde el artista aparece SIN ser album artist
        ("Aparece en"). Con él, el subtítulo desglosa "X álbumes ·
        Y apariciones" — sin él, comportamiento clásico (solo álbumes). */
    appearsCount?: number | undefined;
    coverUrl?: string | undefined;
    href?: string | undefined;
    /** Pre-fetch del hero del avatar on hover/focus. Para artistImageUrl
        (Last.fm) el "hero" es la misma URL → el browser cachea y al
        click es instantáneo. */
    prefetchHero?: () => void;
  };

  let {
    id,
    name,
    albumCount,
    appearsCount,
    coverUrl,
    href = '#',
    prefetchHero,
    ...rest
  }: Props = $props();

  const isCurrent = $derived(player.isPlayingFrom('artist', id));

  let coverEl: HTMLDivElement | undefined = $state();
  function handleClick() {
    if (coverEl) {
      coverEl.style.viewTransitionName = `artist-${id}`;
      // Ver nota en AlbumCard: el layout limpia este nombre tras navegar para
      // que un residuo no duplique el name del detalle y aborte la transición.
      coverEl.dataset.vtActive = '';
    }
  }

  // "X álbumes · Y apariciones" cuando hay datos; los ceros se omiten del
  // label (mostrar "0 álbumes" confunde — un colaborador sin discografía
  // propia muestra solo "Y apariciones"). Sin ningún conteo → genérico
  // "Artista" (típico en resultados de búsqueda).
  const subtitle = $derived(
    artistCountsLabel(albumCount ?? 0, appearsCount ?? 0) ?? 'Artista'
  );
</script>

<a
  class="card"
  {href}
  onclick={handleClick}
  onmouseenter={prefetchHero}
  onfocus={prefetchHero}
  {...rest}
>
  <div bind:this={coverEl} class="cover">
    <CoverImage src={coverUrl} alt="" shape="circle" priority="low" width={300} height={300}>
      {#snippet fallback()}
        <User size="100%" weight="regular" />
      {/snippet}
    </CoverImage>

    {#if isCurrent}
      <div class="playing-overlay" aria-hidden="true">
        <EqualizerIcon color="#fff" height={18} />
      </div>
    {/if}
  </div>

  <p class="name">{name}</p>
  <p class="subtitle">{subtitle}</p>
</a>

<style>
  .card {
    display: block;
    text-align: center;
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    outline: none;
  }
  .card:focus-visible .cover {
    box-shadow: var(--shadow-sm), var(--focus-ring);
  }

  .cover {
    /* aspect-ratio + border-radius full → círculo perfecto que reserva
       el espacio antes de cargar. CoverImage hereda el shape circle. */
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-bottom: var(--space-3);
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .card:hover .cover {
    box-shadow: var(--shadow-md);
  }

  /* Equalizer overlay redondo (matches el border-radius full del cover). */
  .playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    letter-spacing: var(--tracking-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
