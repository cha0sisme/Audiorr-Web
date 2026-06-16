<script lang="ts">
  /**
   * Layout del panel de admin (`/housekeeping`) — shell con sidebar.
   *
   * Navegación primaria en sidebar de 5 secciones (Resumen / Curaduría /
   * Contenido / Personas / Diagnóstico). La reagrupación es solo VISUAL: las
   * 8 rutas físicas siguen donde estaban; el sidebar y los sub-tabs de
   * Curaduría navegan a ellas. Sin mover archivos ni redirects.
   *
   *   - Curaduría agrupa portada (Home) + editorial (Destacadas) +
   *     covers (Smart covers) + artwork (Animated artwork) vía sub-tabs.
   *   - Footer del sidebar = salud de NAVIDROME (servidor de música): ping
   *     one-shot al entrar + botón recomprobar. NO es un loop (el shell está
   *     siempre montado; un poll aquí sería movimiento ocioso permanente).
   *     La salud del backend Audiorr vive en la card "Salud del sistema" del
   *     Resumen — son dos sujetos distintos, etiquetados explícitamente.
   *   - Desktop-first: ≥1024px sidebar lateral fijo; <1024px degrada a una
   *     fila horizontal scrollable (sin drawer JS → SSR-safe).
   *
   * Reglas:
   *   - Solo accesible si `getUser.adminRole === true`. Si no, redirect a `/`.
   *   - La query del user comparte cache key con UserMenu (`['navidromeUser']`)
   *     para evitar doble fetch.
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { House, FilmReel, Layout, Waveform, Users, ArrowsClockwise } from 'phosphor-svelte';
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

  // ─── Secciones (navegación primaria) ────────────────────────────────────
  // `match` lista los segmentos de ruta que pertenecen a esta sección. Una
  // sección puede agrupar varias rutas físicas (Curaduría). `href` es el
  // destino por defecto al pulsar el ítem.
  type Section = {
    id: string;
    label: string;
    href: string;
    Icon: typeof House;
    match: string[];
  };
  const SECTIONS: Section[] = [
    { id: 'resumen',     label: 'Resumen',     href: '/housekeeping/dashboard',   Icon: House,     match: ['dashboard'] },
    { id: 'curaduria',   label: 'Curaduría',   href: '/housekeeping/portada',     Icon: Layout,    match: ['portada', 'editorial', 'covers', 'artwork'] },
    { id: 'contenido',   label: 'Contenido',   href: '/housekeeping/contenido',   Icon: FilmReel,  match: ['contenido'] },
    { id: 'personas',    label: 'Personas',    href: '/housekeeping/usuarios',    Icon: Users,     match: ['usuarios'] },
    { id: 'diagnostico', label: 'Diagnóstico', href: '/housekeeping/diagnostics', Icon: Waveform,  match: ['diagnostics'] }
  ];

  // Sub-tabs de Curaduría — segundo nivel, solo visible dentro de la sección.
  type SubTab = { label: string; href: string; seg: string };
  const CURADURIA_TABS: SubTab[] = [
    { label: 'Home',             href: '/housekeeping/portada',   seg: 'portada' },
    { label: 'Destacadas',       href: '/housekeeping/editorial', seg: 'editorial' },
    { label: 'Smart covers',     href: '/housekeeping/covers',    seg: 'covers' },
    { label: 'Animated artwork', href: '/housekeeping/artwork',   seg: 'artwork' }
  ];

  const currentSeg = $derived(page.url.pathname.split('/')[2] ?? 'dashboard');
  const activeSection = $derived(SECTIONS.find((s) => s.match.includes(currentSeg))?.id ?? 'resumen');
  const inCuraduria = $derived(activeSection === 'curaduria');

  // ─── Footer: salud de Navidrome (ping one-shot, sin loop) ───────────────
  let lastLatency = $state<number | null>(null);
  let serverVersion = $state<string | null>(null);
  let pingFailed = $state(false);
  let pinging = $state(false);

  async function checkNavidrome() {
    if (!credentials.isConfigured || pinging) return;
    pinging = true;
    const start = performance.now();
    try {
      const res = await nav.ping();
      lastLatency = Math.round(performance.now() - start);
      serverVersion = res.version;
      pingFailed = false;
    } catch {
      pingFailed = true;
    } finally {
      pinging = false;
    }
  }

  const healthBand = $derived.by<'ok' | 'warn' | 'down' | 'unknown'>(() => {
    if (pingFailed) return 'down';
    if (lastLatency === null) return 'unknown';
    if (lastLatency < 100) return 'ok';
    if (lastLatency < 300) return 'warn';
    return 'down';
  });

  const serverHost = $derived.by(() => {
    const url = credentials.current?.serverUrl ?? '';
    try {
      return new URL(url).host;
    } catch {
      return url || '—';
    }
  });

  onMount(() => {
    void checkNavidrome();
  });
</script>

{#if checking}
  <div class="hk-loading" aria-busy="true">
    <div class="hk-loading-card"></div>
  </div>
{:else if isAdmin}
  <div class="hk-shell">
    <aside class="hk-sidebar" aria-label="Secciones de Housekeeping">
      <div class="hk-sidebar-brand">Housekeeping</div>

      <nav class="hk-sidebar-nav">
        {#each SECTIONS as section (section.id)}
          <a
            class="hk-nav-item"
            class:active={activeSection === section.id}
            href={section.href}
            aria-current={activeSection === section.id ? 'page' : undefined}
            data-sveltekit-preload-data="hover"
          >
            <section.Icon size={17} weight={activeSection === section.id ? 'fill' : 'regular'} />
            <span>{section.label}</span>
          </a>
        {/each}
      </nav>

      <div class="hk-sidebar-footer">
        <span class="hk-health-label">Navidrome</span>
        <div class="hk-health-row">
          <span class="hk-health-dot" data-band={healthBand} aria-hidden="true"></span>
          <span class="hk-health-value">
            {#if pingFailed}
              Sin respuesta
            {:else if lastLatency !== null}
              {lastLatency} ms
            {:else}
              Sin comprobar
            {/if}
          </span>
          <button
            type="button"
            class="hk-health-recheck"
            onclick={checkNavidrome}
            disabled={pinging}
            aria-label="Recomprobar la salud de Navidrome"
          >
            <ArrowsClockwise size={12} weight="bold" class={pinging ? 'spin' : ''} />
          </button>
        </div>
        <span class="hk-health-sub">
          {serverHost}{#if serverVersion} · v{serverVersion}{/if}
        </span>
      </div>
    </aside>

    <div class="hk-main-col">
      {#if inCuraduria}
        <nav class="hk-subtabs" aria-label="Secciones de Curaduría">
          {#each CURADURIA_TABS as tab (tab.seg)}
            <a
              class="hk-subtab"
              class:active={currentSeg === tab.seg}
              href={tab.href}
              aria-current={currentSeg === tab.seg ? 'page' : undefined}
              data-sveltekit-preload-data="hover"
            >
              {tab.label}
            </a>
          {/each}
        </nav>
      {/if}

      <main class="hk-content">
        {@render children()}
      </main>
    </div>
  </div>
{/if}

<style>
  /* ─── Shell: sidebar + columna de contenido ──────────────────────────── */
  .hk-shell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    gap: var(--space-8);
    align-items: start;
    padding: var(--space-8) var(--space-8) var(--space-12);
    min-width: 0;
    width: 100%;
  }

  /* ─── Sidebar ─────────────────────────────────────────────────────────── */
  .hk-sidebar {
    position: sticky;
    top: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-4);
    background: var(--admin-sidebar-bg);
    border: 1px solid var(--admin-sidebar-border);
    border-radius: var(--hk-card-radius);
    min-height: 0;
  }
  .hk-sidebar-brand {
    padding: 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
  }

  .hk-sidebar-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hk-nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    color: var(--admin-sidebar-item-fg);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.2;
    text-decoration: none;
    transition:
      color var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .hk-nav-item:hover:not(.active) {
    color: var(--admin-sidebar-item-fg-hover);
    background: var(--admin-sidebar-item-bg-hover);
  }
  .hk-nav-item.active {
    color: var(--admin-sidebar-item-fg-active);
    background: var(--admin-sidebar-item-bg-active);
  }
  .hk-nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 18px;
    border-radius: 0 999px 999px 0;
    background: var(--admin-sidebar-item-bar-active);
  }
  .hk-nav-item:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ─── Footer del sidebar — salud Navidrome ───────────────────────────── */
  .hk-sidebar-footer {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-3) var(--space-2) 0;
    border-top: 1px solid var(--separator-subtle);
  }
  .hk-health-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .hk-health-row {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .hk-health-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    flex-shrink: 0;
    background: var(--admin-health-unknown);
  }
  .hk-health-dot[data-band='ok']   { background: var(--admin-health-ok); }
  .hk-health-dot[data-band='warn'] { background: var(--admin-health-warn); }
  .hk-health-dot[data-band='down'] { background: var(--admin-health-down); }
  .hk-health-value {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .hk-health-recheck {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color 160ms var(--ease-ios-default), background 160ms var(--ease-ios-default);
  }
  .hk-health-recheck:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-surface-hover); }
  .hk-health-recheck:disabled { opacity: 0.5; cursor: progress; }
  .hk-health-recheck:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .hk-health-sub {
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.hk-health-recheck .spin) { animation: hk-spin 1s linear infinite; }
  @keyframes hk-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.hk-health-recheck .spin) { animation: none; }
  }

  /* ─── Columna de contenido ───────────────────────────────────────────── */
  .hk-main-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }
  .hk-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  /* ─── Sub-tabs de Curaduría (segundo nivel) ──────────────────────────── */
  .hk-subtabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--segment-bg);
    border-radius: var(--radius-full);
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hk-subtabs::-webkit-scrollbar { display: none; }
  .hk-subtab {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    color: var(--segment-text);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
    transition:
      color var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .hk-subtab:hover:not(.active) { color: var(--text-primary); }
  .hk-subtab.active {
    color: var(--segment-text-active);
    background: var(--segment-indicator-bg);
    box-shadow: var(--segment-indicator-shadow);
  }
  .hk-subtab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
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
  @media (prefers-reduced-motion: reduce) {
    .hk-loading-card { animation: none; }
  }

  /* ─── Responsive: <1024px el sidebar pasa a fila horizontal arriba ────── */
  @media (max-width: 1024px) {
    .hk-shell {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-5);
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .hk-sidebar {
      position: static;
      flex-direction: row;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      overflow-x: auto;
      scrollbar-width: none;
    }
    .hk-sidebar::-webkit-scrollbar { display: none; }
    .hk-sidebar-brand { display: none; }
    .hk-sidebar-nav {
      flex-direction: row;
      gap: 2px;
      flex: 1;
    }
    .hk-nav-item { white-space: nowrap; }
    .hk-nav-item.active::before { display: none; }
    .hk-sidebar-footer {
      margin-top: 0;
      flex-direction: row;
      align-items: center;
      gap: 7px;
      padding: 0 0 0 var(--space-3);
      border-top: 0;
      border-left: 1px solid var(--separator-subtle);
      flex-shrink: 0;
    }
    .hk-health-label,
    .hk-health-sub { display: none; }
  }

  @media (max-width: 640px) {
    .hk-nav-item span { display: none; }
    .hk-nav-item { padding: var(--space-2); }
  }
</style>
