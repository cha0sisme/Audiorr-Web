<script lang="ts">
  /**
   * TransitionDetailPanel — sheet derecho del viewer de Diagnostics.
   *
   * Mirror del iOS TransitionDetailSheet (TransitionDiagnosticsView.swift:959+).
   * Renderiza:
   *   - Header con from→to, fecha, type badge.
   *   - StarRating10 — autosave inmediato al click.
   *   - Comment textarea — autosave debounced 1s.
   *   - Botón "Borrar comentario" (solo si hay texto).
   *   - Sección técnica: chips coloreados con flags activos + datos numéricos
   *     clave (BPM, energy, fade, entry, anticipation, paths).
   *
   * El componente es controlado por el caller — recibe el record y tres
   * callbacks. NO hace fetch propio.
   */
  import { X, Trash, Info } from 'phosphor-svelte';
  import type { TransitionRecord } from '$types/diagnostics';
  import StarRating10 from './StarRating10.svelte';

  type Props = {
    record: TransitionRecord;
    onClose: () => void;
    /** Llamado al cambiar rating o al flush del comment debounce. Cualquiera
        de los dos campos puede ser null para limpiarlo. */
    onCommit: (payload: { userRating?: number | null; userComment?: string | null }) => void;
    onDeleteComment: () => void;
  };

  let { record, onClose, onCommit, onDeleteComment }: Props = $props();

  // Estado local del editor — inicializado vacío y populado por el $effect
  // que watcha `record` (corre al primer render Y cada vez que el caller
  // pasa un record distinto). Inicializar a `record.userRating ?? 0` aquí
  // capturaría solo el valor inicial — el linter de Svelte 5 lo rechaza.
  let rating = $state(0);
  let comment = $state('');
  let lastSavedComment = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    rating = record.userRating ?? 0;
    comment = record.userComment ?? '';
    lastSavedComment = record.userComment ?? '';
  });

  function handleRatingChange(next: number) {
    rating = next;
    onCommit({
      userRating: next === 0 ? null : next,
      userComment: comment.length > 0 ? comment : null
    });
  }

  function scheduleCommentSave(value: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (value === lastSavedComment) return;
      lastSavedComment = value;
      onCommit({
        userRating: rating === 0 ? null : rating,
        userComment: value.length > 0 ? value : null
      });
    }, 1000);
  }

  function handleCommentInput(e: Event) {
    const t = e.target as HTMLTextAreaElement;
    comment = t.value;
    scheduleCommentSave(t.value);
  }

  function handleDelete() {
    if (debounceTimer) clearTimeout(debounceTimer);
    comment = '';
    lastSavedComment = '';
    onDeleteComment();
  }

  // Force flush al cerrar (por si el debounce no llegó).
  function handleClose() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (comment !== lastSavedComment) {
      lastSavedComment = comment;
      onCommit({
        userRating: rating === 0 ? null : rating,
        userComment: comment.length > 0 ? comment : null
      });
    }
    onClose();
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString('es-ES', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  }
  function fmtNum(n: number | undefined, digits = 2): string {
    if (n === undefined) return '—';
    return n.toFixed(digits);
  }

  // Chips de mecanismos: solo renderizamos los que están active=true. Color
  // ajustado por categoría (filter, gate, anticipation, etc.) para escaneo
  // rápido visual. Nombre humano corto.
  type Chip = { label: string; tone: 'accent' | 'success' | 'warning' | 'neutral' };
  const flagChips = $derived.by((): Chip[] => {
    const r = record;
    const out: Chip[] = [];
    if (r.beatSynced) out.push({ label: 'beat-sync', tone: 'success' });
    if (r.timeStretched) out.push({ label: 'time-stretch', tone: 'accent' });
    if (r.tier4Active) out.push({ label: 'tier4', tone: 'accent' });
    if (r.chillRecipeApplied) out.push({ label: 'chill', tone: 'accent' });
    if (r.genreCapApplied) out.push({ label: 'genre-cap', tone: 'warning' });
    if (r.entryFinalCapApplied) out.push({ label: 'entry-cap', tone: 'warning' });
    if (r.bRapidFadeIn) out.push({ label: 'B rapid-in', tone: 'neutral' });
    if (r.isIntroInstrumental) out.push({ label: 'intro instr.', tone: 'neutral' });
    if (r.isOutroInstrumental) out.push({ label: 'outro instr.', tone: 'neutral' });
    if (r.skipBFilters) out.push({ label: 'skip B filt.', tone: 'neutral' });
    if (r.useBassKill) out.push({ label: 'bass-kill', tone: 'neutral' });
    if (r.useMidScoop) out.push({ label: 'mid-scoop', tone: 'neutral' });
    if (r.useHighShelfCut) out.push({ label: 'highshelf', tone: 'neutral' });
    if (r.useNotchSweep) out.push({ label: 'notch', tone: 'neutral' });
    if (r.useStutterCut) out.push({ label: 'stutter', tone: 'neutral' });
    if (r.useDynamicQ) out.push({ label: 'dynamic-Q', tone: 'neutral' });
    return out;
  });
</script>

<aside class="dx-panel" aria-label="Detalle de transición">
  <header class="dx-header">
    <h2 class="dx-title">Transición</h2>
    <button type="button" class="dx-close" aria-label="Cerrar" onclick={handleClose}>
      <X size={16} weight="bold" />
    </button>
  </header>

  <div class="dx-body">
    <!-- ─── Header card: tracks + meta ────────────────────────────────── -->
    <section class="dx-card">
      <p class="dx-track from">
        <span class="dx-track-label">DESDE</span>
        <span class="dx-track-title">{record.fromTitle}</span>
        {#if record.fromArtist}
          <span class="dx-track-artist">{record.fromArtist}</span>
        {/if}
      </p>
      <div class="dx-arrow" aria-hidden="true">↓</div>
      <p class="dx-track to">
        <span class="dx-track-label">HACIA</span>
        <span class="dx-track-title">{record.toTitle}</span>
        {#if record.toArtist}
          <span class="dx-track-artist">{record.toArtist}</span>
        {/if}
      </p>
      <div class="dx-meta-row">
        <span class="dx-type-badge">{record.type}</span>
        <span class="dx-meta-date">{fmtDate(record.date)}</span>
      </div>
    </section>

    <!-- ─── Rating ────────────────────────────────────────────────────── -->
    <section class="dx-card">
      <h3 class="dx-section-title">Tu valoración</h3>
      <div class="dx-rating-wrap">
        <StarRating10 value={rating} onChange={handleRatingChange} size={26} />
        <span class="dx-rating-num" aria-hidden="true">
          {rating === 0 ? '—' : rating}
        </span>
      </div>
      <p class="dx-rating-hint">
        Click sobre la última estrella activa para limpiar.
      </p>
    </section>

    <!-- ─── Comment ───────────────────────────────────────────────────── -->
    <section class="dx-card">
      <h3 class="dx-section-title">Comentario</h3>
      <textarea
        class="dx-textarea"
        placeholder="¿Qué pasó en esta transición?"
        rows={4}
        value={comment}
        oninput={handleCommentInput}
      ></textarea>
      {#if lastSavedComment.length > 0}
        <button type="button" class="dx-delete-btn" onclick={handleDelete}>
          <Trash size={14} weight="regular" />
          <span>Borrar comentario</span>
        </button>
      {/if}
    </section>

    <!-- ─── Mecanismos / chips ───────────────────────────────────────── -->
    {#if flagChips.length > 0}
      <section class="dx-card">
        <h3 class="dx-section-title">Mecanismos activos</h3>
        <div class="dx-chips">
          {#each flagChips as c (c.label)}
            <span class="dx-chip" data-tone={c.tone}>{c.label}</span>
          {/each}
        </div>
      </section>
    {/if}

    <!-- ─── Datos técnicos ───────────────────────────────────────────── -->
    <section class="dx-card">
      <h3 class="dx-section-title">
        <Info size={14} weight="regular" />
        Telemetría
      </h3>
      <dl class="dx-grid">
        <div class="dx-cell">
          <dt>BPM A → B</dt>
          <dd>{fmtNum(record.bpmA, 1)} → {fmtNum(record.bpmB, 1)}</dd>
        </div>
        <div class="dx-cell">
          <dt>Energy A → B</dt>
          <dd>{fmtNum(record.energyA, 2)} → {fmtNum(record.energyB, 2)}</dd>
        </div>
        <div class="dx-cell">
          <dt>Fade duration</dt>
          <dd>{fmtNum(record.fadeDuration, 2)} s</dd>
        </div>
        <div class="dx-cell">
          <dt>Entry point B</dt>
          <dd>{fmtNum(record.entryPoint, 2)} s</dd>
        </div>
        <div class="dx-cell">
          <dt>Anticipation</dt>
          <dd>
            {fmtNum(record.anticipationTime, 2)} s
            {#if record.anticipationReason}
              <span class="dx-cell-note">· {record.anticipationReason}</span>
            {/if}
          </dd>
        </div>
        <div class="dx-cell">
          <dt>Entry source</dt>
          <dd>{record.entryPointSource ?? '—'}</dd>
        </div>
        <div class="dx-cell">
          <dt>Filter preset</dt>
          <dd>{record.filterPreset ?? '—'}</dd>
        </div>
        <div class="dx-cell">
          <dt>Beat sync</dt>
          <dd>{record.beatSyncInfo ?? '—'}</dd>
        </div>
        {#if record.transitionReason}
          <div class="dx-cell dx-cell-wide">
            <dt>Razón</dt>
            <dd>{record.transitionReason}</dd>
          </div>
        {/if}
        {#if record.tier4FailedGate}
          <div class="dx-cell dx-cell-wide">
            <dt>Tier4 falló por</dt>
            <dd>{record.tier4FailedGate}</dd>
          </div>
        {/if}
        <div class="dx-cell dx-cell-wide">
          <dt>Algoritmo</dt>
          <dd>
            <span class="dx-algo">{record.algorithmVersion}</span>
            <span class="dx-build">·  {record.buildId}</span>
          </dd>
        </div>
      </dl>
    </section>
  </div>
</aside>

<style>
  /* Sheet derecho fijo. El layout lo monta detrás de un scrim para que se vea
     como overlay sin desplazar el shell. mismo patrón visual que QueuePanel. */
  .dx-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 100vw);
    z-index: var(--z-sticky);
    display: flex;
    flex-direction: column;
    background: var(--bg-glass-solid);
    backdrop-filter: blur(40px) saturate(1.6);
    -webkit-backdrop-filter: blur(40px) saturate(1.6);
    border-left: 1px solid var(--border-subtle);
    box-shadow: -8px 0 32px var(--shadow-color-lg);
    isolation: isolate;
    color: var(--text-primary);
    -webkit-tap-highlight-color: transparent;
  }
  .dx-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }
  .dx-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: var(--tracking-body);
  }
  .dx-close {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .dx-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .dx-close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .dx-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .dx-card {
    background: var(--bg-surface-elevated);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    border: 1px solid var(--border-subtle);
  }
  .dx-section-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Header card — tracks from/to */
  .dx-track {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dx-track-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .dx-track-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.25;
  }
  .dx-track-artist {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
  .dx-arrow {
    text-align: center;
    margin: var(--space-2) 0;
    color: var(--text-tertiary);
    font-size: var(--text-base);
  }
  .dx-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
  }
  .dx-type-badge {
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    background: var(--accent-muted);
    padding: 4px 10px;
    border-radius: var(--radius-full);
  }
  .dx-meta-date {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  /* Rating */
  .dx-rating-wrap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  .dx-rating-num {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    min-width: 24px;
    text-align: right;
  }
  .dx-rating-hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  /* Comment */
  .dx-textarea {
    width: 100%;
    min-height: 96px;
    resize: vertical;
    padding: var(--space-3);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.5;
    box-sizing: border-box;
    transition: border-color var(--duration-fast) var(--ease-ios-default);
  }
  .dx-textarea:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-muted);
  }
  .dx-delete-btn {
    margin-top: var(--space-2);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--status-danger-text);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .dx-delete-btn:hover {
    background: var(--status-danger-bg);
  }

  /* Chips de mecanismos */
  .dx-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .dx-chip {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    color: var(--text-secondary);
    letter-spacing: 0.01em;
  }
  .dx-chip[data-tone='accent'] {
    color: var(--accent);
    background: var(--accent-muted);
    border-color: transparent;
  }
  .dx-chip[data-tone='success'] {
    color: var(--status-success-text);
    background: var(--status-success-bg);
    border-color: transparent;
  }
  .dx-chip[data-tone='warning'] {
    color: var(--status-warning-text);
    background: var(--status-warning-bg);
    border-color: transparent;
  }

  /* Telemetría grid */
  .dx-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
    margin: 0;
  }
  .dx-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .dx-cell-wide {
    grid-column: 1 / -1;
  }
  .dx-cell dt {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .dx-cell dd {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    word-break: break-word;
  }
  .dx-cell-note {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .dx-algo {
    color: var(--text-primary);
  }
  .dx-build {
    color: var(--text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  @media (max-width: 768px) {
    .dx-panel {
      width: 100vw;
      border-left: none;
    }
  }
</style>
