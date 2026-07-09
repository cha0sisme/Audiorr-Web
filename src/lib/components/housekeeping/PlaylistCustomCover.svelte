<script lang="ts">
  /**
   * PlaylistCustomCover — control de portada MANUAL para una playlist
   * gestionada (Daily Mix, Smart, Editorial, "This Is").
   *
   * Autocontenido: preview + botón Asignar/Reemplazar + botón Quitar (solo
   * si ya hay imagen propia). El backend compone la imagen subida con el
   * título de la playlist encima (variante `classic`) — el usuario SOLO
   * elige la imagen, nunca sube ni recorta el título.
   *
   * Contrato: `D:\Audiorr-shared\decisions\custom-cover-api-contract.md`.
   * Endpoints: GET/POST/DELETE `/api/playlists/:playlistId/custom-cover`.
   *
   * Cache-busting del preview:
   *   - Tras subir: registramos el `contentHash` nuevo en el store global
   *     `playlistCovers` (mismo mecanismo que daily-mixes/smart-playlists)
   *     → `getPlaylistCoverUrl` recalcula la URL con `?v=<hash>` sola.
   *   - Tras subir o quitar: además forzamos un `refreshTick` (`&t=...`)
   *     porque el DELETE no trae hash nuevo (la regeneración automática es
   *     asíncrona) y necesitamos saltar cualquier caché de browser.
   *   - Si el `<img>` da error (backend aún "Generating…"), reintentamos
   *     con backoff corto (hasta 4 intentos) en vez de dejar el hueco roto.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { onDestroy } from 'svelte';
  import { ArrowsClockwise, UploadSimple, Trash, Warning } from 'phosphor-svelte';
  import { getPlaylistCoverUrl } from '$services/dailyMixes';
  import {
    getCustomCoverStatus,
    uploadCustomCover,
    removeCustomCover,
    isCustomCoverAcceptedType,
    CUSTOM_COVER_ACCEPT,
    CUSTOM_COVER_MAX_BYTES
  } from '$services/playlistCustomCover';
  import { BackendError } from '$services/BackendService.svelte';
  import { playlistCovers } from '$stores/playlist-covers.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { credentials } from '$stores/credentials.svelte';

  type Props = {
    playlistId: string;
    playlistName: string;
    /** Lado del preview en px. Por defecto compacto (fila de lista). */
    size?: number;
  };

  let { playlistId, playlistName, size = 56 }: Props = $props();

  const queryClient = useQueryClient();

  const statusQ = createQuery(() => ({
    queryKey: ['customCoverStatus', playlistId],
    queryFn: () => getCustomCoverStatus(playlistId),
    enabled: credentials.isConfigured && playlistId.length > 0,
    staleTime: 60 * 1000
  }));
  const hasCustom = $derived(statusQ.data?.hasCustom ?? false);

  let fileInputEl: HTMLInputElement | undefined = $state();
  let uploading = $state(false);
  let removing = $state(false);
  let errorMsg = $state<string | null>(null);

  // ─── Cache-buster + retry con backoff mientras el backend regenera ──────
  let refreshTick = $state(0);
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => clearTimeout(retryTimer));

  const previewUrl = $derived.by(() => {
    const base = getPlaylistCoverUrl(playlistId);
    if (refreshTick === 0) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}t=${refreshTick}`;
  });

  function bump() {
    retryAttempt = 0;
    refreshTick = Date.now();
  }

  function handlePreviewError() {
    // El backend puede tardar un instante en recomponer tras asignar/quitar
    // (cola de regeneración). Reintenta con backoff corto antes de rendirse.
    if (retryAttempt >= 4) return;
    const delay = 1200 * 2 ** retryAttempt;
    retryAttempt += 1;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      refreshTick = Date.now();
    }, delay);
  }

  function triggerPicker() {
    if (uploading || removing) return;
    errorMsg = null;
    fileInputEl?.click();
  }

  function messageFrom(err: unknown, fallback: string): string {
    if (err instanceof BackendError) return err.message;
    if (err instanceof Error) return err.message;
    return fallback;
  }

  async function handleFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset inmediato: permite volver a elegir el MISMO archivo y que
    // dispare `change` otra vez (si el usuario corrige y reintenta).
    input.value = '';
    if (!file) return;

    errorMsg = null;

    if (!isCustomCoverAcceptedType(file.type)) {
      const msg = 'Formato no soportado. Usa PNG, JPEG o WebP.';
      errorMsg = msg;
      toasts.warning('Formato no soportado', msg);
      return;
    }
    if (file.size > CUSTOM_COVER_MAX_BYTES) {
      const msg = 'La imagen supera los 12 MB permitidos.';
      errorMsg = msg;
      toasts.warning('Archivo demasiado grande', msg);
      return;
    }

    uploading = true;
    try {
      const data = await uploadCustomCover(playlistId, file);
      if (data.contentHash) playlistCovers.set(playlistId, data.contentHash);
      queryClient.setQueryData(['customCoverStatus', playlistId], { hasCustom: true });
      void queryClient.invalidateQueries({ queryKey: ['customCoverStatus', playlistId] });
      bump();
      toasts.success('Portada asignada', `"${playlistName}" ya usa tu imagen.`);
    } catch (err) {
      const msg = messageFrom(err, 'Algo ha ido mal en el servidor.');
      errorMsg = msg;
      toasts.error('No se pudo asignar la portada', msg);
    } finally {
      uploading = false;
    }
  }

  async function handleRemove() {
    if (uploading || removing) return;
    if (!confirm(`¿Quitar la portada manual de "${playlistName}"?\n\nVolverá a la portada automática.`)) {
      return;
    }
    removing = true;
    errorMsg = null;
    try {
      await removeCustomCover(playlistId);
      playlistCovers.remove(playlistId);
      queryClient.setQueryData(['customCoverStatus', playlistId], { hasCustom: false });
      void queryClient.invalidateQueries({ queryKey: ['customCoverStatus', playlistId] });
      bump();
      toasts.success('Portada eliminada', 'Ha vuelto a la portada automática.');
    } catch (err) {
      const msg = messageFrom(err, 'Algo ha ido mal en el servidor.');
      errorMsg = msg;
      toasts.error('No se pudo quitar la portada', msg);
    } finally {
      removing = false;
    }
  }
</script>

<div class="pcc" style:--pcc-size="{size}px">
  <div class="pcc-preview">
    <img src={previewUrl} alt="Portada de {playlistName}" loading="lazy" onerror={handlePreviewError} />
    {#if uploading || removing || statusQ.isPending}
      <span class="pcc-preview-spin" aria-hidden="true">
        <ArrowsClockwise size={12} weight="bold" />
      </span>
    {/if}
  </div>

  <div class="pcc-actions">
    <button
      type="button"
      class="pcc-btn"
      onclick={triggerPicker}
      disabled={uploading || removing}
      aria-label={hasCustom ? `Reemplazar portada de ${playlistName}` : `Asignar portada a ${playlistName}`}
    >
      {#if uploading}
        <ArrowsClockwise size={12} weight="bold" class="pcc-spin" />
      {:else}
        <UploadSimple size={12} weight="bold" />
      {/if}
      {hasCustom ? 'Reemplazar' : 'Asignar'}
    </button>

    {#if hasCustom}
      <button
        type="button"
        class="pcc-btn pcc-btn--danger"
        onclick={handleRemove}
        disabled={uploading || removing}
        aria-label={`Quitar portada manual de ${playlistName}`}
      >
        <Trash size={12} weight="bold" /> Quitar
      </button>
    {/if}

    <input
      bind:this={fileInputEl}
      type="file"
      accept={CUSTOM_COVER_ACCEPT}
      class="pcc-file-input"
      tabindex="-1"
      onchange={handleFileChange}
    />
  </div>

  {#if errorMsg}
    <p class="pcc-error"><Warning size={11} weight="fill" /> {errorMsg}</p>
  {/if}
</div>

<style>
  .pcc {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-wrap: wrap;
  }

  /* ─── Preview ─────────────────────────────────────────────────────────── */
  .pcc-preview {
    position: relative;
    width: var(--pcc-size);
    height: var(--pcc-size);
    border-radius: 7px;
    overflow: hidden;
    background: var(--bg-canvas);
    flex-shrink: 0;
  }
  .pcc-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .pcc-preview-spin {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.35);
    color: #fff;
  }
  .pcc-preview-spin :global(svg) {
    animation: pcc-spin 1s linear infinite;
  }

  /* ─── Acciones ────────────────────────────────────────────────────────── */
  .pcc-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .pcc-file-input {
    /* Oculto pero accesible al foco programático — nunca en el flujo tab. */
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .pcc-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: var(--bg-surface-elevated, var(--bg-canvas));
    border: 1px solid color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 999px;
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 160ms var(--hk-spring-soft, ease),
      color 160ms var(--hk-spring-soft, ease),
      border-color 160ms var(--hk-spring-soft, ease);
  }
  .pcc-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--accent);
  }
  .pcc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .pcc-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  .pcc-btn--danger:hover:not(:disabled) {
    color: var(--status-danger);
    border-color: var(--status-danger);
  }

  :global(.pcc-spin) { animation: pcc-spin 1s linear infinite; }
  @keyframes pcc-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    :global(.pcc-spin),
    .pcc-preview-spin :global(svg) { animation: none; }
  }

  /* ─── Error ───────────────────────────────────────────────────────────── */
  .pcc-error {
    flex-basis: 100%;
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--status-danger);
  }
</style>
