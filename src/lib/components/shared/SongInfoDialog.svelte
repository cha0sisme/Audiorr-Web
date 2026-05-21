<script lang="ts">
  /**
   * SongInfoDialog — modal "Información detallada" del archivo de audio.
   *
   * Sirve como inspector técnico de la pista: formato, calidad, tamaño,
   * ruta en la biblioteca, estadísticas de reproducción, ReplayGain e
   * identificadores. Solo aparecen las secciones para las que el server
   * provee datos — no pintamos placeholders vacíos.
   *
   * Patrón visual coherente con CreatePlaylistDialog y ViewArtistsDialog:
   * scrim + dialog centrado con transiciones fade/scale, semantic tokens
   * para colores, --font-mono para valores técnicos (paths, IDs, números).
   *
   * Datos: hidrata `initialData` con la metadata que el caller ya tenía
   * y refetchea con `getSong(id)` para garantizar tener todos los campos
   * OpenSubsonic (bitDepth, samplingRate, channelCount, replayGain, etc.).
   */
  import { fade, scale } from 'svelte/transition';
  import { createQuery } from '@tanstack/svelte-query';
  import {
    X,
    Copy,
    File,
    Path,
    ChartBar,
    Waveform,
    Fingerprint,
    Tag
  } from 'phosphor-svelte';
  import * as nav from '$services/NavidromeService';
  import { songInfoUI } from '$stores/song-info-ui.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { NavidromeSong } from '$types/navidrome';

  const songId = $derived(songInfoUI.songId);
  const initial = $derived(songInfoUI.initial);

  // initialData mezcla los campos que el caller pasó (al menos id+title)
  // para que el modal pinte al instante. CRÍTICO: `initialDataUpdatedAt: 0`
  // marca esos datos como "stale" → TanStack Query dispara `queryFn` en
  // background para enriquecer con los campos OpenSubsonic (bitDepth,
  // samplingRate, replayGain, playCount, path, etc.) que `getSong` SÍ
  // devuelve pero el `initial` parcial no incluía. Sin esto, el modal se
  // queda con la metadata cruda del row y nunca pinta el resto.
  const songQ = createQuery(() => ({
    queryKey: ['song', songId],
    queryFn: () => nav.getSong(songId),
    enabled: songInfoUI.isOpen && songId.length > 0,
    initialData: initial as NavidromeSong | undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30 * 1000
  }));

  const song = $derived(songQ.data);

  // ─── ESC para cerrar ──────────────────────────────────────────────────
  $effect(() => {
    if (!songInfoUI.isOpen) return;
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
    songInfoUI.close();
  }

  // ─── Formateadores ────────────────────────────────────────────────────
  function formatSize(bytes: number | undefined): string | undefined {
    if (!bytes) return undefined;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  }

  function formatBitrate(kbps: number | undefined): string | undefined {
    if (!kbps) return undefined;
    return `${kbps} kbps`;
  }

  function formatSampling(sr: number | undefined): string | undefined {
    if (!sr) return undefined;
    // 44100 → "44.1 kHz", 48000 → "48 kHz", 96000 → "96 kHz".
    const khz = sr / 1000;
    return `${Number.isInteger(khz) ? khz : khz.toFixed(1)} kHz`;
  }

  function formatChannels(c: number | undefined): string | undefined {
    if (c === undefined) return undefined;
    if (c === 1) return 'Mono';
    if (c === 2) return 'Estéreo';
    if (c === 6) return 'Surround 5.1';
    if (c === 8) return 'Surround 7.1';
    return `${c} canales`;
  }

  function formatDuration(sec: number | undefined): string | undefined {
    if (!sec) return undefined;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatDate(iso: string | undefined): string | undefined {
    if (!iso) return undefined;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });
  }

  function formatGain(g: number | undefined): string | undefined {
    if (g === undefined || Number.isNaN(g)) return undefined;
    return `${g >= 0 ? '+' : ''}${g.toFixed(2)} dB`;
  }

  function formatPeak(p: number | undefined): string | undefined {
    if (p === undefined || Number.isNaN(p)) return undefined;
    return p.toFixed(4);
  }

  // ─── Copy to clipboard helper ─────────────────────────────────────────
  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.success(`${label} copiado`);
    } catch {
      toasts.error('No se pudo copiar al portapapeles');
    }
  }

  // ─── Derivados de visibilidad por sección ─────────────────────────────
  // Solo pintamos secciones con al menos un dato real. Evita columnas con
  // únicamente em-dashes (placeholder visual feo).
  const hasFileInfo = $derived(
    !!(
      song?.suffix ||
      song?.bitRate ||
      song?.samplingRate ||
      song?.bitDepth ||
      song?.channelCount ||
      song?.size ||
      song?.duration
    )
  );
  const hasStats = $derived(
    !!(song?.playCount !== undefined || song?.played || song?.created)
  );
  const rg = $derived(song?.replayGain);
  const hasReplayGain = $derived(
    !!(
      rg &&
      (rg.trackGain !== undefined ||
        rg.trackPeak !== undefined ||
        rg.albumGain !== undefined ||
        rg.albumPeak !== undefined)
    )
  );
  const hasOther = $derived(
    !!(song?.bpm || song?.discNumber || song?.year || song?.genre || song?.comment)
  );
  const hasIdentifiers = $derived(!!(song?.id || song?.musicBrainzId));
</script>

{#if songInfoUI.isOpen}
  <div
    class="sid-scrim"
    in:fade={{ duration: 160 }}
    out:fade={{ duration: 120 }}
    role="presentation"
    onclick={close}
  ></div>
  <div
    class="sid-dialog"
    role="dialog"
    aria-modal="true"
    aria-label="Información detallada de la canción"
    in:scale={{ duration: 240, start: 0.95, opacity: 0 }}
    out:scale={{ duration: 160, start: 0.97, opacity: 0 }}
  >
    <header class="sid-head">
      <div class="sid-head-text">
        <h2 class="sid-title">Información detallada</h2>
        {#if song}
          <p class="sid-sub">
            <span class="sid-sub-title">{song.title}</span>
            {#if song.artist}<span class="sid-sub-sep">·</span><span class="sid-sub-artist">{song.artist}</span>{/if}
          </p>
        {/if}
      </div>
      <button type="button" class="sid-close" aria-label="Cerrar" onclick={close}>
        <X size={14} weight="bold" />
      </button>
    </header>

    <div class="sid-body">
      {#if !song}
        <p class="sid-loading" aria-busy="true">Cargando…</p>
      {:else}
        {@const sr = formatSampling(song.samplingRate)}
        {@const bd = song.bitDepth ? `${song.bitDepth}-bit` : undefined}
        {@const channels = formatChannels(song.channelCount)}
        {@const size = formatSize(song.size)}
        {@const duration = formatDuration(song.duration)}
        {@const playedAt = formatDate(song.played)}
        {@const createdAt = formatDate(song.created)}
        {@const tg = formatGain(rg?.trackGain)}
        {@const tp = formatPeak(rg?.trackPeak)}
        {@const ag = formatGain(rg?.albumGain)}
        {@const ap = formatPeak(rg?.albumPeak)}
        {#if hasFileInfo}
          <section class="sid-section">
            <h3 class="sid-section-title">
              <File size={14} weight="regular" />
              Archivo
            </h3>
            <dl class="sid-fields">
              {#if song.suffix}
                <div class="sid-field">
                  <dt>Formato</dt>
                  <dd class="sid-format">
                    <span class="sid-badge">{song.suffix.toUpperCase()}</span>
                    {#if song.contentType}
                      <span class="sid-mono sid-secondary">{song.contentType}</span>
                    {/if}
                  </dd>
                </div>
              {/if}
              {#if song.bitRate}
                <div class="sid-field">
                  <dt>Bitrate</dt>
                  <dd class="sid-mono">{formatBitrate(song.bitRate)}</dd>
                </div>
              {/if}
              {#if sr || bd}
                <div class="sid-field">
                  <dt>Calidad</dt>
                  <dd class="sid-mono">
                    {#if sr && bd}{sr} <span class="sid-mono-sep">/</span> {bd}{:else}{sr ?? bd}{/if}
                  </dd>
                </div>
              {/if}
              {#if channels}
                <div class="sid-field">
                  <dt>Canales</dt>
                  <dd>{channels}</dd>
                </div>
              {/if}
              {#if size}
                <div class="sid-field">
                  <dt>Tamaño</dt>
                  <dd class="sid-mono">{size}</dd>
                </div>
              {/if}
              {#if duration}
                <div class="sid-field">
                  <dt>Duración</dt>
                  <dd class="sid-mono">{duration}</dd>
                </div>
              {/if}
            </dl>
          </section>
        {/if}

        {#if song.path}
          <section class="sid-section">
            <h3 class="sid-section-title">
              <Path size={14} weight="regular" />
              Ruta
            </h3>
            <div class="sid-path">
              <code class="sid-mono sid-path-code">{song.path}</code>
              <button
                type="button"
                class="sid-copy"
                onclick={() => copy(song.path!, 'Ruta')}
                aria-label="Copiar ruta al portapapeles"
              >
                <Copy size={13} weight="regular" />
              </button>
            </div>
            <p class="sid-hint">
              Relativa a la raíz de la biblioteca configurada en Navidrome.
            </p>
          </section>
        {/if}

        {#if hasStats}
          <section class="sid-section">
            <h3 class="sid-section-title">
              <ChartBar size={14} weight="regular" />
              Estadísticas
            </h3>
            <dl class="sid-fields">
              {#if song.playCount !== undefined}
                <div class="sid-field">
                  <dt>Reproducciones</dt>
                  <dd class="sid-mono">{song.playCount}</dd>
                </div>
              {/if}
              {#if playedAt}
                <div class="sid-field">
                  <dt>Último escuchado</dt>
                  <dd>{playedAt}</dd>
                </div>
              {/if}
              {#if createdAt}
                <div class="sid-field">
                  <dt>Añadido a la biblioteca</dt>
                  <dd>{createdAt}</dd>
                </div>
              {/if}
            </dl>
          </section>
        {/if}

        {#if hasReplayGain && rg}
          <section class="sid-section">
            <h3 class="sid-section-title">
              <Waveform size={14} weight="regular" />
              ReplayGain
            </h3>
            <dl class="sid-fields sid-fields-grid">
              {#if tg}
                <div class="sid-field">
                  <dt>Track gain</dt>
                  <dd class="sid-mono">{tg}</dd>
                </div>
              {/if}
              {#if tp}
                <div class="sid-field">
                  <dt>Track peak</dt>
                  <dd class="sid-mono">{tp}</dd>
                </div>
              {/if}
              {#if ag}
                <div class="sid-field">
                  <dt>Album gain</dt>
                  <dd class="sid-mono">{ag}</dd>
                </div>
              {/if}
              {#if ap}
                <div class="sid-field">
                  <dt>Album peak</dt>
                  <dd class="sid-mono">{ap}</dd>
                </div>
              {/if}
            </dl>
          </section>
        {/if}

        {#if hasOther}
          <section class="sid-section">
            <h3 class="sid-section-title">
              <Tag size={14} weight="regular" />
              Tags
            </h3>
            <dl class="sid-fields">
              {#if song.year}
                <div class="sid-field">
                  <dt>Año</dt>
                  <dd class="sid-mono">{song.year}</dd>
                </div>
              {/if}
              {#if song.genre}
                <div class="sid-field">
                  <dt>Género</dt>
                  <dd>{song.genre}</dd>
                </div>
              {/if}
              {#if song.discNumber}
                <div class="sid-field">
                  <dt>Disco</dt>
                  <dd class="sid-mono">{song.discNumber}</dd>
                </div>
              {/if}
              {#if song.bpm}
                <div class="sid-field">
                  <dt>BPM</dt>
                  <dd class="sid-mono">{song.bpm}</dd>
                </div>
              {/if}
              {#if song.comment}
                <div class="sid-field sid-field-block">
                  <dt>Comentario</dt>
                  <dd class="sid-comment">{song.comment}</dd>
                </div>
              {/if}
            </dl>
          </section>
        {/if}

        {#if hasIdentifiers}
          <section class="sid-section">
            <h3 class="sid-section-title">
              <Fingerprint size={14} weight="regular" />
              Identificadores
            </h3>
            <dl class="sid-fields">
              {#if song.id}
                <div class="sid-field sid-field-block">
                  <dt>ID Subsonic</dt>
                  <dd class="sid-id-row">
                    <code class="sid-mono sid-id">{song.id}</code>
                    <button
                      type="button"
                      class="sid-copy"
                      onclick={() => copy(song.id, 'ID')}
                      aria-label="Copiar ID Subsonic"
                    >
                      <Copy size={13} weight="regular" />
                    </button>
                  </dd>
                </div>
              {/if}
              {#if song.musicBrainzId}
                <div class="sid-field sid-field-block">
                  <dt>MusicBrainz Recording ID</dt>
                  <dd class="sid-id-row">
                    <code class="sid-mono sid-id">{song.musicBrainzId}</code>
                    <button
                      type="button"
                      class="sid-copy"
                      onclick={() => copy(song.musicBrainzId!, 'MBID')}
                      aria-label="Copiar MusicBrainz ID"
                    >
                      <Copy size={13} weight="regular" />
                    </button>
                  </dd>
                </div>
              {/if}
            </dl>
          </section>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ─── Scrim + dialog shell — mismo lenguaje que CreatePlaylistDialog ── */
  .sid-scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: rgb(0 0 0 / 0.55);
    backdrop-filter: blur(8px) saturate(1.1);
    -webkit-backdrop-filter: blur(8px) saturate(1.1);
  }
  .sid-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--z-modal) + 1);
    width: min(560px, calc(100vw - var(--space-6)));
    max-height: min(80vh, 720px);
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-2xl);
    overflow: hidden;
  }

  /* ─── Header ───────────────────────────────────────────────────────── */
  .sid-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-3);
    padding: var(--space-5) var(--space-5) var(--space-4);
    border-bottom: 1px solid var(--separator-subtle);
  }
  .sid-head-text {
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .sid-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    line-height: 1.2;
  }
  .sid-sub {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.3;
    /* Title + artist en línea con sep visual; ellipsis si overflow. */
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sid-sub-title {
    color: var(--text-primary);
    font-weight: 500;
  }
  .sid-sub-sep {
    margin: 0 6px;
    color: var(--text-tertiary);
  }
  .sid-close {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .sid-close:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .sid-close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ─── Body scrollable ─────────────────────────────────────────────── */
  .sid-body {
    overflow-y: auto;
    padding: var(--space-4) var(--space-5) var(--space-5);
    display: grid;
    gap: var(--space-5);
    scrollbar-width: thin;
  }
  .sid-loading {
    margin: 0;
    padding: var(--space-6) 0;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  /* ─── Section ─────────────────────────────────────────────────────── */
  .sid-section {
    display: grid;
    gap: var(--space-3);
  }
  .sid-section-title {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .sid-section-title :global(svg) {
    flex-shrink: 0;
  }

  /* ─── Definition list — clave / valor ─────────────────────────────── */
  .sid-fields {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  /* Variante "grid" — usada en ReplayGain para apilar los 4 campos en 2
     columnas a partir de viewports mid (más compacto y comparable). */
  .sid-fields-grid {
    grid-template-columns: 1fr 1fr;
    column-gap: var(--space-5);
  }
  @media (max-width: 480px) {
    .sid-fields-grid {
      grid-template-columns: 1fr;
    }
  }
  .sid-field {
    display: grid;
    grid-template-columns: minmax(120px, 38%) minmax(0, 1fr);
    align-items: baseline;
    column-gap: var(--space-4);
    padding: 2px 0;
  }
  /* Variante full-width — para path / IDs largos que no caben en columna. */
  .sid-field-block {
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 4px;
  }
  .sid-field dt {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-weight: 400;
  }
  .sid-field dd {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-primary);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  /* ─── Mono utilities ──────────────────────────────────────────────── */
  .sid-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .sid-mono-sep {
    color: var(--text-tertiary);
    margin: 0 2px;
  }
  .sid-secondary {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    margin-left: 6px;
  }

  /* ─── Format badge ────────────────────────────────────────────────── */
  .sid-format {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .sid-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--explicit-badge-bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.4;
  }

  /* ─── Path row ────────────────────────────────────────────────────── */
  .sid-path {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--separator-subtle);
    border-radius: var(--radius-sm);
  }
  .sid-path-code {
    font-size: var(--text-xs);
    color: var(--text-primary);
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: break-all;
    background: transparent;
    padding: 2px 0;
    align-self: center;
  }
  .sid-hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    padding-left: var(--space-1);
  }

  /* ─── ID row (Subsonic / MusicBrainz) ─────────────────────────────── */
  .sid-id-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }
  .sid-id {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--bg-surface);
    border: 1px solid var(--separator-subtle);
    border-radius: var(--radius-xs);
    padding: 4px 8px;
    overflow-wrap: anywhere;
    word-break: break-all;
    line-height: 1.4;
  }

  /* ─── Comment block ───────────────────────────────────────────────── */
  .sid-comment {
    font-size: var(--text-sm);
    color: var(--text-primary);
    line-height: 1.5;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--separator-subtle);
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
  }

  /* ─── Copy button ─────────────────────────────────────────────────── */
  .sid-copy {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 1px solid var(--separator-subtle);
    border-radius: var(--radius-xs);
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default);
  }
  .sid-copy:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
  .sid-copy:active {
    transform: scale(0.94);
    transition-duration: var(--duration-instant);
  }
  .sid-copy:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ─── Responsive ──────────────────────────────────────────────────── */
  @media (max-width: 480px) {
    .sid-dialog {
      width: calc(100vw - var(--space-4));
      max-height: 88vh;
    }
    .sid-head {
      padding: var(--space-4);
    }
    .sid-body {
      padding: var(--space-3) var(--space-4) var(--space-4);
    }
    .sid-field {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
