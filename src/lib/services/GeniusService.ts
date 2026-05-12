/**
 * GeniusService — anotaciones de Genius para una canción.
 *
 *   GET /api/genius/annotations?title=<X>&artist=<Y>
 *   → { found, songId?, geniusUrl?, annotations: GeniusAnnotation[] }
 *
 * División de responsabilidades (decidida en backend/src/routes/genius.routes.ts):
 *   - Backend hace search Genius → referents → ranking por votos top 8.
 *     NO matchea contra LRCLib ni calcula `durationMs` (los referents
 *     no llegan con tiempos; matchear ahí obligaría a re-fetch a LRCLib
 *     que el frontend YA tiene en caché vía LyricsService).
 *   - Frontend matchea cada `fragment` contra las líneas LRCLib synced
 *     ya cargadas y computa `durationMs` por número de palabras del body.
 *
 * Cache LRU 150 entries de la respuesta cruda del backend; el matching
 * client-side depende de las lyrics, así que se hace cada vez que el
 * componente las tenga listas (es barato).
 */

import { browser } from '$app/environment';
import { z } from 'zod';
import { backendService } from '$services/BackendService.svelte';
import type { LyricLine } from '$services/LyricsService.svelte';

/** Shape EXACTO devuelto por el backend (genius.routes.ts → geniusClient.ts).
    No incluye matchedTime ni durationMs — eso lo añade el matcher local. */
export const GeniusAnnotationSchema = z.object({
  id: z.string(),
  fragment: z.string(),
  body: z.string(),
  authorName: z.string().optional(),
  verified: z.boolean().optional(),
  votes: z.number().optional()
});

/** El backend añade `cached`/`reason` además de los campos documentados;
    los aceptamos con passthrough para no romper si cambian. */
export const GeniusResponseSchema = z
  .object({
    found: z.boolean(),
    songId: z.number().optional(),
    geniusUrl: z.string().optional(),
    annotations: z.array(GeniusAnnotationSchema)
  })
  .passthrough();

export type GeniusAnnotation = z.infer<typeof GeniusAnnotationSchema>;
export type GeniusResponse = z.infer<typeof GeniusResponseSchema>;

/** Annotation con metadata de tiempo añadida por el matcher local.
    matchedTime !== null garantiza renderizable en el canvas. */
export type MatchedGeniusAnnotation = GeniusAnnotation & {
  matchedTime: number;
  durationMs: number;
};

const EMPTY_RESPONSE: GeniusResponse = { found: false, annotations: [] };

const CACHE_CAP = 150;
const cache = new Map<string, GeniusResponse>();
const pending = new Map<string, Promise<GeniusResponse>>();

function cacheKey(title: string, artist: string): string {
  return `${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
}

export async function fetchGeniusAnnotations(
  title: string,
  artist: string
): Promise<GeniusResponse> {
  if (!browser || !title || !artist) return EMPTY_RESPONSE;

  const key = cacheKey(title, artist);

  if (cache.has(key)) {
    const value = cache.get(key) ?? EMPTY_RESPONSE;
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  const existing = pending.get(key);
  if (existing) return existing;

  const task = (async () => {
    try {
      const path = `/api/genius/annotations?title=${encodeURIComponent(
        title
      )}&artist=${encodeURIComponent(artist)}`;
      const result = await backendService.get(path, GeniusResponseSchema);
      return result ?? EMPTY_RESPONSE;
    } catch {
      return EMPTY_RESPONSE;
    }
  })();
  pending.set(key, task);
  const result = await task;
  pending.delete(key);

  cache.set(key, result);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}

export function clearGeniusCache(): void {
  cache.clear();
  pending.clear();
}

// ──────────────────────────────────────────────────────────────────────
// Matching client-side: annotation.fragment ↔ línea LRCLib synced
// ──────────────────────────────────────────────────────────────────────

/** Normaliza para comparación: minúsculas, sin diacríticos, sin
    puntuación, espacios colapsados. La normalización aquí es agresiva
    porque el fragment de Genius suele venir con tipografía especial
    (smart quotes, guiones em, ad-libs entre paréntesis) que la letra
    LRCLib no incluye. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ').filter((t) => t.length > 0) : [];
}

/** Jaccard sobre conjunto de tokens. Devuelve 0..1.
    Conservador: empty ↔ algo = 0. */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const uni = setA.size + setB.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/** durationMs por palabras del body. ~280ms/palabra ≈ 215 wpm (lectura
    cómoda). Acotado a [6000, 18000]ms para que ni un body de una
    palabra se vaya en 280ms, ni uno de 200 palabras monopolice el
    canvas durante un minuto. Mismas constantes que el comentario
    original del fetch (max 18000, min 6000). */
function computeDurationMs(body: string): number {
  const words = body.trim().split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(6000, Math.min(18000, words * 280));
}

/** Score para elegir la "mejor" anotación de un cluster denso. Verified
    cuenta mucho (la editorial de Genius la ha vetted); votes y autor son
    señales débiles pero útiles para desempate. */
function scoreAnnotation(a: MatchedGeniusAnnotation): number {
  let s = 0;
  if (a.verified) s += 1000;
  if (typeof a.votes === 'number') s += a.votes;
  if (a.authorName) s += 10;
  return s;
}

/** Tiempo mínimo (s) que una anotación debe poder estar visible antes de
    ser desplazada por la siguiente. Si dentro de esta ventana caen 3
    anotaciones, mostrar las 3 las haría parpadear con menos de 2s cada
    una — el usuario no puede leer. Agrupamos el cluster en una sola
    elección (la "mejor" por score) y descartamos el resto. */
const MIN_GAP_SEC = 6;

/** Matchea cada annotation a la línea LRCLib más similar a su `fragment`.
 *  - Solo considera líneas con `time >= 0` (synced).
 *  - Usa similitud Jaccard sobre tokens; aplica boost si una línea
 *    está literalmente contenida en el fragment (caso muy común: el
 *    fragment es la línea + un par de palabras adyacentes).
 *  - Threshold mínimo 0.35 para evitar matches espurios.
 *  - Devuelve las annotations ordenadas por `matchedTime` ascendente,
 *    ya filtradas: las que no superan el threshold se descartan.
 *  - Si 2+ anotaciones caen dentro de MIN_GAP_SEC seg (cluster denso),
 *    se queda solo la de mejor score — evita que tres curiosidades
 *    seguidas duren ~1s cada una sin tiempo para leerlas.
 */
export function matchAnnotationsToLyrics(
  annotations: GeniusAnnotation[],
  lines: LyricLine[]
): MatchedGeniusAnnotation[] {
  const syncedLines = lines.filter((l) => l.time >= 0);
  if (syncedLines.length === 0 || annotations.length === 0) return [];

  const lineTokens = syncedLines.map((l) => ({
    line: l,
    norm: normalize(l.text),
    toks: tokens(l.text)
  }));

  const matched: MatchedGeniusAnnotation[] = [];
  for (const ann of annotations) {
    const fragNorm = normalize(ann.fragment);
    if (!fragNorm) continue;
    const fragToks = tokens(ann.fragment);

    let bestScore = 0;
    let bestTime: number | null = null;

    for (const lt of lineTokens) {
      if (!lt.norm) continue;
      let score = jaccard(fragToks, lt.toks);
      // Boost: substring containment en ambas direcciones es señal fuerte.
      if (fragNorm.includes(lt.norm) || lt.norm.includes(fragNorm)) {
        score = Math.max(score, 0.85);
      }
      if (score > bestScore) {
        bestScore = score;
        bestTime = lt.line.time;
      }
    }

    if (bestScore >= 0.35 && bestTime !== null) {
      matched.push({
        ...ann,
        matchedTime: bestTime,
        durationMs: computeDurationMs(ann.body)
      });
    }
  }

  matched.sort((a, b) => a.matchedTime - b.matchedTime);

  // Cluster collapse: si la siguiente anotación arranca menos de
  // MIN_GAP_SEC seg después de la primera del cluster, todas van al
  // mismo grupo y solo se queda la mejor por score.
  const out: MatchedGeniusAnnotation[] = [];
  let cluster: MatchedGeniusAnnotation[] = [];
  const flush = () => {
    if (cluster.length === 0) return;
    let best = cluster[0]!;
    let bestScore = scoreAnnotation(best);
    for (let i = 1; i < cluster.length; i++) {
      const c = cluster[i]!;
      const s = scoreAnnotation(c);
      if (s > bestScore) {
        best = c;
        bestScore = s;
      }
    }
    out.push(best);
    cluster = [];
  };
  for (const ann of matched) {
    if (cluster.length === 0 || ann.matchedTime - cluster[0]!.matchedTime < MIN_GAP_SEC) {
      cluster.push(ann);
    } else {
      flush();
      cluster.push(ann);
    }
  }
  flush();
  return out;
}
