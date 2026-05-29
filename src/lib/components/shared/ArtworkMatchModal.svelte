<script lang="ts">
  /**
   * ArtworkMatchModal — confirmación del match antes de descargar animated
   * artwork (ADMIN). El auto-match de Apple/iTunes falla a menudo con títulos
   * cortos o ambiguos, así que en vez de descargar a ciegas mostramos los
   * candidatos y dejamos que el admin confirme el correcto (o pegue un
   * collectionId a mano).
   *
   * Flujo self-contained:
   *   open → busca candidatos (GET /search, no descarga nada) → el admin elige
   *   uno (o escribe un collectionId) → descarga (POST /fetch con collectionId,
   *   origin manual) → poll del job → toast → onConfirmed (refetch del caller).
   *
   * Solo los candidatos con `hasMotion` son descargables (los demás no tienen
   * vídeo). El `best` sugerido por el backend viene preseleccionado.
   */
  import { fade, scale } from 'svelte/transition';
  import { FilmSlate, X, CheckCircle, MagnifyingGlass } from 'phosphor-svelte';
  import {
    searchArtworkCandidates,
    triggerArtworkFetch,
    pollArtworkJob,
    type AppleSearchCandidate
  } from '$services/AlbumArtworkService';
  import { BackendError } from '$services/BackendService.svelte';
  import { toasts } from '$stores/toasts.svelte';

  type Props = {
    open: boolean;
    albumId: string;
    artist: string;
    title: string;
    /** Disparado tras encolar/descargar con éxito — el caller refetchea. */
    onConfirmed?: () => void;
    onClose: () => void;
  };

  let { open, albumId, artist, title, onConfirmed, onClose }: Props = $props();

  type Phase = 'searching' | 'choosing' | 'downloading' | 'error';
  let phase = $state<Phase>('searching');
  let candidates = $state<AppleSearchCandidate[]>([]);
  let errorMsg = $state('');
  /** collectionId del candidato seleccionado (radio). String para comparar. */
  let selectedId = $state<string | null>(null);
  /** Entrada manual: si el admin pega un collectionId, tiene prioridad. */
  let manualId = $state('');

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // collectionId efectivo: el manual gana sobre el seleccionado.
  const effectiveId = $derived(manualId.trim() || selectedId || '');

  function key(c: AppleSearchCandidate): string {
    return String(c.collectionId);
  }

  function stopPoll() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Al abrir: reset + búsqueda de candidatos. Al cerrar: limpia el poll.
  $effect(() => {
    if (!open) {
      stopPoll();
      return;
    }
    // Reset de estado en cada apertura.
    phase = 'searching';
    candidates = [];
    errorMsg = '';
    selectedId = null;
    manualId = '';
    void runSearch();
    return () => stopPoll();
  });

  async function runSearch() {
    try {
      const res = await searchArtworkCandidates({ artist, title });
      if (!res) {
        phase = 'error';
        errorMsg = 'El backend no devolvió candidatos (¿endpoint sin desplegar?).';
        return;
      }
      candidates = res.candidates;
      // Preselecciona el "best" sugerido si tiene motion; si no, el primero
      // con motion. Si ninguno tiene motion, no preselecciona nada (solo los
      // candidatos con motion son descargables).
      const best = res.best != null ? String(res.best) : null;
      const bestCand = candidates.find((c) => key(c) === best && c.hasMotion);
      const firstMotion = candidates.find((c) => c.hasMotion);
      selectedId = bestCand ? key(bestCand) : firstMotion ? key(firstMotion) : null;
      phase = 'choosing';
    } catch (err) {
      phase = 'error';
      errorMsg = err instanceof Error ? err.message : 'Error al buscar candidatos';
    }
  }

  async function confirm() {
    const id = effectiveId;
    if (!id || phase === 'downloading') return;
    phase = 'downloading';
    try {
      const enqueued = await triggerArtworkFetch({
        albumId,
        artist,
        title,
        collectionId: id,
        origin: 'manual',
        // El item de descarga solo aparece sin artwork previo, pero si el admin
        // corrige uno existente desde aquí, force evita el 409 por duplicado.
        force: true
      });
      const jobId = enqueued.jobId;
      // Poll cada 3 s hasta done/failed (mismo ritmo que el job del backend).
      pollTimer = setInterval(async () => {
        try {
          const job = await pollArtworkJob(jobId);
          if (!job) return;
          if (job.status === 'done') {
            stopPoll();
            if (job.matchStatus === 'no-motion' || job.matchStatus === 'not-found') {
              toasts.info('Sin animated artwork', 'Ese candidato no tiene motion en Apple Music');
            } else {
              toasts.success('Animated artwork descargado', title);
              onConfirmed?.();
            }
            onClose();
          } else if (job.status === 'failed') {
            stopPoll();
            phase = 'error';
            errorMsg = job.error ?? 'El job de descarga falló sin detalle';
          }
        } catch {
          stopPoll();
          phase = 'error';
          errorMsg = 'Error al consultar el estado del job';
        }
      }, 3000);
    } catch (err) {
      const msg =
        err instanceof BackendError
          ? `Error ${err.status} al iniciar la descarga`
          : err instanceof Error
            ? err.message
            : 'Error desconocido';
      phase = 'error';
      errorMsg = msg;
    }
  }

  function close() {
    if (phase === 'downloading') return; // no cerrar a mitad de descarga
    onClose();
  }

  // ESC cierra (salvo durante la descarga).
  $effect(() => {
    if (!open) return;
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

{#if open}
  <div
    class="amm-scrim"
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 120 }}
    role="presentation"
    onclick={close}
  ></div>
  <div
    class="amm-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Confirmar animated artwork"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="amm-head">
      <span class="amm-icon" aria-hidden="true">
        <FilmSlate size={20} weight="regular" />
      </span>
      <div class="amm-head-text">
        <h2 class="amm-title">Confirmar artwork</h2>
        <p class="amm-sub">{artist} — {title}</p>
      </div>
      <button
        type="button"
        class="amm-close"
        aria-label="Cerrar"
        onclick={close}
        disabled={phase === 'downloading'}
      >
        <X size={14} weight="bold" />
      </button>
    </header>

    <div class="amm-body">
      {#if phase === 'searching'}
        <div class="amm-status" aria-busy="true">
          <span class="amm-spinner"></span>
          <p>Buscando coincidencias en Apple Music…</p>
        </div>
      {:else if phase === 'error'}
        <div class="amm-status amm-status-error">
          <p>{errorMsg}</p>
          <button type="button" class="amm-btn amm-btn-ghost" onclick={runSearch}>
            <MagnifyingGlass size={14} weight="bold" /> Reintentar búsqueda
          </button>
        </div>
      {:else}
        {#if candidates.length === 0}
          <p class="amm-empty">
            No se encontraron candidatos. Pega un collection ID de iTunes abajo
            si lo conoces.
          </p>
        {:else}
          <p class="amm-hint">
            El match automático falla a menudo. Elige el álbum correcto:
          </p>
          <ul class="amm-list">
            {#each candidates as c (key(c))}
              <li>
                <label class="amm-cand" class:disabled={!c.hasMotion}>
                  <input
                    type="radio"
                    name="artwork-candidate"
                    value={key(c)}
                    checked={selectedId === key(c)}
                    disabled={!c.hasMotion || phase === 'downloading'}
                    onchange={() => {
                      selectedId = key(c);
                      manualId = '';
                    }}
                  />
                  <span class="amm-thumb">
                    {#if c.artworkThumbnailUrl}
                      <img src={c.artworkThumbnailUrl} alt="" loading="lazy" />
                    {:else}
                      <FilmSlate size={20} weight="regular" />
                    {/if}
                  </span>
                  <span class="amm-cand-text">
                    <span class="amm-cand-name">{c.name}</span>
                    <span class="amm-cand-artist">{c.artist}</span>
                  </span>
                  {#if c.hasMotion}
                    <span class="amm-badge amm-badge-motion">
                      <CheckCircle size={12} weight="fill" /> Motion
                    </span>
                  {:else}
                    <span class="amm-badge amm-badge-none">Sin motion</span>
                  {/if}
                </label>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="amm-manual">
          <label class="amm-manual-label" for="amm-manual-id">
            …o pega un collection ID de iTunes a mano
          </label>
          <input
            id="amm-manual-id"
            type="text"
            class="amm-manual-input"
            placeholder="p. ej. 1451901307"
            bind:value={manualId}
            disabled={phase === 'downloading'}
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      {/if}
    </div>

    <footer class="amm-actions">
      <button
        type="button"
        class="amm-btn amm-btn-ghost"
        onclick={close}
        disabled={phase === 'downloading'}
      >
        Cancelar
      </button>
      <button
        type="button"
        class="amm-btn amm-btn-primary"
        onclick={confirm}
        disabled={!effectiveId || phase === 'searching' || phase === 'downloading'}
      >
        {phase === 'downloading' ? 'Descargando…' : 'Descargar'}
      </button>
    </footer>
  </div>
{/if}

<style>
  .amm-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: var(--z-sticky);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .amm-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-sticky) + 1);
    width: min(440px, calc(100vw - 32px));
    max-height: min(80vh, 640px);
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

  .amm-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .amm-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--accent);
    flex-shrink: 0;
  }
  .amm-head-text {
    min-width: 0;
  }
  .amm-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1.25;
  }
  .amm-sub {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .amm-close {
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
  .amm-close:hover:not(:disabled) {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .amm-close:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .amm-body {
    padding: var(--space-4);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .amm-status {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-6) var(--space-3);
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }
  .amm-status-error {
    color: var(--status-error, var(--text-secondary));
  }
  .amm-spinner {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--border-subtle);
    border-top-color: var(--accent);
    animation: amm-spin 0.8s linear infinite;
  }
  @keyframes amm-spin {
    to { transform: rotate(360deg); }
  }

  .amm-hint,
  .amm-empty {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  .amm-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .amm-cand {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .amm-cand:hover:not(.disabled) {
    background: var(--bg-surface-hover);
  }
  .amm-cand:has(input:checked) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .amm-cand.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .amm-cand input {
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .amm-thumb {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--artwork-placeholder-bg);
    color: var(--artwork-placeholder-fg);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .amm-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .amm-cand-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .amm-cand-name {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .amm-cand-artist {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .amm-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .amm-badge-motion {
    background: color-mix(in srgb, var(--status-success, #22c55e) 16%, transparent);
    color: var(--status-success, #22c55e);
  }
  .amm-badge-none {
    background: var(--bg-surface);
    color: var(--text-tertiary);
  }

  .amm-manual {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--separator-subtle);
  }
  .amm-manual-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .amm-manual-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-sm);
    box-sizing: border-box;
    transition: border-color var(--duration-fast) var(--ease-ios-default);
  }
  .amm-manual-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-muted);
  }
  .amm-manual-input:disabled {
    opacity: 0.6;
  }

  .amm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .amm-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
  }
  .amm-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: var(--duration-instant);
  }
  .amm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .amm-btn-ghost {
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }
  .amm-btn-ghost:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }
  .amm-btn-primary {
    background: var(--accent);
    border: 1px solid transparent;
    color: var(--text-on-accent);
  }
  .amm-btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .amm-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  @media (prefers-reduced-motion: reduce) {
    .amm-spinner { animation-duration: 1.6s; }
  }
</style>
