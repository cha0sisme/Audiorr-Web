<script lang="ts">
  /**
   * UpdatePlayCountModal — modal admin para actualizar el play_count de
   * una canción a través de Music-API. Invocable desde el menú contextual
   * de SongRow (Admin Tools → "Editar reproducciones").
   *
   * Port del legacy `src/components/UpdatePlayCountModal.tsx` (frontend
   * Audiorr-backend), adaptado a Svelte 5 runes + tokens del design
   * system + toasts del proyecto.
   */
  import { fade, scale } from 'svelte/transition';
  import { tick } from 'svelte';
  import { X, Hash, MusicNote } from 'phosphor-svelte';
  import { adminToolsUI } from '$stores/admin-tools-ui.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { getSongData, updatePlayCount } from '$services/MusicApiService';

  const target = $derived(adminToolsUI.playCountTarget);

  let playCount = $state(0);
  let loadingData = $state(true);
  let saving = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();

  const canSave = $derived(!!target && !loadingData && !saving && playCount >= 0);

  /** Al abrir: reset + fetch del play_count actual desde Music-API. */
  $effect(() => {
    const current = target;
    if (!current) return;

    playCount = 0;
    loadingData = true;
    saving = false;

    let cancelled = false;
    void getSongData(current.songId).then((res) => {
      if (cancelled || adminToolsUI.playCountTarget?.songId !== current.songId) return;
      if (res.success && typeof res.play_count === 'number') {
        playCount = res.play_count;
      }
      loadingData = false;
      void tick().then(() => inputEl?.focus());
    });
    return () => {
      cancelled = true;
    };
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
    if (saving) return;
    adminToolsUI.closePlayCount();
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!target || !canSave) return;
    saving = true;
    const res = await updatePlayCount(target.songId, playCount);
    saving = false;

    if (res.success) {
      toasts.success(
        'Reproducciones actualizadas',
        `«${target.songTitle}» — ${playCount} reproducciones.`
      );
      adminToolsUI.closePlayCount();
    } else {
      toasts.error('No se ha podido actualizar', res.error ?? 'Error desconocido.');
    }
  }

  function onInput(e: Event) {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (!isNaN(v) && v >= 0) playCount = v;
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
    aria-label="Editar reproducciones"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="cqm-head">
      <span class="cqm-icon" aria-hidden="true">
        <Hash size={20} weight="bold" />
      </span>
      <div class="cqm-head-text">
        <h2 class="cqm-title">Editar reproducciones</h2>
        <p class="cqm-sub">
          Sobrescribe el play_count en la DB de Navidrome vía Music-API.
        </p>
      </div>
      <button
        type="button"
        class="cqm-close"
        aria-label="Cerrar"
        onclick={close}
        disabled={saving}
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
      <label class="cqm-field-label" for="playcount-input">
        {loadingData ? 'Cargando reproducciones actuales…' : `Reproducciones actuales: ${playCount}`}
      </label>
      <label class="cqm-input">
        <Hash size={14} weight="bold" />
        <input
          id="playcount-input"
          bind:this={inputEl}
          type="number"
          min="0"
          value={playCount}
          oninput={onInput}
          disabled={loadingData || saving}
          autocomplete="off"
        />
      </label>
      <div class="cqm-actions">
        <button
          type="button"
          class="cqm-btn cqm-btn-ghost"
          onclick={close}
          disabled={saving}
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="cqm-btn cqm-btn-primary"
          disabled={!canSave}
        >
          {saving ? 'Guardando…' : 'Guardar'}
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
    background: var(--accent-muted);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    color: var(--accent);
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
  .cqm-field-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-weight: 600;
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
  .cqm-input input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
    font-variant-numeric: tabular-nums;
  }
  .cqm-input input:disabled {
    color: var(--text-tertiary);
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
