<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import HorizontalScrollSection from '$components/shared/HorizontalScrollSection.svelte';
  import AlbumCard from '$components/shared/AlbumCard.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import RecentArtistCard from '$components/home/RecentArtistCard.svelte';
  import QuickAccessCard from '$components/home/QuickAccessCard.svelte';
  import TopWeeklyChart from '$components/home/TopWeeklyChart.svelte';
  import WeeklyStatsCard from '$components/home/WeeklyStatsCard.svelte';
  import GenreCard from '$components/shared/GenreCard.svelte';
  import * as nav from '$services/NavidromeService';
  import * as stats from '$services/stats';
  import { getDailyMixes, getPlaylistCoverUrl } from '$services/dailyMixes';
  import { getSmartPlaylists } from '$services/smartPlaylists';
  import { getPinnedPlaylists } from '$services/user';
  import { refreshPlaylistCoverHashes } from '$services/playlist-cover-refresh';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { prefetchCover } from '$utils/cover-cache';
  import { albumToCardProps, playlistToCardProps } from '$utils/navidrome-mappers';
  import { dailyMixToProps } from '$utils/playlist-section-mappers';
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
  //   `created_at` desc). Es lo que queremos en "Últimos álbumes añadidos".
  // - `frequent` = más reproducidos del usuario.
  // - `random` = surtido aleatorio (refresca cada visita, staleTime 0) —
  //   sección "Descubre algo nuevo".
  // - getRecentReleases = "Lanzamientos recientes", ventana 6 meses por
  //   fecha de lanzamiento real (no son adds recientes sino lanzamientos).
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

  // "Lanzamientos recientes" — ventana de 6 meses ordenada por fecha de
  // lanzamiento REAL (releaseDate OpenSubsonic), mirror de
  // HomeViewModel.loadRecentReleases. Reemplaza al antiguo byYear del año
  // en curso, que dejaba fuera lanzamientos de diciembre en enero.
  const recentReleasesQ = createQuery(() => ({
    queryKey: ['recentReleases'],
    queryFn: () => nav.getRecentReleases(6, 30),
    enabled: credentials.isConfigured,
    staleTime: 60 * 60 * 1000
  }));

  /** Fisher-Yates — rotación honesta del pool de géneros. */
  function shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = out[i]!;
      out[i] = out[j]!;
      out[j] = a;
    }
    return out;
  }

  // Géneros (Navidrome — funciona sin backend). Selección "pro": prioriza
  // los más populares (nº de álbumes) pero rota un subconjunto para dar
  // variedad en cada visita — ventana top-20 barajada → 12. Mirror
  // HomeViewModel.loadGenres. staleTime 0 = re-shuffle por visita (como el
  // load() de iOS con TTL corto).
  const genresQ = createQuery(() => ({
    queryKey: ['genres', 'home'],
    queryFn: async () => {
      const all = (await nav.getGenres()).filter(
        (g) => (g.albumCount ?? 0) > 0 && g.value.trim().length > 0
      );
      const popular = [...all].sort((a, b) => (b.albumCount ?? 0) - (a.albumCount ?? 0));
      return {
        featured: shuffle(popular.slice(0, 20)).slice(0, 12),
        total: popular.length
      };
    },
    enabled: credentials.isConfigured,
    staleTime: 0
  }));
  const homeGenres = $derived(genresQ.data?.featured ?? []);
  const totalGenres = $derived(genresQ.data?.total ?? 0);

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
    (recentContextsQ.data ?? [])
      .filter(
        (ctx) =>
          (ctx.type === 'album' || ctx.type === 'playlist' || ctx.type === 'artist') &&
          // Doble defensa: aunque el type vuelva como 'playlist' (entradas
          // legacy donde el backend resuelve smartmix:<id> hacia su playlist
          // base), filtramos por el scheme del contextUri. El QueueManager
          // ya no envia 'smartmix:' al backend a partir de ahora, pero las
          // entradas anteriores siguen contaminando hasta que se purguen.
          !ctx.contextUri.startsWith('smartmix:')
      )
      // Sort defensivo por lastPlayedAt desc -- garantiza que la
      // reproducción más reciente aparezca primera, independientemente del
      // orden que devuelva el backend. Tras el scrobble (50% threshold) el
      // ScrobbleService llama invalidateRecentContexts(); la query se
      // refetchea y el sort coloca la entry de la última playlist/album
      // escuchado al principio del carousel. Mirror del comportamiento iOS.
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.lastPlayedAt).getTime();
        const tb = new Date(b.lastPlayedAt).getTime();
        return tb - ta;
      })
      // Paridad iOS HomeView.loadRecentContexts: para contextos de artista el
      // backend deja `title = COALESCE(context_name, album)`, que cae al nombre
      // del ÁLBUM de la última pista cuando el scrobble no guardó context_name.
      // El nombre fiable del artista está en `artist` → lo usamos como título.
      .map((ctx) =>
        ctx.type === 'artist' && ctx.artist ? { ...ctx, title: ctx.artist } : ctx
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

  const queryClient = useQueryClient();

  // Daily mixes: la query hidrata los `coverContentHash` en el store global
  // `playlistCovers` (side effect del service, mirrors
  // `api.refreshPlaylistCoverHashes()` de iOS) Y alimenta la sección
  // "Tus mixes diarios". Solo mixes con playlist Navidrome resuelta — sin
  // navidromeId la card no puede navegar (mirror resolveMixPlaylists iOS).
  const dailyMixesQ = createQuery(() => ({
    queryKey: ['dailyMixes', credentials.current?.username ?? ''],
    queryFn: () => getDailyMixes(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
  const dailyMixes = $derived((dailyMixesQ.data ?? []).filter((m) => m.navidromeId));

  createQuery(() => ({
    queryKey: ['smartPlaylists', credentials.current?.username ?? ''],
    queryFn: () => getSmartPlaylists(credentials.current!.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  // Playlists fijadas (backend), resueltas contra las playlists reales de
  // Navidrome manteniendo el orden del pin — mirror
  // HomeViewModel.loadPinnedPlaylists. Key derivada de la del Sidebar
  // (['pinnedPlaylists', user]) para que un invalidate por prefijo refresque
  // ambas sin chocar tipos (el Sidebar cachea las PinnedPlaylist crudas).
  const pinnedResolvedQ = createQuery(() => ({
    queryKey: ['pinnedPlaylists', credentials.current?.username ?? '', 'resolved'],
    queryFn: async () => {
      const pinned = await getPinnedPlaylists(credentials.current!.username);
      if (pinned.length === 0) return [];
      const all = await queryClient.fetchQuery({
        queryKey: ['library', 'playlists'],
        queryFn: () => nav.getPlaylists(),
        staleTime: 5 * 60 * 1000
      });
      const lookup = new Map(all.map((p) => [p.id, p]));
      return pinned.flatMap((p) => lookup.get(p.id) ?? []);
    },
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));
  const pinnedPlaylists = $derived(pinnedResolvedQ.data ?? []);

  // "Tu semana" — misma key shape que ProfileView (['userStats', user,
  // period]) para compartir cache con el perfil.
  const weeklyStatsQ = createQuery(() => ({
    queryKey: ['userStats', credentials.current?.username ?? '', 'week'],
    queryFn: () => stats.getUserStats(credentials.current!.username, 'week'),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000
  }));
  const weeklyStats = $derived(weeklyStatsQ.data);

  // Trigger Layer 2 (HEAD/ETag) para playlists no cubiertas por los bulks
  // de arriba — editorial, Spotify-synced, "This Is …", playlists del usuario.
  // Mirror HomeView.swift:91. Idempotente: si el usuario navega Home→Library
  // en pocos segundos, el segundo trigger comparte la misma promise.
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
          <!-- ctx.id = id Subsonic del artista → navega al detalle. El avatar
               y el nombre canónico los resuelve QuickAccessCard vía getArtist.
               Mirror iOS HomeView (NavigationLink a ArtistDetail con ctx.id). -->
          <QuickAccessCard
            id={ctx.id}
            contextType="artist"
            title={ctx.title}
            href={`/artist/${ctx.id}`}
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
          <!-- RecentArtistCard resuelve el avatar real del artista vía
               getArtist(ctx.id) y navega a /artist/<id>. Paridad iOS
               ArtistCardView (resuelve su propio avatar). -->
          <RecentArtistCard id={ctx.id} name={ctx.title} />
        {/if}
      {/snippet}
    </HorizontalScrollSection>
  {/if}

  <!-- ═══ Orden de secciones = HomeView.swift body: personales (quick /
       top semanal / volver a escuchar / fijadas) → descubrimiento
       (lanzamientos / géneros / mixes / random) → catálogo (últimos
       añadidos) → stats (Tu semana). ═══ -->

  <!-- === Playlists fijadas (backend) === -->
  {#if pinnedPlaylists.length > 0}
    <HorizontalScrollSection title="Playlists fijadas" items={pinnedPlaylists}>
      {#snippet item(p)}
        {@const props = playlistToCardProps(p)}
        <PlaylistCard {...props} />
      {/snippet}
    </HorizontalScrollSection>
  {/if}

  <!-- === Lanzamientos recientes: ventana 6 meses por fecha de lanzamiento
       real — diferente de "Últimos álbumes añadidos" (newest = recién
       metidos a la biblioteca). -->
  {#if (recentReleasesQ.data ?? []).length > 0}
    <HorizontalScrollSection
      title="Lanzamientos recientes"
      items={recentReleasesQ.data ?? []}
      seeAllHref="/library/new-releases"
    >
      {#snippet item(a)}
        {@const props = albumToCardProps(a)}
        <AlbumCard {...props} subtitleMode="year" />
      {/snippet}
    </HorizontalScrollSection>
  {/if}

  <!-- === Géneros (Navidrome — funciona sin backend) === -->
  {#if homeGenres.length > 0}
    <HorizontalScrollSection
      title="Géneros"
      items={homeGenres}
      itemMinWidth={168}
      seeAllShape="wide"
      seeAllHref={totalGenres > homeGenres.length ? '/library/genres' : undefined}
    >
      {#snippet item(g)}
        <GenreCard genre={g} />
      {/snippet}
    </HorizontalScrollSection>
  {/if}

  <!-- === Tus mixes diarios (backend) === -->
  {#if dailyMixes.length > 0}
    <HorizontalScrollSection
      title="Tus mixes diarios"
      items={dailyMixes}
      seeAllHref="/library/daily-mixes"
    >
      {#snippet item(mix)}
        {@const props = dailyMixToProps(mix)}
        <PlaylistCard {...props} />
      {/snippet}
    </HorizontalScrollSection>
  {/if}

  <HorizontalScrollSection
    title="Descubre algo nuevo"
    items={randomAlbums.data ?? []}
    seeAllHref="/library/random"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <HorizontalScrollSection
    title="Últimos álbumes añadidos"
    items={newestAlbums.data ?? []}
    seeAllHref="/library/recent"
  >
    {#snippet item(a)}
      {@const props = albumToCardProps(a)}
      <AlbumCard {...props} />
    {/snippet}
  </HorizontalScrollSection>

  <!-- === Tu semana (backend stats) === -->
  {#if weeklyStats && weeklyStats.total_plays > 0}
    <WeeklyStatsCard stats={weeklyStats} />
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
