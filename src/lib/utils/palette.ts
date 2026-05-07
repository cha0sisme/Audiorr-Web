/**
 * Extracción de color dominante del album/playlist cover.
 *
 * Usa node-vibrant para extraer swatches y culori para normalizar a OKLCH —
 * mantenemos hue+chroma como primitivos y los componentes computan la L
 * según tema (dark/light) para garantizar contraste con el background.
 *
 * Falla silenciosamente (devuelve null) si:
 *   - La imagen no carga (404, network)
 *   - CORS bloquea el canvas read (Navidrome necesita ND_CORS=*)
 *   - No hay swatches detectables
 *
 * En esos casos el caller cae al fallback (hue por hash del nombre).
 *
 * IMPLEMENTACIÓN: Vibrant + culori se importan dinámicamente para sacarlos
 * del bundle inicial (~135 KB minified gzipped entre los dos). Solo se
 * cargan cuando el usuario navega a un detail page (album/artist/playlist),
 * que es donde extractPalette se llama.
 */

export type CoverPalette = {
  /** Hue en grados (0-360). */
  hue: number;
  /** Chroma OKLCH clampeado a 0.08-0.18 — evita colores washed out o cantosos. */
  chroma: number;
};

const CHROMA_MIN = 0.08;
const CHROMA_MAX = 0.18;

export async function extractPalette(coverUrl: string): Promise<CoverPalette | null> {
  try {
    const [{ Vibrant }, { converter }] = await Promise.all([
      import('node-vibrant/browser'),
      import('culori')
    ]);
    const toOklch = converter('oklch');
    const palette = await Vibrant.from(coverUrl).getPalette();

    // Preferir Vibrant; caer a DarkVibrant, LightVibrant, Muted en orden.
    // Vibrant suele ser el "color de marca" del cover.
    const swatch =
      palette.Vibrant ??
      palette.DarkVibrant ??
      palette.LightVibrant ??
      palette.Muted ??
      palette.DarkMuted;

    if (!swatch) return null;

    const oklch = toOklch(swatch.hex);
    if (!oklch || oklch.h === undefined) return null;

    return {
      hue: oklch.h,
      chroma: Math.max(CHROMA_MIN, Math.min(CHROMA_MAX, oklch.c ?? CHROMA_MIN))
    };
  } catch {
    // CORS, network, o cover roto — caller usa fallback
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Helpers para que los componentes generen colores theme-aware desde el      */
/* hue/chroma extraídos. La L queda controlada para garantizar contraste.    */

/** Color del play button hero. Theme-aware lightness. */
export function playButtonBg(palette: CoverPalette, isDark: boolean): string {
  // L=0.55 en dark, L=0.45 en light → blanco siempre lee bien encima
  const L = isDark ? 0.55 : 0.45;
  return `oklch(${L} ${palette.chroma} ${palette.hue})`;
}

/** Color top del gradient hero. Siempre dark-ish (hero usa text blanco). */
export function heroGradientTop(palette: CoverPalette): string {
  return `oklch(0.35 ${palette.chroma} ${palette.hue})`;
}

/** Color medio del gradient hero (fade hacia bg-canvas). */
export function heroGradientMid(palette: CoverPalette): string {
  return `oklch(0.22 ${palette.chroma * 0.66} ${palette.hue} / 0.5)`;
}

/* ------------------------------------------------------------------------- */
/* Recipe iOS-style para hero de AlbumDetail / ArtistDetail.                  */
/* iOS apila tres capas: blurred art (back) + 140deg gradient primary→        */
/* secondary + scrim vertical 0.38/0.22/0.06. Acá las exponemos como          */
/* helpers separados — el componente las componene en CSS via background:     */
/* multi-layer.                                                               */

/** Color "primary" iOS — primary @ 0.82 alpha en top-trailing. */
export function heroPaletteOklchPrimary(palette: CoverPalette, alpha = 0.82): string {
  return `oklch(0.45 ${palette.chroma} ${palette.hue} / ${alpha})`;
}

/** Color "secondary" iOS — derivado del hue + 25deg shift, secondary @ 0.76
    alpha en bottom-leading. iOS lo computa como una variante del primary;
    acá hacemos el mismo shift de hue para crear contraste sin perder cohesión. */
export function heroPaletteOklchSecondary(palette: CoverPalette, alpha = 0.76): string {
  const shifted = (palette.hue + 25) % 360;
  return `oklch(0.32 ${palette.chroma * 0.85} ${shifted} / ${alpha})`;
}

/**
 * Background del hero al estilo iOS: gradiente diagonal primary→secondary +
 * scrim oscuro vertical para legibilidad del texto + fade-out final hacia
 * bg-canvas en el último 35% (smooth merge con el contenido inferior).
 *
 * Devuelve un string `background:` multi-layer listo para usar.
 */
export function heroBackgroundLayered(palette: CoverPalette): string {
  const p = heroPaletteOklchPrimary(palette);
  const s = heroPaletteOklchSecondary(palette);
  return [
    // Fade final hacia bg-canvas en el último 35% — sin esto, el corte hero/
    // contenido se siente abrupto.
    `linear-gradient(to bottom, transparent 0%, transparent 65%, var(--bg-canvas) 100%)`,
    // Scrim vertical para contraste del texto blanco.
    `linear-gradient(to bottom, rgb(0 0 0 / 0.38) 0%, rgb(0 0 0 / 0.22) 50%, rgb(0 0 0 / 0.06) 100%)`,
    // Gradient diagonal con el color del cover.
    `linear-gradient(140deg, ${p} 0%, ${s} 100%)`
  ].join(', ');
}

/** Para cuando NO hay imagen: hero como flat fill del primary del palette
    (el iOS llama a esto "isSolid" — covers monocromáticos). */
export function heroBackgroundFlat(palette: CoverPalette): string {
  // L=0.42 da bg dark-ish con buen contraste para texto blanco; chroma full
  // del palette para que el color del álbum siga siendo protagonista.
  return [
    `linear-gradient(to bottom, transparent 0%, transparent 65%, var(--bg-canvas) 100%)`,
    `oklch(0.42 ${palette.chroma} ${palette.hue})`
  ].join(', ');
}

/**
 * Paleta neutral para el hero MIENTRAS se extrae la real con Vibrant.
 * Misma estructura que CoverPalette pero chroma ≈ 0 → renderiza neutral
 * dark (sin hue perceptible). Cuando llega la real, el cambio de chroma
 * 0.02 → 0.10-0.18 se ve como "el color aparece" en lugar de "color
 * erróneo → color correcto".
 *
 * Lo dejamos como objeto exportado (no función) para garantizar referencia
 * estable — los $derived que lo usan no re-disparan por identidad nueva.
 */
export const HERO_PLACEHOLDER_PALETTE: CoverPalette = Object.freeze({
  hue: 220,
  chroma: 0.02
});
