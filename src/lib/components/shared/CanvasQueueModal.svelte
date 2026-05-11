<script lang="ts">
  /**
   * CanvasQueueModal — modal centrado para encolar generación de Canvas
   * desde una URL de YouTube. Acción admin invocable desde el context menu
   * de SongRow (sección "Admin Tools" → "Enviar a la cola de Canvas").
   *
   * Diseño deliberado:
   *   - Modo SIEMPRE `random` (fragmentos aleatorios). El usuario admin
   *     pidió bypass del switch loop/random: para loop irá manualmente al
   *     panel de Housekeeping.
   *   - Sin diálogo de confirmación si ya hay canvas: si el backend
   *     devuelve 409 existing-canvas, mostramos toast informativo y el
   *     usuario decide ir a Housekeeping para reemplazar. No queremos un
   *     "Reemplazar?" inline aquí porque el flujo es spam-friendly (varias
   *     canciones seguidas) y un modal-en-modal rompe ese ritmo.
   *   - El backend ya hace cola FIFO singleton por sí mismo: cada submit
   *     se encola y se procesa cuando llegue su turno.
   */
  import { fade, scale } from 'svelte/transition';
  import { tick } from 'svelte';
  import { X, YoutubeLogo, LinkSimple, MusicNote } from 'phosphor-svelte';
  import { adminToolsUI } from '$stores/admin-tools-ui.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import {
    enqueueCanvasJob,
    isLikelyYoutubeUrl,
    CanvasGenerateError
  } from '$services/CanvasGenerationService';

  let url = $state('');
  let inputEl: HTMLInputElement | undefined = $state();
  let submitting = $state(false);

  const target = $derived(adminToolsUI.canvasQueueTarget);
  const urlOk = $derived(url.length === 0 || isLikelyYoutubeUrl(url));
  const canSubmit = $derived(!!target && url.trim().length > 0 && urlOk && !submitting);

  $effect(() => {
    if (target) {
      url = '';
      submitting = false;
      void tick().then(() => inputEl?.focus());
    }
  });

  $effect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function close() {
    if (submitting) return;
    adminToolsUI.closeCanvasQueue();
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!target || !canSubmit) return;
    submitting = true;
    try {
      await enqueueCanvasJob({
        songId: target.songId,
        youtubeUrl: url.trim(),
        mode: 'random'
      });
      toasts.success(
        'Canvas en cola',
        `«${target.songTitle}» — se generará en cuanto sea su turno.`
      );
      adminToolsUI.closeCanvasQueue();
    } catch (err) {
      if (err instanceof CanvasGenerateError) {
        if (err.kind === 'existing-canvas') {
          toasts.info(
            'Ya tiene canvas',
            'Reemplázalo desde Housekeeping → Contenido si quieres regenerarlo.'
          );
          adminToolsUI.closeCanvasQueue();
          return;
        }
        if (err.kind === 'existing-job') {
          toasts.info(
            'Ya estaba en cola',
            'Hay un job activo para esta canción.'
          );
          adminToolsUI.closeCanvasQueue();
          return;
        }
        if (err.kind === 'bad-request') {
          toasts.warning('Datos no válidos', err.message);
        } else if (err.kind === 'not-found-song') {
          toasts.error('Canción no encontrada', err.message);
        } else if (err.kind === 'no-credentials') {
          toasts.error('Backend sin credenciales Navidrome', err.message);
        } else {
          toasts.error('No se ha podido encolar', err.message);
        }
      } else {
        toasts.error(
          'No se ha podido encolar',
          err instanceof Error ? err.message : 'Algo ha ido mal'
        );
      }
      submitting = false;
    }
  }
</script>

{#if target}
  <div
    class="cqm-scrim"
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 120 }}
    role="presentation"
    onclick={close}
  ></div>
  <div
    class="cqm-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Enviar a la cola de Canvas"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="cqm-head">
      <span class="cqm-icon" aria-hidden="true">
        <YoutubeLogo size={20} weight="fill" />
      </span>
      <div class="cqm-head-text">
        <h2 class="cqm-title">Enviar a la cola de Canvas</h2>
        <p class="cqm-sub">
          Modo fragmentos aleatorios. Se encolará tras los jobs en curso.
        </p>
      </div>
      <button
        type="button"
        class="cqm-close"
        aria-label="Cerrar"
        onclick={close}
        disabled={submitting}
      >
        <X size={14} weight="bold" />
      </button>
    </header>

    <div class="cqm-target">
      <span class="cqm-target-cover" aria-hidden="true">
        <MusicNote size={18} weight="regular" />
      </span>
      <div class="cqm-target-meta">
        <span class="cqm-target-title">{target.songTitle}</span>
        <span class="cqm-target-artist">{target.songArtist}</span>
      </div>
    </div>

    <form class="cqm-form" onsubmit={submit}>
      <label class="cqm-input" class:error={!urlOk}>
        <LinkSimple size={14} weight="bold" />
        <input
          bind:this={inputEl}
          bind:value={url}
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          spellcheck="false"
          autocomplete="off"
          disabled={submitting}
        />
      </label>
      {#if !urlOk}
        <span class="cqm-hint">No reconozco esto como un enlace de YouTube.</span>
      {/if}
      <div class="cqm-actions">
        <button
          type="button"
          class="cqm-btn cqm-btn-ghost"
          onclick={close}
          disabled={submitting}
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="cqm-btn cqm-btn-primary"
          disabled={!canSubmit}
        >
          {submitting ? 'Encolando…' : 'Encolar'}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .cqm-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: var(--z-sticky);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .cqm-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-sticky) + 1);
    width: min(460px, calc(100vw - 32px));
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow:
      0 20px 60px var(--shadow-color-xl),
      0 6px 20px var(--shadow-color-lg);
    color: var(--text-primary);
    overflow: hidden;
  }

  .cqm-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border-bottom: 1px solid var(--border-subtle);
  }
  .cqm-icon {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, #ff0033 14%, transparent);
    border: 1px solid color-mix(in srgb, #ff0033 28%, transparent);
    color: #ff0033;
    flex-shrink: 0;
  }
  .cqm-head-text {
    min-width: 0;
  }
  .cqm-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1.25;
  }
  .cqm-sub {
    margin: 2px 0 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }
  .cqm-close {
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
  .cqm-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .cqm-close:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .cqm-target {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-subtle);
  }
  .cqm-target-cover {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
    background: var(--artwork-placeholder-bg);
    color: var(--artwork-placeholder-fg);
    display: grid;
    place-items: center;
  }
  .cqm-target-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cqm-target-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cqm-target-artist {
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cqm-form {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .cqm-input {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    transition: border-color var(--duration-fast) var(--ease-ios-default);
  }
  .cqm-input:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-muted);
  }
  .cqm-input.error {
    border-color: var(--status-danger);
  }
  .cqm-input input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
  }
  .cqm-input input::placeholder {
    color: var(--text-tertiary);
  }
  .cqm-input input:disabled {
    color: var(--text-tertiary);
  }
  .cqm-hint {
    font-size: var(--text-xs);
    color: var(--status-danger);
    padding-left: 4px;
  }

  .cqm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .cqm-btn {
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default);
    font-family: inherit;
  }
  .cqm-btn:active:not(:disabled) {
    transform: scale(0.97);
    transition-duration: var(--duration-instant);
  }
  .cqm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cqm-btn-ghost {
    background: transparent;
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
  }
  .cqm-btn-ghost:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }
  .cqm-btn-primary {
    background: var(--accent);
    border: 1px solid transparent;
    color: var(--text-on-accent);
  }
  .cqm-btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .cqm-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
</style>
