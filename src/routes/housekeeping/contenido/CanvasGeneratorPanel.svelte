<script lang="ts">
  /**
   * Auto-Generador de Canvas desde YouTube — panel admin housekeeping.
   *
   * Flujo:
   *   1) Buscar canción en Navidrome.
   *   2) Pegar URL de YouTube + elegir modo (random | loop).
   *   3) Generar → encola job, polling cada 1s hasta done/failed.
   *   4) Si ya existe canvas para esta canción → modal de confirmación
   *      con phone-frame del canvas actual + opción "Reemplazar" (force:true).
   *   5) Al done → mostrar .mp4 resultante, invalidar caches de canvas.
   *
   * Servicio: $services/CanvasGenerationService.ts
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    MagnifyingGlass,
    LinkSimple,
    X,
    Check,
    MusicNote,
    Warning,
    YoutubeLogo,
    ArrowsClockwise,
    SlidersHorizontal,
    Sparkle,
    Repeat,
    Play
  } from 'phosphor-svelte';
  import * as nav from '$services/NavidromeService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { backendService } from '$services/BackendService.svelte';
  import { invalidateCanvas } from '$services/CanvasService';
  import {
    enqueueCanvasJob,
    getCanvasJob,
    isLikelyYoutubeUrl,
    CanvasGenerateError
  } from '$services/CanvasGenerationService';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { NavidromeSong } from '$types/navidrome';
  import type {
    CanvasEntry,
    CanvasGenerateMode,
    CanvasGenerationJob,
    CanvasGenerationPhase
  } from '$types/backend';

  const queryClient = useQueryClient();

  // ─── Búsqueda Navidrome ───────────────────────────────────────────────
  let searchValue = $state('');
  let searchDebounced = $state('');
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSearchInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    searchValue = v;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => (searchDebounced = v.trim()), 250);
  }

  const searchQ = createQuery(() => ({
    queryKey: ['hk-cangen-search', searchDebounced],
    queryFn: () =>
      nav.search3(searchDebounced, {
        artistCount: 0,
        albumCount: 0,
        songCount: 20
      }),
    enabled: credentials.isConfigured && searchDebounced.length >= 2,
    staleTime: 60 * 1000
  }));
  const searchResults = $derived(searchQ.data?.songs ?? []);

  // ─── Estado del form ──────────────────────────────────────────────────
  let selectedSong = $state<NavidromeSong | null>(null);
  let youtubeUrl = $state('');
  let mode = $state<CanvasGenerateMode>('random');
  let showAdvanced = $state(false);
  let fragments = $state(4);
  let fragmentSec = $state(2);
  let durationSec = $state(7);

  const urlOk = $derived(youtubeUrl.length === 0 || isLikelyYoutubeUrl(youtubeUrl));
  const canGenerate = $derived(
    !!selectedSong && youtubeUrl.trim().length > 0 && urlOk
  );

  // ─── Estado del job activo ────────────────────────────────────────────
  let activeJobId = $state<string | null>(null);
  let pendingForceCanvas = $state<CanvasEntry | null>(null);
  let submitting = $state(false);

  // Polling tipo TanStack — refetchInterval dinámico (más frecuente cuando
  // running, parado cuando terminó).
  const jobQ = createQuery(() => ({
    queryKey: ['hk-cangen-job', activeJobId],
    queryFn: () => getCanvasJob(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (q) => {
      const job = q.state.data as CanvasGenerationJob | null | undefined;
      if (!job) return 1000;
      if (job.status === 'queued' || job.status === 'running') return 1000;
      return false;
    },
    refetchOnWindowFocus: false
  }));
  const job = $derived(jobQ.data ?? null);

  // ─── Estado actual de canvas para la canción (para hint "ya tiene") ───
  const existingQ = createQuery(() => ({
    queryKey: ['hk-canvas-existing', selectedSong?.id ?? ''],
    queryFn: async () => {
      // Reutilizamos `getCanvasBySongId` del canvas-admin para consistencia
      // con el panel Spotify (misma queryKey, misma invalidación).
      const mod = await import('$services/canvas-admin');
      return mod.getCanvasBySongId(selectedSong!.id);
    },
    enabled: credentials.isConfigured && !!selectedSong,
    staleTime: 5 * 60 * 1000,
    retry: false
  }));

  // ─── Cuando un job termina → invalidar canvas caches ──────────────────
  let lastDoneJobId = $state<string | null>(null);
  $effect(() => {
    if (!job) return;
    if ((job.status === 'done' || job.status === 'failed') && job.id !== lastDoneJobId) {
      lastDoneJobId = job.id;
      if (job.status === 'done') {
        invalidateCanvas(job.songId);
        void queryClient.invalidateQueries({
          queryKey: ['hk-canvas-existing', job.songId]
        });
        toasts.success(
          'Canvas generado',
          `«${job.songTitle}» — listo. Suena en NowPlaying en cuanto vuelva a reproducir.`
        );
      } else if (job.error) {
        toasts.error('Generación fallida', job.error);
      }
    }
  });

  // ─── Acciones del UI ──────────────────────────────────────────────────
  function handleSelectSong(s: NavidromeSong) {
    selectedSong = s;
    searchValue = '';
    searchDebounced = '';
    activeJobId = null;
    pendingForceCanvas = null;
  }
  function handleClearSelection() {
    selectedSong = null;
    youtubeUrl = '';
    activeJobId = null;
    pendingForceCanvas = null;
  }

  async function submit(force: boolean) {
    if (!selectedSong || !canGenerate || submitting) return;
    submitting = true;
    try {
      const r = await enqueueCanvasJob({
        songId: selectedSong.id,
        youtubeUrl: youtubeUrl.trim(),
        mode,
        fragments,
        fragmentSec,
        durationSec,
        force
      });
      activeJobId = r.jobId;
      pendingForceCanvas = null;
    } catch (e) {
      if (e instanceof CanvasGenerateError) {
        if (e.kind === 'existing-canvas' && e.existingCanvas) {
          pendingForceCanvas = e.existingCanvas;
        } else if (e.kind === 'existing-job' && e.existingJob) {
          activeJobId = e.existingJob.id;
          toasts.info(
            'Ya había un job en curso',
            'Te muestro su progreso en lugar de encolar otro.'
          );
        } else if (e.kind === 'bad-request') {
          toasts.warning('Datos no válidos', e.message);
        } else if (e.kind === 'not-found-song') {
          toasts.error('Canción no encontrada', e.message);
        } else if (e.kind === 'no-credentials') {
          toasts.error('Backend sin credenciales Navidrome', e.message);
        } else {
          toasts.error('No se ha podido generar', e.message);
        }
      } else {
        toasts.error(
          'No se ha podido generar',
          e instanceof Error ? e.message : 'Algo ha ido mal'
        );
      }
    } finally {
      submitting = false;
    }
  }

  async function confirmOverwrite() {
    pendingForceCanvas = null;
    await submit(true);
  }
  function cancelOverwrite() {
    pendingForceCanvas = null;
  }

  function resetAfterDone() {
    activeJobId = null;
    youtubeUrl = '';
  }
  async function regenerate() {
    activeJobId = null;
    await submit(true);
  }

  // ─── Helpers de UI ────────────────────────────────────────────────────
  function jobOutputVideoUrl(j: CanvasGenerationJob): string | null {
    if (!j.outputUrl) return null;
    const apiPath = j.outputUrl.replace(/^\/canvas-files\//, '/api/canvas/files/');
    return backendService.fileUrl(apiPath);
  }
  function existingCanvasVideoUrl(c: CanvasEntry): string | null {
    if (c.localPath) {
      const apiPath = c.localPath.replace(/^\/canvas-files\//, '/api/canvas/files/');
      return backendService.fileUrl(apiPath);
    }
    return c.canvasUrl ?? null;
  }

  const PHASES: CanvasGenerationPhase[] = [
    'probing',
    'downloading',
    'evaluating',
    'concatenating',
    'normalizing'
  ];
  const PHASE_LABEL: Record<CanvasGenerationPhase, string> = {
    probing: 'Inspeccionando vídeo',
    downloading: 'Descargando',
    evaluating: 'Evaluando fragmentos',
    concatenating: 'Concatenando',
    normalizing: 'Normalizando'
  };
  function phaseIndex(p: CanvasGenerationPhase | null): number {
    if (!p) return -1;
    return PHASES.indexOf(p);
  }
</script>

<section class="hk-card">
  <header class="hk-section-head">
    <h2>
      <YoutubeLogo size={20} weight="fill" class="yt-icon" />
      Generar Canvas desde YouTube
    </h2>
    <p>
      Cuando Spotify no tiene Canvas oficial, podemos crearlo a partir de un
      vídeo de YouTube. Modo aleatorio para clips dinámicos; modo loop para
      visualizadores.
    </p>
  </header>

  <!-- Paso 1: canción ────────────────────────────────────────────────── -->
  <div class="hk-step">
    <span class="hk-step-tag">1</span>
    <div class="hk-step-body">
      <span class="hk-block-label">¿Qué canción?</span>

      {#if !selectedSong}
        <span class="hk-input">
          <MagnifyingGlass size={14} weight="bold" />
          <input
            type="text"
            placeholder="Busca por título o artista en tu biblioteca"
            value={searchValue}
            oninput={handleSearchInput}
          />
          {#if searchValue.length > 0}
            <button
              type="button"
              class="hk-input-clear"
              onclick={() => {
                searchValue = '';
                searchDebounced = '';
              }}
              aria-label="Limpiar"
            >
              <X size={11} weight="bold" />
            </button>
          {/if}
        </span>

        {#if searchDebounced.length >= 2}
          {#if searchQ.isPending}
            <p class="hk-step-empty">Buscando…</p>
          {:else if searchResults.length === 0}
            <p class="hk-step-empty">
              Nada coincide con <strong>"{searchDebounced}"</strong>.
            </p>
          {:else}
            <ul class="hk-search-list">
              {#each searchResults as s (s.id)}
                <li>
                  <button
                    type="button"
                    class="hk-search-row"
                    onclick={() => handleSelectSong(s)}
                  >
                    <span class="hk-row-cover">
                      {#if s.coverArt}
                        <img src={getCoverArtUrl(s.coverArt, 80)} alt="" loading="lazy" />
                      {:else}
                        <MusicNote size={14} weight="regular" />
                      {/if}
                    </span>
                    <span class="hk-row-meta">
                      <span class="hk-row-title">{s.title}</span>
                      <span class="hk-row-sub">
                        {s.artist ?? 'Sin artista'}
                        {#if s.album} · {s.album}{/if}
                      </span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else if searchValue.length === 0}
          <p class="hk-step-hint">Escribe al menos 2 letras para empezar.</p>
        {/if}
      {:else}
        <div class="hk-selected">
          <span class="hk-row-cover lg">
            {#if selectedSong.coverArt}
              <img src={getCoverArtUrl(selectedSong.coverArt, 200)} alt="" loading="lazy" />
            {:else}
              <MusicNote size={20} weight="regular" />
            {/if}
          </span>
          <div class="hk-selected-meta">
            <span class="hk-selected-title">{selectedSong.title}</span>
            <span class="hk-selected-sub">
              {selectedSong.artist ?? 'Sin artista'}
              {#if selectedSong.album} · {selectedSong.album}{/if}
            </span>
            {#if existingQ.data}
              <span class="hk-existing">
                <Check size={11} weight="bold" />
                Ya tiene canvas
                {#if existingQ.data.source === 'generated'}(generado){:else}(Spotify){/if}
              </span>
            {/if}
          </div>
          <button
            type="button"
            class="hk-btn-ghost"
            onclick={handleClearSelection}
            disabled={submitting || (!!job && (job.status === 'queued' || job.status === 'running'))}
          >
            Cambiar
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Paso 2: YouTube URL + modo + advanced ──────────────────────────── -->
  <div class="hk-step" class:disabled={!selectedSong}>
    <span class="hk-step-tag">2</span>
    <div class="hk-step-body">
      <span class="hk-block-label">¿De qué vídeo?</span>

      <span class="hk-input" class:hk-input-error={!urlOk}>
        <LinkSimple size={14} weight="bold" />
        <input
          type="text"
          placeholder="https://www.youtube.com/watch?v=..."
          value={youtubeUrl}
          oninput={(e) => (youtubeUrl = e.currentTarget.value)}
          disabled={!selectedSong || submitting}
        />
        {#if youtubeUrl.length > 0}
          <button
            type="button"
            class="hk-input-clear"
            onclick={() => (youtubeUrl = '')}
            aria-label="Limpiar"
          >
            <X size={11} weight="bold" />
          </button>
        {/if}
      </span>

      {#if !urlOk}
        <span class="hk-step-hint warning">
          <Warning size={11} weight="fill" /> No reconozco esto como un enlace de YouTube.
        </span>
      {/if}

      <span class="hk-block-label" style="margin-top: 6px;">Modo</span>
      <div class="hk-mode-row">
        <button
          type="button"
          class="hk-mode-chip"
          class:active={mode === 'random'}
          onclick={() => (mode = 'random')}
          disabled={submitting}
        >
          <Sparkle size={13} weight={mode === 'random' ? 'fill' : 'regular'} />
          <span>
            <strong>Fragmentos aleatorios</strong>
            <em>4 cortes de ~2s tipo collage (Spotify-style)</em>
          </span>
        </button>
        <button
          type="button"
          class="hk-mode-chip"
          class:active={mode === 'loop'}
          onclick={() => (mode = 'loop')}
          disabled={submitting}
        >
          <Repeat size={13} weight={mode === 'loop' ? 'fill' : 'regular'} />
          <span>
            <strong>Visualizador en loop</strong>
            <em>Ventana centrada (vídeos lentos/abstractos)</em>
          </span>
        </button>
      </div>

      <button
        type="button"
        class="hk-advanced-toggle"
        onclick={() => (showAdvanced = !showAdvanced)}
      >
        <SlidersHorizontal size={11} weight="bold" />
        {showAdvanced ? 'Ocultar ajustes avanzados' : 'Ajustes avanzados'}
      </button>

      {#if showAdvanced}
        <div class="hk-advanced">
          {#if mode === 'random'}
            <label class="hk-field">
              <span>Fragmentos <em>(1–8)</em></span>
              <input
                type="number"
                min="1"
                max="8"
                bind:value={fragments}
                disabled={submitting}
              />
            </label>
            <label class="hk-field">
              <span>Segundos por fragmento <em>(1–5)</em></span>
              <input
                type="number"
                min="1"
                max="5"
                bind:value={fragmentSec}
                disabled={submitting}
              />
            </label>
          {/if}
          <label class="hk-field">
            <span>Duración total <em>(3–15s)</em></span>
            <input
              type="number"
              min="3"
              max="15"
              bind:value={durationSec}
              disabled={submitting}
            />
          </label>
        </div>
      {/if}

      <div class="hk-step-actions">
        <button
          type="button"
          class="hk-btn-primary"
          onclick={() => submit(false)}
          disabled={!canGenerate || submitting || (!!job && (job.status === 'queued' || job.status === 'running'))}
        >
          {#if submitting}
            <ArrowsClockwise size={13} weight="bold" class="spin" />
            Encolando…
          {:else}
            <YoutubeLogo size={13} weight="fill" /> Generar canvas
          {/if}
        </button>
      </div>
    </div>
  </div>

  <!-- Paso 3: progreso del job ───────────────────────────────────────── -->
  {#if job}
    <div class="hk-step">
      <span class="hk-step-tag">3</span>
      <div class="hk-step-body">
        <span class="hk-block-label">Progreso</span>

        {#if job.status === 'queued'}
          <div class="hk-job-state">
            <ArrowsClockwise size={14} weight="bold" class="spin" />
            <span>En cola…</span>
          </div>
        {:else if job.status === 'running'}
          <div class="hk-job-state">
            <ArrowsClockwise size={14} weight="bold" class="spin" />
            <span>{job.phase ? PHASE_LABEL[job.phase] : 'Procesando'}…</span>
          </div>
          <div class="hk-phase-track" aria-hidden="true">
            {#each PHASES as p (p)}
              <span
                class="hk-phase-dot"
                class:done={phaseIndex(job.phase) > PHASES.indexOf(p)}
                class:active={job.phase === p}
                title={PHASE_LABEL[p]}
              ></span>
            {/each}
          </div>
          {#if job.phaseDetail}
            <span class="hk-step-hint" style="padding-left: 0;">
              <code>{job.phaseDetail}</code>
            </span>
          {/if}
        {:else if job.status === 'done'}
          <div class="hk-job-state success">
            <Check size={14} weight="bold" /> Canvas generado
          </div>
          {#if jobOutputVideoUrl(job)}
            {@const vurl = jobOutputVideoUrl(job)}
            <div class="hk-preview-wrap">
              <video
                class="hk-preview-video"
                src={vurl ?? ''}
                autoplay
                loop
                muted
                playsinline
                controls={false}
              ></video>
              <div class="hk-preview-overlay">
                <Play size={14} weight="fill" />
              </div>
            </div>
          {/if}
          <div class="hk-step-actions">
            <button type="button" class="hk-btn-ghost" onclick={resetAfterDone}>
              Generar otro
            </button>
            <button type="button" class="hk-btn-soft" onclick={regenerate}>
              <ArrowsClockwise size={13} weight="bold" /> Regenerar
            </button>
          </div>
        {:else if job.status === 'failed'}
          <div class="hk-job-state error">
            <Warning size={14} weight="fill" /> Falló: {job.error ?? 'sin detalle'}
          </div>
          {#if mode === 'random'}
            <p class="hk-step-hint">
              Si los fragmentos se rechazan en bucle, prueba <strong>modo loop</strong>.
            </p>
          {/if}
          <div class="hk-step-actions">
            <button type="button" class="hk-btn-ghost" onclick={resetAfterDone}>
              Reintentar con otros valores
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Modal de confirmación cuando ya hay canvas ──────────────────────── -->
  {#if pendingForceCanvas}
    <div
      class="hk-modal-backdrop"
      onclick={cancelOverwrite}
      onkeydown={(e) => e.key === 'Escape' && cancelOverwrite()}
      role="button"
      tabindex="-1"
    >
      <div
        class="hk-modal"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <header class="hk-modal-head">
          <h3>
            {#if pendingForceCanvas.source === 'spotify'}
              Reemplazar canvas oficial de Spotify
            {:else}
              Regenerar canvas existente
            {/if}
          </h3>
          <p>
            {#if pendingForceCanvas.source === 'spotify'}
              Esta canción ya tiene un canvas oficial de Spotify. Si lo
              reemplazas, perderás el original y el nuevo será generado.
            {:else}
              Esta canción ya tiene un canvas generado anteriormente. Si
              continúas, lo sobrescribiremos.
            {/if}
          </p>
        </header>

        {#if existingCanvasVideoUrl(pendingForceCanvas)}
          <div class="hk-preview-wrap centered">
            <video
              class="hk-preview-video"
              src={existingCanvasVideoUrl(pendingForceCanvas) ?? ''}
              autoplay
              loop
              muted
              playsinline
              controls={false}
            ></video>
          </div>
        {/if}

        <div class="hk-modal-actions">
          <button type="button" class="hk-btn-ghost" onclick={cancelOverwrite}>
            Cancelar
          </button>
          <button type="button" class="hk-btn-danger" onclick={confirmOverwrite}>
            Reemplazar
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>

<style>
  /* La estética sigue el patrón de los hk-card existentes (Editorial /
     panel Spotify); el componente está acoplado a esa página por diseño
     — no se reutiliza fuera. */

  .hk-card {
    position: relative;
    padding: var(--hk-card-padding);
    background: var(--hk-card-bg);
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: var(--hk-card-radius);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .hk-section-head { display: flex; flex-direction: column; gap: 4px; }
  .hk-section-head h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .hk-section-head :global(.yt-icon) { color: #ff0033; }
  .hk-section-head p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.55;
    max-width: 70ch;
  }

  /* Steps */
  .hk-step {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 14px;
    transition: opacity 200ms var(--hk-spring-soft);
  }
  .hk-step.disabled { opacity: 0.42; pointer-events: none; }
  .hk-step-tag {
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    font-family: 'Söhne Mono', var(--font-mono);
    font-size: 12px;
    font-weight: 600;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    margin-top: 4px;
  }
  .hk-step-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .hk-block-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  /* Inputs */
  .hk-input {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 12px;
    color: var(--text-secondary);
    transition:
      border-color 200ms var(--hk-spring-soft),
      background 200ms var(--hk-spring-soft);
  }
  .hk-input:focus-within { border-color: var(--accent); background: var(--bg-surface); }
  .hk-input.hk-input-error { border-color: oklch(0.65 0.2 25); }
  .hk-input input {
    flex: 1;
    background: transparent;
    border: 0;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }
  .hk-input input:disabled { color: var(--text-tertiary); cursor: not-allowed; }
  .hk-input input::placeholder { color: var(--text-tertiary); }
  .hk-input-clear {
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 999px;
    background: var(--hk-handle-bg);
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
  }
  .hk-input-clear:hover { color: var(--text-primary); }

  .hk-step-hint {
    font-size: 11px;
    color: var(--text-tertiary);
    padding-left: 4px;
  }
  .hk-step-hint code {
    font-family: 'Söhne Mono', var(--font-mono);
    font-size: 11px;
    padding: 1px 6px;
    background: var(--bg-surface);
    border-radius: 4px;
    color: var(--text-secondary);
  }
  .hk-step-hint.warning {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: oklch(0.78 0.15 75);
  }
  .hk-step-empty {
    margin: 0;
    padding: 12px 14px;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    background: var(--bg-surface);
    border-radius: 10px;
  }
  .hk-step-empty strong { color: var(--text-secondary); font-weight: 600; }

  /* Search list */
  .hk-search-list {
    list-style: none;
    margin: 0;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-surface);
    border-radius: 12px;
  }
  .hk-search-row {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 140ms var(--hk-spring-soft);
  }
  .hk-search-row:hover { background: var(--bg-surface-hover); }
  .hk-search-row:focus-visible {
    outline: none;
    background: var(--bg-surface-hover);
    box-shadow: var(--focus-ring);
  }
  .hk-row-cover {
    width: 36px;
    height: 36px;
    border-radius: 7px;
    overflow: hidden;
    background: var(--bg-canvas);
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .hk-row-cover.lg { width: 56px; height: 56px; border-radius: 10px; }
  .hk-row-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hk-row-meta { display: flex; flex-direction: column; min-width: 0; }
  .hk-row-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }
  .hk-row-sub {
    margin-top: 2px;
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Selected song */
  .hk-selected {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--accent) 10%, var(--hk-tile-bg));
    border-radius: 12px;
  }
  .hk-selected-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hk-selected-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }
  .hk-selected-sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-existing {
    margin-top: 6px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    background: color-mix(in srgb, oklch(0.72 0.18 145) 18%, transparent);
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    color: oklch(0.72 0.18 145);
    width: fit-content;
  }

  /* Mode chips */
  .hk-mode-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .hk-mode-chip {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 10px;
    align-items: start;
    text-align: left;
    padding: 12px 14px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 12px;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
    transition:
      border-color 200ms var(--hk-spring-soft),
      background 200ms var(--hk-spring-soft),
      color 200ms var(--hk-spring-soft);
  }
  .hk-mode-chip > :global(svg) { margin-top: 3px; }
  .hk-mode-chip span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hk-mode-chip strong {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .hk-mode-chip em {
    font-style: normal;
    font-size: 11px;
    color: var(--text-tertiary);
    line-height: 1.4;
  }
  .hk-mode-chip:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border-subtle));
  }
  .hk-mode-chip.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-canvas));
    color: var(--accent);
  }
  .hk-mode-chip.active strong { color: var(--accent); }
  .hk-mode-chip:disabled { opacity: 0.45; cursor: not-allowed; }

  /* Advanced collapsible */
  .hk-advanced-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 0;
    background: transparent;
    border: 0;
    color: var(--text-tertiary);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: color 160ms var(--hk-spring-soft);
  }
  .hk-advanced-toggle:hover { color: var(--text-secondary); }
  .hk-advanced {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-surface);
    border-radius: 10px;
  }
  .hk-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .hk-field > span {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }
  .hk-field em {
    font-style: normal;
    color: var(--text-tertiary);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 4px;
  }
  .hk-field input {
    padding: 8px 10px;
    background: var(--bg-canvas);
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 8px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    outline: none;
    appearance: none;
  }
  .hk-field input:focus { border-color: var(--accent); }

  /* Step actions */
  .hk-step-actions { display: flex; gap: 6px; flex-wrap: wrap; }

  /* Job progress */
  .hk-job-state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .hk-job-state.success { color: oklch(0.72 0.18 145); font-weight: 600; }
  .hk-job-state.error {
    color: oklch(0.68 0.2 25);
    font-weight: 500;
    align-items: flex-start;
  }
  .hk-phase-track {
    display: flex;
    gap: 4px;
  }
  .hk-phase-dot {
    flex: 1;
    height: 4px;
    background: var(--bg-surface);
    border-radius: 999px;
    transition: background 240ms var(--hk-spring-soft);
  }
  .hk-phase-dot.done { background: var(--accent); }
  .hk-phase-dot.active {
    background: color-mix(in srgb, var(--accent) 60%, transparent);
    animation: hk-pulse 1.4s ease-in-out infinite;
  }
  @keyframes hk-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }

  /* Preview .mp4 */
  .hk-preview-wrap {
    position: relative;
    width: 200px;
    aspect-ratio: 9 / 16;
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg-canvas);
  }
  .hk-preview-wrap.centered { margin: 0 auto; }
  .hk-preview-video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hk-preview-overlay {
    position: absolute;
    bottom: 8px;
    right: 8px;
    width: 26px;
    height: 26px;
    border-radius: 999px;
    background: rgb(0 0 0 / 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: #fff;
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  /* Modal */
  .hk-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: grid;
    place-items: center;
    z-index: 1000;
    padding: 20px;
    border: 0;
    cursor: default;
  }
  .hk-modal {
    width: min(100%, 420px);
    background: var(--hk-card-bg);
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: var(--hk-card-radius);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.45);
  }
  .hk-modal-head h3 {
    margin: 0 0 6px;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.005em;
  }
  .hk-modal-head p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .hk-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  /* Buttons */
  .hk-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 18px;
    background: var(--accent);
    border: 0;
    border-radius: 999px;
    color: #fff;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 200ms var(--hk-spring),
      filter 200ms var(--hk-spring-soft);
  }
  .hk-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  .hk-btn-primary:active:not(:disabled) { transform: scale(0.97); }
  .hk-btn-primary:disabled { opacity: 0.42; cursor: not-allowed; }
  .hk-btn-primary:focus-visible { outline: none; box-shadow: var(--focus-ring); }

  .hk-btn-soft {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    background: var(--bg-glass-thin);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 0;
    border-radius: 999px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background 200ms var(--hk-spring-soft);
  }
  .hk-btn-soft:hover:not(:disabled) { background: var(--bg-glass); }
  .hk-btn-soft:disabled { opacity: 0.45; cursor: not-allowed; }

  .hk-btn-ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: color 160ms var(--hk-spring-soft);
  }
  .hk-btn-ghost:hover:not(:disabled) { color: var(--text-primary); }
  .hk-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

  .hk-btn-danger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 18px;
    background: oklch(0.62 0.22 25);
    border: 0;
    border-radius: 999px;
    color: #fff;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 200ms var(--hk-spring),
      filter 200ms var(--hk-spring-soft);
  }
  .hk-btn-danger:hover:not(:disabled) { filter: brightness(1.08); }
  .hk-btn-danger:active:not(:disabled) { transform: scale(0.97); }

  :global(.hk-card .spin) { animation: hk-spin 1s linear infinite; }
  @keyframes hk-spin { to { transform: rotate(360deg); } }

  @media (max-width: 640px) {
    .hk-mode-row { grid-template-columns: 1fr; }
    .hk-selected { grid-template-columns: 56px minmax(0, 1fr); }
    .hk-selected > .hk-btn-ghost {
      grid-column: 1 / -1;
      justify-self: end;
    }
  }
</style>
