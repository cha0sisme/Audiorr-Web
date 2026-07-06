<script lang="ts">
  /**
   * Todos los géneros — grid por popularidad (nº de álbumes) con contador
   * bajo el nombre. Mirror de la página de géneros de iOS (SeeAllGridView
   * caso .genres): el Home muestra una ventana rotatoria de 12; aquí está
   * el catálogo completo. Ruta estática — gana al param /library/[type].
   */
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import GenreCard from '$components/shared/GenreCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { credentials } from '$stores/credentials.svelte';

  const genresQ = createQuery(() => ({
    queryKey: ['genres', 'all'],
    queryFn: async () => {
      const all = (await nav.getGenres()).filter(
        (g) => (g.albumCount ?? 0) > 0 && g.value.trim().length > 0
      );
      return [...all].sort((a, b) => (b.albumCount ?? 0) - (a.albumCount ?? 0));
    },
    enabled: credentials.isConfigured,
    staleTime: 30 * 60 * 1000
  }));

  const genres = $derived(genresQ.data ?? []);
</script>

<PageTitle segments={['Géneros']} />

<div class="page">
  <header class="header">
    <p class="kicker">Biblioteca</p>
    <h1>Géneros</h1>
    {#if genres.length > 0}
      <p class="subtitle">{genres.length} {genres.length === 1 ? 'género' : 'géneros'}</p>
    {/if}
  </header>

  {#if genresQ.isPending}
    <div class="grid" aria-hidden="true">
      {#each Array(12) as _}<div class="card-sk"></div>{/each}
    </div>
  {:else if genresQ.isError}
    <p class="error">No se pudieron cargar los géneros.</p>
  {:else if genres.length > 0}
    <div class="grid">
      {#each genres as g (g.value)}
        <GenreCard genre={g} showsAlbumCount />
      {/each}
    </div>
  {:else}
    <p class="empty">La biblioteca no tiene géneros etiquetados.</p>
  {/if}
</div>

<style>
  .page {
    padding: var(--space-8) var(--space-6) var(--space-12);
    display: grid;
    gap: var(--space-6);
  }
  .header {
    display: grid;
    gap: var(--space-1);
  }
  .kicker {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .grid {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(auto-fill, minmax(min(168px, 100%), 1fr));
  }
  .card-sk {
    aspect-ratio: 168 / 100;
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    animation: pulse 1.5s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  .empty,
  .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
  }

  @media (max-width: 640px) {
    .page {
      padding: var(--space-6) var(--space-4) var(--space-12);
    }
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
