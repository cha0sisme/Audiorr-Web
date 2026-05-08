<script lang="ts">
  /**
   * Profile — Wrapped-lite del usuario (mirrors UserProfileSheet de iOS).
   *
   * Layout:
   *   - Hero (mismo patrón que ArtistDetail/PlaylistDetail): avatar grande
   *     redondo + kicker "Perfil" + h1 username + meta-line opcional.
   *     Background derivado del color determinístico del username (hue+chroma
   *     fijo). El color es persistente: mismo username = mismo color siempre.
   *   - Period selector (semana/mes).
   *   - 4 stat cards (plays, género, BPM, energía).
   *   - Top 5 canciones + Top 5 artistas.
   *
   * Datos: /api/stats/user-stats. Devuelve shape completo con totales 0 y
   * arrays vacíos cuando no hay scrobbles.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { MusicNote, ChartBar, User } from 'phosphor-svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import SegmentedControl from '$components/shared/SegmentedControl.svelte';
  import * as stats from '$services/stats';
  import * as user from '$services/user';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { credentials } from '$stores/credentials.svelte';
  import { userAvatarColor, userAvatarInitial } from '$utils/avatar-color';
  import { heroBackgroundLayered, type CoverPalette } from '$utils/palette';
  import type { StatsPeriod } from '$types/backend';

  const username = $derived(credentials.current?.username ?? '');

  let period = $state<StatsPeriod>('week');
  const PERIOD_TABS = [
    { id: 'week' as const, label: 'Semana' },
    { id: 'month' as const, label: 'Mes' }
  ];

  const statsQ = createQuery(() => ({
    queryKey: ['userStats', username, period],
    queryFn: () => stats.getUserStats(username, period),
    enabled: credentials.isConfigured && username.length > 0,
    staleTime: 5 * 60 * 1000
  }));

  /** Preferencias del backend — avatar URL personalizado + metadata.
      Falla suave si el user aún no tiene un registro. */
  const prefsQ = createQuery(() => ({
    queryKey: ['userPreferences', username],
    queryFn: () => user.getUserPreferences(username),
    enabled: credentials.isConfigured && username.length > 0,
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const avatarUrl = $derived(prefsQ.data?.avatarUrl ?? undefined);
  const data = $derived(statsQ.data);

  const hasNoData = $derived(!statsQ.isPending && (!data || data.total_plays === 0));

  // === Color del usuario (determinístico) → palette del hero ===
  // Mismo username = mismo color, persistente sin storage. La fórmula
  // matchea iOS exactamente (`avatar-color.ts` ↔ `SettingsView.swift:7-17`).
  const avatarColor = $derived(userAvatarColor(username || '?'));
  const initial = $derived(userAvatarInitial(username || '?'));

  const palette = $derived<CoverPalette>({
    hue: avatarColor.hue,
    chroma: 0.14
  });
  const heroBg = $derived(heroBackgroundLayered(palette));

  // === Formatos ===
  const fmtNumber = (n: number) => n.toLocaleString('es-ES');
  const fmtBPM = (n: number | null | undefined) =>
    n != null ? `${Math.round(n)} BPM` : '—';
  const fmtEnergy = (n: number | null | undefined) =>
    n != null ? `${Math.round(n * 100)}%` : '—';

  const topGenre = $derived(data?.top_genres?.[0]?.genre ?? null);

  const memberSince = $derived.by(() => {
    const created = prefsQ.data?.createdAt;
    if (!created) return null;
    return new Date(created).toLocaleDateString('es-ES', {
      month: 'long',
      year: 'numeric'
    });
  });
</script>

<svelte:head>
  <title>{username || 'Perfil'} · Audiorr</title>
</svelte:head>

<div class="profile">
  <!-- Hero — mismo patrón que ArtistDetail/PlaylistDetail. Background del
       avatar color determinístico (mismo username = mismo color). -->
  <header class="hero" style:background={heroBg}>
    <div class="hero-avatar" style:background={avatarColor.css}>
      {#if avatarUrl}
        <CoverImage src={avatarUrl} alt="" shape="circle" lazy={false} priority="high" />
      {:else}
        <span class="hero-initial" aria-hidden="true">{initial}</span>
      {/if}
    </div>

    <div class="hero-meta">
      <p class="kicker">Perfil</p>
      <h1 class="title">{username || 'Invitado'}</h1>
      {#if memberSince}
        <p class="meta-line">Miembro desde {memberSince}</p>
      {/if}
    </div>
  </header>

  <div class="content">
    <div class="period-row">
      <SegmentedControl
        items={PERIOD_TABS}
        value={period}
        onChange={(v) => (period = v)}
        ariaLabel="Período de estadísticas"
      />
      <p class="period-caption">
        {period === 'week' ? 'Últimos 7 días' : 'Último mes'}
      </p>
    </div>

    {#if statsQ.isPending}
      <div class="stats-grid">
        {#each Array(4) as _}<div class="stat-card sk"></div>{/each}
      </div>
      <div class="lists">
        <div class="list-card sk-list"></div>
        <div class="list-card sk-list"></div>
      </div>
    {:else if statsQ.isError}
      <div class="empty">
        <MusicNote size={48} weight="regular" />
        <p>No se pudieron cargar las estadísticas.</p>
        <p class="empty-detail">{statsQ.error?.message ?? ''}</p>
      </div>
    {:else if hasNoData}
      <div class="empty">
        <MusicNote size={48} weight="regular" />
        <p>Sin datos en este período. Reproduce algo y vuelve aquí.</p>
      </div>
    {:else if data}
      <div class="stats-grid">
        <div class="stat-card">
          <p class="stat-label">Reproducciones</p>
          <p class="stat-value">{fmtNumber(data.total_plays)}</p>
        </div>
        <div class="stat-card">
          <p class="stat-label">Género top</p>
          <p class="stat-value truncate">{topGenre ?? '—'}</p>
        </div>
        <div class="stat-card">
          <p class="stat-label">BPM medio</p>
          <p class="stat-value">{fmtBPM(data.weighted_average_BPM)}</p>
        </div>
        <div class="stat-card">
          <p class="stat-label">Energía media</p>
          <p class="stat-value">{fmtEnergy(data.weighted_average_Energy)}</p>
        </div>
      </div>

      <div class="lists">
        <section class="list-card">
          <header class="list-head">
            <ChartBar size={18} weight="regular" />
            <h2>Top canciones</h2>
          </header>
          {#if data.top_songs.length === 0}
            <p class="list-empty">Sin canciones aún.</p>
          {:else}
            <ol class="rank-list">
              {#each data.top_songs.slice(0, 5) as song, i (song.id ?? `${song.title}-${i}`)}
                <li class="rank-row">
                  <span class="rank">{i + 1}</span>
                  <div class="thumb">
                    <CoverImage
                      src={song.cover_art ? getCoverArtUrl(song.cover_art, 120) : undefined}
                      alt=""
                    >
                      {#snippet fallback()}
                        <MusicNote size="100%" weight="regular" />
                      {/snippet}
                    </CoverImage>
                  </div>
                  <div class="rank-info">
                    {#if song.album_id}
                      <a class="rank-title" href={`/album/${song.album_id}`}>
                        {song.title}
                      </a>
                    {:else}
                      <span class="rank-title">{song.title}</span>
                    {/if}
                    <span class="rank-sub">{song.artist}</span>
                  </div>
                  <div class="plays">
                    <span class="plays-count">{fmtNumber(song.plays)}</span>
                    <span class="plays-label">plays</span>
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </section>

        <section class="list-card">
          <header class="list-head">
            <User size={18} weight="regular" />
            <h2>Top artistas</h2>
          </header>
          {#if data.top_artists.length === 0}
            <p class="list-empty">Sin artistas aún.</p>
          {:else}
            <ol class="rank-list">
              {#each data.top_artists.slice(0, 5) as artist, i (`${artist.artist}-${i}`)}
                {@const artistColor = userAvatarColor(artist.artist)}
                <li class="rank-row">
                  <span class="rank">{i + 1}</span>
                  <div class="thumb thumb-round" style:background={artistColor.css}>
                    <span class="thumb-initial">{userAvatarInitial(artist.artist)}</span>
                  </div>
                  <div class="rank-info">
                    <a class="rank-title" href={`/search?q=${encodeURIComponent(artist.artist)}`}>
                      {artist.artist}
                    </a>
                  </div>
                  <div class="plays">
                    <span class="plays-count">{fmtNumber(artist.plays)}</span>
                    <span class="plays-label">plays</span>
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      </div>
    {/if}

    <div class="bottom-spacer" aria-hidden="true"></div>
  </div>
</div>

<style>
  .profile {
    min-height: 100%;
  }

  /* === Hero — replica del de ArtistDetail/PlaylistDetail === */
  .hero {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: var(--space-6);
    padding: var(--space-12) var(--space-6) var(--space-8);
    color: var(--hero-text-primary);
    transition: background var(--duration-normal) var(--ease-ios-default);
  }

  .hero-avatar {
    position: relative;
    width: 200px;
    height: 200px;
    border-radius: var(--radius-full);
    overflow: hidden;
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.45);
    flex-shrink: 0;
    display: grid;
    place-items: center;
    color: #fff;
  }
  .hero-initial {
    font-size: 80px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: var(--tracking-display-lg);
    user-select: none;
  }

  .hero-meta {
    min-width: 0;
    display: grid;
    gap: var(--space-2);
    color: var(--hero-text-primary);
  }
  .kicker {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--hero-text-secondary);
  }
  .title {
    margin: 0;
    font-size: var(--text-4xl);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: var(--tracking-display-lg);
    color: var(--hero-text-primary);
  }
  .meta-line {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--hero-text-secondary);
  }

  /* === Contenido bajo el hero === */
  .content {
    padding: var(--space-2) var(--space-6) var(--space-12);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .period-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
  }
  .period-caption {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
    gap: var(--space-4);
  }
  .stat-card {
    padding: var(--space-5);
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    display: grid;
    gap: var(--space-2);
    min-height: 110px;
  }
  .stat-label {
    margin: 0;
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-secondary);
  }
  .stat-value {
    margin: 0;
    font-size: var(--text-3xl);
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .stat-value.truncate {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sk,
  .sk-list {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .sk { min-height: 110px; }
  .sk-list { min-height: 320px; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .lists {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
    gap: var(--space-5);
  }
  .list-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .list-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-primary);
  }
  .list-head h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 700;
    letter-spacing: var(--tracking-body);
    line-height: 1.2;
  }
  .list-empty {
    margin: 0;
    padding: var(--space-4);
    text-align: center;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
  }

  .rank-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .rank-row {
    display: grid;
    grid-template-columns: 28px 48px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    transition: background var(--duration-fast) var(--ease-ios-default);
  }
  .rank-row:hover {
    background: var(--row-hover);
  }
  .rank {
    text-align: center;
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .thumb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--bg-surface-elevated);
    position: relative;
    flex-shrink: 0;
  }
  .thumb-round {
    border-radius: var(--radius-full);
    display: grid;
    place-items: center;
    color: #fff;
  }
  .thumb-initial {
    font-size: 18px;
    font-weight: 700;
    line-height: 1;
    user-select: none;
  }

  .rank-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .rank-title {
    color: var(--text-primary);
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
  }
  .rank-title:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .rank-sub {
    margin-top: 2px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plays {
    text-align: right;
    display: grid;
    line-height: 1.2;
  }
  .plays-count {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .plays-label {
    font-size: 10px;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-12) var(--space-4);
    background: var(--bg-surface);
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-lg);
    color: var(--text-tertiary);
    text-align: center;
  }
  .empty :global(svg) {
    opacity: 0.3;
  }
  .empty-detail {
    margin: var(--space-1) 0 0;
    font-size: var(--text-xs);
    color: var(--text-disabled);
    font-family: var(--font-mono);
  }

  .bottom-spacer { height: 80px; }

  @media (max-width: 768px) {
    .hero {
      grid-template-columns: 1fr;
      text-align: center;
      padding: var(--space-8) var(--space-4) var(--space-6);
      justify-items: center;
    }
    .hero-avatar {
      width: 160px;
      height: 160px;
    }
    .hero-initial {
      font-size: 64px;
    }
    .hero-meta { justify-items: center; }
    .title { font-size: var(--text-3xl); }
    .content { padding: var(--space-2) var(--space-4) var(--space-12); }
  }
</style>
