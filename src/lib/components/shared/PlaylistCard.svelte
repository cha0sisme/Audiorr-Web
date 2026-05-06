<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { Play, Queue } from 'phosphor-svelte';
  import NowPlayingIndicator from './NowPlayingIndicator.svelte';
  import CoverImage from './CoverImage.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import * as nav from '$services/NavidromeService';

  type Props = HTMLAnchorAttributes & {
    /** ID de la playlist — para detectar si el playback viene de aquí. */
    id: string;
    name: string;
    songCount?: number | undefined;
    owner?: string | undefined;
    coverUrl?: string | undefined;
    href?: string | undefined;
  };

  let { id, name, songCount, owner, coverUrl, href = '#', ...rest }: Props = $props();

  const isCurrent = $derived(player.isPlayingFrom('playlist', id));

  let coverEl: HTMLDivElement | undefined = $state();
  function handleClick() {
    if (coverEl) coverEl.style.viewTransitionName = `playlist-${id}`;
  }

  /** Click del Play del cover. stopPropagation para no navegar al detalle. */
  let loadingPlay = $state(false);
  async function handlePlayClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loadingPlay) return;
    loadingPlay = true;
    try {
      const playlist = await nav.getPlaylist(id);
      const songs = playlist.entry ?? [];
      if (songs.length === 0) return;
      player.context = { type: 'playlist', id };
      queueManager.play(songs, 0);
    } catch {
      // Silencioso — fallar no debería notificar al usuario.
    } finally {
      loadingPlay = false;
    }
  }

  const subtitle = $derived(
    [songCount && `${songCount} canciones`, owner && `por ${owner}`]
      .filter(Boolean)
      .join(' · ')
  );
</script>

<a class="card" {href} onclick={handleClick} {...rest}>
  <div class="cover-wrap">
    <div bind:this={coverEl} class="cover">
      <CoverImage src={coverUrl} alt="">
        {#snippet fallback()}
          <Queue size="100%" weight="regular" />
        {/snippet}
      </CoverImage>

      {#if isCurrent}
        <div class="playing-overlay" aria-hidden="true">
          <NowPlayingIndicator
            isPlaying={player.isPlaying}
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
        aria-label={`Reproducir ${name}`}
        onclick={handlePlayClick}
      >
        <Play size={14} weight="fill" />
      </button>
    {/if}
  </div>

  <p class="title">{name}</p>
  <p class="subtitle">{subtitle}</p>
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

  .playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
    pointer-events: none;
  }

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
    margin-left: 1px;
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
