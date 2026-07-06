<script lang="ts">
  /**
   * GenreCard — tarjeta de género con degradado vibrante derivado de forma
   * determinista del nombre (mismo género → mismo color siempre, y el mismo
   * que en iOS: idéntico hash FNV-1a 64-bit que GenreCardView). Port de
   * HomeView.swift GenreCardView: degradado diagonal + bokeh translúcido
   * difuminado + brillo superior + scrim inferior de contraste + icono
   * representativo como marca de agua.
   */
  import {
    Radio,
    Guitar,
    Waveform,
    MusicNotes,
    PianoKeys,
    MicrophoneStage,
    Headphones,
    FilmSlate,
    Sparkle,
    Disc,
    MusicNote,
    MusicNoteSimple
  } from 'phosphor-svelte';
  import type { NavidromeGenre } from '$types/navidrome';

  type Props = {
    genre: NavidromeGenre;
    /** Nº de álbumes bajo el nombre (página "todos los géneros"). */
    showsAlbumCount?: boolean;
  };

  let { genre, showsAlbumCount = false }: Props = $props();

  /** Hue estable 0..359 a partir del nombre — hash FNV-1a de 64 bits con
      BigInt para producir EXACTAMENTE el mismo hue que iOS (UInt64 % 360). */
  function genreHue(name: string): number {
    const MASK = 0xffffffffffffffffn;
    let h = 14695981039346656037n;
    for (const byte of new TextEncoder().encode(name.toLowerCase())) {
      h ^= BigInt(byte);
      h = (h * 1099511628211n) & MASK;
    }
    return Number(h % 360n);
  }

  const hue = $derived(genreHue(genre.value));

  /** Icono representativo según el nombre (paridad conceptual con el mapa
      de SF Symbols de iOS; glifos Phosphor equivalentes). Orden de chequeo:
      de lo más específico a lo más general (k-pop antes que pop). */
  const icon = $derived.by<typeof MusicNote>(() => {
    const n = genre.value.toLowerCase();
    const has = (...keys: string[]) => keys.some((k) => n.includes(k));
    if (has('hip hop', 'hip-hop', 'hiphop', 'rap', 'trap', 'drill')) return Radio;
    if (has('rock', 'metal', 'punk', 'grunge', 'hardcore')) return Guitar;
    if (has('electro', 'edm', 'techno', 'house', 'trance', 'dubstep', 'dance', 'drum and bass', 'dnb'))
      return Waveform;
    if (has('jazz')) return MusicNotes;
    if (has('classic', 'clásic', 'orchestr', 'orquest', 'opera', 'symphon')) return PianoKeys;
    if (has('soul', 'r&b', 'rnb', 'funk', 'motown')) return MicrophoneStage;
    if (has('country', 'folk', 'blues', 'acoustic', 'acústic', 'americana')) return Guitar;
    if (has('reggae', 'reggaeton', 'latin', 'latino', 'salsa', 'cumbia', 'bachata', 'merengue'))
      return MusicNoteSimple;
    if (has('ambient', 'chill', 'lo-fi', 'lofi', 'instrumental', 'study')) return Headphones;
    if (has('soundtrack', 'score', 'film', 'cine', 'banda sonora')) return FilmSlate;
    if (has('k-pop', 'kpop', 'j-pop', 'jpop', 'anime')) return Sparkle;
    if (has('disco')) return Disc;
    if (has('pop')) return MicrophoneStage;
    return MusicNote;
  });
  const Icon = $derived(icon);

  const albumCount = $derived(genre.albumCount ?? 0);
</script>

<a
  class="card"
  href={`/genre/${encodeURIComponent(genre.value)}`}
  style:--genre-hue={hue}
>
  <span class="icon" aria-hidden="true">
    <Icon size={34} weight="fill" />
  </span>
  <span class="meta">
    <span class="name">{genre.value}</span>
    {#if showsAlbumCount && albumCount > 0}
      <span class="count">{albumCount} {albumCount === 1 ? 'álbum' : 'álbumes'}</span>
    {/if}
  </span>
</a>

<style>
  /* Colores derivados del hue determinista. c1/c2 = conversión HSB→HSL de
     los valores iOS (sat .70 bri .92 / sat .88 bri .60, +32° de deriva). */
  .card {
    --c1: hsl(var(--genre-hue) 80% 60%);
    --c2: hsl(calc(var(--genre-hue) + 32) 79% 34%);

    position: relative;
    isolation: isolate;
    display: flex;
    align-items: flex-end;
    aspect-ratio: 168 / 100;
    width: 100%;
    padding: 14px;
    border-radius: var(--radius-lg);
    overflow: hidden;
    text-decoration: none;
    background: linear-gradient(135deg, var(--c1), var(--c2));
    box-shadow: var(--shadow-sm);
    /* Borde de luz fino (overlay del GenreCardView iOS). */
    outline: 1px solid rgb(255 255 255 / 0.18);
    outline-offset: -1px;
    transition:
      transform var(--duration-fast) var(--ease-ios-default),
      box-shadow var(--duration-normal) var(--ease-ios-default);
  }
  .card:hover {
    transform: scale(1.02);
    box-shadow: var(--shadow-md);
  }
  .card:active {
    transform: scale(0.98);
    transition-duration: var(--duration-instant);
  }
  .card:focus-visible {
    outline: none;
    box-shadow: var(--shadow-sm), var(--focus-ring);
  }

  /* Bokeh translúcido (profundidad tipo "mesh") + brillo superior + scrim
     inferior de contraste — los hues por hash pueden salir muy claros. */
  .card::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      radial-gradient(55% 90% at 82% -20%, rgb(255 255 255 / 0.2), transparent 70%),
      radial-gradient(55% 90% at 5% 95%, var(--c2), transparent 72%),
      linear-gradient(to bottom, rgb(255 255 255 / 0.22), transparent 50%),
      linear-gradient(to top, rgb(0 0 0 / 0.25), transparent 50%);
  }

  .icon {
    position: absolute;
    top: 12px;
    right: 12px;
    color: rgb(255 255 255 / 0.3);
    filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.15));
  }

  .meta {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1.15;
    color: #fff;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.28);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .count {
    font-size: var(--text-xs);
    font-weight: 500;
    color: rgb(255 255 255 / 0.8);
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.28);
  }
</style>
