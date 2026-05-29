<script lang="ts">
  /**
   * /housekeeping/deezer-sync — Panel de administración de Deezer Sync.
   *
   * Permite importar playlists de Deezer hacia Navidrome con matching
   * fuzzy contra la biblioteca local. Mirror del panel Spotify Sync
   * (deshabilitado por directriz del director).
   *
   * Flujo:
   *   1. Input URL/ID Deezer → Preview (tabla de tracks con % matching).
   *   2. Confirmar → Start Sync (guarda + sincroniza por primera vez).
   *   3. Lista de syncs existentes: force re-sync / delete.
   *   4. Match manual desde el preview (busca en Navidrome, confirma).
   *
   * Contrato backend (adec1dc+):
   *   GET    /api/sync/list                         → SyncedPlaylistV2[]
   *   GET    /api/sync/preview/:id?source=deezer    → SyncPreviewV2
   *   POST   /api/sync/start                        { source:'deezer', externalId, name? }
   *   POST   /api/sync/sync/:id?source=deezer       → forzar re-sync
   *   DELETE /api/sync/deezer/:id
   *   POST   /api/sync/manual-match                 { source:'deezer', externalTrackId, navidromeSongId, ... }
   *   GET    /api/sync/search-songs?q=…
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    ListBullets,
    MagnifyingGlass,
    ArrowsClockwise,
    Trash,
    Link,
    CheckCircle,
    XCircle,
    Wrench,
    Check
  } from 'phosphor-svelte';
  import HKInfoCard from '../HKInfoCard.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import {
    listDeezerSyncs,
    previewDeezerSync,
    startDeezerSync,
    forceDeezerSync,
    removeDeezerSync,
    manualMatchDeezer,
    searchSongs,
    extractDeezerPlaylistId
  } from '$services/sync';
  import type { SyncedPlaylistV2, SyncPreviewV2, SearchSongItem } from '$types/backend';

  const queryClient = useQueryClient();

  // ─── Lista de syncs Deezer existentes ───────────────────────────────────
  const syncsQ = createQuery(() => ({
    queryKey: ['deezerSyncs'],
    queryFn: () => listDeezerSyncs(),
    enabled: credentials.isConfigured,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false
  }));

  const syncs = $derived(syncsQ.data ?? []);

  // ─── Estado del formulario de preview ────────────────────────────────────
  let inputValue = $state('');
  let previewLoading = $state(false);
  let previewData = $state<SyncPreviewV2 | null>(null);
  let previewError = $state<string | null>(null);
  let startingSync = $state(false);

  // ─── Estado de match manual ───────────────────────────────────────────────
  type ManualMatchState = {
    trackId: string;
    trackName: string;
    artistName: string;
    query: string;
    results: SearchSongItem[];
    searching: boolean;
    saving: boolean;
  };
  let manualMatch = $state<ManualMatchState | null>(null);

  // ─── Estado de force re-sync y delete por ID ─────────────────────────────
  let forcingId = $state<string | null>(null);
  let deletingId = $state<string | null>(null);

  // ─── Helpers de formato ───────────────────────────────────────────────────
  function relativeTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const abs = Math.abs(ms);
    const min = Math.round(abs / 60_000);
    const hr = Math.round(abs / 3_600_000);
    const day = Math.round(abs / 86_400_000);
    if (abs < 60_000) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    if (hr < 24) return `hace ${hr} h`;
    return `hace ${day} ${day === 1 ? 'día' : 'días'}`;
  }

  function matchPct(p: SyncedPlaylistV2): string {
    if (!p.trackCount) return '—';
    return `${Math.round((p.matchCount / p.trackCount) * 100)}%`;
  }

  function matchTone(pct: number): 'good' | 'mid' | 'low' {
    if (pct >= 80) return 'good';
    if (pct >= 50) return 'mid';
    return 'low';
  }

  const parsedId = $derived.by(() => {
    const raw = inputValue.trim();
    if (!raw) return '';
    return extractDeezerPlaylistId(raw);
  });

  const canPreview = $derived(parsedId.length > 0 && !previewLoading);

  // ─── Acciones ─────────────────────────────────────────────────────────────

  async function handlePreview() {
    if (!canPreview) return;
    previewLoading = true;
    previewError = null;
    previewData = null;
    try {
      previewData = await previewDeezerSync(inputValue.trim());
    } catch (err) {
      previewError = err instanceof Error ? err.message : 'Error al obtener el preview';
      toasts.error('Preview fallido', previewError ?? 'Error desconocido');
    } finally {
      previewLoading = false;
    }
  }

  async function handleStartSync() {
    if (!previewData || startingSync) return;
    startingSync = true;
    try {
      await startDeezerSync(inputValue.trim(), previewData.name);
      toasts.success('Sync iniciado', `"${previewData.name}" sincronizando contra Navidrome.`);
      inputValue = '';
      previewData = null;
      await queryClient.invalidateQueries({ queryKey: ['deezerSyncs'] });
    } catch (err) {
      toasts.error('Error al iniciar sync', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      startingSync = false;
    }
  }

  async function handleForce(p: SyncedPlaylistV2) {
    if (forcingId) return;
    forcingId = p.externalId;
    try {
      await forceDeezerSync(p.externalId);
      toasts.success('Re-sync forzado', `"${p.name}" está sincronizando.`);
      await queryClient.invalidateQueries({ queryKey: ['deezerSyncs'] });
    } catch (err) {
      toasts.error('Error en re-sync', err instanceof Error ? err.message : 'Algo ha ido mal');
    } finally {
      forcingId = null;
    }
  }

  async function handleDelete(p: SyncedPlaylistV2) {
    if (
      !confirm(
        `¿Eliminar la sync de "${p.name}"?\n\nSe eliminará el registro de sync. La playlist de Navidrome NO se borra.`
      )
    )
      return;
    deletingId = p.externalId;
    try {
      await removeDeezerSync(p.externalId);
      toasts.success('Sync eliminada', `"${p.name}" ya no se sincroniza.`);
      await queryClient.invalidateQueries({ queryKey: ['deezerSyncs'] });
    } catch (err) {
      toasts.error(
        'Error al eliminar sync',
        err instanceof Error ? err.message : 'Algo ha ido mal'
      );
    } finally {
      deletingId = null;
    }
  }

  function openManualMatch(trackId: string, trackName: string, artistName: string) {
    manualMatch = {
      trackId,
      trackName,
      artistName,
      query: `${trackName} ${artistName}`.trim(),
      results: [],
      searching: false,
      saving: false
    };
    // Lanzamos búsqueda inicial automática con nombre+artista
    void doSearch();
  }

  async function doSearch() {
    if (!manualMatch || manualMatch.searching) return;
    manualMatch.searching = true;
    try {
      manualMatch.results = await searchSongs(manualMatch.query);
    } catch {
      manualMatch.results = [];
    } finally {
      manualMatch.searching = false;
    }
  }

  async function confirmManualMatch(song: SearchSongItem) {
    if (!manualMatch || !previewData || manualMatch.saving) return;
    manualMatch.saving = true;
    try {
      await manualMatchDeezer({
        source: 'deezer',
        externalTrackId: manualMatch.trackId,
        navidromeSongId: song.id,
        trackName: manualMatch.trackName,
        artistName: manualMatch.artistName,
        navidromeTitle: song.title,
        navidromeArtist: song.artist
      });
      toasts.success(
        'Match manual guardado',
        `"${manualMatch.trackName}" → "${song.title}" de ${song.artist}`
      );
      manualMatch = null;
      // Refresca el preview para actualizar el estado de la fila
      previewData = await previewDeezerSync(inputValue.trim());
    } catch (err) {
      toasts.error(
        'Error al guardar match',
        err instanceof Error ? err.message : 'Algo ha ido mal'
      );
    } finally {
      if (manualMatch) manualMatch.saving = false;
    }
  }
</script>

<svelte:head>
  <title>Deezer Sync · Housekeeping</title>
</svelte:head>

<!-- ════════════════════════════════════════════════════════════════════
     Panel principal — usa HKInfoCard (patrón visual Housekeeping)
     ════════════════════════════════════════════════════════════════════ -->

<!-- Card 1: Importar nueva playlist Deezer -->
<HKInfoCard
  Icon={Link}
  kicker="DEEZER SYNC"
  title="Importar playlist de Deezer"
  description="Pega la URL de una playlist pública de Deezer o su ID numérico. El backend la mapea contra tu biblioteca Navidrome."
  pattern="waves"
  tone="accent"
>
  {#snippet children()}
    <div class="ds-form">
      <div class="ds-input-row">
        <input
          class="ds-input"
          type="text"
          placeholder="deezer.com/playlist/… o ID numérico"
          bind:value={inputValue}
          onkeydown={(e) => { if (e.key === 'Enter') void handlePreview(); }}
          autocomplete="off"
          spellcheck="false"
        />
        <button
          class="ds-btn ds-btn-primary"
          type="button"
          onclick={handlePreview}
          disabled={!canPreview}
        >
          {#if previewLoading}
            <ArrowsClockwise size={14} weight="bold" class="spin" />
            Cargando…
          {:else}
            <MagnifyingGlass size={14} weight="bold" />
            Preview
          {/if}
        </button>
      </div>

      {#if parsedId && !previewData && !previewLoading}
        <p class="ds-hint">ID detectado: <code>{parsedId}</code></p>
      {/if}

      {#if previewError}
        <p class="ds-error">{previewError}</p>
      {/if}
    </div>

    <!-- Preview resultado -->
    {#if previewData}
      <div class="ds-preview-header">
        <div class="ds-preview-meta">
          <span class="ds-preview-name">{previewData.name}</span>
          <span class="ds-preview-stats">
            {previewData.matchCount} / {previewData.trackCount} encontradas
            <span
              class="ds-pct-badge"
              data-tone={matchTone(previewData.percentage)}
            >{previewData.percentage.toFixed(0)}%</span>
          </span>
        </div>
        <button
          class="ds-btn ds-btn-primary"
          type="button"
          onclick={handleStartSync}
          disabled={startingSync}
        >
          {#if startingSync}
            <ArrowsClockwise size={14} weight="bold" class="spin" />
            Sincronizando…
          {:else}
            <Check size={14} weight="bold" />
            Iniciar sync
          {/if}
        </button>
      </div>

      <div class="ds-track-table-wrap">
        <table class="ds-track-table">
          <thead>
            <tr>
              <th>Track Deezer</th>
              <th>Artista</th>
              <th class="ds-col-status">Estado</th>
              <th class="ds-col-action">Acción</th>
            </tr>
          </thead>
          <tbody>
            {#each previewData.tracks as row (row.spotify.id)}
              <tr class:ds-row-found={row.found} class:ds-row-missing={!row.found}>
                <td class="ds-td-track">
                  <span class="ds-track-name">{row.spotify.name}</span>
                  <span class="ds-track-album">{row.spotify.album}</span>
                </td>
                <td class="ds-td-artist">{row.spotify.artist}</td>
                <td class="ds-col-status">
                  {#if row.found}
                    <span class="ds-status-chip ds-status-found">
                      <CheckCircle size={12} weight="fill" />
                      {row.isManual ? 'Manual' : 'Match'}
                    </span>
                  {:else}
                    <span class="ds-status-chip ds-status-missing">
                      <XCircle size={12} weight="fill" />
                      No hallada
                    </span>
                  {/if}
                </td>
                <td class="ds-col-action">
                  {#if !row.found}
                    <button
                      class="ds-btn ds-btn-ghost ds-btn-sm"
                      type="button"
                      onclick={() =>
                        openManualMatch(row.spotify.id, row.spotify.name, row.spotify.artist)}
                    >
                      <Wrench size={12} weight="bold" />
                      Emparejar
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/snippet}
</HKInfoCard>

<!-- Card 2: Syncs Deezer existentes -->
<HKInfoCard
  Icon={ListBullets}
  kicker="SYNCS ACTIVOS"
  title="Playlists Deezer sincronizadas"
  description={syncsQ.isPending
    ? 'Cargando…'
    : syncs.length === 0
      ? 'Aún no hay playlists Deezer sincronizadas.'
      : `${syncs.length} ${syncs.length === 1 ? 'playlist sincronizada' : 'playlists sincronizadas'}`}
  pattern="lines"
  tone="mint"
>
  {#snippet children()}
    {#if syncsQ.isPending}
      <div class="ds-skel-list">
        {#each Array(3) as _}
          <div class="ds-skel-row"></div>
        {/each}
      </div>
    {:else if syncs.length === 0}
      <p class="ds-empty">
        <ListBullets size={20} weight="regular" />
        Importa tu primera playlist de Deezer con el formulario de arriba.
      </p>
    {:else}
      <ul class="ds-syncs-list">
        {#each syncs as p (p.externalId)}
          {@const rawPct = p.trackCount > 0 ? (p.matchCount / p.trackCount) * 100 : 0}
          <li class="ds-sync-row">
            <div class="ds-sync-meta">
              <span class="ds-sync-name">{p.name}</span>
              <span class="ds-sync-sub">
                ID {p.externalId} ·
                {p.matchCount}/{p.trackCount} tracks ·
                Última sync {relativeTime(p.lastSync)}
              </span>
            </div>
            <span class="ds-pct-badge" data-tone={matchTone(rawPct)}>
              {matchPct(p)}
            </span>
            <div class="ds-sync-actions">
              <button
                class="ds-btn ds-btn-ghost ds-btn-sm"
                type="button"
                disabled={forcingId === p.externalId}
                onclick={() => void handleForce(p)}
                title="Forzar re-sync"
              >
                <ArrowsClockwise
                  size={13}
                  weight="bold"
                  class={forcingId === p.externalId ? 'spin' : ''}
                />
              </button>
              <button
                class="ds-btn ds-btn-ghost ds-btn-sm ds-btn-danger"
                type="button"
                disabled={deletingId === p.externalId}
                onclick={() => void handleDelete(p)}
                title="Eliminar sync"
              >
                <Trash size={13} weight="bold" />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</HKInfoCard>

<!-- Modal de match manual ─────────────────────────────────────────────── -->
{#if manualMatch}
  <div
    class="ds-modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Emparejar track manualmente"
  >
    <div class="ds-modal">
      <header class="ds-modal-header">
        <h4 class="ds-modal-title">Emparejar manualmente</h4>
        <button
          class="ds-btn ds-btn-ghost ds-btn-sm"
          type="button"
          onclick={() => (manualMatch = null)}
          aria-label="Cerrar"
        >
          <XCircle size={16} weight="fill" />
        </button>
      </header>

      <div class="ds-modal-track">
        <span class="ds-modal-track-name">{manualMatch.trackName}</span>
        <span class="ds-modal-track-artist">{manualMatch.artistName}</span>
      </div>

      <div class="ds-modal-search-row">
        <input
          class="ds-input ds-input-sm"
          type="text"
          placeholder="Buscar en tu biblioteca…"
          bind:value={manualMatch.query}
          onkeydown={(e) => { if (e.key === 'Enter') void doSearch(); }}
        />
        <button
          class="ds-btn ds-btn-primary ds-btn-sm"
          type="button"
          disabled={manualMatch.searching}
          onclick={doSearch}
        >
          {#if manualMatch.searching}
            <ArrowsClockwise size={13} class="spin" />
          {:else}
            <MagnifyingGlass size={13} weight="bold" />
          {/if}
        </button>
      </div>

      {#if manualMatch.results.length > 0}
        <ul class="ds-modal-results">
          {#each manualMatch.results as song (song.id)}
            <li class="ds-modal-result-row">
              <div class="ds-modal-result-meta">
                <span class="ds-modal-result-title">{song.title}</span>
                <span class="ds-modal-result-artist">{song.artist}{song.album ? ` · ${song.album}` : ''}</span>
              </div>
              <button
                class="ds-btn ds-btn-primary ds-btn-sm"
                type="button"
                disabled={manualMatch.saving}
                onclick={() => void confirmManualMatch(song)}
              >
                {#if manualMatch.saving}
                  <ArrowsClockwise size={12} class="spin" />
                {:else}
                  <Check size={12} weight="bold" />
                  Usar
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else if !manualMatch.searching}
        <p class="ds-modal-empty">Sin resultados. Prueba con otro nombre.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ============================================================================
     Tokens heredados del design system — NO se inventan valores propios.
     Colores: color-mix(in srgb, ...) con var(--accent) o OKLCH explícitos.
     Espaciados: var(--space-*).
     Fuentes: var(--text-*), var(--font-mono).
     ============================================================================ */

  /* ─── Formulario de input ─────────────────────────────────────────────── */
  .ds-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .ds-input-row {
    display: flex;
    gap: var(--space-2);
    align-items: stretch;
  }
  .ds-input {
    flex: 1;
    min-width: 0;
    padding: 9px 14px;
    background: var(--bg-canvas);
    border: 1.5px solid color-mix(in srgb, var(--text-tertiary) 20%, transparent);
    border-radius: 10px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    transition: border-color 160ms ease;
    outline: none;
  }
  .ds-input:focus {
    border-color: var(--accent);
  }
  .ds-input.ds-input-sm {
    padding: 7px 11px;
    font-size: var(--text-xs);
  }
  .ds-hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .ds-hint code {
    font-family: var(--font-mono);
    background: var(--bg-canvas);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 10px;
  }
  .ds-error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--status-danger);
  }

  /* ─── Botones ─────────────────────────────────────────────────────────── */
  .ds-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.005em;
    cursor: pointer;
    transition:
      transform 180ms var(--ease-ios-default),
      filter 180ms ease,
      opacity 180ms ease;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .ds-btn:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  .ds-btn:active:not(:disabled) {
    transform: scale(0.96);
  }
  .ds-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .ds-btn-primary {
    background: var(--accent);
    color: #fff;
  }
  .ds-btn-primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .ds-btn-ghost {
    background: var(--bg-glass-thin);
    color: var(--text-secondary);
    padding: 7px 12px;
  }
  .ds-btn-ghost:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text-primary);
  }

  .ds-btn-sm {
    padding: 5px 10px;
    font-size: 11px;
  }

  .ds-btn-danger {
    color: var(--status-danger);
  }
  .ds-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
  }

  /* Spin para iconos de carga (espejo del :global(.spin) del HKActionCard) */
  :global(.ds-btn .spin) {
    animation: ds-spin 1s linear infinite;
  }
  @keyframes ds-spin {
    to { transform: rotate(360deg); }
  }

  /* ─── Preview de tracks ───────────────────────────────────────────────── */
  .ds-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .ds-preview-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .ds-preview-name {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ds-preview-stats {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* Badge de porcentaje — tonal según calidad del match */
  .ds-pct-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .ds-pct-badge[data-tone='good'] {
    background: color-mix(in srgb, oklch(0.72 0.18 145) 16%, transparent);
    color: oklch(0.72 0.18 145);
  }
  .ds-pct-badge[data-tone='mid'] {
    background: color-mix(in srgb, oklch(0.78 0.15 75) 18%, transparent);
    color: oklch(0.78 0.15 75);
  }
  .ds-pct-badge[data-tone='low'] {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    color: var(--status-danger);
  }

  /* Tabla de tracks del preview */
  .ds-track-table-wrap {
    overflow-x: auto;
    border-radius: 12px;
    background: var(--bg-canvas);
  }
  .ds-track-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .ds-track-table thead tr {
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary) 14%, transparent);
  }
  .ds-track-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    white-space: nowrap;
  }
  .ds-track-table td {
    padding: 8px 12px;
    vertical-align: middle;
    border-bottom: 1px solid color-mix(in srgb, var(--text-tertiary) 8%, transparent);
  }
  .ds-track-table tr:last-child td {
    border-bottom: 0;
  }
  .ds-row-found td {
    opacity: 1;
  }
  .ds-row-missing td {
    opacity: 0.72;
  }

  .ds-td-track {
    min-width: 160px;
  }
  .ds-track-name {
    display: block;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .ds-track-album {
    display: block;
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .ds-td-artist {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ds-col-status {
    white-space: nowrap;
    width: 90px;
  }
  .ds-col-action {
    width: 96px;
    text-align: right;
  }

  .ds-status-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
  }
  .ds-status-found {
    background: color-mix(in srgb, oklch(0.72 0.18 145) 16%, transparent);
    color: oklch(0.72 0.18 145);
  }
  .ds-status-missing {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    color: var(--status-danger);
  }

  /* ─── Lista de syncs existentes ──────────────────────────────────────── */
  .ds-syncs-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ds-sync-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .ds-sync-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ds-sync-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ds-sync-sub {
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ds-sync-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  /* ─── Skeleton ─────────────────────────────────────────────────────────── */
  .ds-skel-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ds-skel-row {
    height: 54px;
    background: var(--bg-canvas);
    border-radius: 12px;
    animation: ds-pulse 1.6s ease-in-out infinite;
  }
  @keyframes ds-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  .ds-empty {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    background: var(--bg-canvas);
    border-radius: 12px;
  }
  .ds-empty :global(svg) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  /* ─── Modal match manual ──────────────────────────────────────────────── */
  .ds-modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--scrim);
    z-index: 500;
    display: grid;
    place-items: center;
    padding: var(--space-6);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .ds-modal {
    width: 100%;
    max-width: 480px;
    background: var(--bg-surface);
    border-radius: 18px;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-shadow: 0 24px 64px oklch(0 0 0 / 0.32);
    animation: ds-modal-in 220ms var(--ease-ios-default) both;
  }
  @keyframes ds-modal-in {
    from { transform: scale(0.93); opacity: 0; }
    to   { transform: scale(1);    opacity: 1; }
  }
  .ds-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .ds-modal-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
  }
  .ds-modal-track {
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ds-modal-track-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .ds-modal-track-artist {
    font-size: 11px;
    color: var(--text-tertiary);
  }
  .ds-modal-search-row {
    display: flex;
    gap: var(--space-2);
  }
  .ds-modal-results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    max-height: 260px;
    overflow-y: auto;
  }
  .ds-modal-result-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-canvas);
    border-radius: 10px;
  }
  .ds-modal-result-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .ds-modal-result-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ds-modal-result-artist {
    font-size: 10px;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ds-modal-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-align: center;
    padding: var(--space-4);
  }

  /* ─── Responsive ──────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .ds-input-row {
      flex-direction: column;
    }
    .ds-btn {
      justify-content: center;
    }
    .ds-sync-row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
    }
    .ds-sync-actions {
      grid-column: 2;
      grid-row: 1 / span 2;
    }
    .ds-pct-badge {
      grid-column: 1;
      grid-row: 2;
      justify-self: start;
    }
    .ds-td-artist,
    .ds-track-album { display: none; }
  }
</style>
