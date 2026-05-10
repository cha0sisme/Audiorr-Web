/**
 * transition-type-tone — paleta OKLCH para los 11 tipos de transición.
 *
 * Mirror del mapping de iOS `TransitionDiagnosticsView.swift:937-952`:
 *   CROSSFADE blue · EQ_MIX purple · CUT red · NATURAL_BLEND green ·
 *   BEAT_MATCH_BLEND cyan · CUT_A_FADE_IN_B orange · FADE_OUT_A_CUT_B yellow ·
 *   STEM_MIX mint · DROP_MIX pink · CLEAN_HANDOFF gray · VINYL_STOP indigo.
 *
 * Defino los colores en OKLCH con L medio (~0.68) y chroma controlado para
 * que funcionen sobre fondo glass dark Y light sin necesidad de override
 * por theme. La función devuelve el color base; el componente lo combina
 * con `color-mix` para producir background sutil + border + texto sólido,
 * consistente con el resto del design system.
 */

export type TransitionTypeTone = {
  /** Color OKLCH listo para usar en `color:` o como base de `color-mix`. */
  color: string;
  /** Etiqueta humana corta — útil si en algún momento el badge muestra
      label custom en vez del raw type. Por ahora coincide con el type
      Subsonic, pero abstrae la decisión. */
  label: string;
};

const PALETTE: Record<string, TransitionTypeTone> = {
  CROSSFADE:        { color: 'oklch(0.66 0.16 245)', label: 'CROSSFADE' },         // blue
  EQ_MIX:           { color: 'oklch(0.66 0.18 305)', label: 'EQ_MIX' },            // purple
  CUT:              { color: 'oklch(0.68 0.22 25)',  label: 'CUT' },               // red
  NATURAL_BLEND:    { color: 'oklch(0.7 0.16 145)',  label: 'NATURAL_BLEND' },     // green
  BEAT_MATCH_BLEND: { color: 'oklch(0.74 0.13 215)', label: 'BEAT_MATCH_BLEND' },  // cyan
  CUT_A_FADE_IN_B:  { color: 'oklch(0.74 0.16 55)',  label: 'CUT_A_FADE_IN_B' },   // orange
  FADE_OUT_A_CUT_B: { color: 'oklch(0.85 0.15 95)',  label: 'FADE_OUT_A_CUT_B' },  // yellow
  STEM_MIX:         { color: 'oklch(0.74 0.14 165)', label: 'STEM_MIX' },          // mint
  DROP_MIX:         { color: 'oklch(0.7 0.18 12)',   label: 'DROP_MIX' },          // pink
  CLEAN_HANDOFF:    { color: 'oklch(0.65 0.02 250)', label: 'CLEAN_HANDOFF' },     // gray
  VINYL_STOP:       { color: 'oklch(0.6 0.16 275)',  label: 'VINYL_STOP' }         // indigo
};

const FALLBACK: TransitionTypeTone = {
  color: 'oklch(0.65 0.02 250)',
  label: 'OTRO'
};

export function transitionTypeTone(type: string): TransitionTypeTone {
  return PALETTE[type] ?? FALLBACK;
}
