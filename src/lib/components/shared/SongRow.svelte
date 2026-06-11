<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    Play,
    MusicNote,
    DotsThree,
    Plus,
    ListPlus,
    Star,
    User,
    Disc,
    Wrench,
    YoutubeLogo,
    Hash,
    Tag,
    Info
  } from 'phosphor-svelte';
  import EqualizerIcon from './EqualizerIcon.svelte';
  import ExplicitBadge from './ExplicitBadge.svelte';
  import CoverImage from './CoverImage.svelte';
  import ContextMenu, { type ContextMenuItem } from './ContextMenu.svelte';
  import { Users } from 'phosphor-svelte';
  import { player, type PlaybackContext } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { addToPlaylistUI } from '$stores/playlist-mutations-ui.svelte';
  import { adminToolsUI } from '$stores/admin-tools-ui.svelte';
  import { viewArtistsUI } from '$stores/view-artists-ui.svelte';
  import { songInfoUI } from '$stores/song-info-ui.svelte';
  import { authInfo } from '$stores/auth-info.svelte';
  import { favorites } from '$stores/favorites.svelte';
  import { formatTime } from '$utils/format';
  import { displayArtistName, featuringText } from '$utils/artist-format';
  import type { SongListItem } from '$utils/navidrome-mappers';

  type Props = {
    track: SongListItem;
    /** Posición del row en la lista (1-indexed). Usado en el slot izquierdo. */
    index: number;
    /** True = es la canción actualmente sonando desde este contexto. */
    isCurrent: boolean;
    /** Artist crudo de la pista (titular principal). Se usa para el menú
        contextual y como fallback de formato. El texto que se PINTA bajo el
        título lo deriva `displayArtist` (formato Apple Music). */
    artist?: string | undefined;
    /** Si se pasa, activa el modo "solo featurings" estilo Apple Music: el
        artista solo se pinta cuando la pista trae invitados distintos del
        titular del álbum ("Drake feat. Snoop Dogg"); si es solo del titular,
        no se muestra nada. Mirror del `albumArtist` de SongRowView (iOS). */
    albumArtist?: string | undefined;
    /** URL del cover thumbnail. Cuando viene, se renderiza un thumb 40x40
        a la izquierda (modo "Popular" en ArtistDetail). El indicador de
        número/play queda escondido para evitar duplicar info visual. */
    coverUrl?: string | undefined;
    /** Contexto desde donde se renderiza la row — controla qué items aparecen
        en su menú contextual. Coincide con el `contextType` del SongList. */
    contextType: NonNullable<PlaybackContext>['type'];
    onPlay: () => void;
  };

  let { track, index, isCurrent, artist, albumArtist, coverUrl, contextType, onPlay }: Props =
    $props();

  const explicit = $derived(track.explicit ?? false);
  const showCover = $derived(coverUrl !== undefined);

  /** Texto del artista a pintar bajo el título. `null` = no mostrar nada.
      - Con `albumArtist` (página de álbum): solo featurings, formato
        "Drake feat. Snoop Dogg" (oculta las pistas que son solo del titular).
      - Sin `albumArtist` (playlist/popular): el artista crudo formateado al
        estilo Apple Music cuando hay varios ("A & B"). Mirror del `artistText`
        de SongRowView (iOS). */
  const displayArtist = $derived.by<string | null>(() => {
    const list = track.artists ?? [];
    if (albumArtist !== undefined) {
      return featuringText(list, artist ?? '', albumArtist);
    }
    if (artist === undefined) return null;
    return displayArtistName(list, artist);
  });

  let hovered = $state(false);
  let menuOpen = $state(false);

  /**
   * Items del menu contextual. Lógica:
   *   - "Añadir a continuación" y "Añadir a Playlist" siempre presentes.
   *   - "Ver artista" / "Ver artistas" — todos menos cuando ya estamos en
   *     /artist (contextType === 'artist'). Si `track.artists` trae >1
   *     entrada (OpenSubsonic multi-artist), pasamos a "Ver artistas"
   *     (plural) y abrimos el mini-modal `ViewArtistsDialog` con la lista.
   *     Si solo hay 1 (o el server no expone `artists[]`), queda la
   *     versión singular que navega directo a `track.artistId`.
   *   - "Ver álbum" — todos menos cuando ya estamos en /album. Solo si
   *     tenemos albumId.
   *   - El divider separa las acciones de los "ver". Si el segundo grupo
   *     queda vacío, no metemos divider.
   */
  const menuItems = $derived.by<ContextMenuItem[]>(() => {
    const items: ContextMenuItem[] = [
      {
        label: 'Añadir a continuación',
        icon: Plus,
        action: () => {
          // SongListItem es la forma normalizada de SongList; al venir desde
          // ArtistDetail/Playlist/Album el item ya trae artist/album/etc, así
          // que construímos PersistableSong directo sin pasar por NavidromeSong.
          queueManager.insertNextItem(track, artist);
        }
      },
      {
        label: 'Añadir a Playlist',
        icon: ListPlus,
        action: () => {
          addToPlaylistUI.open([track.id]);
        }
      },
      {
        label: favorites.isSong(track.id) ? 'Quitar de favoritos' : 'Añadir a favoritos',
        icon: Star,
        action: () => {
          void favorites.toggleSong(track.id);
        }
      }
    ];
    const navItems: ContextMenuItem[] = [];
    if (contextType !== 'artist') {
      const multiArtist = (track.artists?.length ?? 0) > 1;
      if (multiArtist && track.artists) {
        const artists = track.artists;
        navItems.push({
          label: 'Ver artistas',
          icon: Users,
          action: () => {
            viewArtistsUI.open(artists, track.title);
          }
        });
      } else if (track.artistId) {
        navItems.push({
          label: 'Ver artista',
          icon: User,
          action: () => {
            if (track.artistId) goto(`/artist/${track.artistId}`);
          }
        });
      }
    }
    if (contextType !== 'album' && track.albumId) {
      navItems.push({
        label: 'Ver álbum',
        icon: Disc,
        action: () => {
          if (track.albumId) goto(`/album/${track.albumId}`);
        }
      });
    }
    if (navItems.length > 0) {
      items.push({ divider: true });
      items.push(...navItems);
    }
    if (authInfo.isAdmin) {
      const adminTarget = {
        songId: track.id,
        songTitle: track.title,
        songArtist: artist ?? track.artist ?? 'Desconocido'
      };
      items.push({ divider: true });
      items.push({
        label: 'Admin Tools',
        icon: Wrench,
        submenu: [
          {
            label: 'Enviar a la cola de Canvas',
            icon: YoutubeLogo,
            action: () => {
              adminToolsUI.openCanvasQueue(adminTarget);
            }
          },
          {
            label: 'Editar reproducciones',
            icon: Hash,
            action: () => {
              adminToolsUI.openPlayCount(adminTarget);
            }
          },
          {
            label: 'Editar smart tags',
            icon: Tag,
            action: () => {
              adminToolsUI.openSmartTags(adminTarget);
            }
          },
          {
            label: 'Información detallada',
            icon: Info,
            action: () => {
              songInfoUI.open(track.id, {
                id: track.id,
                title: track.title,
                artist: artist ?? track.artist,
                album: track.album,
                albumId: track.albumId,
                artistId: track.artistId,
                duration: track.durationSec,
                explicitStatus: track.explicit ? 'explicit' : undefined
              });
            }
          }
        ]
      });
    }
    return items;
  });

  function handleRowClick() {
    if (menuOpen) return;
    onPlay();
  }

  function handleRowKeydown(e: KeyboardEvent) {
    if (menuOpen) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay();
    }
  }

  function handleDotsClick(e: MouseEvent) {
    e.stopPropagation();
    menuOpen = !menuOpen;
  }
</script>

<div
  class="row"
  class:current={isCurrent}
  class:with-cover={showCover}
  class:menu-open={menuOpen}
  role="button"
  tabindex="0"
  style:--row-i={index - 1}
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  onclick={handleRowClick}
  onkeydown={handleRowKeydown}
>
  {#if showCover}
    <span class="cover-slot" aria-hidden="true">
      <CoverImage src={coverUrl} alt="" priority="low" width={120} height={120}>
        {#snippet fallback()}
          <MusicNote size="100%" weight="regular" />
        {/snippet}
      </CoverImage>
      {#if isCurrent}
        <span class="cover-overlay">
          <EqualizerIcon color="#fff" height={14} />
        </span>
      {/if}
    </span>
  {:else}
    <span class="indicator" aria-hidden="true">
      {#if isCurrent}
        <EqualizerIcon height={14} />
      {:else if hovered}
        <Play size={14} weight="fill" />
      {:else}
        <span class="num">{index}</span>
      {/if}
    </span>
  {/if}

  <span class="title-block">
    <span class="title-line">
      <span class="title">{track.title}</span>
      {#if explicit}
        <ExplicitBadge size="14px" />
      {/if}
    </span>
    {#if displayArtist}
      <span class="artist">{displayArtist}</span>
    {/if}
  </span>

  <span class="duration">{formatTime(track.durationSec)}</span>

  <span class="menu-anchor">
    <button
      type="button"
      class="dots-btn"
      onclick={handleDotsClick}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label="Más opciones"
    >
      <DotsThree size={18} weight="bold" />
    </button>
    <ContextMenu
      open={menuOpen}
      items={menuItems}
      onClose={() => (menuOpen = false)}
    />
  </span>
</div>

<style>
  /* Entry animation: cada fila aparece con un translateY+fade escalonado.
     El delay deriva del índice de la fila (--row-i) × stagger del token.
     `backwards` mantiene el estado inicial durante el delay → no hay flash
     pre-animation. Solo dispara en mount inicial; updates posteriores no
     re-disparan porque la animación ya completó (pinned final). */
  .row {
    animation: song-row-entry var(--row-entry-duration) var(--row-entry-ease)
      calc(var(--row-i, 0) * var(--row-entry-stagger)) backwards;

    width: 100%;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto 36px;
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
  .row.with-cover {
    grid-template-columns: 40px minmax(0, 1fr) auto 36px;
  }
  .row:hover,
  .row.menu-open {
    background: var(--row-hover);
  }
  .row:focus-visible {
    outline: none;
    background: var(--row-hover);
    box-shadow: var(--focus-ring);
  }

  .row.current .title {
    color: var(--text-accent);
  }

  .indicator {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--text-tertiary);
  }
  .row.current .indicator {
    color: var(--text-accent);
  }

  .num {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }
  .row:hover .num {
    color: var(--text-primary);
  }

  .cover-slot {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: var(--shadow-xs);
  }
  .cover-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
  }

  .title-block {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .title-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .title {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .artist {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .duration {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }

  /* Anchor relativo para que el ContextMenu se posicione respecto al dots. */
  .menu-anchor {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* Botón dots: siempre presente, opacidad sube en hover/focus/abierto.
     iOS Music lo muestra siempre en mobile y solo on-hover en macOS — acá
     vamos por el patrón de "siempre visible" para que funcione bien en touch
     y discoverability. */
  .dots-btn {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0.5;
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .row:hover .dots-btn,
  .row:focus-within .dots-btn,
  .row.menu-open .dots-btn {
    opacity: 1;
    color: var(--text-primary);
  }
  .dots-btn:hover {
    background: var(--bg-surface-hover);
  }
  .dots-btn:active {
    background: var(--bg-surface-active);
    transition-duration: var(--duration-instant);
  }
  .dots-btn:focus-visible {
    outline: none;
    opacity: 1;
    color: var(--text-primary);
    box-shadow: var(--focus-ring);
  }

  @keyframes song-row-entry {
    from {
      opacity: 0;
      transform: translateY(var(--row-entry-distance));
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Reduced motion: el primitive ya pone duraciones a 0ms y distance a
     0px. El @keyframes corre pero es instantáneo y sin movimiento → no
     re-implementamos. */
</style>
