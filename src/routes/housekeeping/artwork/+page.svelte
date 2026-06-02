<script lang="ts">
  /**
   * Housekeeping → Artwork. Gestión de los animated artworks descargados
   * (ADMIN). El auto-match de Apple/iTunes falla a menudo, así que aquí el
   * admin revisa qué se descargó (con su referencia iTunes) y borra los mal
   * etiquetados — el borrado limpia la fila de la DB y los .mp4 del disco.
   *
   * El preview es el propio vídeo (muted/loop): ver el motion es justo lo que
   * permite detectar un match incorrecto de un vistazo.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { FilmSlate, Trash, Warning, ArrowSquareOut } from 'phosphor-svelte';
  import {
    listArtworks,
    deleteArtwork,
    resolveArtworkVideoUrl,
    type AlbumArtworkEntry
  } from '$services/AlbumArtworkService';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';

  const artworksQ = createQuery(() => ({
    queryKey: ['housekeeping', 'artworks'],
    queryFn: () => listArtworks({ limit: 500 }),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const entries = $derived(artworksQ.data ?? []);

  // Borrado en dos pasos: click → confirmación inline → confirmar. Evita un
  // window.confirm feo y un modal extra para una acción de baja frecuencia.
  let confirmingId = $state<string | null>(null);
  let deletingId = $state<string | null>(null);

  async function doDelete(entry: AlbumArtworkEntry) {
    if (deletingId) return;
    deletingId = entry.albumId;
    try {
      const res = await deleteArtwork(entry.albumId);
      const n = res.deletedFiles.length;
      toasts.success(
        'Artwork eliminado',
        `${entry.title ?? entry.albumId} · ${n} ${n === 1 ? 'archivo' : 'archivos'}`
      );
      await artworksQ.refetch();
    } catch {
      toasts.error('No se pudo eliminar el artwork');
    } finally {
      deletingId = null;
      confirmingId = null;
    }
  }

  function fmtDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Preview bajo demanda: reproduce el vídeo de la fila al entrar el ratón o
  // el foco, lo pausa al salir. Evita tener cientos de <video> en autoplay.
  function hoverPlay(ev: Event & { currentTarget: HTMLElement }): void {
    const video = ev.currentTarget.querySelector('video');
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => {});
  }
  function hoverPause(ev: Event & { currentTarget: HTMLElement }): void {
    ev.currentTarget.querySelector('video')?.pause();
  }

  function refLine(e: AlbumArtworkEntry): string {
    const parts: string[] = [];
    if (e.country) parts.push(e.country.toUpperCase());
    if (e.variant) parts.push(e.variant);
    return parts.join(' · ');
  }
</script>

<svelte:head>
  <title>Artwork · Housekeeping · Audiorr</title>
</svelte:head>

<section class="hk-art">
  <header class="hk-art-head">
    <h1 class="hk-art-title">Animated artwork</h1>
    {#if entries.length > 0}
      <span class="hk-art-count">{entries.length}</span>
    {/if}
  </header>
  <p class="hk-art-intro">
    Motion artwork descargado de Apple Music. Revisa la referencia de iTunes y
    elimina los álbumes mal etiquetados — se borran de la base de datos y del
    disco.
  </p>

  {#if artworksQ.isPending}
    <div class="hk-art-grid" aria-busy="true">
      {#each Array(6) as _}
        <div class="hk-art-sk"></div>
      {/each}
    </div>
  {:else if artworksQ.isError}
    <div class="hk-art-state hk-art-state-error">
      <Warning size={20} weight="fill" />
      <p>No se pudo cargar el listado de artworks. ¿Backend desplegado?</p>
    </div>
  {:else if entries.length === 0}
    <div class="hk-art-state">
      <FilmSlate size={28} weight="regular" />
      <p>Aún no hay animated artwork descargado.</p>
    </div>
  {:else}
    <ul class="hk-art-list">
      {#each entries as e (e.albumId)}
        {@const videoUrl = resolveArtworkVideoUrl(e)}
        <li class="hk-art-row">
          <a
            class="hk-art-preview"
            href={`/album/${e.albumId}`}
            aria-label={`Ver ${e.title ?? 'álbum'}`}
            onmouseenter={hoverPlay}
            onmouseleave={hoverPause}
            onfocusin={hoverPlay}
            onfocusout={hoverPause}
          >
            {#if videoUrl}
              <!-- Sin autoplay: con cientos de filas, reproducir todos a la vez
                   satura red/CPU. Solo se reproduce el que está bajo el ratón
                   (o con foco de teclado). `preload="metadata"` muestra el
                   primer frame como póster sin descargar el vídeo entero. -->
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={videoUrl} muted loop playsinline preload="metadata"></video>
            {:else}
              <span class="hk-art-preview-fallback"><FilmSlate size={20} weight="regular" /></span>
            {/if}
          </a>

          <div class="hk-art-info">
            <a class="hk-art-name" href={`/album/${e.albumId}`}>
              {e.title ?? e.albumId}
              <ArrowSquareOut size={12} weight="bold" />
            </a>
            {#if e.artist}<p class="hk-art-artist">{e.artist}</p>{/if}
            <div class="hk-art-meta">
              <span
                class="hk-art-badge"
                class:manual={e.matchStatus === 'manual'}
                class:auto={e.matchStatus === 'auto'}
              >{e.matchStatus}</span>
              {#if e.appleCollectionId}
                <span class="hk-art-itunes">iTunes #{e.appleCollectionId}</span>
              {/if}
              {#if refLine(e)}<span class="hk-art-ref">{refLine(e)}</span>{/if}
              {#if e.cachedAt}<span class="hk-art-date">{fmtDate(e.cachedAt)}</span>{/if}
            </div>
          </div>

          <div class="hk-art-actions">
            {#if confirmingId === e.albumId}
              <button
                type="button"
                class="hk-art-btn hk-art-btn-danger"
                onclick={() => doDelete(e)}
                disabled={deletingId === e.albumId}
              >
                {deletingId === e.albumId ? 'Eliminando…' : 'Confirmar'}
              </button>
              <button
                type="button"
                class="hk-art-btn hk-art-btn-ghost"
                onclick={() => (confirmingId = null)}
                disabled={deletingId === e.albumId}
              >
                Cancelar
              </button>
            {:else}
              <button
                type="button"
                class="hk-art-btn hk-art-btn-icon"
                aria-label={`Eliminar artwork de ${e.title ?? e.albumId}`}
                onclick={() => (confirmingId = e.albumId)}
              >
                <Trash size={16} weight="regular" />
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .hk-art {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }
  .hk-art-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hk-art-title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
  }
  .hk-art-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 22px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
  }
  .hk-art-intro {
    margin: 0;
    max-width: 60ch;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    line-height: 1.5;
  }

  /* === Estados === */
  .hk-art-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-6);
    text-align: center;
    color: var(--text-tertiary);
    background: var(--bg-surface);
    border-radius: var(--hk-card-radius, var(--radius-lg));
  }
  .hk-art-state p {
    margin: 0;
    font-size: var(--text-sm);
  }
  .hk-art-state-error {
    color: var(--status-error, var(--text-secondary));
  }

  /* === Skeleton === */
  .hk-art-grid {
    display: grid;
    gap: var(--space-2);
  }
  .hk-art-sk {
    height: 72px;
    background: var(--bg-surface);
    border-radius: var(--radius-md);
    animation: hk-art-pulse 1.6s ease-in-out infinite;
  }
  @keyframes hk-art-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  /* === Lista === */
  .hk-art-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .hk-art-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .hk-art-preview {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--artwork-placeholder-bg);
    flex-shrink: 0;
    display: block;
  }
  .hk-art-preview video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hk-art-preview-fallback {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--artwork-placeholder-fg);
  }

  .hk-art-info {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hk-art-name {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    text-decoration: none;
    width: fit-content;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .hk-art-name:hover {
    color: var(--accent);
  }
  .hk-art-name :global(svg) {
    flex-shrink: 0;
    opacity: 0.6;
  }
  .hk-art-artist {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-art-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .hk-art-badge {
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    font-weight: 600;
    text-transform: capitalize;
  }
  .hk-art-badge.manual {
    background: color-mix(in srgb, var(--status-success, #22c55e) 16%, transparent);
    border-color: transparent;
    color: var(--status-success, #22c55e);
  }
  .hk-art-badge.auto {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: transparent;
    color: var(--accent);
  }
  .hk-art-itunes {
    font-variant-numeric: tabular-nums;
  }

  /* === Acciones === */
  .hk-art-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .hk-art-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full);
    font-family: inherit;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .hk-art-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .hk-art-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  .hk-art-btn-icon {
    padding: var(--space-2);
    background: transparent;
    color: var(--text-tertiary);
  }
  .hk-art-btn-icon:hover {
    background: color-mix(in srgb, var(--status-error, #ef4444) 14%, transparent);
    color: var(--status-error, #ef4444);
  }
  .hk-art-btn-danger {
    background: var(--status-error, #ef4444);
    color: #fff;
  }
  .hk-art-btn-danger:hover:not(:disabled) {
    filter: brightness(1.08);
  }
  .hk-art-btn-ghost {
    background: transparent;
    border-color: var(--border-subtle);
    color: var(--text-primary);
  }
  .hk-art-btn-ghost:hover:not(:disabled) {
    background: var(--bg-surface-hover);
  }

  @media (max-width: 640px) {
    .hk-art-row {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-areas:
        'preview info'
        'actions actions';
    }
    .hk-art-actions {
      grid-area: actions;
      justify-content: flex-end;
    }
  }
</style>
