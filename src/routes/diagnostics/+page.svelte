<script lang="ts">
  /**
   * /diagnostics — viewer admin del histórico de TransitionRecord.
   *
   * Mirror del iOS Settings>Diagnostics:
   *   - Search bar + filter chips (Todas, Sin valorar, 1-3, 4-6, 7-10, 💎).
   *   - Lista agrupada por día → sesión, con sub-header de sesión (mean,
   *     count, duration, diamonds).
   *   - Tap en row → TransitionDetailPanel (rate + comment + mecanismos +
   *     telemetría).
   *
   * Carga `?limit=200` + `/sessions` en una sola tanda — backend recomienda
   * client-side hasta ~300 records (estamos en 45 hoy). Cuando crezca,
   * añadir paginación scroll-based.
   *
   * Charts diferidos a Fase 2 — esta página solo entrega listing + rate.
   */
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import { ArrowsClockwise, MagnifyingGlass, X, Star, Diamond } from 'phosphor-svelte';
  import { diagnosticsService } from '$services/DiagnosticsService.svelte';
  import type { TransitionRecord, SessionSummary } from '$types/diagnostics';
  import TransitionDetailPanel from '$components/diagnostics/TransitionDetailPanel.svelte';

  type Filter = 'all' | 'unrated' | 'low' | 'mid' | 'high' | 'diamonds';
  const FILTERS: { id: Filter; label: string; emoji?: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'unrated', label: 'Sin valorar' },
    { id: 'low', label: '1–3' },
    { id: 'mid', label: '4–6' },
    { id: 'high', label: '7–10' },
    { id: 'diamonds', label: 'Diamonds', emoji: '💎' }
  ];

  let records = $state<TransitionRecord[]>([]);
  let sessions = $state<SessionSummary[]>([]);
  let loading = $state(false);
  let lastError = $state<string | null>(null);

  let searchQuery = $state('');
  let debouncedSearch = $state('');
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let activeFilter = $state<Filter>('all');
  let selectedRecord = $state<TransitionRecord | null>(null);

  // ─── Fetch ─────────────────────────────────────────────────────────────
  async function refresh() {
    loading = true;
    lastError = null;
    try {
      const [list, sess] = await Promise.all([
        diagnosticsService.listTransitions({ limit: 200 }),
        diagnosticsService.listSessions(100)
      ]);
      records = list.transitions;
      sessions = sess;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Error desconocido';
      records = [];
      sessions = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void refresh();
  });

  // ─── Search debounce ───────────────────────────────────────────────────
  function onSearchInput(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    searchQuery = v;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      debouncedSearch = v.trim().toLowerCase();
    }, 220);
  }
  function clearSearch() {
    searchQuery = '';
    debouncedSearch = '';
  }

  // ─── Filter pipeline ──────────────────────────────────────────────────
  const filtered = $derived.by(() => {
    let out = records;
    // Por filter chip
    switch (activeFilter) {
      case 'unrated':
        out = out.filter((r) => r.userRating == null);
        break;
      case 'low':
        out = out.filter((r) => r.userRating != null && r.userRating <= 3);
        break;
      case 'mid':
        out = out.filter(
          (r) => r.userRating != null && r.userRating >= 4 && r.userRating <= 6
        );
        break;
      case 'high':
        out = out.filter(
          (r) => r.userRating != null && r.userRating >= 7 && r.userRating <= 10
        );
        break;
      case 'diamonds':
        out = out.filter((r) => r.userRating === 10);
        break;
    }
    // Por search (substring case-insensitive en from/to title + artist)
    if (debouncedSearch.length > 0) {
      const q = debouncedSearch;
      out = out.filter(
        (r) =>
          r.fromTitle.toLowerCase().includes(q) ||
          r.toTitle.toLowerCase().includes(q) ||
          (r.fromArtist?.toLowerCase().includes(q) ?? false) ||
          (r.toArtist?.toLowerCase().includes(q) ?? false)
      );
    }
    return out;
  });

  // KPIs derivados (solo de records crudos, no del filtered — son métricas
  // globales del histórico, no de la vista actual).
  const kpis = $derived.by(() => {
    const total = records.length;
    const rated = records.filter((r) => r.userRating != null);
    const ratedCount = rated.length;
    const meanRating =
      ratedCount > 0
        ? rated.reduce((a, r) => a + (r.userRating ?? 0), 0) / ratedCount
        : 0;
    const diamonds = records.filter((r) => r.userRating === 10).length;
    const ratedPct = total > 0 ? Math.round((ratedCount / total) * 100) : 0;
    return { total, meanRating, diamonds, ratedPct, unrated: total - ratedCount };
  });

  // Conteo "sin valorar" para badge del filter chip.
  const unratedCount = $derived(records.filter((r) => r.userRating == null).length);

  // ─── Agrupación día > sesión ──────────────────────────────────────────
  // sessions viene pre-agregado por backend; los records vienen sueltos
  // (orden DESC por date). Para mostrar día > sesión > rows:
  //   1) Agrupamos los filtered por sessionId.
  //   2) Para cada sessionId, buscamos su SessionSummary (para mean/count).
  //   3) Agrupamos sesiones por día (key = YYYY-MM-DD del startedAt).
  type RowGroup = {
    sessionId: string;
    summary: SessionSummary | null;
    rows: TransitionRecord[];
  };
  type DayGroup = {
    dayKey: string;
    label: string;
    sessionGroups: RowGroup[];
  };

  const dayGroups = $derived.by((): DayGroup[] => {
    const sessionMap = new Map<string, SessionSummary>();
    for (const s of sessions) sessionMap.set(s.sessionId, s);

    const bySession = new Map<string, TransitionRecord[]>();
    for (const r of filtered) {
      const arr = bySession.get(r.sessionId) ?? [];
      arr.push(r);
      bySession.set(r.sessionId, arr);
    }

    const sessionGroups: RowGroup[] = [];
    for (const [sid, rows] of bySession) {
      sessionGroups.push({
        sessionId: sid,
        summary: sessionMap.get(sid) ?? null,
        rows: rows.sort((a, b) => +new Date(b.date) - +new Date(a.date))
      });
    }
    sessionGroups.sort((a, b) => {
      const ad = a.summary?.startedAt ?? a.rows[0]?.date ?? '';
      const bd = b.summary?.startedAt ?? b.rows[0]?.date ?? '';
      return +new Date(bd) - +new Date(ad);
    });

    const days = new Map<string, DayGroup>();
    for (const sg of sessionGroups) {
      const refDate = sg.summary?.startedAt ?? sg.rows[0]?.date;
      if (!refDate) continue;
      const d = new Date(refDate);
      const dayKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      const existing = days.get(dayKey);
      if (existing) {
        existing.sessionGroups.push(sg);
      } else {
        days.set(dayKey, {
          dayKey,
          label: humanDayLabel(d),
          sessionGroups: [sg]
        });
      }
    }
    return Array.from(days.values());
  });

  function humanDayLabel(d: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayStart = new Date(d);
    dayStart.setHours(0, 0, 0, 0);
    const diffDays = Math.round(
      (today.getTime() - dayStart.getTime()) / 86400000
    );
    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';
    return d.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  function fmtTimeRange(start: string, end: string): string {
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit'
    })}–${e.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function fmtDuration(start: string, end: string): string {
    const ms = +new Date(end) - +new Date(start);
    const min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}min`;
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // ─── Mutations ────────────────────────────────────────────────────────
  async function commitRating(
    id: string,
    payload: { userRating?: number | null; userComment?: string | null }
  ) {
    try {
      const updated = await diagnosticsService.rateTransition(id, payload);
      // Replace in records y selectedRecord para reflejar cambios.
      records = records.map((r) => (r.id === id ? { ...r, ...updated } : r));
      if (selectedRecord?.id === id) {
        selectedRecord = { ...selectedRecord, ...updated };
      }
    } catch (err) {
      console.error('[diagnostics] rate failed', err);
    }
  }
  async function deleteComment(id: string) {
    try {
      await diagnosticsService.deleteComment(id);
      records = records.map((r) =>
        r.id === id ? { ...r, userComment: null } : r
      );
      if (selectedRecord?.id === id) {
        selectedRecord = { ...selectedRecord, userComment: null };
      }
    } catch (err) {
      console.error('[diagnostics] delete comment failed', err);
    }
  }

  // ─── Sheet transitions ────────────────────────────────────────────────
  function sheetIn(_n: HTMLElement) {
    return {
      duration: 320,
      easing: cubicOut,
      css: (t: number) => `
        transform: translateX(${(1 - t) * 100}%);
        opacity: ${t};
      `
    };
  }
  function sheetOut(_n: HTMLElement) {
    return {
      duration: 240,
      easing: cubicIn,
      css: (t: number) => `
        transform: translateX(${(1 - t) * 100}%);
        opacity: ${t};
      `
    };
  }
</script>

<div class="dg-shell">
  <!-- ─── Top bar ─────────────────────────────────────────────────────── -->
  <header class="dg-topbar">
    <div class="dg-titles">
      <h1 class="dg-title">Diagnostics</h1>
      <p class="dg-subtitle">
        Histórico de transiciones · valoraciones · mecanismos
      </p>
    </div>
    <button
      type="button"
      class="dg-refresh"
      aria-label="Refrescar"
      disabled={loading}
      onclick={() => void refresh()}
    >
      <span class="dg-refresh-icon" class:spin={loading}>
        <ArrowsClockwise size={16} weight="bold" />
      </span>
      <span>Refrescar</span>
    </button>
  </header>

  <!-- ─── KPI cards ────────────────────────────────────────────────────── -->
  <section class="dg-kpis" aria-label="Resumen">
    <article class="dg-kpi">
      <span class="dg-kpi-num">{kpis.meanRating === 0 ? '—' : kpis.meanRating.toFixed(2)}</span>
      <span class="dg-kpi-label">Mean rating</span>
    </article>
    <article class="dg-kpi">
      <span class="dg-kpi-num">{kpis.total}</span>
      <span class="dg-kpi-label">Transiciones</span>
    </article>
    <article class="dg-kpi">
      <span class="dg-kpi-num dg-kpi-diamond">
        <Diamond size={20} weight="fill" />
        {kpis.diamonds}
      </span>
      <span class="dg-kpi-label">Diamonds</span>
    </article>
    <article class="dg-kpi">
      <span class="dg-kpi-num">{kpis.ratedPct}%</span>
      <span class="dg-kpi-label">Valoradas · {kpis.unrated} sin valorar</span>
    </article>
  </section>

  <!-- ─── Search + filter chips ────────────────────────────────────────── -->
  <section class="dg-controls">
    <label class="dg-search">
      <MagnifyingGlass size={16} weight="regular" />
      <input
        type="search"
        placeholder="Buscar título o artista…"
        value={searchQuery}
        oninput={onSearchInput}
        autocomplete="off"
        spellcheck="false"
      />
      {#if searchQuery.length > 0}
        <button type="button" class="dg-search-clear" aria-label="Limpiar" onclick={clearSearch}>
          <X size={12} weight="bold" />
        </button>
      {/if}
    </label>

    <div class="dg-chips" role="tablist" aria-label="Filtros">
      {#each FILTERS as f (f.id)}
        <button
          type="button"
          class="dg-chip"
          class:active={activeFilter === f.id}
          role="tab"
          aria-selected={activeFilter === f.id}
          onclick={() => (activeFilter = f.id)}
        >
          {#if f.emoji}<span class="dg-chip-emoji">{f.emoji}</span>{/if}
          <span>{f.label}</span>
          {#if f.id === 'unrated' && unratedCount > 0}
            <span class="dg-chip-badge">{unratedCount}</span>
          {/if}
        </button>
      {/each}
    </div>
  </section>

  <!-- ─── Lista agrupada día > sesión ─────────────────────────────────── -->
  <section class="dg-list">
    {#if loading && records.length === 0}
      <div class="dg-empty">
        <p>Cargando histórico…</p>
      </div>
    {:else if lastError}
      <div class="dg-empty dg-empty-error">
        <p class="dg-empty-title">No se pudo cargar el histórico</p>
        <p class="dg-empty-sub">{lastError}</p>
      </div>
    {:else if dayGroups.length === 0}
      <div class="dg-empty">
        <p class="dg-empty-title">
          {debouncedSearch
            ? `Sin resultados para "${debouncedSearch}"`
            : activeFilter === 'unrated'
              ? 'Todas valoradas. Buen trabajo.'
              : 'Aún no hay transiciones aquí.'}
        </p>
      </div>
    {:else}
      {#each dayGroups as day (day.dayKey)}
        <div class="dg-day">
          <h2 class="dg-day-header">{day.label}</h2>
          {#each day.sessionGroups as sg (sg.sessionId)}
            <div class="dg-session">
              {#if sg.summary}
                <div class="dg-session-header">
                  <span class="dg-session-time">
                    {fmtTimeRange(sg.summary.startedAt, sg.summary.endedAt)}
                  </span>
                  <span class="dg-session-meta">
                    {fmtDuration(sg.summary.startedAt, sg.summary.endedAt)} ·
                    {sg.summary.transitionCount} trans
                    {#if sg.summary.meanRating != null}
                      · {sg.summary.meanRating.toFixed(2)} mean
                    {/if}
                    {#if sg.summary.diamonds != null && sg.summary.diamonds > 0}
                      · <Diamond size={11} weight="fill" /> {sg.summary.diamonds}
                    {/if}
                  </span>
                </div>
              {/if}
              <ul class="dg-rows">
                {#each sg.rows as r (r.id)}
                  <li>
                    <button
                      type="button"
                      class="dg-row"
                      class:selected={selectedRecord?.id === r.id}
                      onclick={() => (selectedRecord = r)}
                    >
                      <span class="dg-row-rating">
                        {#if r.userRating != null}
                          <Star size={14} weight="fill" />
                          <span>{r.userRating}</span>
                        {:else}
                          <span class="dg-row-rating-empty">—</span>
                        {/if}
                      </span>
                      <span class="dg-row-titles">
                        <span class="dg-row-title">{r.fromTitle}</span>
                        <span class="dg-row-arrow">→</span>
                        <span class="dg-row-title">{r.toTitle}</span>
                      </span>
                      <span class="dg-row-type">{r.type}</span>
                      <span class="dg-row-time">{fmtTime(r.date)}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </section>
</div>

<!-- Detail sheet derecho -->
{#if selectedRecord}
  <div in:fade={{ duration: 160 }} out:fade={{ duration: 120 }}>
    <button
      type="button"
      class="dg-scrim"
      aria-label="Cerrar detalle"
      onclick={() => (selectedRecord = null)}
    ></button>
  </div>
  <div in:sheetIn out:sheetOut>
    <TransitionDetailPanel
      record={selectedRecord}
      onClose={() => (selectedRecord = null)}
      onCommit={(payload) => {
        if (selectedRecord) void commitRating(selectedRecord.id, payload);
      }}
      onDeleteComment={() => {
        if (selectedRecord) void deleteComment(selectedRecord.id);
      }}
    />
  </div>
{/if}

<style>
  .dg-shell {
    max-width: 1200px;
    margin: 0 auto;
    padding: var(--space-6) var(--space-6) var(--space-12);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  /* ── Top bar */
  .dg-topbar {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .dg-titles { min-width: 0; }
  .dg-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    color: var(--text-primary);
  }
  .dg-subtitle {
    margin: 4px 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .dg-refresh {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .dg-refresh:hover {
    background: var(--bg-surface-hover);
  }
  .dg-refresh:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .dg-refresh-icon {
    display: grid;
    place-items: center;
  }
  .dg-refresh-icon.spin {
    animation: dg-spin 1s linear infinite;
  }
  @keyframes dg-spin {
    to { transform: rotate(360deg); }
  }

  /* ── KPIs */
  .dg-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }
  .dg-kpi {
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dg-kpi-num {
    font-family: var(--font-sans);
    font-size: var(--text-3xl);
    font-weight: 700;
    line-height: 1;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .dg-kpi-diamond {
    color: var(--accent);
  }
  .dg-kpi-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    font-weight: 600;
  }

  /* ── Controls */
  .dg-controls {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .dg-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 10px 14px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    color: var(--text-secondary);
    transition: border-color var(--duration-fast) var(--ease-ios-default);
  }
  .dg-search:focus-within {
    border-color: var(--accent);
  }
  .dg-search input {
    flex: 1;
    border: none;
    background: transparent;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-primary);
    outline: none;
    min-width: 0;
  }
  .dg-search-clear {
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: var(--bg-surface-active);
    color: var(--text-secondary);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .dg-search-clear:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }

  .dg-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .dg-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default);
  }
  .dg-chip:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .dg-chip.active {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: transparent;
  }
  .dg-chip-emoji {
    font-size: 12px;
    line-height: 1;
  }
  .dg-chip-badge {
    background: var(--status-danger);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    line-height: 1.4;
  }
  .dg-chip.active .dg-chip-badge {
    background: rgba(255, 255, 255, 0.25);
    color: #fff;
  }

  /* ── List */
  .dg-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .dg-day {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .dg-day-header {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    text-transform: capitalize;
    position: sticky;
    top: 0;
    background: linear-gradient(
      180deg,
      var(--bg-canvas) 0%,
      var(--bg-canvas) 70%,
      transparent 100%
    );
    padding: var(--space-2) 0;
    z-index: 1;
  }
  .dg-session {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dg-session-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    margin-bottom: 2px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .dg-session-time {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .dg-session-meta {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .dg-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-subtle);
    overflow: hidden;
  }
  .dg-row {
    width: 100%;
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto auto;
    align-items: center;
    column-gap: var(--space-3);
    padding: 12px var(--space-4);
    border: none;
    background: transparent;
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease-ios-default);
    font-family: inherit;
  }
  .dg-row:hover {
    background: var(--row-hover);
  }
  .dg-row.selected {
    background: var(--row-playing);
  }
  .dg-row:focus-visible {
    outline: none;
    background: var(--row-hover);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .dg-row-rating {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .dg-row-rating-empty {
    color: var(--text-quaternary);
  }
  .dg-row-titles {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }
  .dg-row-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }
  .dg-row-arrow {
    color: var(--text-quaternary);
    flex-shrink: 0;
  }
  .dg-row-type {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-secondary);
    background: var(--bg-surface-elevated);
    padding: 3px 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .dg-row-time {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    min-width: 42px;
    text-align: right;
  }

  /* ── Empty / error */
  .dg-empty {
    padding: var(--space-12) var(--space-6);
    display: grid;
    place-items: center;
    text-align: center;
    color: var(--text-secondary);
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-lg);
  }
  .dg-empty-title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }
  .dg-empty-sub {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
  .dg-empty-error .dg-empty-title {
    color: var(--status-danger-text);
  }

  /* ── Scrim debajo del sheet */
  .dg-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    z-index: calc(var(--z-sticky) - 1);
  }

  @media (max-width: 640px) {
    .dg-row {
      grid-template-columns: 50px minmax(0, 1fr) auto;
    }
    .dg-row-time { display: none; }
    .dg-row-title { max-width: 140px; }
    .dg-title { font-size: var(--text-2xl); }
  }
</style>
