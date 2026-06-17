<script lang="ts">
  /**
   * Search — página de resultados. El input vive en el Sidebar (single
   * source of truth a nivel UX); esta página solo lee la URL ?q y
   * renderiza los resultados.
   *
   * Performance:
   *   - search3 con count=20 por tipo (cap razonable, respuesta rápida).
   *   - placeholderData keepPreviousData → cero skeleton flash entre
   *     keystrokes consecutivos del usuario en el sidebar.
   *   - Playlists no tienen endpoint de search en Subsonic; filtramos
   *     getPlaylists() client-side (mismo cache que /library).
   *   - staleTime 30s, gcTime 60s — searches son volátiles.
   */
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { Clock } from 'phosphor-svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import SegmentedControl from '$components/shared/SegmentedControl.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import * as nav from '$services/NavidromeService';
  import {
    albumToCardProps,
    artistToCardProps,
    playlistToCardProps,
    songToListItem,
    type SongListItem
  } from '$utils/navidrome-mappers';
  import type { NavidromeArtist, NavidromeSong } from '$types/navidrome';
  import { credentials } from '$stores/credentials.svelte';
  import { searchHistory } from '$stores/search-history.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';

  type Tab = 'all' | 'artists' | 'albums' | 'songs' | 'playlists';
  const TABS = [
    { id: 'all' as const, label: 'Todo' },
    { id: 'artists' as const, label: 'Artistas' },
    { id: 'albums' as const, label: 'Álbumes' },
    { id: 'songs' as const, label: 'Canciones' },
    { id: 'playlists' as const, label: 'Playlists' }
  ];

  const MIN_QUERY = 2;

  // URL — fuente de verdad para query y tab.
  const urlQuery = $derived(page.url.searchParams.get('q') ?? '');
  const currentTab = $derived<Tab>(
    (page.url.searchParams.get('tab') as Tab | null) ?? 'all'
  );

  function setTab(t: Tab) {
    const url = new URL(page.url);
    if (t === 'all') url.searchParams.delete('tab');
    else url.searchParams.set('tab', t);
    goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function applyRecent(q: string) {
    const url = new URL('/search', window.location.origin);
    url.searchParams.set('q', q);
    goto(url);
  }

  // ==========================================================================
  // Queries
  // ==========================================================================
  const isActive = $derived(urlQuery.length >= MIN_QUERY);

  // SIN placeholderData — al cambiar urlQuery (cada keystroke debounced),
  // queremos que las cards viejas DESMONTEN inmediatamente. Eso cancela los
  // fetches in-flight de sus covers via CoverImage.onDestroy → libera la
  // pool de conexiones para que la nueva petición search3 corra rápido,
  // y luego sus covers nuevos.
  //
  // Counts: artistas/álbumes 20 (luego filtramos client-side por nombre,
  // así que sobre-pedimos un poco), canciones 40 (suficiente para tener
  // material tras filtrar y poder reproducir desde el resultado).
  const searchQ = createQuery(() => ({
    queryKey: ['search', urlQuery],
    // signal viene de TanStack Query — se aborta cuando el queryKey cambia
    // (siguiente keystroke debounced). Cancela el fetch en vuelo en lugar
    // de esperar a que devuelva data ya stale.
    queryFn: ({ signal }) =>
      nav.search3(urlQuery, { artistCount: 20, albumCount: 20, songCount: 40 }, signal),
    enabled: credentials.isConfigured && isActive,
    staleTime: 30 * 1000,
    gcTime: 60 * 1000
  }));

  const playlistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured && isActive,
    gcTime: 30 * 60 * 1000
  }));

  const filteredPlaylists = $derived.by(() => {
    if (!isActive || !playlistsQ.data) return [];
    const q = urlQuery.toLowerCase();
    return playlistsQ.data
      .map((p) => ({
        p,
        score: bestFieldScore([p.name, p.owner, p.comment], q)
      }))
      .filter((x) => x.score !== NO_MATCH)
      .sort((x, y) => x.score - y.score)
      .slice(0, 20)
      .map((x) => x.p);
  });

  // Refinado: Subsonic search3 hace FTS sobre múltiples campos (lyrics,
  // comments, tags), así que devuelve álbumes y artistas que matchean por
  // cualquier metadata interno — p. ej. buscar "POWER" trae "Nevermind"
  // porque alguna pista del álbum contiene esa palabra en sus tags. Para
  // mostrar solo matches obvios filtramos client-side por substring en
  // los campos visibles, y además rankeamos por calidad de match:
  //
  //   0 = exacto (title === query)
  //   1 = empieza por la query
  //   2 = la query es una palabra completa dentro del campo
  //   3 = la query aparece como substring en cualquier posición
  //
  // Para items con varios campos relevantes (canción: title/artist/album;
  // álbum: name/artist) tomamos el MEJOR campo y le sumamos un offset por
  // prioridad de campo (primary 0, secondary +10, tertiary +20). Así un
  // match exacto en title gana a un match exacto en album, y un match en
  // título-de-canción gana a uno solo-en-album.
  const NO_MATCH = Number.POSITIVE_INFINITY;
  const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

  function matchScore(value: string | undefined | null, q: string): number {
    if (!value) return NO_MATCH;
    const lower = value.toLowerCase();
    if (lower === q) return 0;
    if (lower.startsWith(q)) return 1;
    const escaped = q.replace(REGEX_ESCAPE, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(value)) return 2;
    if (lower.includes(q)) return 3;
    return NO_MATCH;
  }

  /** Combina varios campos: el mejor score gana, con offset por prioridad. */
  function bestFieldScore(
    fields: Array<string | undefined | null>,
    q: string
  ): number {
    let best = NO_MATCH;
    for (let i = 0; i < fields.length; i++) {
      const s = matchScore(fields[i], q);
      if (s === NO_MATCH) continue;
      const withOffset = s + i * 10;
      if (withOffset < best) best = withOffset;
    }
    return best;
  }

  const rawSongs = $derived<NavidromeSong[]>(searchQ.data?.songs ?? []);
  const rawArtists = $derived<NavidromeArtist[]>(searchQ.data?.artists ?? []);
  const rawAlbums = $derived(searchQ.data?.albums ?? []);

  const filteredAlbums = $derived.by(() => {
    if (!isActive) return [];
    const q = urlQuery.toLowerCase();
    return rawAlbums
      .map((a) => ({ a, score: bestFieldScore([a.name, a.artist], q) }))
      .filter((x) => x.score !== NO_MATCH)
      .sort((x, y) => x.score - y.score)
      .map((x) => x.a);
  });

  // Para artistas: Navidrome a veces no devuelve artistas que existen solo
  // como `artist` de tracks (sin álbumes propios indexados). Complementamos
  // extrayendo artistas únicos de los songs results cuyo nombre matchea el
  // query, deduplicando contra los artistas que ya devolvió search3. El
  // ranking final se hace sobre la lista combinada.
  const filteredArtists = $derived.by<NavidromeArtist[]>(() => {
    if (!isActive) return [];
    const q = urlQuery.toLowerCase();
    const seenIds = new Set<string>();
    const candidates: NavidromeArtist[] = [];

    for (const a of rawArtists) {
      if (matchScore(a.name, q) === NO_MATCH) continue;
      seenIds.add(a.id);
      candidates.push(a);
    }
    for (const s of rawSongs) {
      if (!s.artistId || seenIds.has(s.artistId)) continue;
      if (matchScore(s.artist, q) === NO_MATCH) continue;
      seenIds.add(s.artistId);
      // NavidromeArtist mínimo. Sin coverArt → fallback de ArtistCard
      // (icono User). albumCount undefined → subtítulo "Artista".
      candidates.push({ id: s.artistId, name: s.artist ?? '' });
    }

    return candidates
      .map((a) => ({ a, score: matchScore(a.name, q) }))
      .sort((x, y) => x.score - y.score)
      .map((x) => x.a);
  });

  // Canciones rankeadas: title (primary) > artist (+10) > album (+20). Eso
  // hace que "POWER" exact match en title aparezca antes que "Powertrip" o
  // que una canción cualquiera de un álbum llamado "Power Symphony". El
  // mismo orden se replica en filteredSongsRaw para que `playSong(index)`
  // apunte al track correcto.
  const filteredSongsRaw = $derived.by<NavidromeSong[]>(() => {
    if (!isActive) return [];
    const q = urlQuery.toLowerCase();
    return rawSongs
      .map((s) => ({
        s,
        score: bestFieldScore([s.title, s.artist, s.album], q)
      }))
      .filter((x) => x.score !== NO_MATCH)
      .sort((x, y) => x.score - y.score)
      .map((x) => x.s);
  });

  const filteredSongs = $derived<SongListItem[]>(
    filteredSongsRaw.map((s, i) => songToListItem(s, i, true, true))
  );

  function playSong(_track: SongListItem, index: number) {
    if (filteredSongsRaw.length === 0) return;
    // Sin contexto: la reproducción desde search es ad-hoc, no queremos
    // que ningún álbum/artista/playlist se marque como "playing from".
    player.context = null;
    queueManager.play(filteredSongsRaw, index);
  }

  const totalResults = $derived(
    filteredArtists.length +
      filteredAlbums.length +
      filteredSongs.length +
      filteredPlaylists.length
  );

  // Registrar en historial cuando hay matches sustanciales.
  // CRITICAL: searchHistory.push() lee y escribe `items` ($state). Si lo
  // llamamos directamente, este $effect se suscribe implícitamente a items
  // (vía el filter interno de push) → cada push trigger re-run → push
  // otra vez → effect_update_depth_exceeded. untrack() evita el tracking
  // de los reads del callback.
  $effect(() => {
    if (!isActive) return;
    if (searchQ.isFetching) return;
    if (totalResults > 0) untrack(() => searchHistory.push(urlQuery));
  });
</script>

<PageTitle segments={urlQuery ? [urlQuery, 'Buscar'] : ['Buscar']} />

<div class="search-page">
  <header class="header">
    {#if isActive}
      <h1 class="title">
        Resultados para <span class="query-text">«{urlQuery}»</span>
      </h1>
      <div class="tabs">
        <SegmentedControl
          items={TABS}
          value={currentTab}
          onChange={setTab}
          ariaLabel="Filtrar tipo de resultado"
        />
      </div>
    {:else}
      <h1 class="title">Buscar</h1>
      <p class="lead">Empieza a escribir en la barra de búsqueda — mínimo {MIN_QUERY} caracteres.</p>
    {/if}
  </header>

  {#if !isActive}
    <!-- Empty state: recientes -->
    {#if searchHistory.items.length > 0}
      <section class="recent">
        <header class="recent-header">
          <h2 class="recent-title">
            <Clock size={16} weight="regular" />
            Recientes
          </h2>
          <button type="button" class="link" onclick={() => searchHistory.clear()}>
            Limpiar
          </button>
        </header>
        <ul class="recent-list">
          {#each searchHistory.items as q (q)}
            <li>
              <button type="button" class="recent-chip" onclick={() => applyRecent(q)}>
                {q}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {:else if searchQ.isPending && !searchQ.data}
    <section class="results">
      <div class="grid-skeleton">
        {#each Array(8) as _}<div class="card-sk"></div>{/each}
      </div>
    </section>
  {:else if searchQ.isError}
    <p class="error">No se pudo realizar la búsqueda. Reintenta.</p>
  {:else if totalResults === 0}
    <p class="empty">
      Sin resultados para <strong>«{urlQuery}»</strong>.
    </p>
  {:else}
    <section class="results" aria-busy={searchQ.isFetching}>
      {#if (currentTab === 'all' || currentTab === 'artists') && filteredArtists.length > 0}
        <div class="result-section">
          <h2 class="section-title">Artistas</h2>
          <div class="grid" data-kind="artist">
            {#each filteredArtists.slice(0, currentTab === 'all' ? 6 : filteredArtists.length) as a (a.id)}
              {@const props = artistToCardProps(a)}
              <ArtistCard {...props} />
            {/each}
          </div>
        </div>
      {/if}

      {#if (currentTab === 'all' || currentTab === 'albums') && filteredAlbums.length > 0}
        <div class="result-section">
          <h2 class="section-title">Álbumes</h2>
          <div class="grid" data-kind="album">
            {#each filteredAlbums.slice(0, currentTab === 'all' ? 6 : filteredAlbums.length) as a (a.id)}
              {@const props = albumToCardProps(a)}
              <AlbumCard {...props} />
            {/each}
          </div>
        </div>
      {/if}

      {#if (currentTab === 'all' || currentTab === 'songs') && filteredSongs.length > 0}
        <div class="result-section">
          <h2 class="section-title">Canciones</h2>
          <div class="songs-list">
            <SongList
              tracks={filteredSongs.slice(0, currentTab === 'all' ? 5 : filteredSongs.length)}
              contextType="queue"
              contextId="search"
              showCover
              onPlay={playSong}
            />
          </div>
        </div>
      {/if}

      {#if (currentTab === 'all' || currentTab === 'playlists') && filteredPlaylists.length > 0}
        <div class="result-section">
          <h2 class="section-title">Playlists</h2>
          <div class="grid" data-kind="playlist">
            {#each filteredPlaylists.slice(0, currentTab === 'all' ? 6 : filteredPlaylists.length) as p (p.id)}
              {@const props = playlistToCardProps(p)}
              <PlaylistCard {...props} />
            {/each}
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .search-page {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }

  .header {
    display: grid;
    gap: var(--space-3);
  }
  .title {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .query-text {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .lead {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-base);
    max-width: none;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  /* === Recientes === */
  .recent {
    display: grid;
    gap: var(--space-3);
  }
  .recent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .recent-title {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: var(--tracking-body);
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .link:hover {
    color: var(--text-primary);
  }
  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .recent-chip {
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .recent-chip:hover {
    background: var(--bg-surface-hover);
  }
  .recent-chip:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* === Results === */
  .results {
    display: grid;
    gap: var(--space-7);
  }
  .result-section {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .section-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    line-height: 1.2;
  }

  .grid {
    display: grid;
    gap: var(--space-5);
  }
  .grid[data-kind='album'],
  .grid[data-kind='playlist'] {
    grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  }
  .grid[data-kind='artist'] {
    grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
    gap: var(--space-6);
  }

  .grid-skeleton {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));
  }
  .card-sk {
    aspect-ratio: 1;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  .empty,
  .error {
    margin: 0;
    padding: var(--space-8) 0;
    text-align: center;
    color: var(--text-tertiary);
    max-width: none;
  }

  @media (max-width: 640px) {
    .search-page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .title {
      font-size: var(--text-2xl);
    }
    .grid[data-kind='album'],
    .grid[data-kind='playlist'] {
      grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr));
    }
    .grid[data-kind='artist'] {
      grid-template-columns: repeat(auto-fill, minmax(min(110px, 100%), 1fr));
    }
  }
</style>
