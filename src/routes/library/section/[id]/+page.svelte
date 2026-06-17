<script lang="ts">
  /**
   * /library/section/[id] — SeeAllGrid de una sección `dynamic` del
   * `homepage_layout`. Recibe el id de la sección, lee el layout del
   * backend, encuentra la sección y resuelve sus IDs contra getPlaylists()
   * para obtener las playlists Navidrome con metadata.
   *
   * 404 si:
   *   - el layout no existe
   *   - la sección no existe en el layout
   *   - la sección existe pero no es de tipo `dynamic` (las fixed_* tienen
   *     sus propias rutas: /library/daily-mixes, /smart-playlists,
   *     /my-playlists).
   */
  import PageTitle from '$components/shared/PageTitle.svelte';
  import { page } from '$app/state';
  import { error } from '@sveltejs/kit';
  import { createQuery } from '@tanstack/svelte-query';
  import SeeAllGrid from '$components/shared/SeeAllGrid.svelte';
  import PlaylistCard from '$components/shared/PlaylistCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { loadPlaylistsLayout } from '$services/userAffinity';
  import { playlistToCardProps } from '$utils/navidrome-mappers';
  import { isSmartPlaylistName } from '$utils/playlist-section-mappers';
  import { credentials } from '$stores/credentials.svelte';
  import type { NavidromePlaylist } from '$types/navidrome';

  const sectionId = $derived(page.params.id ?? '');

  // Comparte queryKey con /library (homepageLayout reordenado por afinidad).
  // El orden de section.playlists viene ya ordenado por rankPredicted desde
  // el backend para secciones dynamic.
  const layoutQ = createQuery(() => ({
    queryKey: ['playlistsLayout', credentials.current?.username ?? ''],
    queryFn: () => loadPlaylistsLayout(credentials.current?.username),
    enabled: credentials.isConfigured,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000
  }));

  const playlistsQ = createQuery(() => ({
    queryKey: ['library', 'playlists'],
    queryFn: () => nav.getPlaylists(),
    enabled: credentials.isConfigured,
    gcTime: 30 * 60 * 1000
  }));

  const section = $derived(
    (layoutQ.data ?? []).find((s) => s.id === sectionId) ?? null
  );

  // Validación: el id no corresponde a una sección dynamic conocida.
  $effect(() => {
    if (layoutQ.isPending) return;
    if (!section || section.type !== 'dynamic') {
      error(404, `Sección dynamic desconocida: ${sectionId}`);
    }
  });

  const title = $derived(section?.title ?? 'Playlists');

  /** Items: ids del section.playlists resueltos contra el getPlaylists(). */
  const items = $derived.by<NavidromePlaylist[]>(() => {
    if (!section || section.type !== 'dynamic') return [];
    const all = playlistsQ.data ?? [];
    const map = new Map(all.map((p) => [p.id, p]));
    return (section.playlists ?? [])
      .map((id) => map.get(id))
      .filter((p): p is NavidromePlaylist => !!p && !isSmartPlaylistName(p));
  });
</script>

<PageTitle segments={[title]} />

<SeeAllGrid {title} kind="playlist">
  {#each items as p (p.id)}
    {@const props = playlistToCardProps(p)}
    <PlaylistCard {...props} />
  {/each}
</SeeAllGrid>
