<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import ArtistCard from '$components/shared/ArtistCard.svelte';
  import * as nav from '$services/NavidromeService';
  import { artistAvatarUrl } from '$utils/navidrome-mappers';

  type Props = {
    /** ID Subsonic del artista (viene de `ctx.id` del recent-context). */
    id: string;
    /** Nombre de fallback mientras resuelve (= `ctx.title`, ya normalizado al
        nombre del artista en la home). */
    name: string;
  };

  let { id, name }: Props = $props();

  // El item de "Volver a escuchar" solo trae id + nombre — el avatar hay que
  // resolverlo. Mirror de iOS ArtistCardView, que resuelve su propio avatar a
  // partir del id. Reutiliza la queryKey ['artist', id] de ArtistDetail → cache
  // compartido: al navegar al detalle el artista ya está hidratado.
  const artistQ = createQuery(() => ({
    queryKey: ['artist', id],
    queryFn: () => nav.getArtist(id),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false
  }));

  const coverUrl = $derived(artistQ.data ? artistAvatarUrl(artistQ.data, 300) : undefined);
  const resolvedName = $derived(artistQ.data?.name ?? name);
  const albumCount = $derived(artistQ.data?.albumCount);
</script>

<ArtistCard
  {id}
  name={resolvedName}
  {coverUrl}
  {albumCount}
  href={`/artist/${id}`}
  prefetchHero={() => {}}
/>
