<script lang="ts">
  /**
   * QueuePanel — panel lateral derecho que lista la queue actual.
   *
   * Tres secciones (mirroring iOS NowPlayingView Queue tab):
   *   1. "Sonando ahora" — track actual fijo arriba.
   *   2. "Próximas" — queue[currentIndex+1..end].
   *   3. "Reproducidas" — history (si hay), colapsable.
   *
   * Click en cualquier row = jumpTo(index) (en próximas) o re-load (history,
   * Phase 2 cuando integremos restauración de orden histórico).
   *
   * El panel comparte el real-estate del lado derecho con el CanvasPanel —
   * el layout aplica mutex (abrir queue cierra canvas y viceversa). Eso evita
   * solapamientos sin diseñar dos paneles coexistentes para v1.
   */
  import { X, MusicNote, Trash, Queue as QueueIcon } from 'phosphor-svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { queueUI } from '$stores/queue-ui.svelte';
  import { player } from '$stores/player.svelte';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import NowPlayingIndicator from '$components/shared/NowPlayingIndicator.svelte';
  import ExplicitBadge from '$components/shared/ExplicitBadge.svelte';
  import { formatTime } from '$utils/format';
  import type { PersistableSong } from '$services/QueueManager.svelte';

  function close() {
    queueUI.close();
  }

  function thumbUrl(song: PersistableSong): string | undefined {
    return song.coverArt ? getCoverArtUrl(song.coverArt, 200) : undefined;
  }

  function isExplicit(song: PersistableSong): boolean {
    return song.explicitStatus === 'explicit';
  }

  /** Click en una row de "Próximas" — jump al absolute index. */
  function jumpToAbsolute(absoluteIndex: number) {
    queueManager.jumpTo(absoluteIndex);
  }

  /** Quitar de la queue. Para "Próximas", absoluteIndex = currentIndex + 1 + relIndex. */
  function removeAt(absoluteIndex: number, e: MouseEvent) {
    e.stopPropagation();
    queueManager.remove(absoluteIndex);
  }

  function clearUpcoming() {
    queueManager.clearUpcoming();
  }

  // Slice de "próximas" — desde currentIndex+1 hasta el final.
  const upcoming = $derived(
    queueManager.currentIndex >= 0
      ? queueManager.queue.slice(queueManager.currentIndex + 1)
      : queueManager.queue
  );

  const currentSong = $derived(queueManager.currentSong);

  // History al revés (más recientes primero) — UX standard.
  const recentHistory = $derived([...queueManager.history].reverse());

  let showHistory = $state(false);
</script>

<aside class="queue-panel" aria-label="Cola de reproducción">
  <header class="qp-header">
    <h2 class="qp-title">
      <QueueIcon size={18} weight="regular" />
      <span>Cola</span>
    </h2>
    <div class="qp-actions">
      {#if upcoming.length > 0}
        <button type="button" class="qp-action" onclick={clearUpcoming} title="Limpiar próximas">
          <Trash size={14} weight="regular" />
        </button>
      {/if}
      <button type="button" class="qp-close" aria-label="Cerrar cola" onclick={close}>
        <X size={14} weight="bold" />
      </button>
    </div>
  </header>

  <div class="qp-body">
    {#if currentSong}
      <section class="qp-section">
        <p class="qp-section-label">Sonando ahora</p>
        <div class="qp-row qp-row-current">
          <span class="qp-thumb">
            <CoverImage src={thumbUrl(currentSong)} alt="">
              {#snippet fallback()}
                <MusicNote size="100%" weight="regular" />
              {/snippet}
            </CoverImage>
            <span class="qp-thumb-overlay">
              <NowPlayingIndicator
                isPlaying={player.isPlaying}
                color="#fff"
                height={14}
                barWidth={2}
              />
            </span>
          </span>
          <span class="qp-meta">
            <span class="qp-title-line">
              <span class="qp-track-title">{currentSong.title}</span>
              {#if isExplicit(currentSong)}
                <ExplicitBadge size="12px" />
              {/if}
            </span>
            <span class="qp-track-artist">{currentSong.artist}</span>
          </span>
          <span class="qp-duration">{formatTime(currentSong.duration)}</span>
        </div>
      </section>
    {/if}

    <section class="qp-section">
      <p class="qp-section-label">
        Próximas
        {#if upcoming.length > 0}
          <span class="qp-count">· {upcoming.length}</span>
        {/if}
      </p>

      {#if upcoming.length === 0}
        <p class="qp-empty">No hay nada en la cola.</p>
      {:else}
        <ul class="qp-list">
          {#each upcoming as song, i (song.id + ':' + i)}
            {@const absoluteIndex = queueManager.currentIndex + 1 + i}
            <li>
              <button
                type="button"
                class="qp-row"
                onclick={() => jumpToAbsolute(absoluteIndex)}
              >
                <span class="qp-thumb">
                  <CoverImage src={thumbUrl(song)} alt="">
                    {#snippet fallback()}
                      <MusicNote size="100%" weight="regular" />
                    {/snippet}
                  </CoverImage>
                </span>
                <span class="qp-meta">
                  <span class="qp-title-line">
                    <span class="qp-track-title">{song.title}</span>
                    {#if isExplicit(song)}
                      <ExplicitBadge size="12px" />
                    {/if}
                  </span>
                  <span class="qp-track-artist">{song.artist}</span>
                </span>
                <span class="qp-duration">{formatTime(song.duration)}</span>
                <span
                  class="qp-remove"
                  role="button"
                  tabindex="-1"
                  aria-label="Quitar"
                  onclick={(e) => removeAt(absoluteIndex, e)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      removeAt(absoluteIndex, e as unknown as MouseEvent);
                    }
                  }}
                >
                  <X size={14} weight="bold" />
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if recentHistory.length > 0}
      <section class="qp-section">
        <button
          type="button"
          class="qp-section-toggle"
          onclick={() => (showHistory = !showHistory)}
          aria-expanded={showHistory}
        >
          <span class="qp-section-label">
            Reproducidas <span class="qp-count">· {recentHistory.length}</span>
          </span>
          <span class="qp-chevron" class:open={showHistory}></span>
        </button>

        {#if showHistory}
          <ul class="qp-list qp-list-history">
            {#each recentHistory as song, i (song.id + ':h:' + i)}
              <li>
                <div class="qp-row qp-row-history">
                  <span class="qp-thumb">
                    <CoverImage src={thumbUrl(song)} alt="">
                      {#snippet fallback()}
                        <MusicNote size="100%" weight="regular" />
                      {/snippet}
                    </CoverImage>
                  </span>
                  <span class="qp-meta">
                    <span class="qp-title-line">
                      <span class="qp-track-title">{song.title}</span>
                      {#if isExplicit(song)}
                        <ExplicitBadge size="12px" />
                      {/if}
                    </span>
                    <span class="qp-track-artist">{song.artist}</span>
                  </span>
                  <span class="qp-duration">{formatTime(song.duration)}</span>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>
</aside>

<style>
  /* Anclado a la derecha como CanvasPanel. Glass surface — popover-grade
     blur+saturate para que el contenido del main quede legible detrás cuando
     hay solapamiento durante el slide-in. */
  .queue-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: var(--queue-panel-width, 360px);
    z-index: var(--z-sticky);

    display: flex;
    flex-direction: column;

    background: var(--bg-glass-solid);
    backdrop-filter: blur(40px) saturate(1.6);
    -webkit-backdrop-filter: blur(40px) saturate(1.6);
    border-left: 1px solid var(--border-subtle);
    box-shadow: -8px 0 32px var(--shadow-color-lg);

    isolation: isolate;
    -webkit-tap-highlight-color: transparent;
  }

  @media (max-width: 768px) {
    .queue-panel {
      width: 100vw;
      border-left: none;
    }
  }

  .qp-header {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .qp-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: var(--tracking-body);
    color: var(--text-primary);
  }
  .qp-actions {
    display: flex;
    gap: var(--space-1);
  }
  .qp-action,
  .qp-close {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      color var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .qp-action:hover,
  .qp-close:hover {
    color: var(--text-primary);
    background: var(--bg-surface-hover);
  }
  .qp-close:focus-visible,
  .qp-action:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Body scrollable — header se queda fijo arriba. */
  .qp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) 0 var(--space-4);
  }

  .qp-section {
    padding: var(--space-3) 0;
  }
  .qp-section + .qp-section {
    border-top: 1px solid var(--border-subtle);
  }
  .qp-section-label {
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-5);
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .qp-count {
    font-weight: 500;
    color: var(--text-quaternary);
  }
  .qp-section-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-5);
    margin: 0 0 var(--space-2);
    background: transparent;
    border: none;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .qp-section-toggle:hover .qp-section-label {
    color: var(--text-secondary);
  }
  .qp-section-toggle:focus-visible {
    outline: none;
  }
  .qp-section-toggle:focus-visible .qp-section-label {
    color: var(--text-primary);
  }
  .qp-section-toggle .qp-section-label {
    margin: 0;
    padding: 0;
  }
  .qp-chevron {
    width: 8px;
    height: 8px;
    border-right: 1.5px solid var(--text-tertiary);
    border-bottom: 1.5px solid var(--text-tertiary);
    transform: rotate(-45deg);
    margin-right: 6px;
    transition: transform var(--duration-fast) var(--ease-ios-default);
  }
  .qp-chevron.open {
    transform: rotate(45deg);
  }

  .qp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 1px;
  }
  .qp-list-history li {
    opacity: 0.7;
  }
  .qp-list-history li:hover {
    opacity: 1;
  }

  /* Row: layout idéntico al SongRow pero compacto (40px thumb, 4 columnas:
     thumb | meta | duration | remove-btn). El botón remove es la última
     columna, oculta hasta hover (mismo patrón que SongRow.dots). */
  .qp-row {
    width: 100%;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) auto 28px;
    align-items: center;
    column-gap: var(--space-3);
    padding: var(--space-2) var(--space-5);
    background: transparent;
    border: none;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
    -webkit-tap-highlight-color: transparent;
  }
  .qp-row:hover {
    background: var(--row-hover);
  }
  .qp-row:focus-visible {
    outline: none;
    background: var(--row-hover);
    box-shadow: var(--focus-ring);
  }
  .qp-row-current {
    background: transparent;
    cursor: default;
  }
  .qp-row-current:hover {
    background: transparent;
  }
  .qp-row-history {
    cursor: default;
  }
  .qp-row-history:hover {
    background: var(--row-hover);
  }

  .qp-thumb {
    position: relative;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    box-shadow: var(--shadow-xs);
    flex-shrink: 0;
  }
  .qp-thumb-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
  }

  .qp-meta {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .qp-title-line {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .qp-track-title {
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.25;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .qp-row-current .qp-track-title {
    color: var(--text-accent);
  }
  .qp-track-artist {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qp-duration {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-tertiary);
  }

  /* Remove btn — aparece en hover de la row (no del btn) para no ocupar
     espacio con un blank constante. tabindex=-1 para que el focus
     keyboard del row no caiga en el remove (Enter en la row hace jump,
     no remove). */
  .qp-remove {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    color: var(--text-tertiary);
    display: grid;
    place-items: center;
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .qp-row:hover .qp-remove {
    opacity: 1;
  }
  .qp-remove:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .qp-empty {
    margin: 0;
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    max-width: none;
  }
</style>
