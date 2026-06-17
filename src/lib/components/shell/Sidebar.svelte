<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { tick } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import {
    House, MagnifyingGlass, VinylRecord, Star,
    ListPlus, UsersThree, X, SidebarSimple, CaretUp
  } from 'phosphor-svelte';
  import Logo from '$components/shared/Logo.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import UserMenu from '$components/shell/UserMenu.svelte';
  import LiveListeners from '$components/shell/LiveListeners.svelte';
  import BrandWord from '$components/shell/BrandWord.svelte';
  import * as user from '$services/user';
  import { getPlaylistCoverUrl } from '$services/dailyMixes';
  import { credentials } from '$stores/credentials.svelte';
  import { sidebarUI } from '$stores/sidebar-ui.svelte';
  import { tooltip } from '$lib/actions/tooltip';

  const collapsed = $derived(sidebarUI.collapsed);

  /** Categorías de navegación. Cada ruta cae en una; cada nav item declara
      la suya. Un solo highlight a la vez sin ambigüedad. */
  type NavCategory =
    | 'home'
    | 'library'
    | 'playlists'
    | 'artists'
    | 'favorites'
    | null;

  type NavItem = {
    href: string;
    label: string;
    Icon: typeof House;
    category: NavCategory;
  };

  const mainNav: NavItem[] = [
    { href: '/', label: 'Inicio', Icon: House, category: 'home' },
    { href: '/library', label: 'Tu librería', Icon: VinylRecord, category: 'library' },
    { href: '/favorites', label: 'Favoritos', Icon: Star, category: 'favorites' }
  ];

  const libraryNav: NavItem[] = [
    { href: '/library?tab=playlists', label: 'Playlists', Icon: ListPlus, category: 'playlists' },
    { href: '/library?tab=artists', label: 'Artistas', Icon: UsersThree, category: 'artists' }
  ];

  /** Mapea la URL actual a una categoría única. Centraliza las reglas de
      "qué nav item se highlightea cuando estamos en X ruta". */
  function categorize(pathname: string, search: URLSearchParams): NavCategory {
    if (pathname === '/') return 'home';

    // Detail views — la categoría sigue al tipo de entidad
    if (pathname.startsWith('/album/')) return 'library';
    if (pathname.startsWith('/playlist/')) return 'playlists';
    if (pathname.startsWith('/artist/')) return 'artists';

    if (pathname.startsWith('/favorites')) return 'favorites';

    if (pathname === '/library') {
      const tab = search.get('tab');
      if (tab === 'playlists') return 'playlists';
      if (tab === 'artists') return 'artists';
      return 'library'; // tab=albums o sin tab
    }

    if (pathname.startsWith('/library/')) {
      // Legacy see-all routes: /library/recent, /library/most-played, etc.
      // (todas son listas de álbumes excepto playlists/artists explícitos)
      if (pathname === '/library/playlists' || pathname.startsWith('/library/playlists/')) {
        return 'playlists';
      }
      if (pathname === '/library/artists' || pathname.startsWith('/library/artists/')) {
        return 'artists';
      }
      return 'library';
    }

    return null;
  }

  const currentCategory = $derived(
    categorize(page.url.pathname, page.url.searchParams)
  );

  function isActive(item: NavItem): boolean {
    return item.category !== null && item.category === currentCategory;
  }

  // ==========================================================================
  // Search input (inline en sidebar, navega a /search debounced)
  // ==========================================================================
  const SEARCH_DEBOUNCE_MS = 250;
  let searchValue = $state('');
  let searchInputEl: HTMLInputElement | undefined = $state();
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Sincroniza desde URL ?q solo si el usuario NO está editando el input.
  // Mantiene el valor "pegado" cuando entras a /search?q=foo desde fuera,
  // y lo limpia al navegar a otras rutas.
  $effect(() => {
    const isOnSearch = page.url.pathname === '/search';
    const fromUrl = isOnSearch ? (page.url.searchParams.get('q') ?? '') : '';
    if (typeof document !== 'undefined' && document.activeElement === searchInputEl) {
      return;
    }
    searchValue = fromUrl;
  });

  function handleSearchInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    searchValue = v;

    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      const trimmed = v.trim();
      const url = new URL('/search', window.location.origin);
      if (trimmed) url.searchParams.set('q', trimmed);

      // replaceState solo si ya estamos en /search (evita spamear el history
      // con cada keystroke). Si venimos de otra ruta, push para que el
      // back-button vuelva a la página anterior.
      const replaceState = page.url.pathname === '/search';
      goto(url, { replaceState, keepFocus: true, noScroll: true });
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (searchValue) {
        clearSearch();
      } else {
        searchInputEl?.blur();
      }
    }
  }

  function clearSearch() {
    searchValue = '';
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (page.url.pathname === '/search') {
      goto('/search', { replaceState: true, keepFocus: true, noScroll: true });
    }
    searchInputEl?.focus();
  }

  // Search en modo colapsado: el <input> vive solo en el layout expandido, así
  // que en colapsado no hay dónde escribir. Click → expandimos el sidebar y,
  // tras el re-render que monta el input, le damos foco. Tras teclear, el
  // debounce de handleSearchInput navega a /search igual que en expandido.
  async function expandAndFocusSearch() {
    if (sidebarUI.collapsed) {
      sidebarUI.set(false);
      await tick();
    }
    searchInputEl?.focus();
    searchInputEl?.select();
  }

  // ==========================================================================
  // Pinned Playlists — sincronizadas con backend Audiorr.
  // Lista compacta debajo de las navs. Si no hay pinned, la sección se omite.
  // ==========================================================================
  const pinnedQ = createQuery(() => ({
    queryKey: ['pinnedPlaylists', credentials.current?.username ?? ''],
    queryFn: () => user.getPinnedPlaylists(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
  const pinnedPlaylists = $derived(pinnedQ.data ?? []);

  // Límite de pinned visibles. Si hay más, se muestran las primeras + un toggle
  // "+N más" que expande el resto (morph grid-rows). Colapsado muestra menos
  // (el rail es estrecho). Estado en sidebarUI (ephemeral por sesión).
  const PINNED_LIMIT_EXPANDED = 6;
  const PINNED_LIMIT_COLLAPSED = 5;
  const pinnedLimit = $derived(collapsed ? PINNED_LIMIT_COLLAPSED : PINNED_LIMIT_EXPANDED);
  const pinnedOverflow = $derived(Math.max(0, pinnedPlaylists.length - pinnedLimit));
  const pinnedFirst = $derived(pinnedPlaylists.slice(0, pinnedLimit));
  const pinnedRest = $derived(pinnedPlaylists.slice(pinnedLimit));
  const pinnedExpanded = $derived(sidebarUI.pinnedExpanded);

  // Atajo global ⌘K / Ctrl+K / "/" → focus al input. Esto vive en el sidebar
  // porque es el dueño del input — el layout NO lo gestiona, evitando un
  // detour por context o store global solo para el focus.
  $effect(() => {
    if (typeof document === 'undefined') return;
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const isSlash =
        e.key === '/' &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement);
      if (isCmdK || isSlash) {
        e.preventDefault();
        searchInputEl?.focus();
        searchInputEl?.select();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
</script>

<aside class="sidebar" class:collapsed>
  <div class="brand-row">
    <a href="/" class="brand-icon" aria-label="Audiorr — Inicio" use:tooltip={collapsed ? 'Inicio' : ''}>
      <Logo size={32} />
    </a>
    {#if !collapsed}
      <BrandWord />
    {/if}
    <button
      type="button"
      class="collapse-toggle"
      onclick={() => sidebarUI.toggle()}
      aria-label={collapsed ? 'Expandir sidebar' : 'Contraer sidebar'}
      aria-pressed={collapsed}
      use:tooltip={collapsed ? 'Expandir' : 'Contraer'}
    >
      <SidebarSimple size={18} weight="regular" />
    </button>
  </div>

  {#if collapsed}
    <button
      type="button"
      class="search-collapsed"
      class:active={page.url.pathname === '/search'}
      aria-label="Buscar"
      onclick={expandAndFocusSearch}
      use:tooltip={'Buscar'}
    >
      <MagnifyingGlass size={20} weight="regular" />
    </button>
  {:else}
    <div class="search" class:active={page.url.pathname === '/search'}>
      <span class="search-icon" aria-hidden="true">
        <MagnifyingGlass size={18} weight="regular" />
      </span>
      <input
        bind:this={searchInputEl}
        type="search"
        value={searchValue}
        oninput={handleSearchInput}
        onkeydown={handleSearchKeydown}
        placeholder="Buscar"
        aria-label="Buscar artistas, álbumes, playlists"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
      />
      {#if searchValue}
        <button
          type="button"
          class="clear-btn"
          onclick={clearSearch}
          aria-label="Limpiar búsqueda"
          tabindex="-1"
        >
          <X size={12} weight="bold" />
        </button>
      {:else}
        <kbd class="kbd">⌘K</kbd>
      {/if}
    </div>
  {/if}

  <nav class="nav" aria-label="Navegación principal">
    {#each mainNav as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={isActive(item)}
        data-sveltekit-preload-data="hover"
        use:tooltip={collapsed ? item.label : ''}
      >
        <item.Icon size={20} weight={isActive(item) ? 'fill' : 'regular'} />
        {#if !collapsed}<span>{item.label}</span>{/if}
      </a>
    {/each}
  </nav>

  <div class="section">
    {#if !collapsed}<p class="section-label">Biblioteca</p>{/if}
    <nav class="nav" aria-label="Biblioteca">
      {#each libraryNav as item}
        <a
          href={item.href}
          class="nav-item"
          class:active={isActive(item)}
          data-sveltekit-preload-data="hover"
          use:tooltip={collapsed ? item.label : ''}
        >
          <item.Icon size={20} weight={isActive(item) ? 'fill' : 'regular'} />
          {#if !collapsed}<span>{item.label}</span>{/if}
        </a>
      {/each}
    </nav>
  </div>

  {#snippet pinnedItem(p: (typeof pinnedPlaylists)[number])}
    <a
      class="pinned-item"
      href={`/playlist/${p.id}`}
      class:active={page.url.pathname === `/playlist/${p.id}`}
      data-sveltekit-preload-data="hover"
      aria-label={collapsed ? p.name : undefined}
      use:tooltip={p.name}
    >
      <span class="pinned-cover">
        <CoverImage src={getPlaylistCoverUrl(p.id)} alt="">
          {#snippet fallback()}
            <ListPlus size="60%" weight="regular" />
          {/snippet}
        </CoverImage>
      </span>
      {#if !collapsed}<span class="pinned-name">{p.name}</span>{/if}
    </a>
  {/snippet}

  {#if pinnedPlaylists.length > 0}
    <div class="section pinned-section">
      {#if !collapsed}<p class="section-label">Ancladas</p>{/if}
      <nav class="pinned-list" aria-label="Playlists ancladas">
        {#each pinnedFirst as p (p.id)}{@render pinnedItem(p)}{/each}
      </nav>
      {#if pinnedOverflow > 0}
        <div class="pinned-extra" class:open={pinnedExpanded}>
          <div class="pinned-extra-inner">
            <nav class="pinned-list" aria-label="Más playlists ancladas">
              {#each pinnedRest as p (p.id)}{@render pinnedItem(p)}{/each}
            </nav>
          </div>
        </div>
        <button
          type="button"
          class="pinned-toggle"
          class:collapsed
          onclick={() => sidebarUI.togglePinned()}
          aria-expanded={pinnedExpanded}
          use:tooltip={collapsed ? (pinnedExpanded ? 'Mostrar menos' : `Ver ${pinnedOverflow} más`) : ''}
        >
          {#if collapsed}
            {#if pinnedExpanded}
              <CaretUp size={14} weight="bold" />
            {:else}
              <span class="more-count">+{pinnedOverflow}</span>
            {/if}
          {:else}
            <span>{pinnedExpanded ? 'Mostrar menos' : `+${pinnedOverflow} más`}</span>
          {/if}
        </button>
      {/if}
    </div>
  {/if}

  <div class="sidebar-bottom">
    <LiveListeners {collapsed} />
    <div class="footer">
      <UserMenu compact={collapsed} />
    </div>
  </div>
</aside>

<style>
  .sidebar {
    grid-area: sidebar;
    /* Flex column con margin-top: auto en footer empuja el footer abajo
       y deja el void en el medio (no pegado a las secciones de arriba). */
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-3) var(--space-4);
    background: var(--bg-surface);
    border-right: 1px solid var(--separator-subtle);
    /* Altura la maneja el grid del shell (spans both rows). */
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    transition: padding var(--duration-normal) var(--ease-ios-default);
  }
  /* Modo colapsado: padding horizontal mínimo para que los iconos queden
     centrados en el rail estrecho. */
  .sidebar.collapsed {
    padding-left: var(--space-2);
    padding-right: var(--space-2);
  }

  /* === Logo + BrandWord + toggle: en expandido los 3 en fila;
     en colapsado el logo arriba, toggle debajo (stack). === */
  .brand-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    min-height: 32px;
  }
  .sidebar.collapsed .brand-row {
    flex-direction: column;
    gap: var(--space-3);
    padding: 0;
  }
  .brand-icon {
    display: inline-flex;
    line-height: 0;
    flex-shrink: 0;
  }
  .collapse-toggle {
    margin-left: auto;
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .collapse-toggle:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .collapse-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .sidebar.collapsed .collapse-toggle {
    margin-left: 0;
  }

  /* Search colapsado: solo el icono como botón cuadrado. Click expande el
     sidebar y enfoca el input (no hay dónde escribir en modo colapsado). */
  .search-collapsed {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    margin: 0 auto;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    text-decoration: none;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .search-collapsed:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .search-collapsed.active {
    background: var(--row-active);
    color: var(--text-primary);
  }
  .search-collapsed:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* === Search button (Raycast/Linear-style con kbd hint) === */
  /* Container del input. Estilo "frosted button" — el input dentro hereda
     todo el styling visual, este wrapper solo provee el chrome. */
  .search {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    min-height: 36px;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .search:hover,
  .search:focus-within,
  .search.active {
    background: var(--bg-surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .search:focus-within {
    box-shadow: var(--focus-ring);
  }

  .search-icon {
    display: grid;
    place-items: center;
    color: inherit;
  }

  .search input[type='search'] {
    width: 100%;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    /* line-height saludable: el caret (text cursor) toma la altura del
       line-box (font-size × line-height). Con 1.2 quedaba diminuto; 1.5 le
       da una altura proporcional al texto, sin descuadrar el min-height 36px
       del contenedor (14px × 1.5 + 16px padding ≈ 37px). */
    line-height: 1.5;
    letter-spacing: var(--tracking-body);
    padding: 0;
    -webkit-appearance: none;
    appearance: none;
  }
  .search input[type='search']::-webkit-search-decoration,
  .search input[type='search']::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .search input::placeholder {
    color: var(--text-secondary);
  }

  /* Clear button: solo visible cuando hay valor. tabindex=-1 → tab keyboard
     no aterriza acá (Esc en el input ya hace clear). */
  .clear-btn {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .clear-btn:hover {
    background: var(--bg-surface-active);
    color: var(--text-primary);
  }
  /* kbd: sans-serif (no mono) para que el ⌘ y la K se vean consistentes
     entre fuentes — los stacks mono renderizan el ⌘ con métricas raras.
     Inline-flex centrado, height fija para que se vea sólido como una tecla. */
  .kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    padding: 0 6px;
    background: var(--bg-canvas);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-xs);
    color: var(--text-tertiary);
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: var(--tracking-wide);
    flex-shrink: 0;
  }

  /* === Nav sections === */
  .nav {
    display: grid;
    gap: 1px;
  }

  .section {
    display: grid;
    gap: var(--space-2);
    min-height: 0;
  }
  .section-label {
    margin: 0;
    padding: 0 var(--space-3);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }

  /* === Pinned Playlists === */
  /* Sección debajo de Biblioteca; lista compacta con cover 28×28 + nombre.
     Scroll-friendly si hay muchas (el sidebar entero ya es overflow-y: auto). */
  .pinned-section {
    /* Sin gap-y interno aparte del default — la lista controla su propio. */
    min-height: 0;
  }
  .pinned-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  /* Grid 28px + 1fr — el grid template-column auto-shrink garantiza que
     el .pinned-name (segunda columna) se trunque por ellipsis cuando el
     nombre supera el ancho disponible. Con flex+gap esto fallaba: los
     flex items con texto tienen min-width:auto (= min-content) y el
     ellipsis no se aplica si la palabra del nombre cabe entera (los
     nombres de playlist a menudo son una sola palabra larga). */
  .pinned-item {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-3);
    min-height: 40px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.3;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
    min-width: 0;
  }
  .pinned-item:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  .pinned-item.active {
    background: var(--row-active);
    color: var(--text-primary);
  }
  .pinned-item:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .pinned-cover {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    position: relative;
    background: var(--bg-surface-elevated);
    color: var(--text-tertiary);
  }
  .pinned-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* Overflow de pinned: morph grid-rows 0fr→1fr (mismo patrón que el acordeón
     de Jobs / PersonCard). No max-height — anima limpio sin magic numbers. */
  .pinned-extra {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--morph-duration) var(--morph-ease);
  }
  .pinned-extra.open {
    grid-template-rows: 1fr;
  }
  .pinned-extra-inner {
    overflow: hidden;
    min-height: 0;
  }

  /* Toggle "+N más" / "Mostrar menos". Discreto, alineado con las pinned. */
  .pinned-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    margin-top: 2px;
    padding: 6px var(--space-3);
    border: 0;
    background: transparent;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .pinned-toggle:hover {
    background: var(--row-hover);
    color: var(--text-secondary);
  }
  .pinned-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .pinned-toggle.collapsed {
    justify-content: center;
    width: 40px;
    height: 32px;
    margin: 2px auto 0;
    padding: 0;
  }
  .pinned-toggle .more-count {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
  }

  @media (prefers-reduced-motion: reduce) {
    .pinned-extra {
      transition: none;
    }
  }

  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    min-height: 36px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.4;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  /* Colapsado: nav items son cuadrados centered con solo el icono. */
  .sidebar.collapsed .nav-item {
    justify-content: center;
    padding: var(--space-2);
    width: 40px;
    height: 40px;
    min-height: 40px;
    margin: 0 auto;
  }
  /* Pinned colapsado: solo el cover (40x40) centrado. */
  .sidebar.collapsed .pinned-item {
    grid-template-columns: 40px;
    justify-content: center;
    padding: var(--space-1);
    min-height: 48px;
  }
  .sidebar.collapsed .pinned-cover {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
  }
  .nav-item:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }

  /* Active: barra vertical accent a la izquierda + bg sutil + color primary.
     La barra usa ::before para no afectar el layout interno. */
  .nav-item.active {
    color: var(--text-primary);
    background: var(--row-active);
  }
  .nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 18px;
    background: var(--accent);
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
  }

  .nav-item:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Grupo inferior: "Escuchando ahora" + footer. El margin-top:auto vive aquí
     (no en .footer) para empujar AMBOS al fondo como una unidad — así la
     presencia social queda pegada encima del avatar, estilo Spotify. Cuando
     no hay nadie escuchando, LiveListeners no pinta nada y el gap colapsa. */
  .sidebar-bottom {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .footer {
    display: grid;
    gap: 2px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--separator-subtle);
  }

  /* Mobile: oculta sidebar, los Tab Bar lo reemplazan (lo armamos después) */
  @media (max-width: 768px) {
    .sidebar {
      display: none;
    }
  }
</style>
