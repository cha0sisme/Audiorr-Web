<script lang="ts">
  /**
   * /favorites — puerta a la playlist Navidrome "Favoritos" del usuario.
   *
   * El backend materializa los /star como una playlist real por usuario
   * (source='starred'), así que la experiencia canónica de favoritos ES la
   * página de playlist normal (cover de estrella, DJ mode, SmartMix, todo).
   * Esta ruta solo la resuelve y redirige a /playlist/<id>; si todavía no
   * existe (primer uso), dispara un sync y reintenta. El estado de fallo
   * cubre un backend desplegado sin la feature.
   */
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { Star, ArrowsClockwise } from 'phosphor-svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { favorites } from '$stores/favorites.svelte';

  let failed = $state(false);
  let resolving = $state(false);

  async function resolve() {
    if (resolving) return;
    resolving = true;
    failed = false;
    try {
      const id = await favorites.resolvePlaylistId();
      if (id) {
        await goto(`/playlist/${id}`, { replaceState: true });
        return;
      }
      failed = true;
    } catch {
      failed = true;
    } finally {
      resolving = false;
    }
  }

  // untrack: resolve() lee/escribe $state síncronamente; sin él, el effect
  // se suscribiría a `resolving`/`failed` y re-dispararía en bucle.
  $effect(() => {
    if (credentials.isConfigured) untrack(() => void resolve());
  });
</script>

<svelte:head>
  <title>Favoritos · Audiorr</title>
</svelte:head>

<div class="fav-gate">
  {#if failed}
    <div class="state">
      <Star size={36} weight="regular" />
      <p class="state-title">Tu playlist de favoritos no está lista</p>
      <p class="state-sub">
        Marca alguna canción con la estrella y vuelve a intentarlo. Si el problema persiste,
        puede que el servidor necesite actualizarse.
      </p>
      <button type="button" class="retry-btn" disabled={resolving} onclick={() => void resolve()}>
        <ArrowsClockwise size={16} weight="bold" />
        Reintentar
      </button>
    </div>
  {:else}
    <div class="state" aria-busy="true">
      <span class="spinner" aria-hidden="true"></span>
      <p class="state-title">Abriendo tus favoritos…</p>
    </div>
  {/if}
</div>

<style>
  .fav-gate {
    display: grid;
    place-items: center;
    min-height: 50vh;
  }
  .state {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    color: var(--text-tertiary);
    text-align: center;
    max-width: 44ch;
  }
  .state-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
  }
  .state-sub {
    margin: 0;
    font-size: var(--text-sm);
  }
  .retry-btn {
    margin-top: var(--space-2);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .retry-btn:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }
  .retry-btn:disabled {
    opacity: 0.5;
    cursor: progress;
  }
  .retry-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--border-subtle);
    border-top-color: var(--accent);
    animation: fav-spin 0.8s linear infinite;
  }
  @keyframes fav-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
