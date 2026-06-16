<script lang="ts">
  /**
   * Housekeeping → Artwork. Gestión de los animated artworks descargados
   * (ADMIN). El auto-match de Apple/iTunes falla a menudo, así que aquí el
   * admin revisa qué se descargó (con su referencia iTunes) y borra los mal
   * etiquetados — el borrado limpia la fila de la DB y los .mp4 del disco.
   *
   * Grid de pósters 3:4 (aspect nativo del motion artwork de Apple, fileUrlTall
   * 2048×2732): ver el motion a buen tamaño es lo que permite detectar un match
   * incorrecto de un vistazo. En reposo cada celda muestra el cover estático
   * (barato); el <video> solo se monta en la celda con hover/foco — máximo un
   * decoder vivo en GPU.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { FilmSlate, Trash, ArrowSquareOut } from 'phosphor-svelte';
  import {
    listArtworks,
    deleteArtwork,
    resolveArtworkVideoUrl,
    type AlbumArtworkEntry
  } from '$services/AlbumArtworkService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';

  const artworksQ = createQuery(() => ({
    queryKey: ['housekeeping', 'artworks'],
    queryFn: () => listArtworks({ limit: 500 }),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const entries = $derived(artworksQ.data ?? []);

  // Borrado en dos pasos: click → confirmación anclada → confirmar. El popover
  // se ancla al botón sin tapar el póster (ves lo que vas a borrar).
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

  // Preview bajo demanda: por defecto cada celda muestra el cover ESTÁTICO del
  // álbum (`<img>`, barato y gestionado por el cache de imágenes del browser).
  // El `<video>` solo se MONTA en la celda bajo el ratón/foco — así nunca hay
  // más de un decoder de vídeo vivo. Tener cientos de `<video>` montados (aun
  // con preload="metadata") retiene un frame decodificado por elemento en GPU
  // (~4.6 MB cada uno a 1080² → cientos de MB). El montaje on-demand lo evita.
  let hoveredId = $state<string | null>(null);
  function hoverEnter(id: string): void {
    hoveredId = id;
  }
  function hoverLeave(id: string): void {
    if (hoveredId === id) hoveredId = null;
  }

  // Línea de metadatos bajo el póster: iTunes #id · país · variant.
  function metaLine(e: AlbumArtworkEntry): string {
    const parts: string[] = [];
    if (e.appleCollectionId) parts.push(`iTunes #${e.appleCollectionId}`);
    if (e.country) parts.push(e.country.toUpperCase());
    if (e.variant) parts.push(e.variant);
    return parts.join(' · ');
  }
</script>

<svelte:head>
  <title>Artwork · Housekeeping · Audiorr</title>
</svelte:head>

<AdminPanel
  title="Animated artwork"
  error={artworksQ.isError ? 'No se pudo cargar el listado de artworks. ¿Backend desplegado?' : null}
  onRetry={() => artworksQ.refetch()}
  empty={!artworksQ.isPending && !artworksQ.isError && entries.length === 0}
  emptyText="Aún no hay animated artwork descargado."
>
  {#snippet info()}
    Motion artwork descargado de Apple Music. Revisa la referencia de iTunes y
    elimina los álbumes mal etiquetados — se borran de la base de datos y del
    disco.
  {/snippet}
  {#snippet action()}
    {#if entries.length > 0}
      <span class="hk-art-count">{entries.length}</span>
    {/if}
  {/snippet}

  {#if artworksQ.isPending}
    <div class="hk-art-grid" aria-busy="true">
      {#each Array(10) as _, i (i)}
        <div class="hk-art-cell">
          <div class="hk-art-sk-poster"></div>
          <div class="hk-art-sk-line"></div>
          <div class="hk-art-sk-line short"></div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="hk-art-grid">
      {#each entries as e (e.albumId)}
        {@const videoUrl = resolveArtworkVideoUrl(e)}
        <article class="hk-art-cell">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="hk-art-poster-wrap"
            onmouseenter={() => hoverEnter(e.albumId)}
            onmouseleave={() => hoverLeave(e.albumId)}
            onfocusin={() => hoverEnter(e.albumId)}
            onfocusout={() => hoverLeave(e.albumId)}
          >
            {#if videoUrl}
              <!-- Póster estático: cover del álbum (Navidrome). Lazy + barato.
                   Es lo único que se ve en reposo — sin <video> = sin decoder. -->
              <img
                class="hk-art-poster"
                src={getCoverArtUrl(e.albumId, 300)}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <!-- El <video> solo se monta cuando esta celda tiene hover/foco.
                   autoplay+muted arranca al montar; al salir, se desmonta y el
                   decoder se libera. Máximo un vídeo vivo en toda la página. -->
              {#if hoveredId === e.albumId}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video
                  class="hk-art-video"
                  src={videoUrl}
                  autoplay
                  muted
                  loop
                  playsinline
                  preload="auto"
                ></video>
              {/if}
            {:else}
              <span class="hk-art-fallback"><FilmSlate size={28} weight="regular" /></span>
            {/if}

            <!-- Badge de match (arriba-izquierda) -->
            <span
              class="hk-art-badge"
              class:manual={e.matchStatus === 'manual'}
              class:auto={e.matchStatus === 'auto'}
            >{e.matchStatus}</span>

            <!-- Borrado: icono reveal-on-hover (siempre visible en touch) -->
            <button
              type="button"
              class="hk-art-trash"
              aria-label={`Eliminar artwork de ${e.title ?? e.albumId}`}
              onclick={() => (confirmingId = confirmingId === e.albumId ? null : e.albumId)}
            >
              <Trash size={15} weight="bold" />
            </button>
          </div>

          <!-- Confirmación anclada al cell (no tapa el póster, no la clipa el wrap) -->
          {#if confirmingId === e.albumId}
            <div class="hk-art-confirm" role="dialog" aria-label="Confirmar eliminación">
              <span class="hk-art-confirm-q">¿Eliminar?</span>
              <div class="hk-art-confirm-btns">
                <button
                  type="button"
                  class="hk-art-cbtn hk-art-cbtn-danger"
                  onclick={() => doDelete(e)}
                  disabled={deletingId === e.albumId}
                >
                  {deletingId === e.albumId ? '…' : 'Eliminar'}
                </button>
                <button
                  type="button"
                  class="hk-art-cbtn hk-art-cbtn-ghost"
                  onclick={() => (confirmingId = null)}
                  disabled={deletingId === e.albumId}
                >
                  Cancelar
                </button>
              </div>
            </div>
          {/if}

          <!-- Metadatos BAJO el póster (nunca sobre el vídeo) -->
          <div class="hk-art-meta">
            <a class="hk-art-name" href={`/album/${e.albumId}`}>
              <span class="hk-art-name-text">{e.title ?? e.albumId}</span>
              <ArrowSquareOut size={11} weight="bold" />
            </a>
            {#if e.artist}<p class="hk-art-artist">{e.artist}</p>{/if}
            {#if metaLine(e)}<p class="hk-art-sub">{metaLine(e)}</p>{/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</AdminPanel>

<style>
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

  /* === Grid 3:4 === */
  .hk-art-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(150px, 18vw, 200px), 1fr));
    gap: var(--space-3);
  }
  .hk-art-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    /* Virtualización nativa: el navegador no renderiza ni hace layout de las
       celdas fuera de pantalla (el listado puede tener cientos). contain-
       intrinsic-size reserva el alto para que el scroll no salte. */
    content-visibility: auto;
    contain-intrinsic-size: auto 280px;
  }

  .hk-art-poster-wrap {
    position: relative;
    aspect-ratio: 3 / 4;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--artwork-placeholder-bg);
  }
  .hk-art-poster,
  .hk-art-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  /* El vídeo se monta encima del póster al hacer hover. */
  .hk-art-video { z-index: 1; }
  .hk-art-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--artwork-placeholder-fg);
  }

  /* Badge de match (arriba-izquierda) */
  .hk-art-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 2;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 700;
    text-transform: capitalize;
  }
  .hk-art-badge.manual {
    background: color-mix(in srgb, var(--status-success) 22%, transparent);
    border-color: transparent;
    color: var(--status-success);
  }
  .hk-art-badge.auto {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    border-color: transparent;
    color: var(--accent);
  }

  /* Trash: reveal-on-hover en desktop, siempre visible en touch */
  .hk-art-trash {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--bg-surface) 78%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .hk-art-poster-wrap:hover .hk-art-trash,
  .hk-art-poster-wrap:focus-within .hk-art-trash {
    opacity: 1;
  }
  .hk-art-trash:hover {
    background: var(--status-danger);
    color: var(--status-danger-contrast);
  }
  .hk-art-trash:focus-visible {
    outline: none;
    opacity: 1;
    box-shadow: var(--focus-ring);
  }
  @media (hover: none) {
    .hk-art-trash { opacity: 1; }
  }

  /* Confirmación anclada (esquina superior derecha, bajo el trash) */
  .hk-art-confirm {
    position: absolute;
    top: 40px;
    right: 6px;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--radius-md);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-lg);
  }
  .hk-art-confirm-q {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .hk-art-confirm-btns {
    display: flex;
    gap: 4px;
  }
  .hk-art-cbtn {
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition: filter var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .hk-art-cbtn:disabled { opacity: 0.5; cursor: not-allowed; }
  .hk-art-cbtn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .hk-art-cbtn-danger {
    background: var(--status-danger);
    color: var(--status-danger-contrast);
  }
  .hk-art-cbtn-danger:hover:not(:disabled) { filter: brightness(1.08); }
  .hk-art-cbtn-ghost {
    background: transparent;
    border-color: var(--border-subtle);
    color: var(--text-secondary);
  }
  .hk-art-cbtn-ghost:hover:not(:disabled) { background: var(--bg-surface-hover); }

  /* === Metadatos === */
  .hk-art-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .hk-art-name {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .hk-art-name:hover { color: var(--accent); }
  .hk-art-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-art-name :global(svg) { flex-shrink: 0; opacity: 0.55; }
  .hk-art-artist {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-art-sub {
    margin: 1px 0 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* === Skeleton de celda 3:4 === */
  .hk-art-sk-poster {
    aspect-ratio: 3 / 4;
    border-radius: var(--radius-md);
    background: var(--skeleton-bg);
    animation: hk-art-pulse 1.6s ease-in-out infinite;
  }
  .hk-art-sk-line {
    height: 12px;
    border-radius: var(--radius-sm);
    background: var(--skeleton-bg);
    animation: hk-art-pulse 1.6s ease-in-out infinite;
  }
  .hk-art-sk-line.short { width: 60%; }
  @keyframes hk-art-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hk-art-sk-poster,
    .hk-art-sk-line { animation: none; }
  }
</style>
