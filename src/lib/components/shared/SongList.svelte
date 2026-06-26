<script lang="ts">
  import SongRow from './SongRow.svelte';
  import { Disc } from 'phosphor-svelte';
  import { player, type PlaybackContext } from '$stores/player.svelte';
  import type { SongListItem } from '$utils/navidrome-mappers';
  import type { NavidromeDiscTitle } from '$types/navidrome';

  type Props = {
    tracks: SongListItem[];
    /** Tipo de contexto al que pertenece esta lista (album/playlist/etc). */
    contextType: NonNullable<PlaybackContext>['type'];
    /** ID del contexto. Usado para isPlayingFrom() en cada row. */
    contextId: string;
    /** Subtítulos de disco del álbum (OpenSubsonic `album.discTitles`). Cuando
        existen, el separador de disco muestra "Disco N · {título}" en vez del
        genérico "Disco N". Solo relevante en vista álbum multi-disco. */
    discTitles?: NavidromeDiscTitle[] | undefined;
    /** Mostrar thumbnail por row (modo "Popular" en ArtistDetail). El track
        debe traer `coverUrl` poblado. Cuando true escondemos el header de
        columnas (no calza visualmente con thumbs grandes). */
    showCover?: boolean;
    /** Si se pasa, activa el modo "solo featurings" de Apple Music en cada
        row: el artista solo se pinta cuando la pista trae invitados distintos
        del titular del álbum. Lo usa AlbumDetail; las playlists lo dejan
        undefined (muestran el artista normal). Mirror del `albumArtist` de
        SongListView (iOS). */
    albumArtist?: string | undefined;
    /** Llamado al click en una row. El parent decide qué hacer (load song,
        set context, etc). Recibe el track y su índice 0-based. */
    onPlay: (track: SongListItem, index: number) => void;
  };

  // `contextId` se conserva en el Props type por simetría con `contextType`
  // (algún caller futuro podría querer restringir el highlight al contexto),
  // pero hoy no lo desestructuramos: iOS / Apple Music highlightean la
  // canción actual en CUALQUIER lista donde aparezca, no solo donde se
  // inició el playback.
  let { tracks, contextType, discTitles, showCover = false, albumArtist, onPlay }: Props =
    $props();

  function isCurrent(trackId: string): boolean {
    return player.currentSong?.id === trackId;
  }

  // Agrupamos por disco SOLO en vista álbum y SOLO cuando hay más de un disco
  // distinto. En playlists / "Popular" del artista las pistas vienen de álbumes
  // diferentes y su `discNumber` no es comparable → nunca agrupamos ahí. Si los
  // archivos no tienen tag de disco todo cae en disco 1 → set de tamaño 1 → no
  // se muestra ningún separador (cero regresión). Mirror SongListView (iOS).
  const groupByDisc = $derived(
    contextType === 'album' && new Set(tracks.map((t) => t.discNumber ?? 1)).size > 1
  );

  function discLabel(disc: number): string {
    const title = discTitles?.find((d) => d.disc === disc)?.title;
    return title ? `Disco ${disc} · ${title}` : `Disco ${disc}`;
  }

  // Lista plana de ítems de render: separadores de disco intercalados con las
  // filas. `originalIndex` preserva la posición en `tracks` (= posición en el
  // array `songs` que el parent pasa a queueManager.play, no se puede perder al
  // agrupar). `visualIndex` es la posición visual contando separadores → stagger
  // lineal de la entry animation. En el caso plano (no agrupado) cada fila
  // conserva su número 1-indexed y visualIndex = índice de lista, idéntico al
  // comportamiento previo.
  type RenderItem =
    | { kind: 'disc'; key: string; disc: number; label: string; visualIndex: number }
    | {
        kind: 'track';
        key: string;
        track: SongListItem;
        number: number;
        originalIndex: number;
        visualIndex: number;
      };

  const renderItems = $derived.by<RenderItem[]>(() => {
    const items: RenderItem[] = [];
    if (!groupByDisc) {
      tracks.forEach((track, i) => {
        items.push({
          kind: 'track',
          key: track.id,
          track,
          number: i + 1,
          originalIndex: i,
          visualIndex: i
        });
      });
      return items;
    }
    let visual = 0;
    let prevDisc: number | null = null;
    tracks.forEach((track, i) => {
      const disc = track.discNumber ?? 1;
      if (disc !== prevDisc) {
        items.push({
          kind: 'disc',
          key: `disc-${disc}`,
          disc,
          label: discLabel(disc),
          visualIndex: visual
        });
        visual += 1;
        prevDisc = disc;
      }
      items.push({
        kind: 'track',
        key: track.id,
        track,
        // Número real de pista dentro del disco (reinicia por disco) — paridad
        // Apple Music. trackNumber ya viene de `song.track`.
        number: track.trackNumber,
        originalIndex: i,
        visualIndex: visual
      });
      visual += 1;
    });
    return items;
  });
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
    {#each renderItems as item (item.key)}
      {#if item.kind === 'disc'}
        <div class="disc-separator" style:--row-i={item.visualIndex}>
          <span class="disc-icon" aria-hidden="true">
            <Disc size={16} weight="regular" />
          </span>
          <span class="disc-label">{item.label}</span>
        </div>
      {:else}
        <SongRow
          track={item.track}
          index={item.number}
          rowIndex={item.visualIndex}
          isCurrent={isCurrent(item.track.id)}
          artist={item.track.artist}
          {albumArtist}
          coverUrl={showCover ? item.track.coverUrl : undefined}
          {contextType}
          onPlay={() => onPlay(item.track, item.originalIndex)}
        />
      {/if}
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

  /* Separador de disco (álbumes multi-disco). Replica la rejilla de SongRow
     para que su contenido caiga en columna con las pistas: icono en el slot
     del número, label alineado con el título. La columna 1 (favorito) queda
     vacía a propósito, igual que el gutter de las filas. Spec: design-lead. */
  .disc-separator {
    display: grid;
    grid-template-columns: 28px 32px minmax(0, 1fr) auto 36px;
    align-items: center;
    column-gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    /* Más aire arriba (separa del grupo anterior), poco abajo (el separador
       pertenece a las pistas que le siguen) → percepción de agrupación. */
    margin-top: var(--space-6);
    margin-bottom: var(--space-2);
    /* Misma cascada de entrada que las filas, escalonada por --row-i. */
    animation: disc-separator-entry var(--row-entry-duration) var(--row-entry-ease)
      calc(var(--row-i, 0) * var(--row-entry-stagger)) backwards;
  }
  /* El primer separador (Disco 1) va casi pegado al header de columnas; un
     margin-top grande abriría un hueco feo entre header y contenido. */
  .disc-separator:first-child {
    margin-top: var(--space-2);
  }
  .disc-icon {
    grid-column: 2;
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
  }
  .disc-label {
    grid-column: 3 / -1;
    min-width: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: var(--tracking-body);
    /* Sentence case (no uppercase): un discTitle propio uppercaseado se lee
       mal. Trunca con ellipsis si el título es largo. */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes disc-separator-entry {
    from {
      opacity: 0;
      transform: translateY(var(--row-entry-distance));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
