<script lang="ts">
  /**
   * SmartTagsModal — modal admin para editar los smart tags (mood, género,
   * idioma) de una canción vía Music-API. Invocable desde el menú
   * contextual de SongRow (Admin Tools → "Editar smart tags").
   *
   * Cada campo se guarda independientemente con su propio botón "Guardar"
   * — replica el patrón del legacy y permite tocar un único tag sin
   * arrastrar los demás. Port del `src/components/SmartTagModal.tsx` del
   * frontend Audiorr-backend.
   */
  import { fade, scale } from 'svelte/transition';
  import { tick } from 'svelte';
  import { X, Tag, MusicNote, Check, Warning } from 'phosphor-svelte';
  import { adminToolsUI } from '$stores/admin-tools-ui.svelte';
  import {
    getSongData,
    updateTag,
    type SmartTagField
  } from '$services/MusicApiService';

  const target = $derived(adminToolsUI.smartTagsTarget);

  type FieldState = {
    value: string;
    saving: boolean;
    feedback: { ok: boolean; msg: string } | null;
  };

  const FIELDS: { key: SmartTagField; label: string; placeholder: string }[] = [
    { key: 'mood', label: 'Mood', placeholder: 'ej: happy, sad, energetic…' },
    { key: 'genre', label: 'Género', placeholder: 'ej: Rock, Latin Pop…' },
    { key: 'language', label: 'Idioma', placeholder: 'ej: spa, eng…' }
  ];

  const emptyField = (): FieldState => ({ value: '', saving: false, feedback: null });

  let fields = $state<Record<SmartTagField, FieldState>>({
    mood: emptyField(),
    genre: emptyField(),
    language: emptyField()
  });
  let loadingData = $state(true);
  let dialogEl: HTMLDivElement | undefined = $state();

  /** Al abrir: reset + fetch de los tags actuales desde Music-API. */
  $effect(() => {
    const current = target;
    if (!current) return;

    fields = { mood: emptyField(), genre: emptyField(), language: emptyField() };
    loadingData = true;

    let cancelled = false;
    void getSongData(current.songId).then((res) => {
      if (cancelled || adminToolsUI.smartTagsTarget?.songId !== current.songId) return;
      if (res.success && res.tags) {
        fields = {
          mood: { value: res.tags.mood ?? '', saving: false, feedback: null },
          genre: { value: res.tags.genre ?? '', saving: false, feedback: null },
          language: { value: res.tags.language ?? '', saving: false, feedback: null }
        };
      }
      loadingData = false;
      void tick().then(() => {
        dialogEl?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      });
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

  const anySaving = $derived(
    fields.mood.saving || fields.genre.saving || fields.language.saving
  );

  function close() {
    if (anySaving) return;
    adminToolsUI.closeSmartTags();
  }

  function patch(key: SmartTagField, p: Partial<FieldState>) {
    fields = { ...fields, [key]: { ...fields[key], ...p } };
  }

  async function save(key: SmartTagField) {
    if (!target) return;
    const val = fields[key].value.trim();
    if (!val || fields[key].saving) return;
    patch(key, { saving: true, feedback: null });
    const res = await updateTag(target.songId, key, val);
    patch(key, {
      saving: false,
      feedback: {
        ok: res.success,
        msg: res.success
          ? res.message ?? 'Tag actualizado.'
          : res.error ?? 'Error desconocido.'
      }
    });
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
    bind:this={dialogEl}
    class="cqm-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Editar smart tags"
    in:scale={{ duration: 240, start: 0.94, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.96, opacity: 0 }}
  >
    <header class="cqm-head">
      <span class="cqm-icon" aria-hidden="true">
        <Tag size={20} weight="fill" />
      </span>
      <div class="cqm-head-text">
        <h2 class="cqm-title">Editar smart tags</h2>
        <p class="cqm-sub">
          Mood, género e idioma. Cada campo se guarda por separado.
        </p>
      </div>
      <button
        type="button"
        class="cqm-close"
        aria-label="Cerrar"
        onclick={close}
        disabled={anySaving}
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

    <div class="cqm-form">
      {#if loadingData}
        <div class="cqm-loading">Cargando smart tags actuales…</div>
      {:else}
        {#each FIELDS as f (f.key)}
          {@const state = fields[f.key]}
          <div class="cqm-field">
            <label class="cqm-field-label" for={`smarttag-${f.key}`}>
              {f.label}
            </label>
            <div class="cqm-row">
              <label class="cqm-input">
                <Tag size={14} weight="bold" />
                <input
                  id={`smarttag-${f.key}`}
                  type="text"
                  value={state.value}
                  oninput={(e) =>
                    patch(f.key, {
                      value: (e.target as HTMLInputElement).value,
                      feedback: null
                    })}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void save(f.key);
                    }
                  }}
                  placeholder={f.placeholder}
                  disabled={state.saving}
                  autocomplete="off"
                  spellcheck="false"
                />
              </label>
              <button
                type="button"
                class="cqm-btn cqm-btn-primary cqm-btn-sm"
                onclick={() => void save(f.key)}
                disabled={state.saving || !state.value.trim()}
              >
                {state.saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            {#if state.feedback}
              <div
                class="cqm-feedback"
                class:ok={state.feedback.ok}
                class:err={!state.feedback.ok}
              >
                {#if state.feedback.ok}
                  <Check size={12} weight="bold" />
                {:else}
                  <Warning size={12} weight="bold" />
                {/if}
                <span>{state.feedback.msg}</span>
              </div>
            {/if}
          </div>
        {/each}
      {/if}

      <div class="cqm-actions">
        <button
          type="button"
          class="cqm-btn cqm-btn-ghost"
          onclick={close}
          disabled={anySaving}
        >
          Cerrar
        </button>
      </div>
    </div>
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
    width: min(480px, calc(100vw - 32px));
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
    gap: var(--space-4);
  }
  .cqm-loading {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-align: center;
    padding: var(--space-4) 0;
  }
  .cqm-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .cqm-field-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-weight: 600;
  }
  .cqm-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2);
    align-items: stretch;
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
    min-width: 0;
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
  }
  .cqm-input input::placeholder {
    color: var(--text-tertiary);
  }
  .cqm-input input:disabled {
    color: var(--text-tertiary);
  }
  .cqm-feedback {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
  }
  .cqm-feedback.ok {
    background: color-mix(in srgb, var(--status-success) 14%, transparent);
    color: var(--status-success);
  }
  .cqm-feedback.err {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    color: var(--status-danger);
  }

  .cqm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
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
    white-space: nowrap;
  }
  .cqm-btn-sm {
    padding: var(--space-2) var(--space-3);
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
