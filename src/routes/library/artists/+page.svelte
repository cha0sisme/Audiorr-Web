<script lang="ts">
  /**
   * /library/artists — A-Z list de TODOS los artistas. Replica el patrón
   * `AllArtistsView` de iOS (ArtistsView.swift:665-735): grupos por letra
   * inicial con headers sticky, fila por artista (avatar + nombre).
   *
   * No metemos sidebar lateral A-Z scrubber (iOS lo usa con haptics; en web
   * el equivalente sería un side rail con scroll-into-view, pero la lista
   * típica de Audiorr es navegable scrolleando — añadir el rail si la
   * biblioteca crece a >500 artistas).
   *
   * Override de `/library/[type]/+page.svelte` con `type='artists'`: SvelteKit
   * prefiere rutas estáticas más específicas. La antigua VirtualGrid que
   * estaba ahí queda obsoleta para 'artists' (los álbumes/playlists siguen
   * usándola).
   */
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { CaretRight } from 'phosphor-svelte';
  import * as nav from '$services/NavidromeService';
  import { createQuery } from '@tanstack/svelte-query';
  import { credentials } from '$stores/credentials.svelte';
  import { userAvatarColor, userAvatarInitial } from '$utils/avatar-color';
  import type { NavidromeArtist } from '$types/navidrome';

  const artistsQ = createQuery(() => ({
    queryKey: ['library', 'artists'],
    queryFn: () => nav.getArtists(),
    enabled: credentials.isConfigured,
    gcTime: 30 * 60 * 1000
  }));

  /** Agrupa por letra inicial. Símbolos y dígitos van a `#` (al final del
      orden). Misma lógica que iOS ArtistsView.swift:42-55. */
  const grouped = $derived.by(() => {
    const artists = artistsQ.data ?? [];
    const groups = new Map<string, NavidromeArtist[]>();
    for (const a of artists) {
      const first = a.name.charAt(0).toUpperCase();
      const letter = /[A-Z0-9]/.test(first) ? first : '#';
      const list = groups.get(letter) ?? [];
      list.push(a);
      groups.set(letter, list);
    }
    return [...groups.entries()]
      .sort((a, b) => {
        if (a[0] === '#') return 1;
        if (b[0] === '#') return -1;
        return a[0].localeCompare(b[0], 'es');
      })
      .map(([letter, items]) => ({ letter, artists: items }));
  });

  const total = $derived(artistsQ.data?.length ?? 0);
</script>

<PageTitle segments={['Todos los artistas']} />

<div class="page">
  <header class="page-header">
    <h1>Todos los artistas</h1>
    {#if total > 0}
      <p class="subtitle">{total} {total === 1 ? 'artista' : 'artistas'}</p>
    {/if}
  </header>

  {#if artistsQ.isPending}
    <div class="rows-skeleton">
      {#each Array(12) as _}
        <div class="row-sk"></div>
      {/each}
    </div>
  {:else if artistsQ.isError}
    <p class="error">No se pudieron cargar los artistas.</p>
  {:else}
    {#each grouped as group (group.letter)}
      <section class="letter-group">
        <h2 class="letter-header">{group.letter}</h2>
        <ul class="rows">
          {#each group.artists as artist (artist.id)}
            {@const color = userAvatarColor(artist.name)}
            <li>
              <a class="row" href={`/artist/${artist.id}`} data-sveltekit-preload-data="hover">
                <span
                  class="thumb"
                  style:background={color.css}
                  aria-hidden="true"
                >
                  <span class="initial">{userAvatarInitial(artist.name)}</span>
                </span>
                <span class="name">{artist.name}</span>
                <CaretRight size={12} weight="bold" />
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<style>
  .page {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
  }

  .page-header {
    display: grid;
    gap: var(--space-2);
  }
  .page-header h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* === Grupo por letra === */
  .letter-group {
    display: grid;
    gap: var(--space-1);
  }
  /* Header sticky — pega arriba mientras se hace scroll, hasta que el
     siguiente grupo lo empuja. Mismo patrón que la lista de Apple Music. */
  .letter-header {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: var(--space-2) var(--space-2);
    background: var(--bg-canvas);
    border-bottom: 1px solid var(--separator-subtle);
    font-size: var(--text-sm);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .row:hover {
    background: var(--row-hover);
  }
  .row:focus-visible {
    outline: none;
    background: var(--row-hover);
    box-shadow: var(--focus-ring);
  }

  .thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    color: #fff;
    overflow: hidden;
    flex-shrink: 0;
  }
  .initial {
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    user-select: none;
  }
  .name {
    font-size: var(--text-base);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.3;
  }
  .row :global(svg) {
    color: var(--text-tertiary);
  }

  .rows-skeleton {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .row-sk {
    height: 64px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-secondary);
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    .page-header h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
