<script lang="ts">
  /**
   * CrateDiggerSection — "Crate Digger": sugerencias para añadir al final de
   * una playlist privada o de Favoritos (estilo Spotify "Recommended songs").
   *
   * Contrato: D:\Audiorr-shared\decisions\crate-digger-suggestions-api-contract.md
   *
   * - `mode='playlist'`: header "Redondea tu lista", botón `+`, añade con
   *   `updatePlaylist(songIdsToAdd)`.
   * - `mode='favorites'`: header "Amplía tus favoritos", botón estrella,
   *   añade con `star` (NUNCA `updatePlaylist` — el sync de starred del
   *   backend revertiría el cambio en su próximo ciclo de 15 min).
   *
   * Paginación por cursor opaco: "Ver más" = append (`cursor=nextCursor`),
   * "Actualizar" = reshuffle (`refresh=true`, sin cursor). Dedup: el server
   * re-lee la lista/favoritos vivos en cada llamada (capa a+b); el cliente
   * quita la fila al instante tras un add exitoso (capa c) e invalida la
   * query `['playlist', playlistId]` para que el listado de arriba refresque.
   *
   * Oculta cuando `eligible:false`, o `items:[]` con `nextCursor:null`
   * (señal insuficiente — nunca se rellena con aleatorio, req#1 del
   * contrato). Sin firma "Engine": es una utilidad inline, no un estante
   * curado.
   */
  import { onDestroy } from 'svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { ArrowsClockwise } from 'phosphor-svelte';
  import CrateDiggerRow from './CrateDiggerRow.svelte';
  import { fetchCrateDiggerSuggestions } from '$services/CrateDiggerService';
  import * as nav from '$services/NavidromeService';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { favorites } from '$stores/favorites.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { CrateDiggerItem, CrateDiggerBasis } from '$types/backend';
  import type { NavidromeSong } from '$types/navidrome';

  type Props = {
    playlistId: string;
    mode: 'playlist' | 'favorites';
  };
  let { playlistId, mode }: Props = $props();

  const queryClient = useQueryClient();

  // Decisión director 2026-07-15: 10, uniforme en las 3 plataformas (el "20"
  // de la sección UX del contrato quedó desactualizado tras esa decisión).
  const PAGE_LIMIT = 10;
  /** La fila queda con el icono en estado "confirmado" (Check / ★) este
      tiempo antes de salir de la lista — feedback legible del morph antes
      del collapse. */
  const REMOVE_DELAY_MS = 550;

  let status = $state<'idle' | 'loading' | 'ready'>('idle');
  let eligible = $state(false);
  let basis = $state<CrateDiggerBasis>('playlist');
  let items = $state<CrateDiggerItem[]>([]);
  let nextCursor = $state<string | null>(null);
  let loadingMore = $state(false);
  let refreshing = $state(false);
  let pendingIds = $state<ReadonlySet<string>>(new Set());
  let justAddedIds = $state<ReadonlySet<string>>(new Set());

  function withId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    return new Set(set).add(id);
  }
  function withoutId(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
    const next = new Set(set);
    next.delete(id);
    return next;
  }

  async function loadFirstPage(currentPlaylistId: string): Promise<void> {
    status = 'loading';
    items = [];
    nextCursor = null;
    pendingIds = new Set();
    justAddedIds = new Set();
    const res = await fetchCrateDiggerSuggestions(currentPlaylistId, { limit: PAGE_LIMIT });
    eligible = res.eligible;
    basis = res.basis;
    items = res.items;
    nextCursor = res.nextCursor;
    status = 'ready';
  }

  // Reactivo a navegación entre playlists sin remount del padre (mismo
  // patrón que playlistQ en +page.svelte, pero acá el estado es paginado a
  // mano en vez de una query TanStack simple).
  $effect(() => {
    const id = playlistId;
    void loadFirstPage(id);
  });

  async function handleLoadMore(): Promise<void> {
    if (!nextCursor || loadingMore) return;
    loadingMore = true;
    try {
      const res = await fetchCrateDiggerSuggestions(playlistId, {
        limit: PAGE_LIMIT,
        cursor: nextCursor
      });
      items = [...items, ...res.items];
      nextCursor = res.nextCursor;
    } finally {
      loadingMore = false;
    }
  }

  async function handleRefresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const res = await fetchCrateDiggerSuggestions(playlistId, {
        limit: PAGE_LIMIT,
        refresh: true
      });
      eligible = res.eligible;
      basis = res.basis;
      items = res.items;
      nextCursor = res.nextCursor;
    } finally {
      refreshing = false;
    }
  }

  // Handles de los timeouts de "confirmado → sale de la lista" en vuelo, para
  // poder limpiarlos si el componente se destruye antes de que disparen
  // (navegación fuera de la playlist durante la ventana de 550ms).
  const pendingRemovals = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => {
    for (const t of pendingRemovals) clearTimeout(t);
  });

  function scheduleRemoval(id: string): void {
    justAddedIds = withId(justAddedIds, id);
    const handle = setTimeout(() => {
      pendingRemovals.delete(handle);
      items = items.filter((i) => i.id !== id);
      justAddedIds = withoutId(justAddedIds, id);
    }, REMOVE_DELAY_MS);
    pendingRemovals.add(handle);
  }

  async function handleAdd(item: CrateDiggerItem): Promise<void> {
    if (pendingIds.has(item.id) || justAddedIds.has(item.id)) return;
    pendingIds = withId(pendingIds, item.id);
    try {
      if (mode === 'favorites') {
        // favorites.toggleSong ya hace optimismo + rollback + su propio toast
        // de error + notifyStarredSync (materializa "Favoritos" más rápido
        // que el cron de 15 min). Nunca lanza — comprobamos el resultado
        // leyendo el store tras el await en vez de un try/catch propio.
        await favorites.toggleSong(item.id);
        if (!favorites.isSong(item.id)) return; // falló — el store ya avisó
        toasts.success('Añadida a favoritos');
      } else {
        await nav.updatePlaylist(playlistId, { songIdsToAdd: [item.id] });
        toasts.success('Añadida');
      }
      scheduleRemoval(item.id);
      void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
    } catch (err) {
      toasts.error('Crate Digger', err instanceof Error ? err.message : 'No se pudo añadir');
    } finally {
      pendingIds = withoutId(pendingIds, item.id);
    }
  }

  /** Sintetiza un NavidromeSong mínimo para reproducir la fila (tap = play,
      convención universal). El contrato no expone un `coverArt` de canción
      propio — reutilizamos `albumId`, la misma fuente que usa CrateDiggerRow
      para la portada (documentado ahí). */
  function toNavidromeSong(item: CrateDiggerItem): NavidromeSong {
    return {
      id: item.id,
      title: item.title,
      artist: item.artist,
      album: item.album,
      albumId: item.albumId,
      coverArt: item.albumId,
      duration: item.durationSec,
      ...(item.artistId !== undefined ? { artistId: item.artistId } : {})
    };
  }

  function handlePlay(index: number): void {
    const songs = items.map(toNavidromeSong);
    queueManager.play(songs, index);
  }

  function isCurrent(id: string): boolean {
    return player.currentSong?.id === id;
  }

  const heading = $derived(mode === 'favorites' ? 'Amplía tus favoritos' : 'Redondea tu lista');

  const subtitle = $derived.by(() => {
    if (mode === 'favorites') return 'A partir de tus favoritos y de lo que escuchas.';
    if (basis === 'taste') return 'A partir de lo que escuchas.';
    if (basis === 'broad') return 'Populares de tu biblioteca.';
    return 'A partir de lo que ya tiene y de lo que escuchas.';
  });

  // Oculta cuando no es elegible, o cuando la señal es insuficiente (sin
  // items y sin más páginas). Si el usuario vacía la página actual a base de
  // añadir pero SÍ queda más (`nextCursor`), el cuerpo queda vacío y el
  // footer ("Ver más") sigue ofreciendo la siguiente tanda.
  const showSection = $derived(
    status === 'ready' && eligible && !(items.length === 0 && nextCursor === null)
  );
</script>

{#if showSection}
  <section class="cd-section" aria-label={heading}>
    <header class="cd-header">
      <h2 class="cd-heading">{heading}</h2>
      <p class="cd-subtitle">{subtitle}</p>
    </header>

    {#if items.length > 0}
      <div class="cd-rows">
        {#each items as item, i (item.id)}
          <CrateDiggerRow
            {item}
            {mode}
            isCurrent={isCurrent(item.id)}
            pending={pendingIds.has(item.id)}
            justAdded={justAddedIds.has(item.id)}
            onPlay={() => handlePlay(i)}
            onAdd={() => void handleAdd(item)}
          />
        {/each}
      </div>
    {/if}

    <footer class="cd-footer">
      {#if nextCursor}
        <button
          type="button"
          class="cd-footer-btn"
          onclick={() => void handleLoadMore()}
          disabled={loadingMore}
        >
          {#if loadingMore}
            <span class="cd-footer-spinner"><ArrowsClockwise size={14} weight="bold" /></span>
          {/if}
          Ver más
        </button>
      {/if}
      <button
        type="button"
        class="cd-footer-btn cd-footer-btn-ghost"
        onclick={() => void handleRefresh()}
        disabled={refreshing}
      >
        {#if refreshing}
          <span class="cd-footer-spinner"><ArrowsClockwise size={14} weight="bold" /></span>
        {/if}
        Actualizar
      </button>
    </footer>
  </section>
{/if}

<style>
  .cd-section {
    margin-top: var(--space-8);
    padding: var(--space-6) var(--space-4) var(--space-12);
    border-top: 1px solid var(--separator-subtle);
    animation: cd-section-entry var(--duration-normal) var(--ease-ios-default);
  }
  @keyframes cd-section-entry {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .cd-header {
    padding: 0 var(--space-4) var(--space-3);
    display: grid;
    gap: var(--space-1);
  }
  .cd-heading {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 800;
    letter-spacing: var(--tracking-display-sm);
    color: var(--text-primary);
  }
  .cd-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }

  .cd-rows {
    display: grid;
    gap: 1px;
  }

  .cd-footer {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) 0;
  }
  .cd-footer-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default);
  }
  .cd-footer-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }
  .cd-footer-btn:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .cd-footer-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .cd-footer-btn-ghost {
    background: transparent;
  }
  .cd-footer-btn-ghost:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }

  .cd-footer-spinner {
    display: grid;
    place-items: center;
    animation: cd-footer-spin 1s linear infinite;
  }
  @keyframes cd-footer-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
