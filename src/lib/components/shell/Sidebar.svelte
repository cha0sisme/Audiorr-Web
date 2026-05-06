<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    House, MagnifyingGlass, MusicNotes, Heart,
    ListPlus, Star, X
  } from 'phosphor-svelte';
  import Logo from '$components/shared/Logo.svelte';
  import UserMenu from '$components/shell/UserMenu.svelte';

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
    { href: '/library', label: 'Tu librería', Icon: MusicNotes, category: 'library' },
    { href: '/favorites', label: 'Favoritos', Icon: Heart, category: 'favorites' }
  ];

  const libraryNav: NavItem[] = [
    { href: '/library?tab=playlists', label: 'Playlists', Icon: ListPlus, category: 'playlists' },
    { href: '/library?tab=artists', label: 'Artistas', Icon: Star, category: 'artists' }
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

<aside class="sidebar">
  <div class="brand-row">
    <a href="/" class="brand-icon" aria-label="Audiorr — Inicio">
      <Logo size={32} />
    </a>
  </div>

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

  <nav class="nav" aria-label="Navegación principal">
    {#each mainNav as item}
      <a
        href={item.href}
        class="nav-item"
        class:active={isActive(item)}
        data-sveltekit-preload-data="hover"
      >
        <item.Icon size={20} weight={isActive(item) ? 'fill' : 'regular'} />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>

  <div class="section">
    <p class="section-label">Biblioteca</p>
    <nav class="nav" aria-label="Biblioteca">
      {#each libraryNav as item}
        <a
          href={item.href}
          class="nav-item"
          class:active={isActive(item)}
          data-sveltekit-preload-data="hover"
        >
          <item.Icon size={20} weight={isActive(item) ? 'fill' : 'regular'} />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  </div>

  <div class="footer">
    <UserMenu />
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
  }

  /* === Logo: solo icon, sin efectos de interacción.
     Click target = el icono mismo (32×32). === */
  .brand-row {
    padding: 0 var(--space-2);
  }
  .brand-icon {
    display: inline-block;
    line-height: 0;
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
    line-height: 1.2;
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

  .footer {
    display: grid;
    gap: 2px;
    padding-top: var(--space-3);
    border-top: 1px solid var(--separator-subtle);
    /* Auto-push al fondo del sidebar (flex column). El void va arriba del
       footer, no entre las secciones de nav. */
    margin-top: auto;
  }

  /* Mobile: oculta sidebar, los Tab Bar lo reemplazan (lo armamos después) */
  @media (max-width: 768px) {
    .sidebar {
      display: none;
    }
  }
</style>
