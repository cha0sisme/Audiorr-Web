/**
 * dj-helpers — funciones puras compartidas por SmartMix v4.0 y (futuro)
 * DJMixingService. Este módulo es deliberadamente pequeño: solo lo que
 * cualquiera de los dos necesita. Cuando se porte el DJMixingService entero
 * (transitions, crossfade, etc) reusará estas mismas helpers.
 *
 * Mirror EXACTO de:
 *   - DJMixingService.harmonicBPM (Swift line 3567)
 *   - DJMixingService.HarmonicCompatibility / HarmonicPenalty / harmonicPenalty
 *     (Swift line 3582-3631)
 *   - SmartMixManager.keyToCamelot / camelotKey (Swift line 731-743)
 *
 * No tocar sin sincronizar con el iOS canónico — son las mismas curvas
 * (pesos, distancias Camelot, ratios half/double-time) usadas en producción.
 */

// ============================================================================
// Camelot Wheel — mapping nota musical → notación Camelot
// ============================================================================

/** Mirror exacto del `keyToCamelot` Swift en SmartMixManager.swift:731. */
export const KEY_TO_CAMELOT: Record<string, string> = {
  // Major (B-side)
  B: '1B',  'F#': '2B',  'C#': '3B',  'G#': '4B',  'D#': '5B',  'A#': '6B',
  F: '7B',  C:    '8B',  G:    '9B',  D:    '10B', A:    '11B', E:    '12B',
  // Minor (A-side)
  'G#m': '1A',  'D#m': '2A',  'A#m': '3A',  Fm: '4A',  Cm: '5A',  Gm: '6A',
  Dm:    '7A',  Am:    '8A',  Em:    '9A',  Bm: '10A', 'F#m': '11A', 'C#m': '12A',
  // Equivalencias enarmónicas frecuentes
  Gb:  '2B',  Db:  '3B',  Ab:  '4B',  Eb:  '5B',  Bb:  '6B',
  Ebm: '2A',  Bbm: '3A'
};

/** Convierte una key musical (ej. "C#m") a notación Camelot (ej. "12A").
 *  Devuelve `undefined` si la key es null/undefined o no está en el map. */
export function camelotKey(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return KEY_TO_CAMELOT[key];
}

// ============================================================================
// Harmonic compatibility (Camelot Wheel distance)
// ============================================================================

export enum HarmonicCompatibility {
  Compatible = 0,
  Acceptable = 1,
  Tense = 2,
  Clash = 3
}

export type HarmonicPenalty = {
  distance: number;
  compatibility: HarmonicCompatibility;
  /** Helper para callers — equivalente al `var isClash` Swift. */
  isClash: boolean;
};

const CAMELOT_PATTERN = /^(\d+)([AB])$/i;

/**
 * Calcula la penalización armónica entre dos keys Camelot.
 * Mirror exacto de DJMixingService.harmonicPenalty.
 *
 * Distancia:
 *   - 0..1 → compatible (mismo número, o ±1 número, mismo letter)
 *   - 2    → acceptable si solo cambia número, tense si cambia número + letter
 *   - 3    → tense
 *   - 4+   → clash
 *
 * Si alguna key es null/undefined o no se reconoce: devuelve compatible
 * (no penalizar lo que no podemos evaluar — mismo comportamiento que iOS).
 */
export function harmonicPenalty(
  keyA: string | null | undefined,
  keyB: string | null | undefined
): HarmonicPenalty {
  if (!keyA || !keyB) {
    return { distance: 0, compatibility: HarmonicCompatibility.Compatible, isClash: false };
  }

  const matchA = keyA.match(CAMELOT_PATTERN);
  const matchB = keyB.match(CAMELOT_PATTERN);
  if (!matchA || !matchB) {
    return { distance: 0, compatibility: HarmonicCompatibility.Compatible, isClash: false };
  }

  const numA = Number.parseInt(matchA[1]!, 10);
  const numB = Number.parseInt(matchB[1]!, 10);
  const letterA = matchA[2]!.toUpperCase();
  const letterB = matchB[2]!.toUpperCase();

  // Camelot wheel es circular 1-12. Distancia mínima entre dos posiciones.
  const diffNum = Math.min(Math.abs(numA - numB), 12 - Math.abs(numA - numB));
  const diffLetter = letterA !== letterB ? 1 : 0;
  const totalDistance = diffNum + diffLetter;

  let compatibility: HarmonicCompatibility;
  if (totalDistance <= 1) {
    compatibility = HarmonicCompatibility.Compatible;
  } else if (totalDistance === 2) {
    compatibility = diffLetter === 1 ? HarmonicCompatibility.Tense : HarmonicCompatibility.Acceptable;
  } else if (totalDistance === 3) {
    compatibility = HarmonicCompatibility.Tense;
  } else {
    compatibility = HarmonicCompatibility.Clash;
  }

  const isClash =
    compatibility === HarmonicCompatibility.Tense ||
    compatibility === HarmonicCompatibility.Clash;

  return { distance: totalDistance, compatibility, isClash };
}

// ============================================================================
// Harmonic BPM — half/double-time resolution
// ============================================================================

/**
 * Devuelve el BPM "armónico" de B respecto a A. Mirror exacto de
 * DJMixingService.harmonicBPM:
 *   - Solo half-time (0.5x) y double-time (2x) son musicalmente válidos para
 *     beat matching. Ratios 3:2 (ej. 80→120) crean falsos compatibles que
 *     requieren time-stretch >10% y suenan terrible.
 *   - Si el ajuste acerca a A más que el original B, devolvemos el ajustado.
 */
export function harmonicBPM(bpmA: number, bpmB: number): number {
  if (bpmA <= 0 || bpmB <= 0) return bpmB;
  const ratios = [0.5, 1.0, 2.0];
  const bestRatio = ratios.reduce((best, r) =>
    Math.abs(bpmB * r - bpmA) < Math.abs(bpmB * best - bpmA) ? r : best
  , 1.0);
  const adjusted = bpmB * bestRatio;
  return Math.abs(adjusted - bpmA) < Math.abs(bpmB - bpmA) ? adjusted : bpmB;
}
