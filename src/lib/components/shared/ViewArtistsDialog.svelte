<script lang="ts">
  /**
   * ViewArtistsDialog — mini-modal centrado que lista los artistas de una
   * canción cuando hay más de uno (OpenSubsonic `song.artists[]`).
   *
   * Cada row: avatar circular + nombre. Click navega al perfil y cierra
   * el modal. El avatar lo fetchea cada `ArtistRow` con `getArtist(id)`
   * via TanStack Query (queryKey `['artist', id]`, compartido con el resto
   * del frontend) — si el usuario ya visitó el perfil, sale instantáneo.
   */
  import { fade, scale } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { X } from 'phosphor-svelte';
  import ArtistRow from './ViewArtistsDialogRow.svelte';
  import { viewArtistsUI } from '$stores/view-artists-ui.svelte';

  function close() {
    viewArtistsUI.close();
  }

  function handleArtistClick(id: string) {
    close();
    goto(`/artist/${id}`);
  }

  $effect(() => {
    if (!viewArtistsUI.isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if viewArtistsUI.isOpen}
  <div
    class="vad-scrim"
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 120 }}
    role="presentation"
    onclick={close}
  ></div>
  <div
    class="vad-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Ver artistas de la canción"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="vad-head">
      <div class="vad-head-text">
        <h2 class="vad-title">Artistas</h2>
        {#if viewArtistsUI.songTitle}
          <p class="vad-sub">{viewArtistsUI.songTitle}</p>
        {/if}
      </div>
      <button type="button" class="vad-close" aria-label="Cerrar" onclick={close}>
        <X size={14} weight="bold" />
      </button>
    </header>

    <ul class="vad-list">
      {#each viewArtistsUI.artists as a (a.id)}
        <li>
          <ArtistRow id={a.id} name={a.name} onSelect={() => handleArtistClick(a.id)} />
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .vad-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: var(--z-sticky);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .vad-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-sticky) + 1);
    width: min(380px, calc(100vw - 32px));
    max-height: min(560px, calc(100vh - 64px));
    display: flex;
    flex-direction: column;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow:
      0 20px 60px var(--shadow-color-xl),
      0 6px 20px var(--shadow-color-lg);
    color: var(--text-primary);
    overflow: hidden;
  }

  .vad-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }
  .vad-head-text {
    min-width: 0;
  }
  .vad-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1.25;
  }
  .vad-sub {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vad-close {
    width: 26px;
    height: 26px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .vad-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .vad-list {
    list-style: none;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .vad-list li {
    list-style: none;
  }
</style>
