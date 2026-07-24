<script lang="ts">
  /**
   * PlaybackOrigin — "Reproduciendo desde {origen}". Muestra de dónde salió la
   * cola actual (álbum / playlist / artista / Tus Favoritos / Lo más escuchado)
   * con acceso directo a ese origen. Dos superficies (mirror del port iOS,
   * NowPlayingViewerView.swift):
   *   - variant="viewer": línea blanca inline dentro del NowPlaying, bajo el
   *     artista (paridad iOS).
   *   - variant="sidebar": fila propia en el clúster inferior del sidebar
   *     (ventaja web: siempre a la vista sin abrir overlay). Eyebrow "ORIGEN".
   *
   * El nombre se DERIVA del id del `contextUri` (TanStack cacheado), no de un
   * `contextName` puenteado — el contextUri ya se persiste/restaura. Ver
   * `$utils/playback-origin`.
   */
  import { createQuery } from '@tanstack/svelte-query';
  import { page } from '$app/state';
  import type { Component } from 'svelte';
  import type { IconWeight } from 'phosphor-svelte';
  import { VinylRecord, ListPlus, UsersThree, Star, ChartBar, CaretRight } from 'phosphor-svelte';
  import { player } from '$stores/player.svelte';
  import { credentials } from '$stores/credentials.svelte';
  import * as nav from '$services/NavidromeService';
  import { getCoverArtUrl } from '$services/NavidromeService';
  import { getPlaylistCoverUrl } from '$services/dailyMixes';
  import CoverImage from '$components/shared/CoverImage.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import { parseOrigin, type ParsedOrigin } from '$utils/playback-origin';

  type Props = {
    /** 'viewer' → línea blanca inline en el NowPlaying. 'sidebar' → fila estilo
        pinned (cover + chevron) con eyebrow "ORIGEN". */
    variant: 'viewer' | 'sidebar';
    /** Solo sidebar: rail colapsado (solo cover/glifo + tooltip). */
    collapsed?: boolean;
    /** Llamado al navegar, antes del goto del <a>. El viewer lo usa para cerrar
        el overlay. */
    onNavigate?: () => void;
  };
  let { variant, collapsed = false, onNavigate }: Props = $props();

  type IconComp = Component<{ size?: number | string; weight?: IconWeight }>;
  type ResolvableOrigin = Exclude<ParsedOrigin, { kind: 'top-weekly' }>;

  const parsed = $derived(parseOrigin(player.contextUri));

  async function fetchOrigin(
    p: ResolvableOrigin,
    username: string
  ): Promise<{ name: string; isFavorites: boolean; coverArt: string | null }> {
    if (p.kind === 'album') {
      const a = await nav.getAlbum(p.id);
      return { name: a.name, isFavorites: false, coverArt: a.coverArt ?? null };
    }
    if (p.kind === 'artist') {
      const a = await nav.getArtist(p.id);
      return { name: a.name, isFavorites: false, coverArt: null };
    }
    // playlist — en web "Favoritos" es una playlist Navidrome real; la
    // detectamos por nombre+comment+owner (mismo criterio que FavoritesStore).
    const pl = await nav.getPlaylist(p.id);
    const isFav =
      pl.name === 'Favoritos' &&
      (pl.comment ?? '').includes('Starred Synced') &&
      (pl.owner ?? '').toLowerCase() === username.toLowerCase();
    return {
      name: isFav ? 'Tus Favoritos' : pl.name,
      isFavorites: isFav,
      coverArt: pl.coverArt ?? null
    };
  }

  const resolveQ = createQuery(() => ({
    queryKey: ['playbackOrigin', player.contextUri ?? ''],
    queryFn: () => fetchOrigin(parsed as ResolvableOrigin, credentials.current?.username ?? ''),
    enabled: !!parsed && parsed.kind !== 'top-weekly',
    staleTime: 5 * 60 * 1000,
    retry: false
  }));

  type Display = {
    glyph: IconComp;
    prefix: string;
    name: string;
    href: string | null;
    coverUrl: string | null;
    aria: string;
  };

  const display = $derived.by<Display | null>(() => {
    const p = parsed;
    if (!p) return null;
    if (p.kind === 'top-weekly') {
      return {
        glyph: ChartBar as IconComp,
        prefix: '',
        name: 'Lo más escuchado esta semana',
        href: null,
        coverUrl: null,
        aria: 'Reproduciendo desde Lo más escuchado esta semana'
      };
    }
    const data = resolveQ.data;
    if (!data) return null; // aún resolviendo → no pintamos (evita flash sin nombre)
    if (p.kind === 'album') {
      return {
        glyph: VinylRecord as IconComp,
        prefix: 'Del álbum · ',
        name: data.name,
        href: `/album/${p.id}`,
        coverUrl: data.coverArt ? getCoverArtUrl(data.coverArt, 80) : null,
        aria: `Reproduciendo desde el álbum ${data.name}`
      };
    }
    if (p.kind === 'artist') {
      return {
        glyph: UsersThree as IconComp,
        prefix: 'De ',
        name: data.name,
        href: `/artist/${p.id}`,
        coverUrl: null, // covers de artista poco fiables en web → glifo
        aria: `Reproduciendo desde ${data.name}`
      };
    }
    // playlist / favoritos
    if (data.isFavorites) {
      return {
        glyph: Star as IconComp,
        prefix: '',
        name: 'Tus Favoritos',
        href: `/playlist/${p.id}`,
        coverUrl: null,
        aria: 'Reproduciendo desde tus Favoritos'
      };
    }
    return {
      glyph: ListPlus as IconComp,
      prefix: 'De la playlist · ',
      name: data.name,
      // Cover SIEMPRE del backend personalizado, nunca el coverArt de Navidrome.
      href: `/playlist/${p.id}`,
      coverUrl: getPlaylistCoverUrl(p.id),
      aria: `Reproduciendo desde la playlist ${data.name}`
    };
  });

  const tooltipText = $derived(display ? `${display.prefix}${display.name}` : '');
  const isActive = $derived(!!display?.href && page.url.pathname === display.href);

  function handleClick() {
    onNavigate?.();
  }
</script>

{#if display}
  {@const Glyph = display.glyph}
  {#if variant === 'viewer'}
    <!-- ── Viewer: línea blanca inline bajo el artista, sobre el backdrop ── -->
    {#if display.href}
      <a class="np-origin" href={display.href} onclick={handleClick} aria-label={display.aria}>
        <span class="np-origin-glyph"><Glyph size={13} weight="fill" /></span>
        <span class="np-origin-text"
          >{#if display.prefix}<span class="np-origin-prefix">{display.prefix}</span>{/if}<span
            class="np-origin-name">{display.name}</span
          ></span
        >
        <span class="np-origin-chevron"><CaretRight size={11} weight="bold" /></span>
      </a>
    {:else}
      <span class="np-origin np-origin-static" aria-label={display.aria}>
        <span class="np-origin-glyph"><Glyph size={13} weight="fill" /></span>
        <span class="np-origin-text"><span class="np-origin-name">{display.name}</span></span>
      </span>
    {/if}
  {:else}
    <!-- ── Sidebar: fila con cover/glifo + nombre + chevron, eyebrow "ORIGEN" ── -->
    <div class="origin-section" class:collapsed>
      {#if !collapsed}<p class="origin-label">Origen</p>{/if}
      {#snippet leading()}
        <span class="origin-cover">
          {#if display.coverUrl}
            <CoverImage src={display.coverUrl} alt="">
              {#snippet fallback()}<Glyph size="55%" weight="fill" />{/snippet}
            </CoverImage>
          {:else}
            <span class="origin-glyph-box"><Glyph size="55%" weight="fill" /></span>
          {/if}
        </span>
      {/snippet}
      {#if display.href}
        <a
          class="origin-row"
          class:active={isActive}
          href={display.href}
          data-sveltekit-preload-data="hover"
          aria-label={display.aria}
          use:tooltip={collapsed ? tooltipText : ''}
        >
          {@render leading()}
          {#if !collapsed}
            <span class="origin-name">{display.name}</span>
            <span class="origin-chevron"><CaretRight size={12} weight="bold" /></span>
          {/if}
        </a>
      {:else}
        <div class="origin-row origin-row-static" aria-label={display.aria} use:tooltip={collapsed ? tooltipText : ''}>
          {@render leading()}
          {#if !collapsed}<span class="origin-name">{display.name}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}
{/if}

<style>
  /* ═══ Viewer: texto blanco fijo sobre el backdrop, sin píldora (regla del
     viewer: legibilidad por blanco, nunca --accent). Apila bajo el artista y
     encima del estado de Connect. ═══ */
  .np-origin {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 6px 0 0;
    max-width: 100%;
    text-decoration: none;
    color: #fff;
    -webkit-tap-highlight-color: transparent;
    transition: opacity var(--duration-fast) var(--ease-ios-default);
  }
  a.np-origin:hover .np-origin-name {
    color: rgba(255, 255, 255, 1);
  }
  a.np-origin:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-xs);
  }
  .np-origin-glyph {
    display: inline-flex;
    color: rgba(255, 255, 255, 0.55);
    flex-shrink: 0;
  }
  .np-origin-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.3;
  }
  .np-origin-prefix {
    color: rgba(255, 255, 255, 0.55);
    font-weight: 400;
  }
  .np-origin-name {
    color: rgba(255, 255, 255, 0.9);
    font-weight: 600;
    transition: color var(--duration-fast) var(--ease-ios-default);
  }
  .np-origin-chevron {
    display: inline-flex;
    color: rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  /* ═══ Sidebar: fila estilo .pinned-item (cover 28px + nombre + chevron),
     con eyebrow "ORIGEN". Consume tokens semánticos. ═══ */
  .origin-section {
    display: grid;
    gap: var(--space-2);
  }
  .origin-label {
    margin: 0;
    padding: 0 var(--space-3);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-tertiary);
  }
  .origin-row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-3);
    min-height: 40px;
    border-radius: var(--radius-sm);
    text-decoration: none;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
    line-height: 1.3;
    min-width: 0;
    transition:
      background var(--duration-fast) var(--ease-ios-default),
      color var(--duration-fast) var(--ease-ios-default);
  }
  a.origin-row:hover {
    background: var(--row-hover);
    color: var(--text-primary);
  }
  a.origin-row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }
  /* Active: estás EN la página del origen → barra accent + bg, como .pinned-item.active */
  .origin-row.active {
    position: relative;
    background: var(--row-active);
    color: var(--text-primary);
  }
  .origin-row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 18px;
    background: var(--accent);
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
  }
  .origin-row-static {
    cursor: default;
  }
  .origin-cover {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    position: relative;
    background: var(--bg-surface-elevated);
    color: var(--text-tertiary);
  }
  .origin-glyph-box {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .origin-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .origin-chevron {
    display: inline-flex;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  /* Colapsado (rail): solo el cover/glifo 40px centrado + tooltip. */
  .origin-section.collapsed .origin-row {
    grid-template-columns: 40px;
    justify-content: center;
    padding: var(--space-1);
    min-height: 48px;
  }
  .origin-section.collapsed .origin-cover {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-sm);
  }
</style>
