<script lang="ts">
  /**
   * CountryRankingTable — ranking de países por intentos de acceso. Es el
   * equivalente accesible del mapa (toda la info en texto) y lo que da lectura
   * cuando el mapa tiene un solo país. data-bar de fondo + mini stacked-bar
   * ok/fail/blocked. El grupo '??' (LAN/histórico) va a un chip aparte, no como
   * fila de país.
   */
  import { GlobeHemisphereWest } from 'phosphor-svelte';
  import { countryName } from '$utils/session-format';
  import InfoPopover from './InfoPopover.svelte';

  export type RankRow = {
    country: string;
    ok: number;
    fail: number;
    blocked: number;
    total: number;
    value: number;
    tone: 'good' | 'watch' | 'alert' | 'calm';
  };

  type Props = {
    rows: RankRow[];
    maxValue: number;
    noCountry: { ok: number; fail: number; blocked: number; total: number; value: number } | null;
    hoveredCountry: string | null;
  };
  let { rows, maxValue, noCountry, hoveredCountry = $bindable() }: Props = $props();

  function pct(part: number, whole: number): number {
    return whole > 0 ? (part / whole) * 100 : 0;
  }
</script>

<div class="crt">
  <table class="crt-table">
    <caption class="sr-only">Ranking de países por intentos de acceso</caption>
    <thead>
      <tr>
        <th scope="col">País</th>
        <th scope="col" class="crt-num">Intentos</th>
        <th scope="col">ok / fallidos / bloq.</th>
      </tr>
    </thead>
    <tbody>
      {#if rows.length === 0}
        <tr><td colspan="3" class="crt-empty">Sin accesos registrados con país todavía.</td></tr>
      {:else}
        {#each rows as r (r.country)}
          {@const seg = r.ok + r.fail + r.blocked}
          <tr
            class:hl={hoveredCountry === r.country}
            onmouseenter={() => (hoveredCountry = r.country)}
            onmouseleave={() => { if (hoveredCountry === r.country) hoveredCountry = null; }}
          >
            <td class="crt-country">
              <span class="crt-dot" data-tone={r.tone} aria-hidden="true"></span>
              <span class="crt-name">{countryName(r.country) ?? r.country}</span>
            </td>
            <td class="crt-num">
              <span class="crt-bar" style={`--w:${pct(r.value, maxValue)}%`} aria-hidden="true"></span>
              <span class="crt-val">{r.value}</span>
            </td>
            <td class="crt-mix">
              <span class="crt-stack" aria-hidden="true">
                {#if r.ok > 0}<span class="crt-seg" data-tone="good" style={`flex:${r.ok}`}></span>{/if}
                {#if r.fail > 0}<span class="crt-seg" data-tone="watch" style={`flex:${r.fail}`}></span>{/if}
                {#if r.blocked > 0}<span class="crt-seg" data-tone="alert" style={`flex:${r.blocked}`}></span>{/if}
                {#if seg === 0}<span class="crt-seg crt-seg-empty"></span>{/if}
              </span>
              <span class="crt-mix-nums">{r.ok}/{r.fail}/{r.blocked}</span>
            </td>
          </tr>
        {/each}
      {/if}
    </tbody>
  </table>

  {#if noCountry && noCountry.value > 0}
    <div class="crt-nocountry">
      <GlobeHemisphereWest size={15} weight="regular" />
      <span class="crt-nc-label">Sin país</span>
      <span class="crt-nc-val">{noCountry.value}</span>
      <span class="crt-nc-note">LAN e histórico</span>
      <InfoPopover>
        Accesos sin país detectado: red local (sin pasar por Cloudflare) e
        histórico anterior a esta función. Se cuentan en los totales pero no se
        sitúan en el mapa.
      </InfoPopover>
    </div>
  {/if}
</div>

<style>
  .crt { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0);
    white-space: nowrap; border: 0;
  }

  .crt-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
  .crt-table th {
    padding: 6px 8px;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-subtle);
  }
  .crt-table th.crt-num { text-align: right; }
  .crt-table td {
    padding: 7px 8px;
    border-bottom: 1px solid var(--border-subtle);
    vertical-align: middle;
  }
  .crt-table tr:last-child td { border-bottom: 0; }
  .crt-table tbody tr { transition: background var(--duration-fast) var(--ease-ios-default); }
  .crt-table tbody tr.hl { background: var(--bg-surface-hover); }
  .crt-empty {
    padding: var(--space-5) var(--space-2) !important;
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .crt-country { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .crt-dot { width: 8px; height: 8px; border-radius: var(--radius-full); flex-shrink: 0; }
  .crt-dot[data-tone='good'] { background: var(--status-success); }
  .crt-dot[data-tone='calm'] { background: var(--accent); }
  .crt-dot[data-tone='watch'] { background: var(--status-warning); }
  .crt-dot[data-tone='alert'] { background: var(--status-danger); }
  .crt-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    font-weight: 600;
  }

  .crt-num { position: relative; text-align: right; white-space: nowrap; }
  .crt-bar {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    height: 20px;
    width: var(--w);
    max-width: calc(100% - 8px);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-radius: var(--radius-sm);
    pointer-events: none;
  }
  .crt-val { position: relative; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-primary); }

  .crt-mix { width: 44%; }
  .crt-stack {
    display: flex;
    gap: 1px;
    height: 6px;
    width: 100%;
    max-width: 130px;
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-bottom: 3px;
  }
  .crt-seg { display: block; height: 100%; min-width: 2px; }
  .crt-seg[data-tone='good'] { background: var(--status-success); }
  .crt-seg[data-tone='watch'] { background: var(--status-warning); }
  .crt-seg[data-tone='alert'] { background: var(--status-danger); }
  .crt-seg-empty { flex: 1; background: var(--bg-surface-active); min-width: 0; }
  .crt-mix-nums {
    font-size: 11px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  /* Chip "Sin país" — contado, subordinado, gris neutro (nunca semáforo). */
  .crt-nocountry {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-surface-elevated);
    border-radius: var(--radius-md);
    color: var(--text-tertiary);
  }
  .crt-nc-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); }
  .crt-nc-val { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
  .crt-nc-note { font-size: var(--text-xs); margin-left: auto; }
</style>
