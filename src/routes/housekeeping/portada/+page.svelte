<script lang="ts">
  /**
   * /housekeeping/editorial/portada — canvas builder de la portada.
   *
   * Diseña el `homepage_layout`: qué filas se muestran, en qué orden, qué
   * playlists destacadas incluye cada fila dynamic.
   *
   * Operaciones:
   *   - Reorder por drag handle (HTML5 nativo) o flechas.
   *   - Editar título de filas dynamic inline.
   *   - Añadir/quitar filas (dynamic + fixed_smart).
   *   - Añadir playlists a filas dynamic via popover picker.
   *   - Publicar cambios via floating bar (sentient: pulsa cuando hay diff).
   *
   * Las playlists destacadas (Editorial=true) se gestionan en
   * `/housekeeping/editorial/biblioteca`. Aquí solo las consumimos.
   */
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import {
    ArrowUp,
    ArrowDown,
    Plus,
    X,
    Check,
    DotsSixVertical,
    Sparkle
  } from 'phosphor-svelte';
  import * as nav from '$services/NavidromeService';
  import {
    getHomepageLayout,
    setHomepageLayout,
    DEFAULT_HOMEPAGE_LAYOUT
  } from '$services/globalSettings';
  import { isDailyMixName, isSmartPlaylistName } from '$utils/playlist-section-mappers';
  import { getPlaylistCoverUrl } from '$services/dailyMixes';
  import { credentials } from '$stores/credentials.svelte';
  import { toasts } from '$stores/toasts.svelte';
  import type { NavidromePlaylist } from '$types/navidrome';
  import type { PlaylistSection } from '$types/backend';

  const queryClient = useQueryClient();

  // ─── Carga ──────────────────────────────────────────────────────────────
  const playlistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));
  const layoutQ = createQuery(() => ({
    queryKey: ['homepageLayout'],
    queryFn: () => getHomepageLayout(),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const isLoading = $derived(playlistsQ.isPending || layoutQ.isPending);

  // ─── Estado del builder ────────────────────────────────────────────────
  let backendSnapshot = $state<string>('');
  let sections = $state<PlaylistSection[]>([]);

  $effect(() => {
    if (layoutQ.isPending) return;
    const fromBackend =
      layoutQ.data && layoutQ.data.length > 0 ? layoutQ.data : DEFAULT_HOMEPAGE_LAYOUT;
    sections = structuredClone(fromBackend);
    backendSnapshot = JSON.stringify(fromBackend);
  });

  const hasChanges = $derived(JSON.stringify(sections) !== backendSnapshot);

  let isSaving = $state(false);
  let recentlySaved = $state(false);

  // ─── Section builder helpers ───────────────────────────────────────────
  function addDynamic() {
    sections = [
      ...sections,
      { id: `sec-${Date.now()}`, title: 'Nueva fila', type: 'dynamic', playlists: [] }
    ];
  }
  function addSmart() {
    if (sections.some((s) => s.type === 'fixed_smart')) return;
    sections = [
      ...sections,
      { id: 'smart-playlists', title: 'Hecho para ti', type: 'fixed_smart' }
    ];
  }
  function removeSection(id: string) {
    sections = sections.filter((s) => s.id !== id);
  }
  function updateTitle(id: string, title: string) {
    sections = sections.map((s) => (s.id === id ? { ...s, title } : s));
  }
  function moveUp(idx: number) {
    if (idx === 0) return;
    const next = [...sections];
    [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
    sections = next;
  }
  function moveDown(idx: number) {
    if (idx === sections.length - 1) return;
    const next = [...sections];
    [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
    sections = next;
  }
  function removePlaylistFromSection(sectionId: string, playlistId: string) {
    sections = sections.map((s) =>
      s.id === sectionId
        ? { ...s, playlists: (s.playlists ?? []).filter((id) => id !== playlistId) }
        : s
    );
  }
  function addPlaylistToSection(sectionId: string, playlistId: string) {
    sections = sections.map((s) => {
      if (s.id !== sectionId || s.type !== 'dynamic') return s;
      const list = s.playlists ?? [];
      if (list.includes(playlistId)) return s;
      return { ...s, playlists: [...list, playlistId] };
    });
  }

  // ─── Drag & drop de filas (reorder) ────────────────────────────────────
  let draggedSectionId = $state<string | null>(null);
  let dropBetweenIdx = $state<number | null>(null);

  function startDragSection(e: DragEvent, sectionId: string) {
    draggedSectionId = sectionId;
    if (e.dataTransfer) {
      e.dataTransfer.setData('application/x-audiorr-section', sectionId);
      e.dataTransfer.effectAllowed = 'move';
    }
  }
  function endDrag() {
    draggedSectionId = null;
    dropBetweenIdx = null;
  }
  function handleDropBetween(e: DragEvent, idx: number) {
    e.preventDefault();
    if (!draggedSectionId) return;
    const fromIdx = sections.findIndex((s) => s.id === draggedSectionId);
    if (fromIdx === -1 || fromIdx === idx || fromIdx + 1 === idx) {
      endDrag();
      return;
    }
    const next = [...sections];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    const insertAt = fromIdx < idx ? idx - 1 : idx;
    next.splice(insertAt, 0, moved);
    sections = next;
    endDrag();
  }
  function handleDragOverBetween(e: DragEvent, idx: number) {
    if (!draggedSectionId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dropBetweenIdx = idx;
  }
  function handleDragLeaveBetween(idx: number) {
    if (dropBetweenIdx === idx) dropBetweenIdx = null;
  }

  // ─── Add picker (popover por fila dynamic) ─────────────────────────────
  let addPickerOpenFor = $state<string | null>(null);

  $effect(() => {
    if (addPickerOpenFor === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-add-picker]')) return;
      if (target?.closest('[data-add-trigger]')) return;
      addPickerOpenFor = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') addPickerOpenFor = null;
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  });

  // ─── Publish ────────────────────────────────────────────────────────────
  async function handlePublish() {
    if (!hasChanges || isSaving) return;
    isSaving = true;
    recentlySaved = false;
    try {
      await setHomepageLayout(sections);
      backendSnapshot = JSON.stringify(sections);
      // Invalidamos ambas keys:
      //   - ['homepageLayout']           → editor admin (esta misma página)
      //   - ['playlistsLayout', user]    → /library (consumidor real, layout
      //     reordenado por afinidad o legacy según ranked-layout endpoint)
      void queryClient.invalidateQueries({ queryKey: ['homepageLayout'] });
      void queryClient.invalidateQueries({ queryKey: ['playlistsLayout'] });
      recentlySaved = true;
      setTimeout(() => (recentlySaved = false), 1800);
    } catch (err) {
      toasts.error(
        'No se ha podido publicar',
        err instanceof Error ? err.message : 'Algo ha ido mal en el servidor'
      );
    } finally {
      isSaving = false;
    }
  }

  // ─── Listas derivadas ───────────────────────────────────────────────────
  const allPlaylists = $derived(playlistsQ.data ?? []);
  function isEditorial(p: NavidromePlaylist): boolean {
    return (p.comment ?? '').includes('[Editorial]');
  }
  const catalog = $derived(
    allPlaylists.filter((p) => !isDailyMixName(p) && !isSmartPlaylistName(p))
  );
  const editorialPlaylists = $derived(catalog.filter(isEditorial));

  function availableForSection(sectionId: string): NavidromePlaylist[] {
    const sec = sections.find((s) => s.id === sectionId);
    const taken = new Set(sec?.playlists ?? []);
    return editorialPlaylists.filter((p) => !taken.has(p.id));
  }

  const playlistById = $derived.by(() => {
    const map = new Map<string, NavidromePlaylist>();
    for (const p of allPlaylists) map.set(p.id, p);
    return map;
  });

  function sectionTypeLabel(t: PlaylistSection['type']): string {
    if (t === 'fixed_daily') return 'Mixes diarios';
    if (t === 'fixed_smart') return 'Smart Playlists';
    if (t === 'fixed_user')  return 'Mis playlists';
    return 'Editoriales';
  }
  function sectionTypeDesc(t: PlaylistSection['type']): string {
    if (t === 'fixed_daily') return 'Los 4 mixes que el cron genera para cada persona.';
    if (t === 'fixed_smart') return 'En bucle, Tiempo atrás y Radar de novedades por usuario.';
    if (t === 'fixed_user')  return 'Las playlists propias del usuario que abre Audiorr.';
    return 'Tú eliges qué playlists destacadas aparecen aquí.';
  }
</script>

<svelte:head>
  <title>Portada · Editorial</title>
</svelte:head>

{#if isLoading}
  <div class="hk-loading">
    <div class="hk-sk"></div>
  </div>
{:else}
  <section class="hk-card">
    <header class="hk-section-head">
      <h2>Tu portada</h2>
      <p>Reorganiza las filas, ponles nombre y añade las playlists destacadas que quieras destacar en la home.</p>
    </header>

    <div class="hk-rows">
      <div
        class="hk-drop-line"
        class:active={dropBetweenIdx === 0}
        aria-hidden="true"
        ondragover={(e) => handleDragOverBetween(e, 0)}
        ondragleave={() => handleDragLeaveBetween(0)}
        ondrop={(e) => handleDropBetween(e, 0)}
      ></div>

      {#each sections as sec, idx (sec.id)}
        <article
          class="hk-row"
          class:type-fixed={sec.type !== 'dynamic'}
          class:dragging={draggedSectionId === sec.id}
          role="group"
          aria-label={sec.title}
        >
          <div class="hk-row-head">
            <button
              type="button"
              class="hk-row-handle"
              draggable="true"
              ondragstart={(e) => startDragSection(e, sec.id)}
              ondragend={endDrag}
              aria-label="Arrastra para reordenar"
              title="Arrastra para reordenar"
            >
              <DotsSixVertical size={16} weight="bold" />
            </button>

            <div class="hk-row-reorder">
              <button
                type="button"
                class="hk-icon-btn"
                disabled={idx === 0}
                onclick={() => moveUp(idx)}
                aria-label="Subir"
              >
                <ArrowUp size={12} weight="bold" />
              </button>
              <button
                type="button"
                class="hk-icon-btn"
                disabled={idx === sections.length - 1}
                onclick={() => moveDown(idx)}
                aria-label="Bajar"
              >
                <ArrowDown size={12} weight="bold" />
              </button>
            </div>

            <div class="hk-row-title">
              {#if sec.type === 'dynamic'}
                <input
                  type="text"
                  class="hk-row-title-input"
                  value={sec.title}
                  placeholder="Ponle un nombre…"
                  oninput={(e) => updateTitle(sec.id, e.currentTarget.value)}
                />
              {:else}
                <span class="hk-row-title-static">{sec.title}</span>
                <span class="hk-row-tag">{sectionTypeLabel(sec.type)}</span>
              {/if}
            </div>

            {#if sec.type === 'dynamic' || sec.type === 'fixed_smart'}
              <button
                type="button"
                class="hk-row-remove"
                onclick={() => removeSection(sec.id)}
                aria-label="Quitar fila"
                title="Quitar fila"
              >
                <X size={14} weight="bold" />
              </button>
            {/if}
          </div>

          {#if sec.type === 'dynamic'}
            <div class="hk-row-body">
              <ul class="hk-row-pills">
                {#each sec.playlists ?? [] as plId (plId)}
                  {@const pl = playlistById.get(plId)}
                  {#if pl}
                    <li class="hk-pill">
                      <span class="hk-pill-cover">
                        <img src={getPlaylistCoverUrl(pl.id)} alt="" loading="lazy" />
                      </span>
                      <span class="hk-pill-name">{pl.name}</span>
                      <button
                        type="button"
                        class="hk-pill-remove"
                        onclick={() => removePlaylistFromSection(sec.id, pl.id)}
                        aria-label="Quitar de la fila"
                      >
                        <X size={11} weight="bold" />
                      </button>
                    </li>
                  {/if}
                {/each}

                <li class="hk-add-anchor">
                  <button
                    type="button"
                    class="hk-add-btn"
                    data-add-trigger
                    aria-haspopup="menu"
                    aria-expanded={addPickerOpenFor === sec.id}
                    onclick={() => (addPickerOpenFor = addPickerOpenFor === sec.id ? null : sec.id)}
                  >
                    <Plus size={12} weight="bold" />
                    Añadir
                  </button>

                  {#if addPickerOpenFor === sec.id}
                    {@const opts = availableForSection(sec.id)}
                    <div class="hk-add-picker" role="menu" data-add-picker>
                      {#if opts.length === 0}
                        <p class="hk-add-empty">
                          {#if editorialPlaylists.length === 0}
                            Aún no destacas ninguna playlist. Marca alguna como Editorial en la pestaña Biblioteca.
                          {:else}
                            Todas tus playlists destacadas ya están en esta fila.
                          {/if}
                        </p>
                      {:else}
                        <ul class="hk-add-list">
                          {#each opts as opt (opt.id)}
                            <li>
                              <button
                                type="button"
                                class="hk-add-option"
                                role="menuitem"
                                onclick={() => {
                                  addPlaylistToSection(sec.id, opt.id);
                                  addPickerOpenFor = null;
                                }}
                              >
                                <span class="hk-add-option-cover">
                                  <img src={getPlaylistCoverUrl(opt.id)} alt="" loading="lazy" />
                                </span>
                                <span class="hk-add-option-name">{opt.name}</span>
                              </button>
                            </li>
                          {/each}
                        </ul>
                      {/if}
                    </div>
                  {/if}
                </li>
              </ul>

              {#if (sec.playlists ?? []).length === 0}
                <p class="hk-row-empty">
                  Aún no hay playlists aquí. Pulsa <strong>+ Añadir</strong> para empezar.
                </p>
              {/if}
            </div>
          {:else}
            <p class="hk-info">{sectionTypeDesc(sec.type)}</p>
          {/if}
        </article>

        <div
          class="hk-drop-line"
          class:active={dropBetweenIdx === idx + 1}
          aria-hidden="true"
          ondragover={(e) => handleDragOverBetween(e, idx + 1)}
          ondragleave={() => handleDragLeaveBetween(idx + 1)}
          ondrop={(e) => handleDropBetween(e, idx + 1)}
        ></div>
      {/each}
    </div>

    <div class="hk-canvas-actions">
      {#if !sections.some((s) => s.type === 'fixed_smart')}
        <button type="button" class="hk-btn-soft" onclick={addSmart}>
          <Sparkle size={13} weight="bold" /> Smart Playlists
        </button>
      {/if}
      <button type="button" class="hk-btn-soft" onclick={addDynamic}>
        <Plus size={13} weight="bold" /> Añadir fila
      </button>
    </div>
  </section>

  <!-- Floating publish bar — solo visible cuando hay diff. -->
  <div class="hk-publish-bar" class:visible={hasChanges || isSaving || recentlySaved}>
    <p class="hk-publish-hint">
      {#if recentlySaved}
        <Check size={14} weight="bold" /> Listo, ya está publicado
      {:else if isSaving}
        Publicando…
      {:else if hasChanges}
        Tienes cambios sin publicar
      {:else}
        Todo al día
      {/if}
    </p>
    <button
      type="button"
      class="hk-btn-primary"
      class:pulsing={hasChanges && !isSaving && !recentlySaved}
      disabled={!hasChanges || isSaving}
      onclick={handlePublish}
    >
      {#if recentlySaved}
        <Check size={14} weight="bold" /> Publicado
      {:else if isSaving}
        Publicando…
      {:else}
        Publicar cambios
      {/if}
    </button>
  </div>
{/if}

<style>
  /* ============================================================================
     === Glass card primaria ===
     ============================================================================ */
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

  .hk-section-head {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hk-section-head h2 {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .hk-section-head p {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.55;
    max-width: 70ch;
  }

  /* ============================================================================
     === Rows / drop lines / row card ===
     ============================================================================ */
  .hk-rows {
    display: flex;
    flex-direction: column;
  }
  .hk-drop-line {
    height: 8px;
    border-radius: 999px;
    transition: background 200ms var(--hk-spring-soft);
  }
  .hk-drop-line.active {
    height: 10px;
    background: var(--accent);
    margin: 4px 0;
  }

  .hk-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--hk-tile-bg);
    border-radius: 14px;
    transition:
      opacity 200ms var(--hk-spring-soft),
      transform 200ms var(--hk-spring-soft);
  }
  .hk-row.dragging {
    opacity: 0.4;
    transform: scale(0.96);
  }
  .hk-row.type-fixed {
    background: color-mix(in srgb, var(--accent) 4%, var(--hk-tile-bg));
  }

  .hk-row-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hk-row-handle {
    width: 24px;
    height: 24px;
    background: transparent;
    border: 0;
    color: var(--text-tertiary);
    cursor: grab;
    display: grid;
    place-items: center;
    border-radius: 6px;
    transition:
      background 160ms var(--hk-spring-soft),
      color 160ms var(--hk-spring-soft);
  }
  .hk-row-handle:hover {
    background: var(--hk-handle-bg);
    color: var(--text-primary);
  }
  .hk-row-handle:active { cursor: grabbing; }
  .hk-row-handle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-row-reorder {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hk-row-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .hk-row-title-input {
    width: 100%;
    background: transparent;
    border: 0;
    border-bottom: 1.5px solid transparent;
    padding: 4px 2px;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    font-family: inherit;
    transition: border-color 200ms var(--hk-spring-soft);
    letter-spacing: -0.005em;
  }
  .hk-row-title-input::placeholder {
    color: var(--text-tertiary);
    font-weight: 500;
  }
  .hk-row-title-input:hover {
    border-bottom-color: var(--border-subtle);
  }
  .hk-row-title-input:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .hk-row-title-static {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.005em;
  }
  .hk-row-tag {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--bg-glass-thin);
    color: var(--text-tertiary);
    border-radius: 999px;
  }
  .hk-row-remove {
    width: 24px;
    height: 24px;
    background: transparent;
    border: 0;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    border-radius: 6px;
    transition:
      background 160ms var(--hk-spring-soft),
      color 160ms var(--hk-spring-soft);
  }
  .hk-row-remove:hover {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    color: var(--status-danger);
  }
  .hk-row-remove:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-icon-btn {
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    background: var(--hk-handle-bg);
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background 180ms var(--hk-spring-soft),
      color 180ms var(--hk-spring-soft),
      transform 180ms var(--hk-spring-soft);
  }
  .hk-icon-btn:hover:not(:disabled) {
    color: var(--text-primary);
    transform: scale(1.06);
  }
  .hk-icon-btn:disabled { opacity: 0.32; cursor: not-allowed; }
  .hk-icon-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-row-body { min-height: 36px; }
  .hk-info {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 10px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    line-height: 1.55;
  }
  .hk-row-empty {
    margin: 0;
    padding: 10px 14px;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    background: var(--bg-canvas);
    border-radius: 10px;
    text-align: center;
    line-height: 1.5;
  }
  .hk-row-empty strong { color: var(--text-secondary); font-weight: 600; }

  /* ============================================================================
     === Pills (playlists incluidas) ===
     ============================================================================ */
  .hk-row-pills {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hk-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 6px;
    background: var(--bg-surface);
    border-radius: 999px;
    max-width: 220px;
  }
  .hk-pill-cover {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-canvas);
  }
  .hk-pill-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hk-pill-name {
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hk-pill-remove {
    width: 18px;
    height: 18px;
    background: transparent;
    border: 0;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    border-radius: 999px;
    transition: background 160ms var(--hk-spring-soft), color 160ms var(--hk-spring-soft);
  }
  .hk-pill-remove:hover {
    background: color-mix(in srgb, var(--status-danger) 14%, transparent);
    color: var(--status-danger);
  }

  /* ============================================================================
     === Add picker ===
     ============================================================================ */
  .hk-add-anchor {
    position: relative;
    list-style: none;
  }
  .hk-add-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px 4px 8px;
    background: transparent;
    border: 1.5px dashed color-mix(in srgb, var(--border-subtle) 80%, transparent);
    border-radius: 999px;
    color: var(--text-tertiary);
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
    height: 30px;
    transition:
      border-color 160ms var(--hk-spring-soft),
      color 160ms var(--hk-spring-soft),
      background 160ms var(--hk-spring-soft);
  }
  .hk-add-btn:hover,
  .hk-add-btn[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .hk-add-btn:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .hk-add-picker {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 50;
    min-width: 240px;
    max-width: 320px;
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    background: var(--bg-surface-elevated);
    border-radius: 12px;
    box-shadow: 0 14px 32px -12px rgba(0, 0, 0, 0.35), 0 4px 10px -4px rgba(0, 0, 0, 0.2);
    animation: hk-picker-in 200ms var(--hk-spring);
  }
  @keyframes hk-picker-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .hk-add-empty {
    margin: 0;
    padding: 10px 12px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    line-height: 1.5;
    text-align: center;
  }
  .hk-add-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .hk-add-option {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    transition: background 140ms var(--hk-spring-soft);
  }
  .hk-add-option:hover { background: var(--bg-surface-hover); }
  .hk-add-option:focus-visible {
    outline: none;
    background: var(--bg-surface-hover);
    box-shadow: var(--focus-ring);
  }
  .hk-add-option-cover {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    overflow: hidden;
    background: var(--bg-canvas);
    flex-shrink: 0;
  }
  .hk-add-option-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .hk-add-option-name {
    font-size: var(--text-xs);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ============================================================================
     === Canvas actions + publish bar ===
     ============================================================================ */
  .hk-canvas-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: var(--space-2);
  }
  .hk-btn-soft {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-glass-thin);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 0;
    border-radius: 999px;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background 200ms var(--hk-spring-soft);
  }
  .hk-btn-soft:hover { background: var(--bg-glass); }
  .hk-btn-soft:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

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
      opacity 320ms var(--hk-spring),
      transform 360ms var(--hk-spring);
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
  .hk-btn-primary.pulsing {
    animation: hk-breathe 2.4s ease-in-out infinite;
  }
  @keyframes hk-breathe {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.78; }
  }

  /* ============================================================================
     === Loading ===
     ============================================================================ */
  .hk-loading {
    padding: 0;
  }
  .hk-sk {
    height: 480px;
    background: var(--bg-surface);
    border-radius: var(--hk-card-radius);
    animation: hk-pulse 1.6s ease-in-out infinite;
  }
  @keyframes hk-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  @media (max-width: 640px) {
    .hk-publish-bar {
      left: var(--space-4);
      right: var(--space-4);
      bottom: var(--space-4);
      justify-content: space-between;
    }
  }
</style>
