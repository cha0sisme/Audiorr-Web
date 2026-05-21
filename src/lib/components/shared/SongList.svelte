<script lang="ts">
  import SongRow from './SongRow.svelte';
  import { player, type PlaybackContext } from '$stores/player.svelte';
  import type { SongListItem } from '$utils/navidrome-mappers';

  type Props = {
    tracks: SongListItem[];
    /** Tipo de contexto al que pertenece esta lista (album/playlist/etc). */
    contextType: NonNullable<PlaybackContext>['type'];
    /** ID del contexto. Usado para isPlayingFrom() en cada row. */
    contextId: string;
    /** Mostrar thumbnail por row (modo "Popular" en ArtistDetail). El track
        debe traer `coverUrl` poblado. Cuando true escondemos el header de
        columnas (no calza visualmente con thumbs grandes). */
    showCover?: boolean;
    /** Llamado al click en una row. El parent decide qué hacer (load song,
        set context, etc). Recibe el track y su índice 0-based. */
    onPlay: (track: SongListItem, index: number) => void;
  };

  // `contextId` se conserva en el Props type por simetría con `contextType`
  // (algún caller futuro podría querer restringir el highlight al contexto),
  // pero hoy no lo desestructuramos: iOS / Apple Music highlightean la
  // canción actual en CUALQUIER lista donde aparezca, no solo donde se
  // inició el playback.
  let { tracks, contextType, showCover = false, onPlay }: Props = $props();

  function isCurrent(trackId: string): boolean {
    return player.currentSong?.id === trackId;
  }
</script>

<div class="song-list">
  {#if !showCover}
    <header class="list-header">
      <span class="head-num">#</span>
      <span class="head-title">Título</span>
      <span class="head-duration">Duración</span>
    </header>
  {/if}

  <div class="rows">
    {#each tracks as track, i (track.id)}
      <SongRow
        {track}
        index={i + 1}
        isCurrent={isCurrent(track.id)}
        artist={track.artist}
        coverUrl={showCover ? track.coverUrl : undefined}
        {contextType}
        onPlay={() => onPlay(track, i)}
      />
    {/each}
  </div>
</div>

<style>
  .song-list {
    display: grid;
    gap: var(--space-2);
  }

  .list-header {
    display: grid;
    /* Última columna 36px = ancho del dots-btn + gap. Mantiene el header
       alineado con las rows que ahora tienen 4 columnas. */
    grid-template-columns: 32px minmax(0, 1fr) auto 36px;
    align-items: center;
    column-gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--separator-subtle);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .head-num {
    text-align: center;
  }
  .head-duration {
    font-variant-numeric: tabular-nums;
  }

  .rows {
    display: grid;
    gap: 1px;
  }
</style>
