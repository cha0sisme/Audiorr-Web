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
    ChartBar, CheckCircle, ChatTeardrop
  } from 'phosphor-svelte';
  import { diagnosticsService } from '$services/DiagnosticsService.svelte';
  import { connectService } from '$services/ConnectService.svelte';
  import { diagnosticsBus } from '$stores/diagnostics-bus.svelte';
  import { transitionTypeTone } from '$utils/transition-type-tone';
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
  /** Sets de ids con efecto temporal: cada uno corresponde a una animación
      premium distinta. Recreamos el Set con `new Set(...)` tras mutate
      para forzar la reactividad de Svelte (los Sets no son trackeados
      profundamente).

      - `newRowIds` → row entera (.is-new): blur + scale + slide + tinte.
      - `justRatedIds` → estrella del rating (.just-rated): pop spring +
        halo radial accent.
      - `justCommentedIds` → badge de comentario (.just-flashed): pop
        spring + halo radial. */
  let newRowIds = $state(new Set<string>());
  let justRatedIds = $state(new Set<string>());
  let justCommentedIds = $state(new Set<string>());

  function flash(setRef: Set<string>, id: string, ms: number, update: (s: Set<string>) => void) {
    setRef.add(id);
    update(new Set(setRef));
    setTimeout(() => {
      setRef.delete(id);
      update(new Set(setRef));
    }, ms);
  }
  function markRowAsNew(id: string) {
    flash(newRowIds, id, 700, (s) => (newRowIds = s));
  }
  function flashRated(id: string) {
    flash(justRatedIds, id, 1000, (s) => (justRatedIds = s));
  }
  function flashCommented(id: string) {
    flash(justCommentedIds, id, 1000, (s) => (justCommentedIds = s));
  }

  /** Detecta transiciones de estado entre el record anterior y el nuevo
      para disparar las animaciones correspondientes. Usado tanto desde el
      $effect del bus como desde commitRating local. */
  function detectAndFlash(prev: TransitionRecord | undefined, next: TransitionRecord) {
    if (!prev) return;
    if (prev.userRating == null && next.userRating != null) {
      flashRated(next.id);
    }
    const prevHasComment = (prev.userComment ?? '').length > 0;
    const nextHasComment = (next.userComment ?? '').length > 0;
    if (!prevHasComment && nextHasComment) {
      flashCommented(next.id);
    }
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
    const prev = records.find((r) => r.id === updated.id);
    records = records.map((r) => (r.id === updated.id ? { ...r, ...updated } : r));
    if (selectedRecord?.id === updated.id) {
      selectedRecord = { ...selectedRecord, ...updated };
    }
    // Si el record ya estaba en local (echo de nuestra propia mutación),
    // prev refleja el estado post-update y detectAndFlash no dispara nada.
    // Si viene de fuera (otra sesión iOS/web), prev es el estado anterior
    // y dispara las animaciones correspondientes.
    detectAndFlash(prev, updated);
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

  /** Stats agregadas por algorithmVersion, ordenadas cronológicamente
      (versión más antigua primero, más reciente última). Permite comparar
      el algoritmo nuevo vs el anterior — es la dimensión que de verdad
      cambia el rendimiento del DJ engine.

      Caveat: cada versión puede haberse probado con un set distinto de
      música (Hip-Hop vs Indie, etc). El director sabe que el delta entre
      versiones puede llevar confounders; igual es la mejor pista. */
  type VersionStat = {
    version: string;
    mean: number;
    diamonds: number;
    count: number;
    ratedCount: number;
    firstDate: number;
  };
  const versionStats = $derived.by((): VersionStat[] => {
    const byVersion = new Map<string, { records: TransitionRecord[]; firstDate: number }>();
    for (const r of records) {
      const v = r.algorithmVersion;
      const ts = +new Date(r.date);
      const existing = byVersion.get(v);
      if (existing) {
        existing.records.push(r);
        existing.firstDate = Math.min(existing.firstDate, ts);
      } else {
        byVersion.set(v, { records: [r], firstDate: ts });
      }
    }
    const out: VersionStat[] = [];
    for (const [v, info] of byVersion) {
      const rated = info.records.filter((r) => r.userRating != null);
      const mean =
        rated.length > 0
          ? rated.reduce((a, r) => a + (r.userRating ?? 0), 0) / rated.length
          : 0;
      out.push({
        version: v,
        mean,
        diamonds: info.records.filter((r) => r.userRating === 10).length,
        count: info.records.length,
        ratedCount: rated.length,
        firstDate: info.firstDate
      });
    }
    out.sort((a, b) => a.firstDate - b.firstDate);
    return out;
  });

  /** Sesiones ordenadas DESC (más recientes primero). El backend ya las
      pre-agrega con mean, count, diamonds. */
  const sessionsByDate = $derived.by(() =>
    [...sessions].sort((a, b) => +new Date(b.endedAt) - +new Date(a.endedAt))
  );

  /** Comparativos por la dimensión correcta para cada KPI:

        Mean rating + Diamonds: dependen del algoritmo → delta entre la
        versión más reciente y la inmediatamente anterior. Útil para
        verificar regresiones / mejoras al desplegar un build nuevo.

        Total + % Rated: actividad / comportamiento del director → delta
        entre la última sesión y la penúltima. Útil para "¿hoy he ido más
        que ayer?".

      Null cuando no hay datos suficientes para comparar (1 versión sola,
      1 sesión sola). */
  const deltas = $derived.by(() => {
    const v = versionStats;
    const s = sessionsByDate;

    let meanRating: number | null = null;
    let diamonds: number | null = null;
    if (v.length >= 2) {
      const last = v[v.length - 1]!;
      const prev = v[v.length - 2]!;
      meanRating = last.mean - prev.mean;
      diamonds = last.diamonds - prev.diamonds;
    }

    let total: number | null = null;
    let ratedPct: number | null = null;
    if (s.length >= 2) {
      const last = s[0]!;
      const prev = s[1]!;
      total = last.transitionCount - prev.transitionCount;
      const lastPct = (last.rated / Math.max(1, last.transitionCount)) * 100;
      const prevPct = (prev.rated / Math.max(1, prev.transitionCount)) * 100;
      ratedPct = lastPct - prevPct;
    }

    return { meanRating, total, diamonds, ratedPct };
  });

  /** Suffix dinámico para cada delta — explicita qué se compara. El
      componente DiagnosticsKPI lo renderiza en el badge del delta. */
  const deltaSuffix = $derived.by(() => {
    const v = versionStats;
    const prevVersion =
      v.length >= 2 ? v[v.length - 2]!.version : null;
    return {
      meanRating: prevVersion ? `vs ${prevVersion}` : 'sin comparativo',
      diamonds: prevVersion ? `vs ${prevVersion}` : 'sin comparativo',
      total: 'vs sesión anterior',
      ratedPct: 'vs sesión anterior'
    };
  });

  /** Series para sparklines orientadas a la dimensión de cada KPI:

        Mean / Diamonds: 1 punto por versión cronológica. Detecta el
        salto al desplegar un build nuevo (visualmente: subida o bajada
        en el último punto). Si solo hay 1 versión, no hay sparkline.

        Total / % Rated: 1 punto por sesión (últimas 14 reverse). Trend
        de actividad. */
  const sparklines = $derived.by(() => {
    const v = versionStats;
    const s = sessionsByDate;
    const lastSessions = s.slice(0, 14).reverse(); // chronological ASC

    return {
      meanRating: v.length >= 2 ? v.map((x) => Math.round(x.mean * 100) / 100) : [],
      diamonds: v.length >= 2 ? v.map((x) => x.diamonds) : [],
      total: lastSessions.length >= 2 ? lastSessions.map((x) => x.transitionCount) : [],
      ratedPct:
        lastSessions.length >= 2
          ? lastSessions.map((x) =>
              Math.round((x.rated / Math.max(1, x.transitionCount)) * 100)
            )
          : []
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
    const prev = records.find((r) => r.id === id);
    try {
      const updated = await diagnosticsService.rateTransition(id, payload);
      // Replace in records y selectedRecord para reflejar cambios.
      records = records.map((r) => (r.id === id ? { ...r, ...updated } : r));
      if (selectedRecord?.id === id) {
        selectedRecord = { ...selectedRecord, ...updated };
      }
      // Animaciones premium: si esta es la primera valoración o el primer
      // comentario, dispara los efectos. detectAndFlash es idempotente —
      // si el echo socket llega después con prev ya actualizado, no re-anima.
      detectAndFlash(prev, updated);
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

  <!-- ─── KPI cards (superficie sólida sobria; delta + sparkline, sin glass) -->
  <section class="dg-kpis" aria-label="Resumen">
    <DiagnosticsKPI
      Icon={Star}
      kicker="MEAN"
      label="Mean rating"
      value={kpis.meanRating === 0 ? '—' : kpis.meanRating.toFixed(2)}
      delta={deltas.meanRating}
      deltaSuffix={deltaSuffix.meanRating}
      sparkline={sparklines.meanRating}
      pattern="waves"
      variant="solid"
    />
    <DiagnosticsKPI
      Icon={ChartBar}
      kicker="TOTAL"
      label="Transiciones"
      value={String(kpis.total)}
      delta={deltas.total}
      deltaDecimals={0}
      deltaSuffix={deltaSuffix.total}
      sparkline={sparklines.total}
      pattern="lines"
      variant="solid"
    />
    <DiagnosticsKPI
      Icon={Diamond}
      kicker="GEMS"
      label="Diamonds"
      value={String(kpis.diamonds)}
      delta={deltas.diamonds}
      deltaDecimals={0}
      deltaSuffix={deltaSuffix.diamonds}
      sparkline={sparklines.diamonds}
      pattern="mesh"
      variant="solid"
    />
    <DiagnosticsKPI
      Icon={CheckCircle}
      kicker="COBERTURA"
      label={`Valoradas · ${kpis.unrated} sin valorar`}
      value={`${kpis.ratedPct}%`}
      delta={deltas.ratedPct}
      deltaUnit="%"
      deltaDecimals={1}
      deltaSuffix={deltaSuffix.ratedPct}
      sparkline={sparklines.ratedPct}
      pattern="waves"
      variant="solid"
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
                      <span
                        class="dg-row-rating"
                        class:just-rated={justRatedIds.has(r.id)}
                      >
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
                        {#if (r.userComment ?? '').length > 0}
                          <span
                            class="dg-comment-badge"
                            class:just-flashed={justCommentedIds.has(r.id)}
                            title="Esta transición tiene comentario"
                            aria-label="Tiene comentario"
                          >
                            <ChatTeardrop size={11} weight="fill" />
                          </span>
                        {/if}
                      </span>
                      <span
                        class="dg-row-type"
                        style:--type-color={transitionTypeTone(r.type).color}
                      >{r.type}</span>
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
    border: 0;
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
  /* Search alineado al patrón canónico del Sidebar (.search): grid 3 cols,
     padding tighter, radius-md (no full pill — no respeta el lenguaje del
     resto del shell), bg elevated → hover/focus a hover bg + border strong
     + focus-ring del design system. Coherencia total con el search global. */
  .dg-search {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-surface-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    min-height: 36px;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      border-color var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .dg-search:hover,
  .dg-search:focus-within {
    background: var(--bg-surface-hover);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .dg-search:focus-within {
    box-shadow: var(--focus-ring);
  }
  .dg-search input {
    width: 100%;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--text-sm);
    line-height: 1.2;
    letter-spacing: var(--tracking-body);
    padding: 0;
    -webkit-appearance: none;
    appearance: none;
  }
  .dg-search input::-webkit-search-decoration,
  .dg-search input::-webkit-search-cancel-button {
    -webkit-appearance: none;
    appearance: none;
  }
  .dg-search input::placeholder {
    color: var(--text-secondary);
  }
  .dg-search-clear {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .dg-search-clear:hover {
    background: var(--bg-surface-active);
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
    border: 0;
    border-radius: var(--radius-full);
    background: var(--bg-surface);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  .dg-chip:hover {
    background: var(--bg-surface-hover);
    color: var(--text-primary);
  }
  .dg-chip.active {
    background: var(--accent);
    color: var(--text-on-accent);
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
    position: relative;
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
  /* ─── Animación premium "just rated" ──────────────────────────────────
     Cuando el director valora una transición por primera vez (sea desde
     web o sincronizado vía socket desde iOS), la estrella hace un pop
     spring + halo radial accent que se desvanece. iOS Apple-Music style.
     Halo se monta como ::after absolute alrededor de la rating box.
     prefers-reduced-motion neutraliza ambos. */
  .dg-row-rating.just-rated > :global(svg) {
    animation: dg-rate-pop 700ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transform-origin: center;
  }
  .dg-row-rating.just-rated::after {
    content: '';
    position: absolute;
    inset: -10px;
    border-radius: var(--radius-full);
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--accent) 55%, transparent) 0%,
      transparent 65%
    );
    pointer-events: none;
    animation: dg-rate-halo 800ms var(--ease-out-expo);
  }
  @keyframes dg-rate-pop {
    0%   { transform: scale(0.55) rotate(-12deg); }
    45%  { transform: scale(1.45) rotate(8deg); }
    75%  { transform: scale(0.96) rotate(-2deg); }
    100% { transform: scale(1) rotate(0); }
  }
  @keyframes dg-rate-halo {
    0%   { transform: scale(0.5); opacity: 0.95; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .dg-row-rating.just-rated > :global(svg) { animation: none; }
    .dg-row-rating.just-rated::after { animation: none; opacity: 0; }
  }

  /* ─── Badge "tiene comentario" + animación "just commented" ──────────
     Bocadillo Phosphor ChatTeardrop pequeño junto al título. Color accent
     muted permanente para indicar "hay comentario aquí". Cuando el comment
     se acaba de añadir, anima con el mismo lenguaje pop+halo que el rating
     (continuidad visual). */
  .dg-comment-badge {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    flex-shrink: 0;
  }
  .dg-comment-badge.just-flashed {
    animation: dg-rate-pop 700ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transform-origin: center;
  }
  .dg-comment-badge.just-flashed::after {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: var(--radius-full);
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--accent) 55%, transparent) 0%,
      transparent 65%
    );
    pointer-events: none;
    animation: dg-rate-halo 800ms var(--ease-out-expo);
  }
  @media (prefers-reduced-motion: reduce) {
    .dg-comment-badge.just-flashed { animation: none; }
    .dg-comment-badge.just-flashed::after { animation: none; opacity: 0; }
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
  /* Badge del transition type tinted con la paleta de transition-type-tone
     (mirror iOS line 937-952). El color base llega via custom prop
     `--type-color` desde el inline style del span. background + border
     usan color-mix sobre ese color para que combine con el fondo glass
     del row sin chillar — bg al 16%, border al 32%, color del label
     full saturation (legible). */
  .dg-row-type {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--type-color, var(--text-secondary));
    background: color-mix(in srgb, var(--type-color, var(--bg-surface-elevated)) 22%, transparent);
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
    background: var(--bg-surface);
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

  /* ── Scrim debajo del sheet (token semántico) */
  .dg-scrim {
    position: fixed;
    inset: 0;
    background: var(--scrim);
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
