<script lang="ts">
  /**
   * Layout del panel de admin (`/housekeeping`).
   *
   * Estructura mínima:
   *   1. Tab bar (Contenido / Editorial / Playlists) usando tokens
   *      `--segment-*` canónicos del proyecto — coherente con todos los
   *      otros segmented controls.
   *   2. Outlet del child route.
   *
   * Sin título de página ni subtítulo: el contexto lo dan las tabs y la
   * URL. Filosofía "let's keep it simple".
   *
   * Reglas:
   *   - Solo accesible si `getUser.adminRole === true`. Si no, redirect a `/`.
   *   - La query del user comparte cache key con UserMenu (`['navidromeUser']`)
   *     para evitar doble fetch.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { House, FilmReel, Layout, Books } from 'phosphor-svelte';
  import { credentials } from '$stores/credentials.svelte';
  import * as nav from '$services/NavidromeService';

  let { children } = $props();

  const username = $derived(credentials.current?.username ?? '');

  const userInfoQ = createQuery(() => ({
    queryKey: ['navidromeUser', username],
    queryFn: () => nav.getUser(username),
    enabled: credentials.isConfigured && username.length > 0,
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false
  }));
  const isAdmin = $derived(userInfoQ.data?.adminRole === true);
  const checking = $derived(userInfoQ.isPending);

  $effect(() => {
    if (checking) return;
    if (!isAdmin) goto('/', { replaceState: true });
  });

  type Tab = {
    id: string;
    label: string;
    href: string;
    Icon: typeof House;
  };
  const TABS: Tab[] = [
    { id: 'dashboard', label: 'Inicio',    href: '/housekeeping/dashboard', Icon: House    },
    { id: 'contenido', label: 'Contenido', href: '/housekeeping/contenido', Icon: FilmReel },
    { id: 'portada',   label: 'Portada',   href: '/housekeeping/portada',   Icon: Layout   },
    { id: 'editorial', label: 'Editorial', href: '/housekeeping/editorial', Icon: Books    }
  ];

  const activeId = $derived.by(() => {
    const seg = page.url.pathname.split('/')[2];
    return TABS.find((t) => t.id === seg)?.id ?? 'dashboard';
  });

  // ─── Indicator deslizante (ports el patrón de SegmentedControl) ──────
  let segmentEl: HTMLElement | undefined = $state();
  const refs: Record<string, HTMLAnchorElement | undefined> = $state({});

  let indicatorX = $state(0);
  let indicatorW = $state(0);
  let measured = $state(false);

  function measure() {
    const ref = refs[activeId];
    if (!ref || !segmentEl) return;
    const itemRect = ref.getBoundingClientRect();
    const containerRect = segmentEl.getBoundingClientRect();
    indicatorX = itemRect.left - containerRect.left;
    indicatorW = itemRect.width;
    measured = true;
  }

  // Re-mide cuando el activeId cambia. El doble rAF garantiza que el ref
  // del nuevo tab está bind y el layout estable. Sin esto, en navegación
  // directa (deep link) el indicator nace en (0,0).
  $effect(() => {
    void activeId;
    requestAnimationFrame(() => requestAnimationFrame(measure));
  });

  onMount(() => {
    // tick() espera a que Svelte haya bind-eado todos los refs antes de
    // intentar el primer measure. Resuelve el bug "indicator desplazado al
    // entrar directo a /housekeeping/dashboard" porque al primer paint los
    // anchor refs aún no estaban poblados.
    void tick().then(() => {
      requestAnimationFrame(() => requestAnimationFrame(measure));
    });
    if (!segmentEl) return;
    const ro = new ResizeObserver(measure);
    ro.observe(segmentEl);
    return () => ro.disconnect();
  });
</script>

{#if checking}
  <div class="hk-loading" aria-busy="true">
    <div class="hk-loading-card"></div>
  </div>
{:else if isAdmin}
  <div class="hk-shell">
    <nav
      bind:this={segmentEl}
      class="hk-segment"
      aria-label="Secciones de Housekeeping"
    >
      <span
        class="hk-indicator"
        class:visible={measured}
        style:transform="translateX({indicatorX}px)"
        style:width="{indicatorW}px"
        aria-hidden="true"
      ></span>

      {#each TABS as tab (tab.id)}
        <a
          bind:this={refs[tab.id]}
          class="hk-tab"
          class:active={activeId === tab.id}
          href={tab.href}
          aria-current={activeId === tab.id ? 'page' : undefined}
          data-sveltekit-preload-data="hover"
        >
          <tab.Icon size={14} weight={activeId === tab.id ? 'fill' : 'regular'} />
          <span>{tab.label}</span>
        </a>
      {/each}
    </nav>

    <main class="hk-content">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .hk-shell {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    width: 100%;
  }

  /* ─── Tab bar — usa los tokens `--segment-*` canónicos del proyecto ──── */
  .hk-segment {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: 4px;
    background: var(--segment-bg);
    border-radius: var(--radius-full);
    isolation: isolate;
    width: fit-content;
    max-width: 100%;
  }
  .hk-indicator {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 0;
    background: var(--segment-indicator-bg);
    border-radius: var(--radius-full);
    box-shadow: var(--segment-indicator-shadow);
    z-index: 0;
    opacity: 0;
    transition:
      transform 380ms var(--ease-ios-default),
      width 380ms var(--ease-ios-default);
  }
  .hk-indicator.visible { opacity: 1; }
  .hk-tab {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-2) var(--space-4);
    color: var(--segment-text);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.2;
    text-decoration: none;
    border-radius: var(--radius-full);
    transition: color var(--duration-fast) var(--ease-ios-default);
    white-space: nowrap;
  }
  .hk-tab:hover:not(.active) {
    color: var(--text-primary);
  }
  .hk-tab.active {
    color: var(--segment-text-active);
  }
  .hk-tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* ─── Loading mientras chequeamos adminRole ──────────────────────────── */
  .hk-loading {
    padding: var(--space-12) var(--space-6);
    display: grid;
    place-items: center;
  }
  .hk-loading-card {
    width: 280px;
    height: 64px;
    background: var(--bg-surface);
    border-radius: var(--hk-card-radius);
    animation: hk-pulse 1.6s ease-in-out infinite;
  }
  @keyframes hk-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  @media (max-width: 640px) {
    .hk-shell {
      padding: var(--space-6) var(--space-4) var(--space-12);
      gap: var(--space-5);
    }
  }
</style>
