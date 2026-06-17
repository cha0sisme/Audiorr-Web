<script lang="ts">
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { DotsThree, Queue, Plus, ListPlus, Shuffle, Pause } from 'phosphor-svelte';
  import HeroPlayButton from '$components/shared/HeroPlayButton.svelte';
  import HeroCircleButton from '$components/shared/HeroCircleButton.svelte';
  import SmartMixButton from '$components/shared/SmartMixButton.svelte';
  import { smartMixManager } from '$services/SmartMixManager.svelte';
  import ContextMenu, { type ContextMenuItem } from '$components/shared/ContextMenu.svelte';
  import SongList from '$components/shared/SongList.svelte';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import * as nav from '$services/NavidromeService';
  import { songToListItem } from '$utils/navidrome-mappers';
  import { playlistAuthorDetail } from '$utils/playlist-section-mappers';
  import { getPlaylistCoverUrl } from '$services/dailyMixes';
  import { refreshPlaylistCoverHashes } from '$services/playlist-cover-refresh';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import { theme } from '$stores/theme.svelte';
  import {
    extractPalette,
    playButtonBg,
    heroGradientTop,
    heroGradientMid,
    HERO_PLACEHOLDER_PALETTE,
    type CoverPalette
  } from '$utils/palette';

  const playlistId = $derived(page.params.id ?? '');

  // Trigger un refresh global de hashes al entrar (mirror
  // PlaylistDetailView.swift:91). Cubre el caso "el backend regeneró este
  // cover desde la última visita" — `refreshPlaylistCoverHashes` es
  // idempotente y tiene TTL/inflight, así que múltiples montajes seguidos
  // no martillean el backend. Se hace fire-and-forget; no bloquea el render.
  const queryClient = useQueryClient();
  $effect(() => {
    if (!credentials.isConfigured) return;
    void refreshPlaylistCoverHashes(queryClient, credentials.current?.username);
  });

  const playlistQ = createQuery(() => ({
    queryKey: ['playlist', playlistId],
    queryFn: () => nav.getPlaylist(playlistId),
    enabled: credentials.isConfigured && !!playlistId
  }));

  const playlist = $derived(playlistQ.data);
  const songs = $derived(playlist?.entry ?? []);

  // Cover SIEMPRE del backend personalizado (`/api/playlists/<id>/cover.png`).
  // Nunca usamos el coverArt original de Navidrome — el backend re-renderiza
  // con estilo Audiorr y aplica TTL/contentHash. La misma URL se usó en la
  // card del listado (cards y hero comparten URL → cache HTTP del browser
  // los reutiliza), por eso la View Transition card→detail no parpadea.
  const coverUrl = $derived(playlistId ? getPlaylistCoverUrl(playlistId) : undefined);

  const paletteQ = createQuery(() => ({
    queryKey: ['palette', coverUrl ?? ''],
    queryFn: () => extractPalette(coverUrl!),
    enabled: !!coverUrl,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false
  }));

  // Fallback NEUTRO (no hasheado): si Vibrant aún no ha resuelto o ha fallado
  // (CORS, network, swatch nulo), usamos HERO_PLACEHOLDER_PALETTE (chroma ≈ 0)
  // → hero gris/neutro acorde con la UI. Cuando llegue la paleta real, el
  // chroma se anima del placeholder al accent extraído.
  const palette = $derived<CoverPalette>(paletteQ.data ?? HERO_PLACEHOLDER_PALETTE);

  const isDark = $derived(theme.current === 'dark');

  const heroBg = $derived(
    `linear-gradient(180deg, ${heroGradientTop(palette)} 0%, ${heroGradientMid(palette)} 60%, var(--bg-canvas) 100%)`
  );

  const playBg = $derived(playButtonBg(palette, isDark));

  // Playlist tracks vienen con artist propio (varios artistas en la lista) y
  // con cover de su álbum — en playlists no tiene sentido pintar un número de
  // pista (la "posición N en la playlist" no es una propiedad musical), así
  // que el slot izquierdo se llena con el cover del álbum de cada canción
  // (paridad iOS PlaylistDetailView).
  const tracks = $derived(songs.map((s, i) => songToListItem(s, i, true, true)));

  const totalDuration = $derived(tracks.reduce((sum, t) => sum + t.durationSec, 0));

  const totalDurationFormatted = $derived.by(() => {
    const totalMin = Math.floor(totalDuration / 60);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h} h ${m} min`;
  });

  const isCurrentPlaylist = $derived(player.isPlayingFrom('playlist', playlistId));

  // Estados reactivos de los botones del hero — ver explicación en
  // album/[id]/+page.svelte (mismo patrón).
  const isPlayingNormalHere = $derived(
    isCurrentPlaylist &&
      !player.isSmartMixContext(playlistId) &&
      !queueManager.shuffleMode &&
      player.isPlaying
  );
  const isPlayingShuffleHere = $derived(
    isCurrentPlaylist &&
      !player.isSmartMixContext(playlistId) &&
      queueManager.shuffleMode &&
      player.isPlaying
  );

  // Pasamos `contextUri` formal a queueManager.play para que se persista en
  // lastPlayback — sin esto, tras un restore se pierde el context y las
  // cards/heroes no marcan el EQ icon ni los botones reaccionan.

  function loadTrack(_track: ReturnType<typeof songToListItem>, index: number) {
    if (!playlist) return;
    // Click en row específica = play normal (paridad Apple Music).
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    player.context = { type: 'playlist', id: playlist.id };
    queueManager.play(songs, index, { contextUri: `playlist:${playlist.id}` });
  }

  function playAll() {
    if (!playlist || tracks.length === 0) return;
    if (isPlayingNormalHere) {
      player.toggle();
      return;
    }
    player.context = { type: 'playlist', id: playlist.id };
    if (queueManager.shuffleMode) queueManager.toggleShuffle();
    queueManager.play(songs, 0, { contextUri: `playlist:${playlist.id}` });
  }

  function shuffleAll() {
    if (!playlist || tracks.length === 0) return;
    if (isPlayingShuffleHere) {
      player.toggle();
      return;
    }
    player.context = { type: 'playlist', id: playlist.id };
    if (!queueManager.shuffleMode) queueManager.toggleShuffle();
    queueManager.play(songs, 0, { contextUri: `playlist:${playlist.id}` });
  }

  // ─── SmartMix hand-off (mirror iOS PlaylistDetailView lines 420-475) ───
  const smartMixReady = $derived(
    smartMixManager.playlistId === playlistId && smartMixManager.status === 'ready'
  );
  const isSmartMixContext = $derived(player.isSmartMixContext(playlistId));
  const collapsePlay = $derived(smartMixReady || isSmartMixContext);

  // Context menu (3-dots).
  let menuOpen = $state(false);
  const menuItems = $derived<ContextMenuItem[]>([
    {
      label: 'Añadir a continuación',
      icon: Plus,
      action: () => {
        if (songs.length > 0) queueManager.insertNextMany(songs);
      }
    },
    {
      label: 'Añadir a Playlist',
      icon: ListPlus,
      action: () => {
        // TODO: abrir picker de playlists (aún en la misma playlist?)
      }
    }
  ]);
</script>

<PageTitle segments={[playlist?.name ?? 'Playlist']} />

<div class="playlist-detail">
  <header class="hero" style:--hero-bg={heroBg}>
    <div
      class="hero-cover"
      style:view-transition-name={playlistId ? `playlist-${playlistId}` : undefined}
    >
      <CoverImage src={coverUrl} alt="" lazy={false} priority="high">
        {#snippet fallback()}
          <Queue size="100%" weight="regular" />
        {/snippet}
      </CoverImage>
    </div>

    <div class="hero-meta">
      {#if playlistQ.isPending}
        <div class="hero-skeleton">
          <div class="sk sk-1"></div>
          <div class="sk sk-2"></div>
        </div>
      {:else if playlistQ.isError}
        <p class="error">No se pudo cargar la playlist.</p>
      {:else if playlist}
        <p class="kicker">Playlist</p>
        <h1 class="title">{playlist.name}</h1>
        {@const authorLine = playlistAuthorDetail(playlist)}
        {#if authorLine}
          <p class="owner">{authorLine}</p>
        {/if}
        <p class="meta-line">
          {tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'} · {totalDurationFormatted}
        </p>

        <div class="actions">
          <HeroPlayButton
            bgColor={playBg}
            onclick={playAll}
            disabled={tracks.length === 0}
            collapsed={collapsePlay}
            isActive={isPlayingNormalHere}
          />
          <HeroCircleButton
            bgColor={playBg}
            onclick={shuffleAll}
            disabled={tracks.length === 0}
            aria-label={isPlayingShuffleHere ? 'Pausar' : 'Shuffle'}
          >
            {#if isPlayingShuffleHere}
              <Pause size={15} weight="fill" />
            {:else}
              <Shuffle size={15} weight="bold" />
            {/if}
          </HeroCircleButton>
          <SmartMixButton
            bgColor={playBg}
            {playlistId}
            {songs}
            disabled={tracks.length === 0}
          />
          <div class="menu-anchor">
            <HeroCircleButton
              bgColor={playBg}
              onclick={() => (menuOpen = !menuOpen)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Más opciones"
            >
              <DotsThree size={20} weight="bold" />
            </HeroCircleButton>
            <ContextMenu
              open={menuOpen}
              items={menuItems}
              onClose={() => (menuOpen = false)}
            />
          </div>
        </div>
      {/if}
    </div>
  </header>

  <section class="tracks">
    {#if playlistQ.isPending}
      <div class="tracks-skeleton">
        {#each Array(8) as _}
          <div class="row-sk"></div>
        {/each}
      </div>
    {:else if tracks.length > 0}
      <SongList
        {tracks}
        contextType="playlist"
        contextId={playlistId}
        showCover
        onPlay={loadTrack}
      />
    {:else if playlist}
      <p class="empty">Esta playlist está vacía.</p>
    {/if}
  </section>
</div>

<style>
  .playlist-detail { min-height: 100%; }

  .hero {
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: end;
    column-gap: var(--space-6);
    padding: var(--space-12) var(--space-6) var(--space-8);
    color: var(--hero-text-primary);
  }
  /* Backdrop con mask ease-out — el hero se desvanece sobre `--bg-canvas`
     en su tercio inferior sin banding (la mask interpola alpha pura). */
  .hero::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--hero-bg);
    -webkit-mask-image: var(--hero-backdrop-mask);
    mask-image: var(--hero-backdrop-mask);
    z-index: -1;
    transition: background var(--duration-normal) var(--ease-ios-default);
  }

  .hero-cover {
    /* CoverImage rellena el slot. Radius + sombra acá; shimmer/imagen
       los maneja CoverImage internamente. */
    position: relative;
    width: 232px;
    height: 232px;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-2xl);
    flex-shrink: 0;
  }
  .hero-meta {
    min-width: 0;
    display: grid;
    gap: var(--space-2);
    color: var(--hero-text-primary);
  }
  .kicker {
    font-size: var(--text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--hero-text-secondary);
  }
  .title {
    font-size: var(--text-4xl);
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: var(--tracking-display-lg);
    margin: 0;
  }
  .owner {
    font-size: var(--text-base);
    font-weight: 600;
    margin: 0;
    color: var(--hero-text-primary);
  }
  .meta-line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--hero-text-tertiary);
  }

  .actions {
    margin-top: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .menu-anchor {
    position: relative;
    display: inline-flex;
  }

  .hero-skeleton { display: grid; gap: var(--space-3); }
  .sk {
    background: rgb(255 255 255 / 0.15);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .sk-1 { height: 48px; width: 60%; }
  .sk-2 { height: 20px; width: 40%; }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.5; }
  }

  .tracks { padding: var(--space-2) var(--space-4) var(--space-12); }
  .tracks-skeleton { display: grid; gap: var(--space-2); padding: var(--space-3); }
  .row-sk {
    height: 48px;
    background: var(--bg-surface);
    border-radius: var(--radius-sm);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .empty, .error {
    padding: var(--space-8);
    text-align: center;
    color: var(--text-tertiary);
  }
  .error { color: var(--hero-text-secondary); }

  @media (max-width: 768px) {
    .hero {
      grid-template-columns: 1fr;
      text-align: center;
      padding: var(--space-8) var(--space-4) var(--space-6);
      justify-items: center;
    }
    .hero-cover { width: 192px; height: 192px; }
    .hero-meta { justify-items: center; }
    .title { font-size: var(--text-3xl); }
    .actions { justify-content: center; }
  }
</style>
