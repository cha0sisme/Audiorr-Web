<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { MusicNote, Play } from 'phosphor-svelte';
  import NowPlayingIndicator from '$components/shared/NowPlayingIndicator.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import { player, type PlaybackContext } from '$stores/player.svelte';

  type Props = HTMLAnchorAttributes & {
    /** ID del item — para detectar si el playback viene de aquí. */
    id: string;
    /** Tipo de contexto que representa esta card (album/playlist/etc). */
    contextType?: NonNullable<PlaybackContext>['type'];
    title: string;
    coverUrl?: string | undefined;
    href?: string | undefined;
  };

  let {
    id,
    contextType = 'album',
    title,
    coverUrl,
    href = '#',
    ...rest
  }: Props = $props();

  const isCurrent = $derived(player.isPlayingFrom(contextType, id));

  let coverEl: HTMLDivElement | undefined = $state();
  function handleClick() {
    // Solo álbumes participan del View Transition con el hero del AlbumDetail
    if (coverEl && contextType === 'album') {
      coverEl.style.viewTransitionName = `album-${id}`;
    }
  }
</script>

<a class="card" {href} onclick={handleClick} {...rest}>
  <div bind:this={coverEl} class="cover">
    <CoverImage src={coverUrl} alt="">
      {#snippet fallback()}
        <MusicNote size="100%" weight="regular" />
      {/snippet}
    </CoverImage>

    {#if isCurrent}
      <div class="playing-overlay" aria-hidden="true">
        <NowPlayingIndicator
          isPlaying={player.isPlaying}
          color="#fff"
          height={18}
          barWidth={2.5}
        />
      </div>
    {/if}
  </div>

  <span class="title">{title}</span>

  {#if !isCurrent}
    <span class="play-btn" aria-hidden="true">
      <Play size={16} weight="fill" />
    </span>
  {/if}
</a>

<style>
  .card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding-right: var(--space-3);

    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: inherit;
    overflow: hidden;
    isolation: isolate;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .card:hover {
    background: var(--bg-surface-hover);
  }

  .cover {
    position: relative;
    width: 56px;
    height: 56px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .play-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--play-bg);
    color: var(--play-fg);
    display: grid;
    place-items: center;
    box-shadow: var(--play-shadow);
    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .card:hover .play-btn:hover {
    background: var(--play-bg-hover);
  }
  .card:hover .play-btn,
  .card:focus-within .play-btn {
    opacity: 1;
    transform: translateY(0);
  }
</style>
