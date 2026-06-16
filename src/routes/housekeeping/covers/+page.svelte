<script lang="ts">
  /**
   * /housekeeping/covers — Selector de covers 2026 para SmartPlaylists.
   *
   * Muestra una fila por SmartPlaylist (En Bucle, Radar de Novedades, Tiempo Atrás)
   * con la cover actual y las 3 variants nuevas (aurora, prism, ripple) como
   * previews. El admin selecciona una variant por playlist y pulsa "Aplicar
   * diseños" para hacer efectivo el cambio en todos los usuarios.
   *
   * Flujo de aplicar:
   *   1. N × PATCH /api/smart-playlists/:key  { coverVariant, allUsers: true }
   *   2. POST /api/smart-playlists/generate-all  (cooldown 30s server-side)
   *
   * El endpoint de preview devolverá 404 hasta que el backend actualizado esté
   * desplegado — en ese caso se muestra un aviso claro en el panel.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Check, ArrowsClockwise, Warning, Image, PaintBrush } from 'phosphor-svelte';
  import {
    getSmartPlaylists,
    generateAllSmartPlaylists,
    patchSmartPlaylistVariant,
    getCoverPreviewUrl
  } from '$services/smartPlaylists';
  import { backendService, BackendError } from '$services/BackendService.svelte';
  import AdminPanel from '$components/housekeeping/AdminPanel.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import { COVER_VARIANTS_2026, type CoverVariant2026 } from '$types/backend';

  const queryClient = useQueryClient();
  const username = $derived(credentials.current?.username ?? '');

  // ─── Carga de SmartPlaylists ──────────────────────────────────────────────
  const smartQ = createQuery(() => ({
    queryKey: ['smartPlaylists', username],
    queryFn: () => getSmartPlaylists(username),
    enabled: credentials.isConfigured && username.length > 0,
    staleTime: 60 * 1000
  }));

  // Keys de las 3 SmartPlaylists canónicas que gestionamos aquí. Filtramos
  // solo estas porque el panel está pensado para las tres playlists del sistema
  // (puede haber más rows en el futuro por usuario pero estas son las fijas).
  const MANAGED_KEYS = new Set(['en_bucle', 'radar_novedades', 'tiempo_atras']);

  // Una única fila por key (el listado puede devolver varias rows si hay
  // múltiples usuarios; nos quedamos con la primera que aparezca por key,
  // que es la del usuario que hace la consulta, o la primera en orden).
  const rows = $derived.by(() => {
    const playlists = smartQ.data ?? [];
    const seen = new Set<string>();
    return playlists.filter((p) => {
      if (!MANAGED_KEYS.has(p.playlistKey)) return false;
      if (seen.has(p.playlistKey)) return false;
      seen.add(p.playlistKey);
      return true;
    });
  });

  // ─── Selección local de variants ─────────────────────────────────────────
  // Mapa key → variant elegida por el admin en esta sesión.
  // Se inicializa con la variant actual del backend.
  let selected = $state<Record<string, string>>({});

  $effect(() => {
    // Solo init si todavía no hay selección (evita sobrescribir cambios locales
    // del usuario al refrescar la query en background).
    const playlists = smartQ.data ?? [];
    const nextSelected: Record<string, string> = {};
    for (const p of playlists) {
      if (MANAGED_KEYS.has(p.playlistKey) && !(p.playlistKey in selected)) {
        nextSelected[p.playlistKey] = p.coverVariant;
      }
    }
    if (Object.keys(nextSelected).length > 0) {
      selected = { ...selected, ...nextSelected };
    }
  });

  // ─── Cambios pendientes ───────────────────────────────────────────────────
  const hasChanges = $derived(
    rows.some((p) => selected[p.playlistKey] !== undefined && selected[p.playlistKey] !== p.coverVariant)
  );

  // ─── Cache-buster efímero para refrescar las covers actuales tras aplicar ─
  // No persiste entre recargas — solo sirve para mostrar la nueva imagen justo
  // después de aplicar (el browser puede tener la imagen vieja en cache porque
  // coverContentHash no cambia al cambiar solo la variant).
  let coverBuster = $state<number>(0);

  // ─── Estado del flujo de aplicar ─────────────────────────────────────────
  type ApplyState = 'idle' | 'patching' | 'generating' | 'done' | 'cooldown' | 'error';
  let applyState = $state<ApplyState>('idle');
  let cooldownMs = $state<number>(0);
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined;
  let errorMessage = $state<string>('');

  // ─── Detección de backend no desplegado ──────────────────────────────────
  // Las previews de cover-preview.png devuelven 404 hasta que el backend
  // actualizado (c35669a+) esté desplegado. Usamos el primer error 404 de
  // cualquier <img> de preview para mostrar un aviso global.
  let backendOutdated = $state<boolean>(false);

  function onPreviewError(e: Event) {
    const img = e.target as HTMLImageElement;
    // Solo marcamos outdated si la URL es de cover-preview — no queremos
    // falsos positivos por la cover actual que puede tener navidromeId null.
    if (img.src.includes('cover-preview')) {
      backendOutdated = true;
    }
  }

  // ─── Aplicar diseños ──────────────────────────────────────────────────────
  async function handleApply() {
    if (applyState === 'patching' || applyState === 'generating') return;

    const toApply = rows.filter(
      (p) => selected[p.playlistKey] !== undefined && selected[p.playlistKey] !== p.coverVariant
    );
    if (toApply.length === 0) return;

    applyState = 'patching';
    errorMessage = '';

    try {
      // Paso 1: PATCH por cada playlist con cambio.
      for (const p of toApply) {
        const variant = selected[p.playlistKey] as string;
        await patchSmartPlaylistVariant(p.playlistKey, variant as Parameters<typeof patchSmartPlaylistVariant>[1]);
      }

      // Paso 2: generate-all (encola la regeneración de covers con force:true).
      applyState = 'generating';
      await generateAllSmartPlaylists();

      applyState = 'done';
      // Invalidar la query para que el listado refleje las variants nuevas.
      void queryClient.invalidateQueries({ queryKey: ['smartPlaylists'] });
      // Cache-buster para forzar recarga de las covers actuales en el panel.
      coverBuster = Date.now();
      setTimeout(() => (applyState = 'idle'), 2400);

      toasts.success('Diseños aplicados', 'Las covers se regenerarán en unos segundos.');
    } catch (err) {
      if (err instanceof BackendError && err.status === 429) {
        // Cooldown del servidor — mostrar cuenta regresiva.
        applyState = 'cooldown';
        // retryAfter está en segundos (header Retry-After); multiplicamos por 1000.
        const waitMs = (err.retryAfter ?? 30) * 1000;
        cooldownMs = Math.ceil(waitMs / 1000);
        clearTimeout(cooldownTimer);
        cooldownTimer = setInterval(() => {
          cooldownMs = Math.max(0, cooldownMs - 1);
          if (cooldownMs <= 0) {
            clearInterval(cooldownTimer);
            applyState = 'idle';
          }
        }, 1000);
      } else {
        applyState = 'error';
        errorMessage = err instanceof Error ? err.message : 'Error desconocido';
        toasts.error('No se pudo aplicar', errorMessage);
        setTimeout(() => (applyState = 'idle'), 3500);
      }
    }
  }

  // ─── Labels legibles de variant ──────────────────────────────────────────
  const VARIANT_LABELS: Record<string, string> = {
    aurora: 'Aurora',
    prism: 'Prism',
    ripple: 'Ripple',
    classic: 'Classic',
    headline: 'Headline',
    graphic: 'Graphic',
    'artist-gradient': 'Artista'
  };

  function variantLabel(v: string): string {
    return VARIANT_LABELS[v] ?? v;
  }

  // Construye la URL de la cover actual con buster efímero.
  function currentCoverUrl(navidromeId: string | null): string | null {
    if (!navidromeId) return null;
    const base = backendService.fileUrl(
      `/api/playlists/${encodeURIComponent(navidromeId)}/cover.png`
    );
    return coverBuster > 0 ? `${base}?t=${coverBuster}` : base;
  }
</script>

<svelte:head>
  <title>Covers · Housekeeping</title>
</svelte:head>

<AdminPanel
  title="Portadas de playlists inteligentes"
  loading={smartQ.isPending}
  error={smartQ.isError ? 'No se ha podido cargar la lista de Smart Playlists.' : null}
  onRetry={() => smartQ.refetch()}
  empty={!smartQ.isPending && !smartQ.isError && rows.length === 0}
  emptyText="No se han encontrado Smart Playlists. Asegúrate de que el cron las ha generado al menos una vez."
>
  {#snippet info()}
    Elige el diseño de portada para cada Smart Playlist. La cover actual se
    muestra como referencia. Los tres diseños nuevos (Aurora, Prism, Ripple)
    son del estilo editorial 2026.
  {/snippet}

    {#if backendOutdated}
      <div class="hk-notice hk-notice--warn" role="alert">
        <Warning size={16} weight="fill" />
        <span>
          Los previews requieren el backend actualizado (redeploy pendiente). Puedes
          seleccionar un diseño igualmente y aplicarlo cuando el backend esté desplegado.
        </span>
      </div>
    {/if}

      <div class="hk-covers-table" role="table" aria-label="Selector de covers">
        <!-- Cabecera -->
        <div class="hk-covers-thead" role="row" aria-hidden="true">
          <div class="hk-col-playlist">Playlist</div>
          <div class="hk-col-cover">Actual</div>
          {#each COVER_VARIANTS_2026 as v}
            <div class="hk-col-cover">{variantLabel(v)}</div>
          {/each}
        </div>

        <!-- Filas -->
        {#each rows as playlist (playlist.playlistKey)}
          {@const currentVariant = selected[playlist.playlistKey] ?? playlist.coverVariant}
          <div class="hk-covers-row" role="row">
            <!-- Columna nombre -->
            <div class="hk-col-playlist" role="cell">
              <span class="hk-playlist-name">{playlist.name}</span>
              <span class="hk-variant-badge">{variantLabel(currentVariant)}</span>
            </div>

            <!-- Cover actual (referencia) -->
            <div class="hk-col-cover" role="cell">
              <div class="hk-cover-cell hk-cover-cell--reference">
                {#if currentCoverUrl(playlist.navidromeId)}
                  <img
                    src={currentCoverUrl(playlist.navidromeId) ?? ''}
                    alt="Cover actual de {playlist.name}"
                    class="hk-cover-img"
                    loading="lazy"
                  />
                {:else}
                  <div class="hk-cover-placeholder">
                    <Image size={20} weight="duotone" />
                  </div>
                {/if}
                <span class="hk-cover-label">Actual</span>
              </div>
            </div>

            <!-- Variants 2026 -->
            {#each COVER_VARIANTS_2026 as variant (variant)}
              {@const isSelected = currentVariant === variant}
              {@const isOriginal = playlist.coverVariant === variant}
              <div class="hk-col-cover" role="cell">
                <button
                  type="button"
                  class="hk-cover-cell hk-cover-cell--selectable"
                  class:selected={isSelected}
                  onclick={() => (selected = { ...selected, [playlist.playlistKey]: variant })}
                  aria-label="Seleccionar {variantLabel(variant)} para {playlist.name}"
                  aria-pressed={isSelected}
                  title={variantLabel(variant)}
                >
                  <img
                    src={getCoverPreviewUrl(playlist.name, variant, 400)}
                    alt="Preview {variantLabel(variant)} para {playlist.name}"
                    class="hk-cover-img"
                    loading="lazy"
                    onerror={onPreviewError}
                  />

                  {#if isSelected}
                    <span class="hk-cover-check" aria-hidden="true">
                      <Check size={12} weight="bold" />
                    </span>
                  {/if}

                  {#if isOriginal}
                    <span class="hk-cover-original-badge" aria-label="Diseño configurado actualmente">
                      activo
                    </span>
                  {/if}

                  <span class="hk-cover-label">{variantLabel(variant)}</span>
                </button>
              </div>
            {/each}
          </div>
        {/each}
      </div>
</AdminPanel>

{#if !smartQ.isPending && !smartQ.isError}
  <!-- Floating apply bar — glass permitido: flota. -->
  <div class="hk-publish-bar" class:visible={hasChanges || applyState !== 'idle'}>
    <p class="hk-publish-hint">
      {#if applyState === 'done'}
        <Check size={14} weight="bold" /> Cambios aplicados
      {:else if applyState === 'patching'}
        <span class="hk-spin-wrap"><ArrowsClockwise size={14} /></span> Aplicando…
      {:else if applyState === 'generating'}
        <span class="hk-spin-wrap"><ArrowsClockwise size={14} /></span> Regenerando covers…
      {:else if applyState === 'cooldown'}
        <Warning size={14} weight="fill" /> Espera {cooldownMs}s antes de volver a intentarlo
      {:else if applyState === 'error'}
        <Warning size={14} weight="fill" /> {errorMessage}
      {:else if hasChanges}
        <PaintBrush size={14} /> Hay diseños sin aplicar
      {:else}
        Todo al día
      {/if}
    </p>

    <button
      type="button"
      class="hk-btn-primary"
      disabled={!hasChanges || applyState === 'patching' || applyState === 'generating' || applyState === 'cooldown'}
      onclick={handleApply}
    >
      {#if applyState === 'done'}
        <Check size={14} weight="bold" /> Aplicado
      {:else if applyState === 'patching' || applyState === 'generating'}
        <span class="hk-spin-wrap"><ArrowsClockwise size={14} /></span> Aplicando…
      {:else if applyState === 'cooldown'}
        Espera {cooldownMs}s
      {:else}
        Aplicar diseños
      {/if}
    </button>
  </div>
{/if}

<style>
  /* ─── Aviso backend desactualizado ───────────────────────────────────────── */
  .hk-notice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-radius: 10px;
    font-size: var(--text-sm);
    line-height: 1.5;
  }
  .hk-notice--warn {
    background: color-mix(in srgb, var(--status-warning, #f59e0b) 12%, transparent);
    color: var(--text-secondary);
  }
  .hk-notice--warn :global(svg) {
    color: var(--status-warning, #f59e0b);
    flex-shrink: 0;
    margin-top: 2px;
  }

  /* ─── Tabla de covers ────────────────────────────────────────────────────── */
  .hk-covers-table {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .hk-covers-thead {
    display: grid;
    grid-template-columns: 200px 120px repeat(3, 120px);
    gap: var(--space-3);
    padding: 0 var(--space-2);
    align-items: center;
  }
  .hk-covers-thead > div {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    text-align: center;
  }
  .hk-covers-thead .hk-col-playlist {
    text-align: left;
  }

  .hk-covers-row {
    display: grid;
    grid-template-columns: 200px 120px repeat(3, 120px);
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) var(--space-2);
    background: var(--hk-tile-bg);
    border-radius: 14px;
  }

  /* ─── Columnas ───────────────────────────────────────────────────────────── */
  .hk-col-playlist {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .hk-playlist-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.005em;
    line-height: 1.3;
  }
  .hk-variant-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    border-radius: 999px;
    width: fit-content;
  }

  .hk-col-cover {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* ─── Celdas de cover ────────────────────────────────────────────────────── */
  .hk-cover-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: 100px;
  }

  .hk-cover-cell--reference {
    opacity: 0.7;
  }

  .hk-cover-cell--selectable {
    background: transparent;
    border: 2px solid transparent;
    border-radius: 12px;
    padding: 4px;
    cursor: pointer;
    transition:
      border-color 200ms var(--ease-ios-default),
      transform 200ms var(--ease-ios-default),
      box-shadow 200ms var(--ease-ios-default);
    outline: none;
  }
  .hk-cover-cell--selectable:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    transform: scale(1.03);
  }
  .hk-cover-cell--selectable.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent), 0 8px 20px -6px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .hk-cover-cell--selectable:focus-visible {
    box-shadow: var(--focus-ring);
  }

  /* ─── Imagen de cover ────────────────────────────────────────────────────── */
  .hk-cover-img {
    width: 92px;
    height: 92px;
    border-radius: 8px;
    object-fit: cover;
    display: block;
    background: var(--bg-canvas);
  }

  /* Placeholder cuando no hay navidromeId */
  .hk-cover-placeholder {
    width: 92px;
    height: 92px;
    border-radius: 8px;
    background: var(--bg-canvas);
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
  }

  /* ─── Badge check (seleccionada) ─────────────────────────────────────────── */
  .hk-cover-check {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 20px;
    height: 20px;
    background: var(--accent);
    border-radius: 999px;
    display: grid;
    place-items: center;
    color: #fff;
  }

  /* ─── Badge "activo" (variant configurada en backend) ────────────────────── */
  .hk-cover-original-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 2px 6px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    background: color-mix(in srgb, var(--text-primary) 85%, transparent);
    color: var(--bg-page, #0a0a0a);
    border-radius: 6px;
    pointer-events: none;
  }

  /* ─── Label debajo de la cover ───────────────────────────────────────────── */
  .hk-cover-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-tertiary);
    text-align: center;
    margin-top: 2px;
  }

  /* ─── Floating apply bar ─────────────────────────────────────────────────── */
  .hk-publish-bar {
    position: fixed;
    bottom: var(--space-5);
    right: var(--space-6);
    z-index: 100;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 8px 8px 8px 18px;
    background: var(--hk-card-bg);
    backdrop-filter: var(--hk-card-blur);
    -webkit-backdrop-filter: var(--hk-card-blur);
    border-radius: 999px;
    box-shadow: 0 16px 40px -14px rgba(0, 0, 0, 0.4), 0 4px 12px -4px rgba(0, 0, 0, 0.22);
    opacity: 0;
    transform: translateY(20px) scale(0.96);
    pointer-events: none;
    transition:
      opacity 320ms var(--ease-ios-default),
      transform 360ms var(--ease-ios-default);
  }
  .hk-publish-bar.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }
  .hk-publish-hint {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .hk-btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--accent);
    border: 0;
    border-radius: 999px;
    color: #fff;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition:
      transform 200ms var(--ease-ios-default),
      filter 200ms var(--ease-ios-default);
  }
  .hk-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  .hk-btn-primary:active:not(:disabled) { transform: scale(0.97); }
  .hk-btn-primary:disabled { opacity: 0.42; cursor: not-allowed; }
  .hk-btn-primary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  /* ─── Spinner en animación ───────────────────────────────────────────────── */
  .hk-spin-wrap {
    display: inline-flex;
    animation: hk-spin 1s linear infinite;
  }
  @keyframes hk-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  /* ─── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 820px) {
    .hk-covers-thead,
    .hk-covers-row {
      grid-template-columns: 160px 100px repeat(3, 100px);
      gap: var(--space-2);
    }
    .hk-cover-img,
    .hk-cover-placeholder {
      width: 76px;
      height: 76px;
    }
    .hk-cover-cell--selectable {
      width: 84px;
    }
    .hk-cover-cell {
      width: 84px;
    }
  }

  @media (max-width: 640px) {
    .hk-covers-thead {
      display: none;
    }
    .hk-covers-row {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }
    .hk-col-cover {
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--space-2);
      justify-content: flex-start;
    }
    .hk-publish-bar {
      left: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
      justify-content: space-between;
    }
  }
</style>
