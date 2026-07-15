<script lang="ts">
  /**
   * CrateDiggerRow — una fila de sugerencia dentro de la sección "Crate
   * Digger" (ver CrateDiggerSection.svelte). Visualmente hermana de SongRow
   * (mismos tokens de grid/tipografía/espaciado) pero deliberadamente MÁS
   * simple: sin fav-btn a la izquierda ni menú contextual — la acción
   * principal es el botón trailing (`+` o `★` según variante), que es el
   * punto entero de la sección (paridad Spotify "Recommended songs").
   *
   * Tap en la fila = reproducir (convención universal, sin comportamiento
   * nuevo). Tap en el botón trailing = añadir; `stopPropagation` para que no
   * dispare también el play.
   */
  import { Plus, Check, Star, ArrowsClockwise, MusicNote } from 'phosphor-svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import EqualizerIcon from '$components/shared/EqualizerIcon.svelte';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { formatTime } from '$utils/format';
  import type { CrateDiggerItem } from '$types/backend';

  type Props = {
    item: CrateDiggerItem;
    /** 'favorites' = botón estrella + acción star; 'playlist' = botón `+` + updatePlaylist. */
    mode: 'playlist' | 'favorites';
    isCurrent: boolean;
    /** true mientras la mutación (star / updatePlaylist) está en vuelo. */
    pending: boolean;
    /** true tras confirmar el add — el icono hace morph antes de que la fila salga. */
    justAdded: boolean;
    onPlay: () => void;
    onAdd: () => void;
  };

  let { item, mode, isCurrent, pending, justAdded, onPlay, onAdd }: Props = $props();

  // El contrato confirma explícitamente que `albumId` es la fuente para
  // resolver la portada ("el cliente resuelve la portada con esto") — no hay
  // un `coverArt` de canción propio en el item.
  const coverUrl = $derived(getCoverArtUrl(item.albumId, 120));

  const addLabel = $derived(
    mode === 'favorites' ? 'Añadir a favoritos' : `Añadir ${item.title} a la lista`
  );

  function handleAddClick(e: MouseEvent) {
    e.stopPropagation();
    if (pending || justAdded) return;
    onAdd();
  }

  function handleRowKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay();
    }
  }
</script>

<div
  class="cd-row"
  class:current={isCurrent}
  role="button"
  tabindex="0"
  onclick={onPlay}
  onkeydown={handleRowKeydown}
>
  <span class="cd-cover" aria-hidden="true">
    <CoverImage src={coverUrl} alt="" priority="low" width={120} height={120}>
      {#snippet fallback()}
        <MusicNote size="100%" weight="regular" />
      {/snippet}
    </CoverImage>
    {#if isCurrent}
      <span class="cd-cover-overlay">
        <EqualizerIcon color="#fff" height={14} />
      </span>
    {/if}
  </span>

  <span class="cd-title-block">
    <span class="cd-title">{item.title}</span>
    <span class="cd-artist">{item.artist}</span>
  </span>

  <span class="cd-duration">{formatTime(item.durationSec)}</span>

  <button
    type="button"
    class="cd-add-btn"
    class:is-fav-variant={mode === 'favorites'}
    class:just-added={justAdded}
    onclick={handleAddClick}
    disabled={pending || justAdded}
    aria-label={addLabel}
  >
    {#if pending}
      <span class="cd-spinner"><ArrowsClockwise size={16} weight="bold" /></span>
    {:else if mode === 'favorites'}
      <Star size={17} weight={justAdded ? 'fill' : 'regular'} />
    {:else if justAdded}
      <Check size={17} weight="bold" />
    {:else}
      <Plus size={17} weight="bold" />
    {/if}
  </button>
</div>

<style>
  .cd-row {
    width: 100%;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto 40px;
    align-items: center;
    column-gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .cd-row:hover,
  .cd-row:focus-visible {
    background: var(--row-hover);
  }
  .cd-row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .cd-row.current .cd-title {
    color: var(--text-accent);
  }

  .cd-cover {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: var(--shadow-xs);
  }
  .cd-cover-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
  }

  .cd-title-block {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .cd-title {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .cd-artist {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cd-duration {
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }

  .cd-add-btn {
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    color: var(--text-primary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .cd-add-btn:hover:not(:disabled) {
    background: var(--play-bg);
    border-color: var(--play-bg);
    color: var(--play-fg);
  }
  .cd-add-btn:active:not(:disabled) {
    transform: scale(0.92);
  }
  .cd-add-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .cd-add-btn:disabled {
    cursor: default;
  }
  .cd-add-btn.just-added {
    background: var(--status-success);
    border-color: var(--status-success);
    color: #fff;
  }
  .cd-add-btn.is-fav-variant.just-added {
    background: transparent;
    border-color: var(--accent);
    color: var(--accent);
  }

  .cd-spinner {
    display: grid;
    place-items: center;
    animation: cd-spin 1s linear infinite;
  }
  @keyframes cd-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
