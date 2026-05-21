<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import QuickAccessCard from '$components/home/QuickAccessCard.svelte';
  import TopWeeklyChart from '$components/home/TopWeeklyChart.svelte';
  import * as nav from '$services/NavidromeService';
  import * as stats from '$services/stats';
  import { getDailyMixes, getPlaylistCoverUrl } from '$services/dailyMixes';
  import { getSmartPlaylists } from '$services/smartPlaylists';
  import { refreshPlaylistCoverHashes } from '$services/playlist-cover-refresh';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { prefetchCover } from '$utils/cover-cache';
  import { albumToCardProps } from '$utils/navidrome-mappers';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import type { RecentContextItem, TopWeeklySong } from '$types/backend';
  import type { NavidromeSong } from '$types/navidrome';

  // Saludo dinámico por hora — una sola línea, sin username (decisión UI:
  // los nombres de Navidrome suelen ser lowercase técnicos tipo "leandro" o
  // "admin", añadirlos rompe el tono editorial limpio que queremos).
  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? 'Buenas noches'
    : hour < 13 ? 'Buenos días'
    : hour < 20 ? 'Buenas tardes'
    : 'Buenas noches';

  // ===========================================================================
  // Subsonic queries.
  //
  // - `newest` = recién añadidos a la biblioteca (Navidrome ordena por
  //   `created_at` desc). Es lo que queremos en "Recientemente añadido".
  // - `frequent` = más reproducidos del usuario.
  // - `random` = surtido aleatorio (refresca cada visita, staleTime 0).
  // - `byYear` con año actual = "Nuevos lanzamientos" — no son adds recientes
  //   sino lanzamientos del año (un álbum del 2026 añadido hoy y uno del
  //   2026 añadido hace meses entran ambos).
  //
  // Eliminado: `recent` (recently played) — el feed correcto de "lo que has
  // estado escuchando" lo da el backend Audiorr en /api/stats/recent-contexts.
  // ===========================================================================

  const newestAlbums = createQuery(() => ({
    queryKey: ['albumList2', 'newest'],
    queryFn: () => nav.getAlbumList2('newest', 30),
    enabled: credentials.isConfigured
  }));

  const randomAlbums = createQuery(() => ({
    queryKey: ['albumList2', 'random'],
    queryFn: () => nav.getAlbumList2('random', 30),
    staleTime: 0,
    enabled: credentials.isConfigured
  }));

  const currentYear = new Date().getFullYear();
  const newReleases = createQuery(() => ({
    queryKey: ['albumList2', 'byYear', currentYear],
    queryFn: () => nav.getAlbumsByYear(currentYear, currentYear, 30),
    enabled: credentials.isConfigured,
    staleTime: 60 * 60 * 1000
  }));

  // ===========================================================================
  // Backend Audiorr — Jump Back In + Top semanal.
  //
  // Quick-play grid (bajo el saludo) muestra los primeros 6 recentContexts
  // del backend (album / playlist / artist solamente). Si está vacío
  // (instalación nueva sin scrobbles), fallback a `newestAlbums.slice(0, 6)`
  // — siempre hay algo bajo el saludo.
  //
  // "Volver a escuchar" como HorizontalScrollSection aparece SOLO cuando hay
  // overflow (>6 contexts). Mirrors el patrón quickPlayGrid + jumpBackInSection
  // de iOS HomeView.
  //
  // ⚠️ Filtro defensivo `smartmix` / `other`: el backend puede devolver items
  // con `type === 'smartmix'` cuando un cliente (iOS hoy, web cuando se
  // implemente ScrobbleService) ha scrobbleado una cola SmartMix. Esos
  // items NO son navegables como Album/Playlist/Artist — su `id` es el id
  // de la playlist base con prefix smartmix:, así que tratarlos como
  // playlist envía a `/playlist/<smartmix-id>` que tira 404. Decisión
  // director 2026-05-09: SmartMix no debe aparecer nunca en Jump Back In.
  // ===========================================================================

  const recentContextsQ = createQuery(() => ({
    queryKey: ['recentContexts', credentials.current?.username ?? ''],
    queryFn: () => stats.getRecentContexts(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 60 * 1000
  }));
  const recentContexts = $derived(
    (recentContextsQ.data ?? []).filter(
      (ctx) => ctx.type === 'album' || ctx.type === 'playlist' || ctx.type === 'artist'
    )
  );

  const topWeeklyQ = createQuery(() => ({
    queryKey: ['topWeekly'],
    queryFn: () => stats.getTopWeekly(),
    enabled: credentials.isConfigured,
    // El chart cambia día a día (la ventana semanal corre); 5 min es OK,
    // pero como no es crítico, podemos dejar staleTime más alto.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000
  }));
  const topWeekly = $derived(topWeeklyQ.data ?? []);

  // Quick-play grid: primeros 6 contexts. Si vacío → fallback a newest albums.
  type QuickItem =
    | { kind: 'context'; ctx: RecentContextItem }
    | { kind: 'album'; album: NonNullable<typeof newestAlbums.data>[number] };

  const quickItems = $derived.by<QuickItem[]>(() => {
    if (recentContexts.length > 0) {
      return recentContexts.slice(0, 6).map((ctx) => ({ kind: 'context' as const, ctx }));
    }
    return (newestAlbums.data ?? [])
      .slice(0, 6)
      .map((album) => ({ kind: 'album' as const, album }));
  });

  const jumpBackOverflow = $derived(recentContexts.slice(6));

  // === Top semanal play handler ===
  // Convertimos TopWeeklySong → NavidromeSong inline para arrancar la queue.
  // iOS hace lo mismo (con un getSong N+1 en background para hidratar
  // explicit/replayGain) — aquí simplificamos al MVP: la queue es funcional
  // sin esos detalles y el siguiente analyze enriquece on-demand.
  function topWeeklyToNavidromeSong(s: TopWeeklySong): NavidromeSong {
    return {
      id: s.song_id,
      title: s.title,
      artist: s.artist,
      ...(s.artist_id ? { artistId: s.artist_id } : {}),
      album: s.album,
      ...(s.album_id ? { albumId: s.album_id } : {}),
      ...(s.cover_art ? { coverArt: s.cover_art } : {}),
      ...(typeof s.duration === 'number' ? { duration: s.duration } : {})
    };
  }

  function playTopWeekly(index: number) {
    if (topWeekly.length === 0) return;
    const songs = topWeekly.map(topWeeklyToNavidromeSong);
    player.context = { type: 'playlist', id: 'top-weekly' };
    queueManager.play(songs, index, { contextUri: 'playlist:top-weekly' });
  }

  // Side effect: pre-cargar los `coverContentHash` de daily mixes + smart
  // playlists en el store global `playlistCovers`. Mirrors
  // `api.refreshPlaylistCoverHashes()` de iOS HomeView.
  // Sin esto, los covers de playlists en Jump Back In se servirían sin
  // `?v=` y caducarían al cabo de 30 min (vs 1 año con el hash).
  // No renderizamos los datos aquí — es solo para hidratar el cache.
  createQuery(() => ({
    queryKey: ['dailyMixes', credentials.current?.username ?? ''],
    queryFn: () => getDailyMixes(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
  createQuery(() => ({
    queryKey: ['smartPlaylists', credentials.current?.username ?? ''],
    queryFn: () => getSmartPlaylists(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  // Trigger Layer 2 (HEAD/ETag) para playlists no cubiertas por los bulks
  // de arriba — editorial, Spotify-synced, "This Is …", playlists del usuario.
  // Mirror HomeView.swift:91. Idempotente: si el usuario navega Home→Library
  // en pocos segundos, el segundo trigger comparte la misma promise.
  const queryClient = useQueryClient();
  $effect(() => {
    if (!credentials.isConfigured) return;
    void refreshPlaylistCoverHashes(queryClient, credentials.current?.username);
  });
</script>

<div class="home">
  <header class="hero">
    <h1>{greeting}</h1>
  </header>

  <!-- Quick-play grid: 6 primeros recentContexts (album/playlist/artist).
       Mirrors el quickPlayGrid de iOS. Si el wrapped.db está vacío
       (instalación nueva) cae a los 6 primeros álbumes recién añadidos
       para que esta sección nunca aparezca vacía. -->
  <section class="quick-access" aria-label="Acceso rápido">
    {#each quickItems as item (item.kind === 'context' ? item.ctx.contextUri : item.album.id)}
      {#if item.kind === 'context'}
        {@const ctx = item.ctx}
        {#if ctx.type === 'album'}
          <QuickAccessCard
            id={ctx.id}
            contextType="album"
            title={ctx.title}
            coverUrl={ctx.coverArtId ? getCoverArtUrl(ctx.coverArtId, 120) : undefined}
            href={`/album/${ctx.id}`}
            prefetchHero={() => prefetchCover(ctx.coverArtId ?? undefined, 600)}
          />
        {:else if ctx.type === 'playlist'}
          <QuickAccessCard
            id={ctx.id}
            contextType="playlist"
            title={ctx.title}
            coverUrl={getPlaylistCoverUrl(ctx.id)}
            href={`/playlist/${ctx.id}`}
          />
        {:else if ctx.type === 'artist'}
          <!-- ctx.id es el NOMBRE para artist (limitación backend) → href cae
               a /search?q=<name>. Cuando el backend exponga el id Subsonic
               real, simplificar a /artist/<id>. -->
          <QuickAccessCard
            id={ctx.id}
            contextType="artist"
            title={ctx.title}
            href={`/search?q=${encodeURIComponent(ctx.title)}`}
          />
        {/if}
      {:else}
        {@const props = albumToCardProps(item.album)}
        <QuickAccessCard
          id={props.id}
          contextType="album"
          title={props.title}
          coverUrl={props.coverUrl}
          href={props.href}
          prefetchHero={props.prefetchHero}
        />
      {/if}
    {/each}
  </section>

  <!-- Top semanal: 2 columnas de 5 (Top 10 con tendencias). Solo aparece
       si el backend devolvió data — wrapped.db vacío = sin sección. -->
  {#if topWeekly.length > 0}
    <section class="top-weekly" aria-label="Top semanal">
      <header class="section-header">
        <h2>Top semanal</h2>
        <p>Lo más escuchado de la semana</p>
      </header>
      <TopWeeklyChart songs={topWeekly} onPlay={playTopWeekly} />
    </section>
  {/if}

  <!-- Volver a escuchar — overflow del quick-play grid (>6 contexts). -->
  {#if jumpBackOverflow.length > 0}
    <HorizontalScrollSection title="Volver a escuchar" items={jumpBackOverflow}>
      {#snippet item(ctx)}
        {#if ctx.type === 'album'}
          <AlbumCard
            id={ctx.id}
            title={ctx.title}
            artist={ctx.artist}
            coverUrl={ctx.coverArtId ? getCoverArtUrl(ctx.coverArtId, 300) : undefined}
            href={`/album/${ctx.id}`}
            prefetchHero={() => prefetchCover(ctx.coverArtId ?? undefined, 600)}
          />
        {:else if ctx.type === 'playlist'}
          <PlaylistCard
            id={ctx.id}
            name={ctx.title}
            coverUrl={getPlaylistCoverUrl(ctx.id)}
            href={`/playlist/${ctx.id}`}
            prefetchHero={() => {}}
          />
        {:else if ctx.type === 'artist'}
          <ArtistCard
            id={ctx.id}
            name={ctx.title}
            href={`/search?q=${encodeURIComponent(ctx.title)}`}
            prefetchHero={() => {}}
          />
        {/if}
      {/snippet}
    </HorizontalScrollSection>
  {/if}

  <HorizontalScrollSection
    title="Recientemente añadido"
    items={newestAlbums.data ?? []}
    seeAllHref="/library/recent"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Aleatorio"
    subtitle="Algo distinto cada visita"
    items={randomAlbums.data ?? []}
    seeAllHref="/library/random"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <!-- Nuevos lanzamientos: álbumes del año en curso (`byYear`) — diferente
       de "Recientemente añadido" (newest = recién metidos a la biblioteca). -->
  {#if (newReleases.data ?? []).length > 0}
    <HorizontalScrollSection
      title="Nuevos lanzamientos"
      subtitle={`Lanzamientos de ${currentYear}`}
      items={newReleases.data ?? []}
      seeAllHref="/library/new-releases"
    >
      {#snippet item(a)}
        {@const props = albumToCardProps(a)}
        <AlbumCard {...props} subtitleMode="year" />
      {/snippet}
    </HorizontalScrollSection>
  {/if}
</div>

<style>
  .home {
    display: grid;
    gap: var(--space-10);
    padding: var(--space-8) 0 var(--space-12);
  }

  .hero {
    padding: 0 var(--space-6);
  }
  h1 {
    font-size: var(--text-3xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display-lg);
    line-height: 1.1;
    margin: 0;
  }

  .quick-access {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
    gap: var(--space-3);
    padding: 0 var(--space-6);
  }

  .top-weekly {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }
  .section-header {
    padding: 0 var(--space-6);
  }
  .section-header h2 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: var(--tracking-display);
    line-height: 1.2;
    color: var(--text-primary);
  }
  .section-header p {
    margin: 2px 0 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  @media (max-width: 640px) {
    .home {
      gap: var(--space-8);
    }
    .hero {
      padding: 0 var(--space-4);
    }
    .quick-access {
      padding: 0 var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
    }
    .section-header {
      padding: 0 var(--space-4);
    }
    h1 {
      font-size: var(--text-2xl);
    }
  }
</style>
