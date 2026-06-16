<script lang="ts">
  /**
   * /housekeeping/contenido
   *
   * Estructura:
   *   1. Asignar Canvas a una canción (modo individual). Buscas la canción
   *      en tu Navidrome, pegas la URL de Spotify del track, y descargamos
   *      el Canvas para asociarlo.
   *   2. Auto-generador de Canvas desde YouTube (CanvasGeneratorPanel).
   *   3. Deezer Sync (DeezerSyncPanel).
   *
   * Flujo Canvas individual:
   *   a) Search Navidrome → resultados con cover (selecciona uno).
   *   b) Pegas URL Spotify → extraemos trackId.
   *   c) "Comprobar" → fetchSpotifyCanvas → preview del .mp4.
   *   d) "Asignar" → saveCanvasEntry persistente.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    MagnifyingGlass,
    SpotifyLogo,
    LinkSimple,
    ArrowsClockwise,
    Check,
    X,
    Play,
    MusicNote,
    Warning
  } from 'phosphor-svelte';
  import * as nav from '$services/NavidromeService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import {
    extractSpotifyTrackId,
    fetchSpotifyCanvas,
    saveCanvasEntry,
    getCanvasBySongId
  } from '$services/canvas-admin';
  import CanvasGeneratorPanel from './CanvasGeneratorPanel.svelte';
  import DeezerSyncPanel from './DeezerSyncPanel.svelte';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { NavidromeSong } from '$types/navidrome';

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
    queryKey: ['hk-canvas-search', searchDebounced],
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

  // ─── Selección + URL Spotify ──────────────────────────────────────────
  let selectedSong = $state<NavidromeSong | null>(null);
  let spotifyUrl = $state('');
  const parsedTrackId = $derived(spotifyUrl.trim() ? extractSpotifyTrackId(spotifyUrl) : '');
  const canCheck = $derived(!!selectedSong && parsedTrackId.length > 0);

  // ─── Preview del Canvas resuelto ──────────────────────────────────────
  let checking = $state(false);
  let canvasPreviewUrl = $state<string | null>(null);
  let saving = $state(false);
  let lastSavedSongId = $state<string | null>(null);

  // Estado actual de la canción en cache (para mostrar "ya tiene Canvas").
  const existingQ = createQuery(() => ({
    queryKey: ['hk-canvas-existing', selectedSong?.id ?? ''],
    queryFn: () => getCanvasBySongId(selectedSong!.id),
    enabled: credentials.isConfigured && !!selectedSong,
    staleTime: 5 * 60 * 1000,
    retry: false
  }));

  function handleSelectSong(s: NavidromeSong) {
    selectedSong = s;
    spotifyUrl = '';
    canvasPreviewUrl = null;
    lastSavedSongId = null;
    // Limpiar la búsqueda visualmente — ya tienes lo que querías.
    searchValue = '';
    searchDebounced = '';
  }
  function handleClearSelection() {
    selectedSong = null;
    spotifyUrl = '';
    canvasPreviewUrl = null;
  }
  function handleClearUrl() {
    spotifyUrl = '';
    canvasPreviewUrl = null;
  }

  async function handleCheck() {
    if (!canCheck || checking) return;
    checking = true;
    canvasPreviewUrl = null;
    try {
      const url = await fetchSpotifyCanvas(parsedTrackId);
      if (url) {
        canvasPreviewUrl = url;
      } else {
        toasts.warning(
          'Esta canción no tiene Canvas',
          'Spotify no proporciona video para este track. Prueba con otra URL.'
        );
      }
    } catch (err) {
      toasts.error(
        'No se ha podido consultar Spotify',
        err instanceof Error ? err.message : 'Algo ha ido mal en el servidor'
      );
    } finally {
      checking = false;
    }
  }

  async function handleAssign() {
    if (!selectedSong || !canvasPreviewUrl || !parsedTrackId || saving) return;
    saving = true;
    try {
      await saveCanvasEntry({
        songId: selectedSong.id,
        title: selectedSong.title,
        artist: selectedSong.artist ?? '—',
        album: selectedSong.album,
        spotifyTrackId: parsedTrackId,
        canvasUrl: canvasPreviewUrl
      });
      lastSavedSongId = selectedSong.id;
      void queryClient.invalidateQueries({
        queryKey: ['hk-canvas-existing', selectedSong.id]
      });
      // Reset tras un momento para feedback claro.
      setTimeout(() => {
        if (lastSavedSongId === selectedSong?.id) {
          handleClearSelection();
          lastSavedSongId = null;
        }
      }, 2200);
    } catch (err) {
      toasts.error(
        'No se ha podido guardar',
        err instanceof Error ? err.message : 'Algo ha ido mal en el servidor'
      );
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Contenido · Housekeeping</title>
</svelte:head>

<!-- ════════════════════════════════════════════════════════════════════
     1. Asignar Canvas a una canción
     ════════════════════════════════════════════════════════════════════ -->
<AdminPanel title="Asignar Canvas a una canción">
  {#snippet info()}
    Busca la canción en tu biblioteca, pega el link del track en Spotify y
    descargamos el video en bucle para asociarlo.
  {/snippet}

  <!-- Paso 1: buscar / seleccionar canción ─────────────────────────────── -->
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
                  <button type="button" class="hk-search-row" onclick={() => handleSelectSong(s)}>
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
        <!-- Canción seleccionada — ficha resumen con cover + meta + cambiar. -->
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
                <Check size={11} weight="bold" /> Ya tiene Canvas asignado — al guardar lo reemplazamos
              </span>
            {/if}
          </div>
          <button
            type="button"
            class="hk-btn-ghost"
            onclick={handleClearSelection}
            aria-label="Cambiar de canción"
          >
            Cambiar
          </button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Paso 2: URL de Spotify ──────────────────────────────────────────── -->
  <div class="hk-step" class:disabled={!selectedSong}>
    <span class="hk-step-tag">2</span>
    <div class="hk-step-body">
      <span class="hk-block-label">¿Qué track de Spotify?</span>

      <span class="hk-input">
        <LinkSimple size={14} weight="bold" />
        <input
          type="text"
          placeholder="https://open.spotify.com/track/..."
          value={spotifyUrl}
          oninput={(e) => (spotifyUrl = e.currentTarget.value)}
          disabled={!selectedSong || saving}
        />
        {#if spotifyUrl.length > 0}
          <button
            type="button"
            class="hk-input-clear"
            onclick={handleClearUrl}
            aria-label="Limpiar"
          >
            <X size={11} weight="bold" />
          </button>
        {/if}
      </span>

      {#if parsedTrackId && parsedTrackId !== spotifyUrl.trim()}
        <span class="hk-step-hint">
          Vamos a usar el ID <code>{parsedTrackId}</code>
        </span>
      {:else if spotifyUrl.length > 0 && !parsedTrackId}
        <span class="hk-step-hint warning">
          <Warning size={11} weight="fill" /> No reconozco esto como un link de Spotify track.
        </span>
      {/if}

      <div class="hk-step-actions">
        <button
          type="button"
          class="hk-btn-soft"
          onclick={handleCheck}
          disabled={!canCheck || checking}
        >
          {#if checking}
            <ArrowsClockwise size={13} weight="bold" class="hk-content-spin" />
            Comprobando…
          {:else}
            <SpotifyLogo size={13} weight="fill" /> Comprobar Canvas
          {/if}
        </button>
      </div>
    </div>
  </div>

  <!-- Paso 3: preview + asignar ──────────────────────────────────────── -->
  {#if canvasPreviewUrl}
    <div class="hk-step">
      <span class="hk-step-tag">3</span>
      <div class="hk-step-body">
        <span class="hk-block-label">Vista previa del Canvas</span>

        <div class="hk-preview-wrap">
          <video
            class="hk-preview-video"
            src={canvasPreviewUrl}
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

        <div class="hk-step-actions">
          <button
            type="button"
            class="hk-btn-ghost"
            onclick={() => (canvasPreviewUrl = null)}
            disabled={saving}
          >
            Probar otro
          </button>
          <button
            type="button"
            class="hk-btn-primary"
            onclick={handleAssign}
            disabled={saving || lastSavedSongId === selectedSong?.id}
          >
            {#if lastSavedSongId === selectedSong?.id}
              <Check size={14} weight="bold" /> Asignado
            {:else if saving}
              Guardando…
            {:else}
              Asignar a esta canción
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</AdminPanel>

<!-- ════════════════════════════════════════════════════════════════════
     2. Auto-Generador de Canvas desde YouTube
     ════════════════════════════════════════════════════════════════════ -->
<CanvasGeneratorPanel />

<!-- ════════════════════════════════════════════════════════════════════
     3. Deezer Sync
     ════════════════════════════════════════════════════════════════════ -->
<DeezerSyncPanel />

<style>
  /* ============================================================================
     === Pasos numerados — el flujo lineal del usuario ===
     ============================================================================ */
  .hk-step {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 14px;
    transition: opacity 200ms var(--hk-spring-soft);
  }
  .hk-step.disabled {
    opacity: 0.42;
    pointer-events: none;
  }
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

  /* ============================================================================
     === Inputs ===
     ============================================================================ */
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
  .hk-input:focus-within {
    border-color: var(--accent);
    background: var(--bg-surface);
  }
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
  .hk-step-empty strong {
    color: var(--text-secondary);
    font-weight: 600;
  }

  /* ============================================================================
     === Search results list ===
     ============================================================================ */
  .hk-search-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--bg-surface);
    border-radius: 12px;
    padding: 4px;
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
  .hk-search-row:hover {
    background: var(--bg-surface-hover);
  }
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
  .hk-row-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .hk-row-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
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

  /* ============================================================================
     === Selected song summary ===
     ============================================================================ */
  .hk-selected {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--accent) 10%, var(--hk-tile-bg));
    border-radius: 12px;
  }
  .hk-selected-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
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

  /* ============================================================================
     === Step actions row ===
     ============================================================================ */
  .hk-step-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  /* ============================================================================
     === Preview Canvas .mp4 ===
     ============================================================================ */
  .hk-preview-wrap {
    position: relative;
    width: 200px;
    aspect-ratio: 9 / 16;
    border-radius: 14px;
    overflow: hidden;
    background: var(--bg-canvas);
  }
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

  /* ============================================================================
     === Botones ===
     ============================================================================ */
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
  .hk-btn-primary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

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
  .hk-btn-soft:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

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
  .hk-btn-ghost:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* Spin para iconos refresh durante operaciones (clase global: la pone
     Phosphor en el <svg>, fuera del scope del componente). */
  :global(.hk-content-spin) {
    animation: hk-spin 1s linear infinite;
  }
  @keyframes hk-spin { to { transform: rotate(360deg); } }

  @media (max-width: 640px) {
    .hk-selected { grid-template-columns: 56px minmax(0, 1fr); }
    .hk-selected > .hk-btn-ghost {
      grid-column: 1 / -1;
      justify-self: end;
    }
  }
</style>
