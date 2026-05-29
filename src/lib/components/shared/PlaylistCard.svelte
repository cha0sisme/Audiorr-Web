<script lang="ts">
  import type { HTMLAnchorAttributes } from 'svelte/elements';
  import { Play, Queue } from 'phosphor-svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import EqualizerIcon from './EqualizerIcon.svelte';
  import CoverImage from './CoverImage.svelte';
  import { player } from '$stores/player.svelte';
  import { queueManager } from '$services/QueueManager.svelte';
  import * as nav from '$services/NavidromeService';

  type Props = HTMLAnchorAttributes & {
    /** ID de la playlist — para detectar si el playback viene de aquí. */
    id: string;
    name: string;
    songCount?: number | undefined;
    /** Reservado para casos donde no podemos resolver `topArtists` (id no
        Subsonic). PlaylistDetail sí lo expone con `playlistAuthorDetail`. */
    owner?: string | undefined;
    coverUrl?: string | undefined;
    href?: string | undefined;
    /** Pre-fetch del hero del cover (600 vs 300 de la card) on hover/focus. */
    prefetchHero?: () => void;
  };

  let { id, name, songCount, owner, coverUrl, href = '#', prefetchHero, ...rest }: Props = $props();

  const isCurrent = $derived(player.isPlayingFrom('playlist', id));

  let coverEl: HTMLDivElement | undefined = $state();
  function handleClick() {
    if (coverEl) {
      coverEl.style.viewTransitionName = `playlist-${id}`;
      // Ver nota en AlbumCard: el layout limpia este nombre tras navegar para
      // que un residuo no duplique el name del detalle y aborte la transición.
      coverEl.dataset.vtActive = '';
    }
  }

  /** Click del Play del cover. stopPropagation para no navegar al detalle. */
  let loadingPlay = $state(false);
  async function handlePlayClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (loadingPlay) return;
    loadingPlay = true;
    try {
      const playlist = await nav.getPlaylist(id);
      const songs = playlist.entry ?? [];
      if (songs.length === 0) return;
      player.context = { type: 'playlist', id };
      queueManager.play(songs, 0, { contextUri: `playlist:${id}` });
    } catch {
      // Silencioso — fallar no debería notificar al usuario.
    } finally {
      loadingPlay = false;
    }
  }

  // ===========================================================================
  // Subtitle "Incluye Drake, J. Cole, Kendrick" (estilo Spotify).
  //
  // Lazy fetch del detalle SOLO cuando la card entra en viewport (rootMargin
  // 200px para anticipar). Reusa la queryKey ['playlist', id] que también
  // consume PlaylistDetail → al click el detail está instantáneo.
  //
  // Skip fetch si el id no es Subsonic-real (placeholders del backend Audiorr
  // tipo "mix-N" / "smart-X" cuando aún no hay navidromeId asignado).
  // ===========================================================================

  let visible = $state(false);
  let cardEl: HTMLAnchorElement | undefined = $state();

  $effect(() => {
    if (!cardEl || visible) return;
    const target = cardEl;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          obs.disconnect();
          visible = true;
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(target);
    return () => obs.disconnect();
  });

  // `enabled` se computa inline dentro del getter de createQuery — `id` no es
  // reactiva durante la vida del card (key estable en {#each}), así que el
  // regex se evalúa eagerly sin necesidad de un `$derived` separado. Eso
  // evita un derived "huérfano" siendo leído por TanStack durante el cleanup
  // del componente (Svelte 5 derived_inert warning).
  const previewQ = createQuery(() => ({
    queryKey: ['playlist', id],
    queryFn: () => nav.getPlaylist(id),
    enabled: visible && !/^(mix|smart)-/.test(id),
    // Los artistas de una playlist cambian poco — 1h. PlaylistDetail tiene la
    // misma key sin staleTime explícito (default 0) → si el usuario abre el
    // detail y luego vuelve, la card sigue caliente.
    staleTime: 60 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false
  }));

  /** Parsea "Drake feat. J. Cole & Kendrick" → ["Drake", "J. Cole", "Kendrick"]. */
  function parseArtists(haystack: string): string[] {
    return haystack
      .split(/\s*(?:,|\s&\s|\sfeat\.\s|\sfeat\s|\sft\.\s|\sft\s|\sand\s|\swith\s|\sx\s)\s*/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  const topArtists = $derived.by(() => {
    const songs = previewQ.data?.entry ?? [];
    if (songs.length === 0) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of songs) {
      for (const artist of parseArtists(s.artist ?? '')) {
        const key = artist.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(artist);
        if (result.length >= 3) return result;
      }
    }
    return result;
  });

  const subtitle = $derived.by(() => {
    if (topArtists.length > 0) {
      return `Incluye ${topArtists.join(', ')}`;
    }
    if (songCount != null) {
      return `${songCount} canciones`;
    }
    return owner ?? '';
  });

  // En el contexto Jump Back In, el backend a veces envia `name` con el
  // titulo de una cancion (entries derivadas de scrobble.title). Si la
  // preview de Navidrome trae el nombre real, lo usamos como override.
  // Para el resto de callers, previewQ.data?.name suele coincidir con la
  // prop `name`, asi que el cambio es no-op.
  const resolvedName = $derived(previewQ.data?.name ?? name);
</script>

<a
  bind:this={cardEl}
  class="card"
  {href}
  onclick={handleClick}
  onmouseenter={prefetchHero}
  onfocus={prefetchHero}
  {...rest}
>
  <div class="cover-wrap">
    <div bind:this={coverEl} class="cover">
      <CoverImage src={coverUrl} alt="" priority="low" width={300} height={300}>
        {#snippet fallback()}
          <Queue size="100%" weight="regular" />
        {/snippet}
      </CoverImage>

      {#if isCurrent}
        <div class="playing-overlay" aria-hidden="true">
          <EqualizerIcon
            color="#fff"
            height={20}
            barWidth={3}
          />
        </div>
      {/if}
    </div>

    {#if !isCurrent}
      <button
        type="button"
        class="play"
        aria-label={`Reproducir ${resolvedName}`}
        onclick={handlePlayClick}
      >
        <Play size={14} weight="fill" />
      </button>
    {/if}
  </div>

  <p class="title">{resolvedName}</p>
  <p class="subtitle">{subtitle}</p>
</a>

<style>
  .card {
    display: block;
    text-decoration: none;
    color: inherit;
    border-radius: var(--radius-md);
    outline: none;
  }
  .card:focus-visible .cover {
    box-shadow: var(--shadow-sm), var(--focus-ring);
  }

  .cover-wrap {
    position: relative;
    margin-bottom: var(--space-3);
  }

  .cover {
    /* aspect-ratio reserva el espacio antes de cargar la imagen → cero
       layout shift. CoverImage rellena el slot. */
    position: relative;
    aspect-ratio: 1;
    width: 100%;
    border-radius: var(--radius-md);
    overflow: hidden;
    box-shadow: var(--shadow-sm);
    transition: box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .card:hover .cover {
    box-shadow: var(--shadow-md);
  }

  .playing-overlay {
    position: absolute;
    inset: 0;
    background: var(--scrim-on-art);
    display: grid;
    place-items: center;
    pointer-events: none;
  }

  .play {
    position: absolute;
    bottom: var(--space-2);
    right: var(--space-2);
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--overlay-on-art-bg);
    color: var(--overlay-on-art-fg);
    cursor: pointer;
    box-shadow: var(--overlay-on-art-shadow);

    display: grid;
    place-items: center;

    opacity: 0;
    transform: translateY(4px);
    transition:
      opacity var(--duration-fast) var(--ease-ios-default),
      transform var(--duration-fast) var(--ease-ios-default),
      background var(--duration-fast) var(--ease-ios-default);
  }
  .play :global(svg) {
    margin-left: 1px;
  }
  .play:hover {
    background: var(--overlay-on-art-bg-hover);
    transform: translateY(0) scale(1.06);
  }
  .play:active {
    transform: translateY(0) scale(0.94);
    transition-duration: var(--duration-instant);
  }
  .card:hover .play,
  .card:focus-within .play {
    opacity: 1;
    transform: translateY(0);
  }

  .title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    letter-spacing: var(--tracking-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .subtitle {
    margin-top: 2px;
    font-size: var(--text-sm);
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
