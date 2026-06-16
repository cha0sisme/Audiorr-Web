<script lang="ts">
  /**
   * CountryAccessPanel — "Origen de accesos": mapa de símbolos + ranking de
   * países, acoplados. Zona B (AdminPanel claro), bloque hermano de "Salud y
   * actividad". El dato viene de cf-ipcountry (auth-by-country); el histórico
   * sin país y la LAN se agrupan en '??' (chip "Sin país", fuera del mapa).
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { getAuthByCountry } from '$services/dashboard';
  import { credentials } from '$stores/credentials.svelte';
  import type { CountryAccess } from '$types/dashboard';
  import AdminPanel from './AdminPanel.svelte';
  import RangeSelect from './RangeSelect.svelte';
  import WorldSymbolMap, { type MapMetric, type MapSymbol } from './WorldSymbolMap.svelte';
  import CountryRankingTable, { type RankRow } from './CountryRankingTable.svelte';

  let days = $state(7);
  let metric = $state<MapMetric>('suspicious');
  let hoveredCountry = $state<string | null>(null);

  const RANGE = [
    { value: 7, label: '7 días' },
    { value: 14, label: '14 días' },
    { value: 30, label: '30 días' }
  ];

  const q = createQuery(() => ({
    queryKey: ['hk-auth-by-country', days],
    queryFn: () => getAuthByCountry(days),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));

  const raw = $derived<CountryAccess[]>(q.data?.countries ?? []);

  function metricValue(c: CountryAccess): number {
    if (metric === 'blocked') return c.blocked;
    if (metric === 'all') return c.total;
    return c.fail + c.blocked; // suspicious
  }
  function toneOf(c: CountryAccess): RankRow['tone'] {
    if (c.blocked > 0) return 'alert';
    if (c.fail > 0) return 'watch';
    return metric === 'all' ? 'calm' : 'good';
  }

  const ranked = $derived<RankRow[]>(
    raw
      .filter((c) => c.country !== '??')
      .map((c) => ({ ...c, value: metricValue(c), tone: toneOf(c) }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value)
  );
  const vMax = $derived(ranked[0]?.value ?? 0);
  const mapSymbols = $derived<MapSymbol[]>(
    ranked.map((r) => ({ country: r.country, value: r.value, tone: r.tone }))
  );

  const noCountry = $derived.by(() => {
    const c = raw.find((x) => x.country === '??');
    if (!c) return null;
    return { ok: c.ok, fail: c.fail, blocked: c.blocked, total: c.total, value: metricValue(c) };
  });
</script>

<AdminPanel
  title="Origen de accesos"
  error={q.isError ? 'No se pudieron cargar los accesos por país.' : null}
  onRetry={() => q.refetch()}
>
  {#snippet info()}
    De qué país proceden los intentos de acceso, según la IP (Cloudflare). El
    acceso legítimo es casi siempre España; el mapa resalta el origen de los
    intentos fallidos y bloqueados. El histórico anterior a esta función no
    tiene país (aparece como «Sin país»).
  {/snippet}
  {#snippet action()}
    <RangeSelect value={days} options={RANGE} onChange={(v) => (days = v)} />
  {/snippet}

  <div class="cap-grid">
    <WorldSymbolMap
      symbols={mapSymbols}
      {vMax}
      {metric}
      onMetric={(m) => (metric = m)}
      bind:hoveredCountry
      loading={q.isPending}
    />

    <div class="cap-side">
      {#if q.isPending}
        <div class="cap-skel">
          {#each Array(6) as _, i (i)}<div class="cap-skel-row"></div>{/each}
        </div>
      {:else}
        <CountryRankingTable rows={ranked} maxValue={vMax} {noCountry} bind:hoveredCountry />
      {/if}
    </div>
  </div>
</AdminPanel>

<style>
  .cap-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr);
    gap: var(--space-5);
    align-items: start;
  }
  .cap-side { min-width: 0; }

  .cap-skel { display: flex; flex-direction: column; gap: 8px; padding-top: var(--space-5); }
  .cap-skel-row {
    height: 34px;
    border-radius: var(--radius-sm);
    background: var(--skeleton-bg);
    animation: cap-pulse 1.6s ease-in-out infinite;
  }
  @keyframes cap-pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cap-skel-row { animation: none; }
  }

  /* Apilado en estrecho: mapa arriba, ranking debajo. */
  @media (max-width: 860px) {
    .cap-grid { grid-template-columns: 1fr; }
  }
</style>
