<script lang="ts">
  /**
   * /housekeeping/diagnostics — viewer admin del histórico de TransitionRecord.
   *
   * Mirror del iOS Settings>Diagnostics + extras web:
   *   - KPI strip con cards estilo HKInfoCard (pattern + tone) + delta vs
   *     período anterior + mini-sparkline trend (estilo Binance + dashboard).
   *   - Search bar + filter chips (Todas, Sin valorar, 1-3, 4-6, 7-10, 💎).
   *   - Lista agrupada por día → sesión.
   *   - Tap en row → TransitionDetailPanel (rate + comment + mecanismos +
   *     telemetría).
   *   - LIVE updates vía socket.io: cuando el backend emite
   *     `diagnostic_transition_*` la página reacciona en tiempo real (sin
   *     polling). Las nuevas rows entran con animación premium tipo SmartMix.
   *
   * Carga inicial `?limit=200` + `/sessions`. Después solo se mueven cosas
   * por bus reactivo — sin re-fetch por defecto.
   */
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
  import {
    ArrowsClockwise, MagnifyingGlass, X, Star, Diamond,
    ChartBar, CheckCircle
  } from 'phosphor-svelte';
  import { diagnosticsService } from '$services/DiagnosticsService.svelte';
  import { connectService } from '$services/ConnectService.svelte';
  import { diagnosticsBus } from '$stores/diagnostics-bus.svelte';
  import type { TransitionRecord, SessionSummary } from '$types/diagnostics';
  import TransitionDetailPanel from '$components/diagnostics/TransitionDetailPanel.svelte';
  import DiagnosticsKPI from '$components/diagnostics/DiagnosticsKPI.svelte';

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

  // ─── Live updates vía diagnostics-bus (socket.io) ──────────────────────
  // Tres effects aislados, uno por evento. Cada uno usa un guard de tick
  // para no procesar el mismo payload dos veces (race / re-mount).
  let lastSeenCreatedTick = 0;
  let lastSeenUpdatedTick = 0;
  let lastSeenDeletedTick = 0;
  /** Set de ids que entraron via socket post-firstFetch — usados para
      aplicar `.is-new` con animación premium en el render. La clase se
      retira tras 700ms para que la animación corra una vez. */
  let newRowIds = $state(new Set<string>());

  function markRowAsNew(id: string) {
    newRowIds.add(id);
    newRowIds = new Set(newRowIds);
    setTimeout(() => {
      newRowIds.delete(id);
      newRowIds = new Set(newRowIds);
    }, 700);
  }

  $effect(() => {
    const created = diagnosticsBus.lastCreated;
    const tick = diagnosticsBus.tick;
    if (!created || tick === lastSeenCreatedTick) return;
    lastSeenCreatedTick = tick;
    // Skip si ya está en records (defensa contra echo).
    if (records.some((r) => r.id === created.id)) return;
    records = [created, ...records];
    markRowAsNew(created.id);
  });

  $effect(() => {
    const updated = diagnosticsBus.lastUpdated;
    const tick = diagnosticsBus.tick;
    if (!updated || tick === lastSeenUpdatedTick) return;
    lastSeenUpdatedTick = tick;
    records = records.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
    if (selectedRecord?.id === updated.id) {
      selectedRecord = { ...selectedRecord, ...updated };
    }
  });

  $effect(() => {
    const deleted = diagnosticsBus.lastDeleted;
    const tick = diagnosticsBus.tick;
    if (!deleted || tick === lastSeenDeletedTick) return;
    lastSeenDeletedTick = tick;
    records = records.map((r) =>
      r.id === deleted.id ? { ...r, userComment: null, deletedAt: deleted.deletedAt } : r
    );
    if (selectedRecord?.id === deleted.id) {
      selectedRecord = { ...selectedRecord, userComment: null };
    }
  });

  /** Indicador "live" — el dot verde junto al subtitle. Verde si el socket
      está conectado, gris si no. Sin polling: el connectService ya expone
      `hubConnected` reactivo. */
  const liveConnected = $derived(connectService.hubConnected);

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

  /** Comparativos vs período anterior (estilo Binance). Partimos los records
      por la mediana cronológica: primer mitad = "anterior", segunda = "actual".
      Si hay <4 records totales, no hay comparación significativa → null en
      todos los deltas y el card muestra "—". */
  const deltas = $derived.by(() => {
    const sorted = [...records].sort(
      (a, b) => +new Date(a.date) - +new Date(b.date)
    );
    if (sorted.length < 4) {
      return { meanRating: null, total: null, diamonds: null, ratedPct: null };
    }
    const mid = Math.floor(sorted.length / 2);
    const prev = sorted.slice(0, mid);
    const curr = sorted.slice(mid);

    function statsOf(slice: TransitionRecord[]) {
      const rated = slice.filter((r) => r.userRating != null);
      const mean =
        rated.length > 0
          ? rated.reduce((a, r) => a + (r.userRating ?? 0), 0) / rated.length
          : 0;
      const diamonds = slice.filter((r) => r.userRating === 10).length;
      const ratedPct =
        slice.length > 0 ? (rated.length / slice.length) * 100 : 0;
      return { mean, total: slice.length, diamonds, ratedPct };
    }

    const p = statsOf(prev);
    const c = statsOf(curr);
    return {
      meanRating: c.mean - p.mean,
      total: c.total - p.total,
      diamonds: c.diamonds - p.diamonds,
      ratedPct: c.ratedPct - p.ratedPct
    };
  });

  /** Series para sparklines: agrupamos records por día (last 14 days max) y
      calculamos las métricas por día. Cada array es [día0, día1, ...,
      díaN-1] con los días vacíos rellenados con el último valor known
      (carry forward) para que el chart no se rompa. */
  const sparklines = $derived.by(() => {
    if (records.length < 2) {
      return { meanRating: [], total: [], diamonds: [], ratedPct: [] };
    }
    const sorted = [...records].sort(
      (a, b) => +new Date(a.date) - +new Date(b.date)
    );
    // Buckets por día (clave YYYY-MM-DD).
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const buckets = new Map<string, TransitionRecord[]>();
    for (const r of sorted) {
      const k = dayKey(new Date(r.date));
      const arr = buckets.get(k) ?? [];
      arr.push(r);
      buckets.set(k, arr);
    }
    const days = Array.from(buckets.keys()).sort();
    const slice = days.slice(-14); // last 14 days

    const meanRating: number[] = [];
    const totalCum: number[] = []; // cumulative count
    const diamondsCum: number[] = [];
    const ratedPct: number[] = [];

    let runningCount = 0;
    let runningDiamonds = 0;
    for (const k of slice) {
      const day = buckets.get(k) ?? [];
      runningCount += day.length;
      runningDiamonds += day.filter((r) => r.userRating === 10).length;
      const rated = day.filter((r) => r.userRating != null);
      const meanDay =
        rated.length > 0
          ? rated.reduce((a, r) => a + (r.userRating ?? 0), 0) / rated.length
          : meanRating[meanRating.length - 1] ?? 0;
      const pct = day.length > 0 ? (rated.length / day.length) * 100 : 0;
      meanRating.push(Math.round(meanDay * 100) / 100);
      totalCum.push(runningCount);
      diamondsCum.push(runningDiamonds);
      ratedPct.push(Math.round(pct));
    }

    return {
      meanRating,
      total: totalCum,
      diamonds: diamondsCum,
      ratedPct
    };
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
  <!-- Mini toolbar: el contexto "Diagnostics" lo da el tab del housekeeping
       layout. Subtítulo + indicador live (verde si socket conectado, sin
       polling) + refresh discreto como fallback. -->
  <header class="dg-toolbar">
    <div class="dg-toolbar-left">
      <p class="dg-subtitle">
        Histórico de transiciones · valoraciones · mecanismos
      </p>
      <span
        class="dg-live"
        class:on={liveConnected}
        title={liveConnected ? 'Live — actualizándose en tiempo real' : 'Sin socket — refresca a mano'}
      >
        <span class="dg-live-dot" aria-hidden="true"></span>
        <span class="dg-live-label">{liveConnected ? 'Live' : 'Offline'}</span>
      </span>
    </div>
    <button
      type="button"
      class="dg-refresh"
      aria-label="Refrescar manualmente"
      disabled={loading}
      onclick={() => void refresh()}
      title="Refrescar manualmente (no es necesario con socket conectado)"
    >
      <span class="dg-refresh-icon" class:spin={loading}>
        <ArrowsClockwise size={14} weight="bold" />
      </span>
    </button>
  </header>

  <!-- ─── KPI cards (estilo HKInfoCard: pattern + tone + delta + sparkline) -->
  <section class="dg-kpis" aria-label="Resumen">
    <DiagnosticsKPI
      Icon={Star}
      kicker="MEAN"
      label="Mean rating"
      value={kpis.meanRating === 0 ? '—' : kpis.meanRating.toFixed(2)}
      delta={deltas.meanRating}
      deltaSuffix="vs anterior"
      sparkline={sparklines.meanRating}
      pattern="waves"
      tone="accent"
    />
    <DiagnosticsKPI
      Icon={ChartBar}
      kicker="TOTAL"
      label="Transiciones"
      value={String(kpis.total)}
      delta={deltas.total}
      deltaDecimals={0}
      deltaSuffix="vs anterior"
      sparkline={sparklines.total}
      pattern="lines"
      tone="mint"
    />
    <DiagnosticsKPI
      Icon={Diamond}
      kicker="GEMS"
      label="Diamonds"
      value={String(kpis.diamonds)}
      delta={deltas.diamonds}
      deltaDecimals={0}
      deltaSuffix="vs anterior"
      sparkline={sparklines.diamonds}
      pattern="mesh"
      tone="amber"
    />
    <DiagnosticsKPI
      Icon={CheckCircle}
      kicker="COBERTURA"
      label={`Valoradas · ${kpis.unrated} sin valorar`}
      value={`${kpis.ratedPct}%`}
      delta={deltas.ratedPct}
      deltaUnit="%"
      deltaDecimals={1}
      deltaSuffix="vs anterior"
      sparkline={sparklines.ratedPct}
      pattern="waves"
      tone="pink"
    />
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
                      class:is-new={newRowIds.has(r.id)}
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
  /* Sin padding ni max-width propios — vive dentro de `.hk-content` del
     layout housekeeping, que ya provee el container y el padding. */
  .dg-shell {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    min-width: 0;
  }

  /* ── Toolbar: subtitle + refresh action */
  .dg-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .dg-toolbar-left {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    min-width: 0;
  }
  .dg-subtitle {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  /* Live indicator: dot + label. Verde + pulse cuando socket conectado. */
  .dg-live {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--bg-surface-elevated);
    color: var(--text-tertiary);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    transition:
      color var(--duration-normal) var(--ease-ios-default),
      background var(--duration-normal) var(--ease-ios-default);
  }
  .dg-live.on {
    color: var(--status-success-text);
    background: var(--status-success-bg);
  }
  .dg-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-quaternary);
    transition: background var(--duration-normal) var(--ease-ios-default);
  }
  .dg-live.on .dg-live-dot {
    background: var(--status-success);
    box-shadow: 0 0 0 0 currentColor;
    animation: dg-live-pulse 2s ease-out infinite;
  }
  @keyframes dg-live-pulse {
    0%   { box-shadow: 0 0 0 0 var(--status-success); opacity: 1; }
    70%  { box-shadow: 0 0 0 6px transparent; opacity: 0.65; }
    100% { box-shadow: 0 0 0 0 transparent; opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dg-live.on .dg-live-dot { animation: none; }
  }

  /* Refresh discreto — solo iconito, color tertiary. Casi invisible cuando
     live está conectado (no necesita atención). */
  .dg-refresh {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-subtle);
    border-radius: 50%;
    background: var(--bg-surface);
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
    flex-shrink: 0;
  }
  .dg-refresh:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .dg-refresh:disabled {
    opacity: 0.5;
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

  /* ── KPIs grid (cards via DiagnosticsKPI component) */
  .dg-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
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
  /* Animación premium estilo SmartMix cuando llega un record nuevo via socket.
     blur-replace + scale + slide + tinte accent que se desvanece. La clase
     `.is-new` se añade desde JS (markRowAsNew) y se retira a los 700ms para
     que la animación corra una sola vez. */
  .dg-row.is-new {
    animation: dg-row-arrive 700ms var(--ease-out-expo);
  }
  @keyframes dg-row-arrive {
    0% {
      opacity: 0;
      transform: translateY(-14px) scale(0.97);
      filter: blur(6px);
      background: var(--accent-muted);
      box-shadow: inset 3px 0 0 var(--accent);
    }
    50% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
      background: var(--accent-muted);
      box-shadow: inset 3px 0 0 var(--accent);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
      background: transparent;
      box-shadow: inset 0 0 0 var(--accent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dg-row.is-new { animation: none; }
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
  }
</style>
