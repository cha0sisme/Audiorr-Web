<script lang="ts">
  /**
   * Top semanal — Top 10 con tendencias (rank, trend up/down/same/new).
   *
   * Layout estilo Billboard / Apple Music charts: 2 columnas verticales de 5
   * rows cada una en desktop (≥768px); 1 columna en mobile.
   *
   * Mirrors `topWeeklySection` del HomeView de iOS, pero rendered con CSS
   * grid responsive en lugar de scroll horizontal.
   */
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import {
    CaretUp,
    CaretDown,
    DotsThree,
    Disc,
    ListPlus,
    MusicNote,
    Play,
    Plus,
    Queue,
    User
  } from 'phosphor-svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import NowPlayingIndicator from '$components/shared/NowPlayingIndicator.svelte';
  import * as nav from '$services/NavidromeService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { queueManager } from '$services/QueueManager.svelte';
  import { player } from '$stores/player.svelte';
  import type { TopWeeklySong } from '$types/backend';
  import type { NavidromeSong } from '$types/navidrome';

  type Props = {
    songs: TopWeeklySong[];
    /** Recibe el índice (0-based) de la canción clickada. El caller
        construye la queue y arranca el playback. */
    onPlay: (index: number) => void;
  };
  let { songs, onPlay }: Props = $props();

  const firstColumn = $derived(songs.slice(0, 5));
  const secondColumn = $derived(songs.slice(5, 10));

  /** Solo una row tiene el menú abierto a la vez — global por componente. */
  let openMenuIdx = $state<number | null>(null);

  /**
   * Enriquecimiento de los 10 songs con `getSong()` en paralelo. El endpoint
   * `/api/stats/top-weekly` solo devuelve metadata mínima (sin `explicitStatus`
   * ni `replayGain`). Para mostrar el badge "E" + en el futuro normalizar
   * volumen al reproducir, hidratamos con un fetch en background después de
   * que el chart ya está visible. Mirrors el `Task` de iOS HomeView:108-128.
   *
   * El queryKey usa los IDs joineados → si el chart cambia (semana siguiente),
   * se re-fetchea automáticamente. staleTime 1h porque son props del catálogo
   * que no cambian (explicit es metadata fija de la canción).
   */
  const songIdsKey = $derived(songs.map((s) => s.song_id).join(','));

  const enrichedQ = createQuery(() => ({
    queryKey: ['topWeekly', 'enriched', songIdsKey],
    queryFn: async (): Promise<Map<string, NavidromeSong>> => {
      const ids = songs.map((s) => s.song_id);
      const results = await Promise.all(ids.map((id) => nav.getSong(id).catch(() => null)));
      const map = new Map<string, NavidromeSong>();
      for (let i = 0; i < ids.length; i++) {
        const result = results[i];
        const id = ids[i];
        if (result && id) map.set(id, result);
      }
      return map;
    },
    enabled: songs.length > 0,
    staleTime: 60 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false
  }));

  function isExplicit(songId: string): boolean {
    return enrichedQ.data?.get(songId)?.explicitStatus === 'explicit';
  }

  function trendLabel(s: TopWeeklySong): string {
    if (s.trend === 'up') return `Sube ${s.change ?? ''} posiciones`;
    if (s.trend === 'down') return `Baja ${Math.abs(s.change ?? 0)} posiciones`;
    if (s.trend === 'new') return 'Nuevo en el top';
    return 'Sin cambios';
  }

  function topWeeklyToNavidromeSong(s: TopWeeklySong): NavidromeSong {
    return {
      id: s.song_id,
      title: s.title,
      artist: s.artist,
      ...(s.artist_id ? { artistId: s.artist_id } : {}),
      album: s.album,
      ...(s.album_id ? { albumId: s.album_id } : {}),
      ...(s.cover_art ? { coverArt: s.cover_art } : {}),
      ...(typeof s.duration === 'number' ? { duration: s.duration } : {})
    };
  }

  function buildMenuItems(song: TopWeeklySong, idx: number): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      {
        label: 'Reproducir',
        icon: Play,
        action: () => onPlay(idx)
      },
      {
        label: 'Añadir a continuación',
        icon: Plus,
        action: () => queueManager.insertNext(topWeeklyToNavidromeSong(song))
      },
      {
        label: 'Añadir al final',
        icon: Queue,
        action: () => queueManager.addToQueue(topWeeklyToNavidromeSong(song))
      },
      {
        label: 'Añadir a Playlist',
        icon: ListPlus,
        action: () => {
          // TODO: abrir picker de playlists.
        }
      }
    ];
    const navItems: ContextMenuItem[] = [];
    if (song.artist_id) {
      navItems.push({
        label: 'Ver artista',
        icon: User,
        action: () => {
          if (song.artist_id) goto(`/artist/${song.artist_id}`);
        }
      });
    }
    if (song.album_id) {
      navItems.push({
        label: 'Ver álbum',
        icon: Disc,
        action: () => {
          if (song.album_id) goto(`/album/${song.album_id}`);
        }
      });
    }
    if (navItems.length > 0) {
      items.push({ divider: true });
      items.push(...navItems);
    }
    return items;
  }

  function toggleMenu(idx: number, e: MouseEvent) {
    e.stopPropagation();
    openMenuIdx = openMenuIdx === idx ? null : idx;
  }

  function handleRowClick(idx: number) {
    if (openMenuIdx !== null) return;
    onPlay(idx);
  }

  function handleRowKeydown(e: KeyboardEvent, idx: number) {
    if (openMenuIdx !== null) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlay(idx);
    }
  }
</script>

{#snippet row(song: TopWeeklySong, idx: number)}
  {@const isCurrent = player.currentSong?.id === song.song_id}
  {@const explicit = isExplicit(song.song_id)}
  <li>
    <div
      class="row"
      class:menu-open={openMenuIdx === idx}
      class:current={isCurrent}
      role="button"
      tabindex="0"
      onclick={() => handleRowClick(idx)}
      onkeydown={(e) => handleRowKeydown(e, idx)}
    >
      <span class="rank">{song.rank}</span>
      <div class="cover">
        <CoverImage
          src={song.cover_art ? getCoverArtUrl(song.cover_art, 120) : undefined}
          alt=""
        >
          {#snippet fallback()}
            <MusicNote size="100%" weight="regular" />
          {/snippet}
        </CoverImage>
        {#if isCurrent}
          <span class="cover-overlay" aria-hidden="true">
            <NowPlayingIndicator
              isPlaying={player.isPlaying}
              color="#fff"
              height={14}
              barWidth={2}
            />
          </span>
        {/if}
      </div>
      <div class="meta">
        <span class="title-line">
          <span class="title">{song.title}</span>
          {#if explicit}
            <ExplicitBadge size="14px" />
          {/if}
        </span>
        <span class="artist">{song.artist}</span>
      </div>
      <span class="trend trend-{song.trend}" aria-label={trendLabel(song)}>
        {#if song.trend === 'up' && song.change}
          <CaretUp size={12} weight="bold" />
          <span class="num">{song.change}</span>
        {:else if song.trend === 'down' && song.change}
          <CaretDown size={12} weight="bold" />
          <span class="num">{Math.abs(song.change)}</span>
        {:else if song.trend === 'new'}
          <span class="badge">NEW</span>
        {:else}
          <span class="dash">—</span>
        {/if}
      </span>

      <span class="menu-anchor">
        <button
          type="button"
          class="dots-btn"
          onclick={(e) => toggleMenu(idx, e)}
          aria-haspopup="menu"
          aria-expanded={openMenuIdx === idx}
          aria-label="Más opciones"
        >
          <DotsThree size={18} weight="bold" />
        </button>
        <ContextMenu
          open={openMenuIdx === idx}
          items={buildMenuItems(song, idx)}
          onClose={() => (openMenuIdx = null)}
        />
      </span>
    </div>
  </li>
{/snippet}

<div class="chart">
  <ol class="column">
    {#each firstColumn as song, i (song.song_id)}
      {@render row(song, i)}
    {/each}
  </ol>

  {#if secondColumn.length > 0}
    <ol class="column" start={6}>
      {#each secondColumn as song, i (song.song_id)}
        {@render row(song, i + 5)}
      {/each}
    </ol>
  {/if}
</div>

<style>
  .chart {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
    padding: 0 var(--space-6);
  }
  @media (min-width: 768px) {
    .chart {
      grid-template-columns: 1fr 1fr;
      gap: var(--space-6);
    }
  }

  .column {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .column li + li {
    border-top: 1px solid var(--border-subtle);
  }

  .row {
    display: grid;
    grid-template-columns: 32px 56px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-2);
    color: inherit;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover,
  .row:focus-visible,
  .row.menu-open {
    background: var(--bg-surface-hover);
  }
  .row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .rank {
    font-size: var(--text-xl);
    font-weight: 800;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: center;
    line-height: 1;
  }

  .cover {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    background: var(--bg-surface);
  }

  .meta {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .title-line {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Cuando una row es la canción actual, su título toma el color accent —
     mismo tratamiento que SongRow.current. El cover lleva el equalizer overlay. */
  .row.current .title {
    color: var(--accent);
  }
  .cover-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .artist {
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trend {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 36px;
    justify-content: flex-end;
    font-size: var(--text-xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .trend-up { color: var(--status-success, #34c759); }
  .trend-down { color: var(--status-danger, #ff453a); }
  .trend-same { color: var(--text-tertiary); }
  .trend-new { color: var(--accent); }
  .badge {
    padding: 2px 6px;
    background: var(--accent);
    color: var(--accent-fg, #fff);
    border-radius: var(--radius-xs, 4px);
    font-size: 10px;
    letter-spacing: 0.04em;
  }
  .dash {
    color: var(--text-tertiary);
  }

  /* Anchor del context menu — wrapper position:relative para el popover. */
  .menu-anchor {
    position: relative;
    display: inline-flex;
  }
  .dots-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: transparent;
    border: 0;
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover .dots-btn,
  .row:focus-within .dots-btn,
  .row.menu-open .dots-btn {
    opacity: 1;
  }
  .dots-btn:hover {
    background: var(--bg-surface-active);
    color: var(--text-primary);
  }
  .dots-btn:focus-visible {
    outline: none;
    background: var(--bg-surface-active);
    box-shadow: var(--focus-ring);
  }
</style>
