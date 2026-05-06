/**
 * BiquadCoefficients — port verbatim de BiquadCoefficientCalculator.swift.
 *
 * Audio EQ Cookbook formulas (Robert Bristow-Johnson). Coeficientes pre-
 * normalizados: ya divididos por a0, así que el kernel del worklet no necesita
 * tocarlos. `safeNormalize` hace el divide y cae a passthrough si NaN/inf o
 * a0 demasiado chico (numérica inestable).
 */

export type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

export const PASSTHROUGH: BiquadCoefficients = {
  b0: 1,
  b1: 0,
  b2: 0,
  a1: 0,
  a2: 0
};

const PASSTHROUGH_EPS = 1e-6;
const MIN_GAIN_DB_FOR_SHELF_PEAKING = 0.01;
const MIN_A0 = 1e-10;

export function isPassthrough(c: BiquadCoefficients): boolean {
  return (
    Math.abs(c.b0 - 1) < PASSTHROUGH_EPS &&
    Math.abs(c.b1) < PASSTHROUGH_EPS &&
    Math.abs(c.b2) < PASSTHROUGH_EPS &&
    Math.abs(c.a1) < PASSTHROUGH_EPS &&
    Math.abs(c.a2) < PASSTHROUGH_EPS
  );
}

function clampFreq(freq: number, sampleRate: number): number {
  return Math.min(Math.max(freq, 20), sampleRate * 0.5 - 1);
}

function clampGain(gainDB: number): number {
  return Math.min(Math.max(gainDB, -60), 60);
}

/** Divide coeficientes raw por a0 y verifica sanidad. Devuelve passthrough
    si a0 ≤ 1e-10 o algún coeficiente termina NaN/Infinity. */
function safeNormalize(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number
): BiquadCoefficients {
  if (!Number.isFinite(a0) || Math.abs(a0) <= MIN_A0) return PASSTHROUGH;
  const out: BiquadCoefficients = {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0
  };
  if (
    !isFinite(out.b0) ||
    !isFinite(out.b1) ||
    !isFinite(out.b2) ||
    !isFinite(out.a1) ||
    !isFinite(out.a2)
  ) {
    return PASSTHROUGH;
  }
  return out;
}

export function calcLowpass(freq: number, Q: number, sampleRate: number): BiquadCoefficients {
  const f = clampFreq(freq, sampleRate);
  const q = Math.max(Q, 0.1);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const b0 = (1 - cosW0) / 2;
  const b1 = 1 - cosW0;
  const b2 = (1 - cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return safeNormalize(b0, b1, b2, a0, a1, a2);
}

export function calcHighpass(freq: number, Q: number, sampleRate: number): BiquadCoefficients {
  const f = clampFreq(freq, sampleRate);
  const q = Math.max(Q, 0.1);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  const b0 = (1 + cosW0) / 2;
  const b1 = -(1 + cosW0);
  const b2 = (1 + cosW0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  return safeNormalize(b0, b1, b2, a0, a1, a2);
}

export function calcLowShelf(
  freq: number,
  gainDB: number,
  S: number,
  sampleRate: number
): BiquadCoefficients {
  const g = clampGain(gainDB);
  if (Math.abs(g) <= MIN_GAIN_DB_FOR_SHELF_PEAKING) return PASSTHROUGH;

  const f = clampFreq(freq, sampleRate);
  const slope = Math.max(S, 0.1);
  const A = Math.pow(10, g / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const sqrtAalpha = 2 * Math.sqrt(A) * alpha;

  const b0 = A * (A + 1 - (A - 1) * cosW0 + sqrtAalpha);
  const b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
  const b2 = A * (A + 1 - (A - 1) * cosW0 - sqrtAalpha);
  const a0 = A + 1 + (A - 1) * cosW0 + sqrtAalpha;
  const a1 = -2 * (A - 1 + (A + 1) * cosW0);
  const a2 = A + 1 + (A - 1) * cosW0 - sqrtAalpha;

  return safeNormalize(b0, b1, b2, a0, a1, a2);
}

export function calcHighShelf(
  freq: number,
  gainDB: number,
  S: number,
  sampleRate: number
): BiquadCoefficients {
  const g = clampGain(gainDB);
  if (Math.abs(g) <= MIN_GAIN_DB_FOR_SHELF_PEAKING) return PASSTHROUGH;

  const f = clampFreq(freq, sampleRate);
  const slope = Math.max(S, 0.1);
  const A = Math.pow(10, g / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / 2) * Math.sqrt((A + 1 / A) * (1 / slope - 1) + 2);
  const sqrtAalpha = 2 * Math.sqrt(A) * alpha;

  const b0 = A * (A + 1 + (A - 1) * cosW0 + sqrtAalpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
  const b2 = A * (A + 1 + (A - 1) * cosW0 - sqrtAalpha);
  const a0 = A + 1 - (A - 1) * cosW0 + sqrtAalpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosW0);
  const a2 = A + 1 - (A - 1) * cosW0 - sqrtAalpha;

  return safeNormalize(b0, b1, b2, a0, a1, a2);
}

/** Peaking / parametric. `bandwidthOctaves` en octavas (no Q). */
export function calcPeaking(
  freq: number,
  gainDB: number,
  bandwidthOctaves: number,
  sampleRate: number
): BiquadCoefficients {
  const g = clampGain(gainDB);
  if (Math.abs(g) <= MIN_GAIN_DB_FOR_SHELF_PEAKING) return PASSTHROUGH;

  const f = clampFreq(freq, sampleRate);
  const bw = Math.max(bandwidthOctaves, 0.1);
  const A = Math.pow(10, g / 40);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);

  if (Math.abs(sinW0) < 1e-10) return PASSTHROUGH;

  const alpha = sinW0 * Math.sinh(((Math.LN2 / 2) * bw * w0) / sinW0);

  const b0 = 1 + alpha * A;
  const b1 = -2 * cosW0;
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha / A;

  return safeNormalize(b0, b1, b2, a0, a1, a2);
}
