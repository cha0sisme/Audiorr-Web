<script lang="ts">
  /**
   * WeeklyStatsCard — mini card "Tu semana" al pie del Home. Port del
   * weeklyStatsCard de HomeView.swift: fila de stat pills (canciones /
   * horas / género favorito) alimentada por /api/stats/user-stats?period=week.
   * La sección entera solo se monta cuando hay plays (>0) — decisión iOS.
   */
  import { MusicNote, Clock, Guitar } from 'phosphor-svelte';
  import type { UserStats } from '$types/backend';

  type Props = { stats: UserStats };
  let { stats }: Props = $props();

  const totalMinutes = $derived(stats.total_minutes ?? 0);
  const hours = $derived((totalMinutes / 60).toFixed(1));
  const topGenre = $derived(stats.top_genres[0]?.genre);
</script>

<section class="week" aria-label="Tu semana">
  <h2 class="title">Tu semana</h2>
  <div class="pills">
    <!-- Colores decorativos fijos por pill (pink/orange/purple), mirror de
         los tints de iOS. OKLCH inline: no hay token semántico para acentos
         decorativos multi-color (mismo criterio que los colores por
         transitionType del viewer de diagnostics). -->
    <div class="pill" style:--pill-tint="oklch(0.68 0.21 356)">
      <span class="pill-icon"><MusicNote size={17} weight="fill" /></span>
      <span class="pill-value">{stats.total_plays}</span>
      <span class="pill-label">canciones</span>
    </div>
    {#if totalMinutes > 0}
      <div class="pill" style:--pill-tint="oklch(0.72 0.17 55)">
        <span class="pill-icon"><Clock size={17} weight="fill" /></span>
        <span class="pill-value">{hours}</span>
        <span class="pill-label">horas</span>
      </div>
    {/if}
    {#if topGenre}
      <div class="pill" style:--pill-tint="oklch(0.62 0.2 300)">
        <span class="pill-icon"><Guitar size={17} weight="fill" /></span>
        <span class="pill-value pill-value-text">{topGenre}</span>
        <span class="pill-label">Género favorito</span>
      </div>
    {/if}
  </div>
</section>

<style>
  .week {
    display: grid;
    gap: var(--space-3);
    padding: 0 var(--space-6);
  }
  .title {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
    line-height: 1.2;
  }

  .pills {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
    gap: var(--space-3);
    max-width: 560px;
  }
  .pill {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: var(--space-4) var(--space-3);
    background: var(--bg-surface);
    border-radius: var(--radius-lg);
    min-width: 0;
  }
  .pill-icon {
    color: var(--pill-tint);
    display: inline-flex;
  }
  .pill-value {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    max-width: 100%;
  }
  /* Valores textuales (género): truncar en vez de desbordar. */
  .pill-value-text {
    font-size: var(--text-base);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pill-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  @media (max-width: 640px) {
    .week {
      padding: 0 var(--space-4);
    }
  }
</style>
