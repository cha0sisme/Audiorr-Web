<script lang="ts">
  import { artistSegments } from '$utils/artist-format';
  import type { NavidromeItemArtist } from '$types/navidrome';

  type Props = {
    /** Lista completa de artistas (OpenSubsonic `song.artists[]`). Cuando trae
        >1 entrada se renderiza "A feat. B & C" con cada nombre como link. */
    artists?: NavidromeItemArtist[] | undefined;
    /** Nombre crudo del artista principal — fallback cuando no hay `artists[]`. */
    artist: string;
    /** Id Subsonic del artista principal — fallback para el link single. */
    artistId?: string | undefined;
  };

  let { artists, artist, artistId }: Props = $props();

  const segments = $derived(artistSegments(artists ?? [], artist, artistId));
</script>

<!-- prettier-ignore -->
{#each segments as seg, i (i)}{#if seg.kind === 'sep'}<span class="sep">{seg.text}</span>{:else if seg.id}<a class="artist-link" href="/artist/{seg.id}">{seg.name}</a>{:else}<span class="artist-plain">{seg.name}</span>{/if}{/each}

<style>
  /* Sin color propio: hereda del contenedor (.artist del MiniPlayer, etc).
     El link solo cambia a primario + subrayado en hover para señalar que es
     clickable; los separadores y los nombres sin id quedan como texto. */
  .artist-link {
    color: inherit;
    text-decoration: none;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .artist-link:hover {
    color: var(--text-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .artist-link:focus-visible {
    outline: none;
    color: var(--text-primary);
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-xs);
  }
  .sep,
  .artist-plain {
    color: inherit;
  }
</style>
