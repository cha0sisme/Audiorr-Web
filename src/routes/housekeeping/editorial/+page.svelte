<script lang="ts">
  /**
   * /housekeeping/editorial — biblioteca de playlists.
   *
   * Aquí gestionas qué playlists son "editoriales" (destacadas) y cómo se
   * ven sus portadas. La pestaña "Portada" consume estas decisiones para
   * componer la home (las editoriales son las que se pueden añadir a las
   * filas dynamic del homepage_layout).
   *
   * Funcionalidades:
   *   - Búsqueda por nombre o autor (debounce).
   *   - Filtros segmented: Todas / Destacadas / Spotify / Sin destacar.
   *   - Cada item: cover thumb + nombre + owner + badges (Spotify, This Is).
   *   - Toggle Editorial inline.
   *   - Cover picker visual con miniaturas (5 estilos) — solo cuando es
   *     Editorial.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    MagnifyingGlass,
    SpotifyLogo,
    UserCircle,
    X,
    CaretDown,
    Plus,
    ArrowRight,
    Check
  } from 'phosphor-svelte';
  import * as nav from '$services/NavidromeService';
  import {
    getThisIsMapping,
    setThisIsMapping as persistThisIsMapping
  } from '$services/globalSettings';
  import { isDailyMixName, isSmartPlaylistName } from '$utils/playlist-section-mappers';
  import { getPlaylistCoverUrl } from '$services/dailyMixes';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { NavidromePlaylist } from '$types/navidrome';
  import type { ThisIsMapping } from '$services/globalSettings';

  const queryClient = useQueryClient();

  // ─── Carga ──────────────────────────────────────────────────────────────
  const playlistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));
  const thisIsQ = createQuery(() => ({
    queryKey: ['thisIsMapping'],
    queryFn: () => getThisIsMapping(),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const isLoading = $derived(playlistsQ.isPending || thisIsQ.isPending);

  // ─── Mutations ──────────────────────────────────────────────────────────
  async function updateComment(playlist: NavidromePlaylist, newComment: string) {
    try {
      await nav.updatePlaylist(playlist.id, { comment: newComment });
      queryClient.setQueryData<NavidromePlaylist[]>(['library', 'playlists'], (old) =>
        (old ?? []).map((p) => (p.id === playlist.id ? { ...p, comment: newComment } : p))
      );
    } catch (err) {
      toasts.error(
        'No se ha podido aplicar el cambio',
        err instanceof Error ? err.message : 'Algo ha ido mal en el servidor'
      );
    }
  }

  async function handleToggleEditorial(p: NavidromePlaylist) {
    const cur = p.comment ?? '';
    const isEd = cur.includes('[Editorial]');
    const next = isEd
      ? cur.replace('[Editorial]', '').trim()
      : cur ? `${cur}\n[Editorial]` : '[Editorial]';
    await updateComment(p, next);
  }

  type CoverType = 'default' | 'classic' | 'headline' | 'graphic' | 'artist-gradient';
  const COVER_OPTIONS: { value: CoverType; label: string }[] = [
    { value: 'default',         label: 'Auto'      },
    { value: 'classic',         label: 'Clásica'   },
    { value: 'headline',        label: 'Headline'  },
    { value: 'graphic',         label: 'Gráfica'   },
    { value: 'artist-gradient', label: 'Gradiente' }
  ];

  function getCoverType(p: NavidromePlaylist): CoverType {
    const m = (p.comment ?? '').match(/\[Cover:([a-zA-Z-]+)\]/i);
    return ((m?.[1]?.toLowerCase() ?? 'default') as CoverType) || 'default';
  }

  async function handleChangeCover(p: NavidromePlaylist, coverType: CoverType) {
    let next = (p.comment ?? '').replace(/\[Cover:[a-zA-Z-]+\]/gi, '').trim();
    if (coverType !== 'default') {
      next = next ? `${next}\n[Cover:${coverType}]` : `[Cover:${coverType}]`;
    }
    await updateComment(p, next);
  }

  // ─── Filtros ───────────────────────────────────────────────────────────
  type LibraryFilter = 'all' | 'editorial' | 'spotify' | 'unmarked';
  let libraryFilter = $state<LibraryFilter>('all');
  let librarySearch = $state('');

  const allPlaylists = $derived(playlistsQ.data ?? []);
  const thisIs = $derived(thisIsQ.data ?? {});

  function isSpotifySynced(p: NavidromePlaylist): boolean {
    return p.name.startsWith('[Spotify] ') || (p.comment ?? '').includes('Spotify Synced');
  }
  function isEditorial(p: NavidromePlaylist): boolean {
    return (p.comment ?? '').includes('[Editorial]');
  }

  const catalog = $derived(
    allPlaylists.filter((p) => !isDailyMixName(p) && !isSmartPlaylistName(p))
  );
  const counts = $derived({
    all: catalog.length,
    editorial: catalog.filter(isEditorial).length,
    spotify: catalog.filter(isSpotifySynced).length,
    unmarked: catalog.filter((p) => !isEditorial(p) && !isSpotifySynced(p)).length
  });
  const visiblePlaylists = $derived.by(() => {
    let list = catalog;
    if (libraryFilter === 'editorial') list = list.filter(isEditorial);
    else if (libraryFilter === 'spotify') list = list.filter(isSpotifySynced);
    else if (libraryFilter === 'unmarked')
      list = list.filter((p) => !isEditorial(p) && !isSpotifySynced(p));

    const q = librarySearch.trim().toLowerCase();
    if (q.length > 0) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.owner ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  });

  // ════════════════════════════════════════════════════════════════════
  // ─── This Is panel — mapping playlist → nombre artista ──────────────
  // ════════════════════════════════════════════════════════════════════
  // El backend usa `this_is_playlists` (ya cargado en thisIsQ) para que el
  // cover service sepa cómo renderizar las playlists tipo "This Is …" —
  // priorizando el artista del nombre aunque la primera canción sea de
  // otro (ej. "This Is Bad Bunny" cuya primera canción es de Tainy).
  let thisIsSelectedId = $state<string>('');
  let thisIsSelectedSearch = $state('');
  let thisIsArtist = $state('');
  let thisIsPickerOpen = $state(false);
  let thisIsSaving = $state(false);
  let thisIsJustSaved = $state(false);

  /** Map id → playlist (compartido por This Is panel). */
  const playlistsById = $derived.by(() => {
    const m = new Map<string, NavidromePlaylist>();
    for (const p of allPlaylists) m.set(p.id, p);
    return m;
  });

  /** Playlists candidatas para vincular: las editoriales + las Spotify-synced
      (que típicamente son las "This Is …" importadas). Ya excluyen daily +
      smart por el filter del catalog. */
  const thisIsCandidates = $derived(
    catalog.filter((p) => isEditorial(p) || isSpotifySynced(p))
  );

  const thisIsCandidatesFiltered = $derived.by(() => {
    const q = thisIsSelectedSearch.trim().toLowerCase();
    if (!q) return thisIsCandidates.slice(0, 30);
    return thisIsCandidates.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 30);
  });

  const thisIsSelectedPlaylist = $derived(
    thisIsSelectedId ? playlistsById.get(thisIsSelectedId) : undefined
  );

  /** Sugerencia automática del nombre del artista: si la playlist se llama
      "This Is X" o "[Spotify] This Is X", proponemos X. El usuario puede
      sobreescribir o vaciar (si vacío, el backend lo extrae solo). */
  const thisIsSuggestion = $derived.by(() => {
    if (!thisIsSelectedPlaylist) return '';
    const name = thisIsSelectedPlaylist.name.replace(/^\[spotify\]\s*/i, '').trim();
    const m = name.match(/^this is (.+)$/i);
    return m?.[1]?.trim() ?? '';
  });

  /** Si la playlist seleccionada cambia y la suggestion existe, autorrellena.
      Solo si el usuario no ha tipeado nada todavía. */
  $effect(() => {
    if (thisIsSuggestion && !thisIsArtist) {
      thisIsArtist = thisIsSuggestion;
    }
  });

  function thisIsResetForm() {
    thisIsSelectedId = '';
    thisIsSelectedSearch = '';
    thisIsArtist = '';
    thisIsPickerOpen = false;
  }

  // Click-outside del picker dropdown.
  $effect(() => {
    if (!thisIsPickerOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('[data-thisis-picker]')) return;
      thisIsPickerOpen = false;
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  });

  async function thisIsAdd() {
    if (!thisIsSelectedId || thisIsSaving) return;
    thisIsSaving = true;
    try {
      const next: ThisIsMapping = {
        ...(thisIsQ.data ?? {}),
        [thisIsSelectedId]: thisIsArtist.trim()
      };
      await persistThisIsMapping(next);
      queryClient.setQueryData(['thisIsMapping'], next);
      thisIsJustSaved = true;
      setTimeout(() => (thisIsJustSaved = false), 1800);
      thisIsResetForm();
    } catch (err) {
      toasts.error(
        'No se ha podido asociar',
        err instanceof Error ? err.message : 'Algo ha ido mal en el servidor'
      );
    } finally {
      thisIsSaving = false;
    }
  }

  async function thisIsRemove(playlistId: string) {
    const cur = thisIsQ.data ?? {};
    const next: ThisIsMapping = { ...cur };
    delete next[playlistId];
    try {
      await persistThisIsMapping(next);
      queryClient.setQueryData(['thisIsMapping'], next);
    } catch (err) {
      toasts.error(
        'No se ha podido eliminar',
        err instanceof Error ? err.message : 'Algo ha ido mal en el servidor'
      );
    }
  }

  const thisIsEntries = $derived(Object.entries(thisIsQ.data ?? {}));
</script>

<svelte:head>
  <title>Editorial · Housekeeping</title>
</svelte:head>

{#if isLoading}
  <div class="hk-loading">
    <div class="hk-sk"></div>
  </div>
{:else}
  <section class="hk-card">
    <header class="hk-section-head">
      <h2>Tu biblioteca</h2>
      <p>Marca lo que merece destacar y elige cómo se ve su portada. Las que destaques aquí podrás añadirlas a las filas dynamic en la pestaña Portada.</p>
    </header>

    <!-- Búsqueda + filtros -->
    <div class="hk-tools">
      <label class="hk-search">
        <MagnifyingGlass size={14} weight="bold" />
        <input
          type="search"
          placeholder="Buscar por nombre o autor"
          value={librarySearch}
          oninput={(e) => (librarySearch = e.currentTarget.value)}
        />
        {#if librarySearch.length > 0}
          <button
            type="button"
            class="hk-search-clear"
            onclick={() => (librarySearch = '')}
            aria-label="Limpiar búsqueda"
          >
            <X size={11} weight="bold" />
          </button>
        {/if}
      </label>

      <div class="hk-filter-chips" role="radiogroup" aria-label="Filtro de biblioteca">
        {#each [
          { v: 'all',       l: 'Todas',         n: counts.all       },
          { v: 'editorial', l: 'Destacadas',    n: counts.editorial },
          { v: 'spotify',   l: 'Spotify',       n: counts.spotify   },
          { v: 'unmarked',  l: 'Sin destacar',  n: counts.unmarked  }
        ] as opt (opt.v)}
          <button
            type="button"
            class="hk-filter-chip"
            class:active={libraryFilter === opt.v}
            role="radio"
            aria-checked={libraryFilter === opt.v}
            onclick={() => (libraryFilter = opt.v as LibraryFilter)}
          >
            {opt.l}
            <span class="hk-filter-count">{opt.n}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Lista -->
    <ul class="hk-library-list">
      {#if visiblePlaylists.length === 0}
        <li class="hk-library-empty">
          {#if librarySearch.trim().length > 0}
            No hay playlists que coincidan con <strong>"{librarySearch}"</strong>.
          {:else if libraryFilter === 'editorial'}
            Aún no destacas ninguna playlist. Marca alguna abajo y reaparecerá aquí.
          {:else if libraryFilter === 'spotify'}
            No hay playlists sincronizadas desde Spotify.
          {:else}
            No hay playlists en este filtro.
          {/if}
        </li>
      {:else}
        {#each visiblePlaylists as p (p.id)}
          {@const isEd = isEditorial(p)}
          {@const isSpot = isSpotifySynced(p)}
          {@const tIsArtist = thisIs[p.id]}
          {@const coverType = getCoverType(p)}
          <li class="hk-lib-item" class:editorial={isEd}>
            <div class="hk-lib-item-row">
              <span class="hk-lib-item-cover">
                <img src={getPlaylistCoverUrl(p.id)} alt="" loading="lazy" />
              </span>

              <div class="hk-lib-item-meta">
                <div class="hk-lib-item-title-row">
                  <span class="hk-lib-item-name">{p.name}</span>
                  {#if isSpot}
                    <span class="hk-mini-badge spotify" title="Sincronizada desde Spotify">
                      <SpotifyLogo size={10} weight="fill" />
                    </span>
                  {/if}
                  {#if tIsArtist}
                    <span class="hk-mini-badge thisis" title={`This is ${tIsArtist}`}>
                      <UserCircle size={10} weight="fill" />
                    </span>
                  {/if}
                </div>
                <p class="hk-lib-item-sub">
                  {#if p.owner}Por {p.owner}{:else}Sin propietario{/if}
                </p>
              </div>

              <button
                type="button"
                class="hk-toggle"
                class:on={isEd}
                role="switch"
                aria-checked={isEd}
                aria-label={isEd ? 'Quitar de Editorial' : 'Marcar como Editorial'}
                onclick={() => handleToggleEditorial(p)}
              >
                <span class="hk-toggle-track" aria-hidden="true">
                  <span class="hk-toggle-thumb"></span>
                </span>
              </button>
            </div>

            {#if isEd}
              <div class="hk-cover-picker" role="radiogroup" aria-label="Estilo de portada">
                {#each COVER_OPTIONS as opt (opt.value)}
                  <button
                    type="button"
                    class="hk-cover-option"
                    class:active={coverType === opt.value}
                    role="radio"
                    aria-checked={coverType === opt.value}
                    onclick={() => handleChangeCover(p, opt.value)}
                  >
                    <span class="hk-cover-preview" data-style={opt.value}></span>
                    <span class="hk-cover-label">{opt.label}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      {/if}
    </ul>
  </section>

  <!-- ════════════════════════════════════════════════════════════════════
       Páginas «This is …» — mapping playlist → nombre artista
       ════════════════════════════════════════════════════════════════════ -->
  <section class="hk-card">
    <header class="hk-section-head">
      <h2>Páginas «This Is …»</h2>
      <p>Asocia una playlist con un artista para que su portada lo represente correctamente, aunque la primera canción sea de otro nombre.</p>
    </header>

    <!-- Lista de mappings actuales -->
    {#if thisIsEntries.length > 0}
      <ul class="hk-thisis-list">
        {#each thisIsEntries as [pid, artist] (pid)}
          {@const pl = playlistsById.get(pid)}
          <li class="hk-thisis-row">
            <span class="hk-lib-item-cover">
              {#if pl}
                <img src={getPlaylistCoverUrl(pid)} alt="" loading="lazy" />
              {:else}
                <span class="hk-thisis-cover-fallback" aria-hidden="true">
                  <UserCircle size={14} weight="fill" />
                </span>
              {/if}
            </span>
            <div class="hk-thisis-meta">
              <span class="hk-thisis-playlist-name">{pl?.name ?? pid}</span>
              <span class="hk-thisis-link">
                <ArrowRight size={11} weight="bold" />
                <strong>{artist || '(auto desde el nombre)'}</strong>
              </span>
            </div>
            <button
              type="button"
              class="hk-thisis-remove"
              onclick={() => thisIsRemove(pid)}
              aria-label="Quitar asociación"
              title="Quitar asociación"
            >
              <X size={12} weight="bold" />
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hk-thisis-empty">
        Aún no has asociado ninguna playlist con un artista. Añade tu primera asociación abajo ↓
      </p>
    {/if}

    <!-- Form de añadir nuevo -->
    <div class="hk-thisis-form">
      <span class="hk-block-label">Añadir asociación</span>

      <!-- Picker de playlist (custom dropdown con search) -->
      <div class="hk-thisis-field">
        <label class="hk-thisis-field-label" for="thisis-playlist">Playlist</label>
        <div class="hk-thisis-picker" data-thisis-picker>
          <button
            id="thisis-playlist"
            type="button"
            class="hk-thisis-picker-trigger"
            aria-haspopup="listbox"
            aria-expanded={thisIsPickerOpen}
            onclick={() => (thisIsPickerOpen = !thisIsPickerOpen)}
          >
            {#if thisIsSelectedPlaylist}
              <span class="hk-thisis-picker-cover">
                <img src={getPlaylistCoverUrl(thisIsSelectedPlaylist.id)} alt="" loading="lazy" />
              </span>
              <span class="hk-thisis-picker-name">{thisIsSelectedPlaylist.name}</span>
            {:else}
              <span class="hk-thisis-picker-placeholder">Elige una playlist…</span>
            {/if}
            <CaretDown size={12} weight="bold" />
          </button>

          {#if thisIsPickerOpen}
            <div class="hk-thisis-dropdown" role="listbox">
              <div class="hk-thisis-search">
                <MagnifyingGlass size={12} weight="bold" />
                <input
                  type="text"
                  placeholder="Buscar entre tus destacadas y Spotify…"
                  value={thisIsSelectedSearch}
                  oninput={(e) => (thisIsSelectedSearch = e.currentTarget.value)}
                />
              </div>
              {#if thisIsCandidatesFiltered.length === 0}
                <p class="hk-thisis-dropdown-empty">
                  {#if thisIsCandidates.length === 0}
                    Marca alguna playlist como Editorial arriba primero.
                  {:else}
                    Nada coincide con la búsqueda.
                  {/if}
                </p>
              {:else}
                <ul>
                  {#each thisIsCandidatesFiltered as p (p.id)}
                    <li>
                      <button
                        type="button"
                        class="hk-thisis-option"
                        role="option"
                        aria-selected={thisIsSelectedId === p.id}
                        onclick={() => {
                          thisIsSelectedId = p.id;
                          thisIsArtist = '';
                          thisIsPickerOpen = false;
                        }}
                      >
                        <span class="hk-thisis-picker-cover">
                          <img src={getPlaylistCoverUrl(p.id)} alt="" loading="lazy" />
                        </span>
                        <span class="hk-thisis-option-name">{p.name}</span>
                        {#if isEditorial(p)}
                          <span class="hk-thisis-option-tag">Editorial</span>
                        {:else if isSpotifySynced(p)}
                          <span class="hk-thisis-option-tag spotify">Spotify</span>
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      </div>

      <!-- Input artista -->
      <div class="hk-thisis-field">
        <label class="hk-thisis-field-label" for="thisis-artist">
          Nombre del artista
          <span class="hk-thisis-field-hint">opcional</span>
        </label>
        <input
          id="thisis-artist"
          type="text"
          class="hk-thisis-input"
          placeholder={thisIsSuggestion ? `Detectado: ${thisIsSuggestion}` : 'Ej. Bad Bunny'}
          value={thisIsArtist}
          oninput={(e) => (thisIsArtist = e.currentTarget.value)}
          disabled={!thisIsSelectedId}
        />
        <p class="hk-thisis-help">
          Si lo dejas vacío, lo extraemos automáticamente del nombre de la playlist.
        </p>
      </div>

      <div class="hk-thisis-actions">
        {#if thisIsJustSaved}
          <span class="hk-thisis-saved">
            <Check size={12} weight="bold" /> Asociado
          </span>
        {/if}
        <button
          type="button"
          class="hk-btn-soft"
          onclick={thisIsResetForm}
          disabled={!thisIsSelectedId || thisIsSaving}
        >
          Limpiar
        </button>
        <button
          type="button"
          class="hk-btn-primary"
          onclick={thisIsAdd}
          disabled={!thisIsSelectedId || thisIsSaving}
        >
          {#if thisIsSaving}
            Asociando…
          {:else}
            <Plus size={12} weight="bold" /> Asociar
          {/if}
        </button>
      </div>
    </div>
  </section>
{/if}

<style>
  /* ============================================================================
     === Glass card ===
     ============================================================================ */
  .hk-card {
    position: relative;
    padding: var(--hk-card-padding);
    background: var(--hk-card-bg);
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: var(--hk-card-radius);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .hk-section-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hk-section-head h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .hk-section-head p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.55;
    max-width: 70ch;
  }

  /* ============================================================================
     === Tools: search + filter chips ===
     ============================================================================ */
  .hk-tools {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .hk-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 12px;
    color: var(--text-secondary);
    transition:
      border-color 200ms var(--hk-spring-soft),
      background 200ms var(--hk-spring-soft);
  }
  .hk-search:focus-within {
    border-color: var(--accent);
    background: var(--bg-surface);
  }
  .hk-search input {
    flex: 1;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }
  .hk-search input::-webkit-search-cancel-button { display: none; }
  .hk-search input::placeholder { color: var(--text-tertiary); }
  .hk-search-clear {
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 999px;
    background: var(--hk-handle-bg);
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .hk-search-clear:hover { color: var(--text-primary); }

  .hk-filter-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .hk-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 11px;
    background: var(--bg-canvas);
    border: 0;
    border-radius: 999px;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
    transition:
      background 200ms var(--hk-spring-soft),
      color 200ms var(--hk-spring-soft);
  }
  .hk-filter-chip:hover:not(.active) {
    color: var(--text-primary);
    background: var(--bg-surface);
  }
  .hk-filter-chip.active {
    background: var(--accent);
    color: #fff;
  }
  .hk-filter-count {
    padding: 1px 6px;
    background: color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 999px;
    font-family: 'Söhne Mono', var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .hk-filter-chip:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ============================================================================
     === Library list ===
     ============================================================================ */
  .hk-library-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 720px;
    overflow-y: auto;
    padding-right: 4px;
  }
  .hk-library-empty {
    padding: var(--space-4);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    text-align: center;
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .hk-library-empty strong {
    color: var(--text-secondary);
    font-weight: 600;
  }

  .hk-lib-item {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    background: var(--hk-tile-bg);
    border-radius: 12px;
    transition: background 180ms var(--hk-spring-soft);
  }
  .hk-lib-item:hover { background: var(--bg-surface); }
  .hk-lib-item.editorial {
    background: color-mix(in srgb, var(--accent) 10%, var(--hk-tile-bg));
  }

  .hk-lib-item-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .hk-lib-item-cover {
    width: 36px;
    height: 36px;
    border-radius: 7px;
    overflow: hidden;
    background: var(--bg-canvas);
    flex-shrink: 0;
  }
  .hk-lib-item-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .hk-lib-item-meta { min-width: 0; }
  .hk-lib-item-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .hk-lib-item-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
    min-width: 0;
  }
  .hk-mini-badge {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .hk-mini-badge.spotify {
    background: #1db954;
    color: #fff;
  }
  .hk-mini-badge.thisis {
    background: var(--accent);
    color: #fff;
  }
  .hk-lib-item-sub {
    margin: 1px 0 0;
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* === Toggle === */
  .hk-toggle {
    display: inline-flex;
    align-items: center;
    padding: 4px;
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
  }
  .hk-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .hk-toggle-track {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
    border-radius: 999px;
    background: var(--hk-toggle-track-off);
    transition: background 320ms var(--hk-spring);
    flex-shrink: 0;
  }
  .hk-toggle.on .hk-toggle-track {
    background: var(--hk-toggle-track-on);
  }
  .hk-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--hk-toggle-thumb);
    transition: transform 380ms var(--hk-spring);
  }
  .hk-toggle.on .hk-toggle-thumb {
    transform: translateX(16px);
  }

  /* === Cover picker visual === */
  .hk-cover-picker {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-left: 46px;
  }
  .hk-cover-option {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 4px;
    background: transparent;
    border: 1.5px solid transparent;
    border-radius: 8px;
    cursor: pointer;
    transition:
      border-color 180ms var(--hk-spring-soft),
      background 180ms var(--hk-spring-soft);
  }
  .hk-cover-option:hover:not(.active) {
    background: var(--bg-surface);
    border-color: color-mix(in srgb, var(--border-subtle) 70%, transparent);
  }
  .hk-cover-option.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .hk-cover-option:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .hk-cover-preview {
    width: 28px;
    height: 28px;
    border-radius: 5px;
    overflow: hidden;
  }
  .hk-cover-preview[data-style='default'] {
    background: var(--bg-glass);
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
  }
  .hk-cover-preview[data-style='default']::after {
    content: '✦';
    font-size: 14px;
  }
  .hk-cover-preview[data-style='classic'] {
    background:
      linear-gradient(180deg, transparent 60%, rgb(0 0 0 / 0.4) 100%),
      linear-gradient(135deg, oklch(0.55 0.15 260), oklch(0.4 0.18 280));
  }
  .hk-cover-preview[data-style='headline'] {
    background:
      linear-gradient(180deg, transparent 50%, rgb(0 0 0 / 0.5) 100%),
      oklch(0.4 0.18 25);
    position: relative;
  }
  .hk-cover-preview[data-style='headline']::before {
    content: '';
    position: absolute;
    bottom: 4px;
    left: 4px;
    right: 4px;
    height: 5px;
    background: white;
    border-radius: 1px;
  }
  .hk-cover-preview[data-style='graphic'] {
    background:
      radial-gradient(circle at 70% 30%, oklch(0.7 0.2 80) 0%, transparent 50%),
      radial-gradient(circle at 20% 80%, oklch(0.5 0.18 200) 0%, transparent 60%),
      oklch(0.25 0.05 280);
  }
  .hk-cover-preview[data-style='artist-gradient'] {
    background: linear-gradient(135deg, oklch(0.55 0.2 320), oklch(0.7 0.18 30), oklch(0.55 0.18 200));
  }
  .hk-cover-label {
    font-size: 9px;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.02em;
  }
  .hk-cover-option.active .hk-cover-label {
    color: var(--accent);
  }

  /* ============================================================================
     === Loading ===
     ============================================================================ */
  .hk-loading { padding: 0; }
  .hk-sk {
    height: 480px;
    background: var(--bg-surface);
    border-radius: var(--hk-card-radius);
    animation: hk-pulse 1.6s ease-in-out infinite;
  }
  @keyframes hk-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  @media (max-width: 640px) {
    .hk-cover-picker { padding-left: 0; }
  }

  /* ============================================================================
     === This Is panel ===
     ============================================================================ */
  .hk-thisis-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hk-thisis-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--hk-tile-bg);
    border-radius: 12px;
    transition: background 200ms var(--hk-spring-soft);
  }
  .hk-thisis-row:hover { background: var(--bg-surface); }
  .hk-thisis-cover-fallback {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
  }
  .hk-thisis-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hk-thisis-playlist-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }
  .hk-thisis-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .hk-thisis-link strong {
    color: var(--accent);
    font-weight: 600;
  }
  .hk-thisis-remove {
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background 160ms var(--hk-spring-soft),
      color 160ms var(--hk-spring-soft);
  }
  .hk-thisis-remove:hover {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    color: var(--status-danger);
  }
  .hk-thisis-remove:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-thisis-empty {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 12px;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    text-align: center;
  }

  /* === Form de añadir === */
  .hk-thisis-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--hk-tile-bg);
    border-radius: 14px;
  }
  .hk-block-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .hk-thisis-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hk-thisis-field-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
  }
  .hk-thisis-field-hint {
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: 400;
    text-transform: lowercase;
  }

  /* Picker — trigger pill + dropdown absolute */
  .hk-thisis-picker {
    position: relative;
  }
  .hk-thisis-picker-trigger {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 12px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 200ms var(--hk-spring-soft),
      background 200ms var(--hk-spring-soft);
  }
  .hk-thisis-picker-trigger:hover { background: var(--bg-surface); }
  .hk-thisis-picker-trigger[aria-expanded='true'] {
    border-color: var(--accent);
    background: var(--bg-surface);
  }
  .hk-thisis-picker-trigger:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .hk-thisis-picker-cover {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--bg-canvas);
    flex-shrink: 0;
  }
  .hk-thisis-picker-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hk-thisis-picker-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .hk-thisis-picker-placeholder {
    flex: 1;
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .hk-thisis-picker-trigger > :global(svg:last-child) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .hk-thisis-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    z-index: 50;
    max-height: 360px;
    overflow-y: auto;
    padding: 6px;
    background: var(--bg-surface-elevated);
    border-radius: 12px;
    box-shadow: 0 14px 32px -12px rgba(0, 0, 0, 0.35), 0 4px 10px -4px rgba(0, 0, 0, 0.2);
    animation: hk-picker-in 200ms var(--hk-spring);
  }
  @keyframes hk-picker-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .hk-thisis-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent);
    border-radius: 8px;
    margin-bottom: 4px;
    color: var(--text-tertiary);
  }
  .hk-thisis-search input {
    flex: 1;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .hk-thisis-search input::placeholder { color: var(--text-tertiary); }

  .hk-thisis-dropdown ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .hk-thisis-dropdown-empty {
    margin: 0;
    padding: 12px 10px;
    text-align: center;
    color: var(--text-tertiary);
    font-size: 12px;
  }
  .hk-thisis-option {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--text-primary);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 140ms var(--hk-spring-soft);
  }
  .hk-thisis-option:hover { background: var(--bg-surface-hover); }
  .hk-thisis-option[aria-selected='true'] {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .hk-thisis-option-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .hk-thisis-option-tag {
    padding: 1px 8px;
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    color: var(--accent);
    border-radius: 999px;
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .hk-thisis-option-tag.spotify {
    background: color-mix(in srgb, #1db954 16%, transparent);
    color: #1db954;
  }

  /* === Input artista === */
  .hk-thisis-input {
    padding: 9px 12px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 12px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
    transition: border-color 200ms var(--hk-spring-soft);
  }
  .hk-thisis-input:hover:not(:disabled) { border-color: var(--border-subtle); }
  .hk-thisis-input:focus { border-color: var(--accent); background: var(--bg-surface); }
  .hk-thisis-input::placeholder { color: var(--text-tertiary); }
  .hk-thisis-input:disabled {
    background: transparent;
    color: var(--text-tertiary);
    cursor: not-allowed;
  }
  .hk-thisis-help {
    margin: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  /* === Actions === */
  .hk-thisis-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    justify-content: flex-end;
    flex-wrap: wrap;
    padding-top: 4px;
  }
  .hk-thisis-saved {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: auto;
    padding: 4px 10px;
    background: color-mix(in srgb, oklch(0.72 0.18 145) 18%, transparent);
    border-radius: 999px;
    color: oklch(0.72 0.18 145);
    font-size: 11px;
    font-weight: 600;
  }

  .hk-btn-soft {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-glass-thin);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 0;
    border-radius: 999px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background 200ms var(--hk-spring-soft);
  }
  .hk-btn-soft:hover:not(:disabled) { background: var(--bg-glass); }
  .hk-btn-soft:disabled { opacity: 0.45; cursor: not-allowed; }
  .hk-btn-soft:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    background: var(--accent);
    border: 0;
    border-radius: 999px;
    color: #fff;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 200ms var(--hk-spring),
      filter 200ms var(--hk-spring-soft);
  }
  .hk-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  .hk-btn-primary:active:not(:disabled) { transform: scale(0.97); }
  .hk-btn-primary:disabled { opacity: 0.42; cursor: not-allowed; }
  .hk-btn-primary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
