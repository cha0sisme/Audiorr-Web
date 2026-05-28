/**
 * CanvasGenerationService — Auto-Generador de Canvas desde URL de YouTube.
 *
 * Endpoints (issue 2026-05-11-canvas-gen-housekeeping-panel):
 *   POST /api/canvas/generate              → 202 / 400 / 404 / 409 / 503
 *   GET  /api/canvas/generate/jobs/:id     → GenerationJob | 404
 *   GET  /api/canvas/generate/jobs         → { jobs: GenerationJob[] }
 *
 * Usa `backendService.authedFetch` (no los helpers tipados `get`/`post`)
 * porque necesitamos leer el body del 409 para distinguir `existingCanvas`
 * (modal de confirmación) de `existingJob` (info "ya hay job en curso") y
 * propagar mensajes 400/404/503 al usuario. authedFetch aporta el Bearer +
 * el refresh-on-401; el parseo de errores sigue siendo manual aquí.
 */

import { backendService } from '$services/BackendService.svelte';
import { credentials } from '$stores/credentials.svelte';
import {
  CanvasEntrySchema,
  CanvasGenerateEnqueuedSchema,
  CanvasGenerationJobSchema,
  CanvasGenerationJobListSchema,
  type CanvasEntry,
  type CanvasGenerateEnqueued,
  type CanvasGenerateMode,
  type CanvasGenerationJob,
  type CanvasGenerationJobList
} from '$types/backend';

export interface CanvasGenerateInput {
  songId: string;
  youtubeUrl: string;
  mode?: CanvasGenerateMode;
  fragments?: number;
  fragmentSec?: number;
  durationSec?: number;
  force?: boolean;
}

/** Error específico del flujo de generación. Lleva `kind` para que el
    componente pueda hacer pattern matching limpio:
      - 'existing-canvas': 409, ya hay canvas → modal de confirmación.
      - 'existing-job': 409, ya hay job en cola/proceso → info.
      - 'bad-request': 400.
      - 'not-found-song': 404 songId.
      - 'no-credentials': 503.
      - 'server': otros 5xx / network. */
export type CanvasGenerateErrorKind =
  | 'existing-canvas'
  | 'existing-job'
  | 'bad-request'
  | 'not-found-song'
  | 'no-credentials'
  | 'server';

export class CanvasGenerateError extends Error {
  constructor(
    public readonly kind: CanvasGenerateErrorKind,
    message: string,
    public readonly existingCanvas?: CanvasEntry,
    public readonly existingJob?: CanvasGenerationJob
  ) {
    super(message);
    this.name = 'CanvasGenerateError';
  }
}

const YOUTUBE_HOST_RX = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;

/** Validación cliente best-effort. El backend valida en serio. */
export function isLikelyYoutubeUrl(url: string): boolean {
  return YOUTUBE_HOST_RX.test(url.trim());
}

/** Construye headers comunes. Si tenemos username configurado en el
    store de credentials, lo enviamos como `x-navidrome-user` para que el
    backend resuelva la canción con las creds del usuario correcto (mismo
    patrón que daily-mixes / smart-playlists). Sin este header, el backend
    cae a creds globales y puede dar 404 sobre canciones que SÍ existen
    en la biblioteca del user actual. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const user = credentials.current?.username;
  return {
    ...(user ? { 'x-navidrome-user': user } : {}),
    ...(extra ?? {})
  };
}

/** Encola un job. 202 → CanvasGenerateEnqueued; el resto se traduce a
    `CanvasGenerateError` con `kind` y, si aplica, el `existingCanvas` /
    `existingJob` parseados del body. */
export async function enqueueCanvasJob(
  input: CanvasGenerateInput
): Promise<CanvasGenerateEnqueued> {
  let res: Response;
  try {
    res = await backendService.authedFetch('/api/canvas/generate', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(input)
    });
  } catch (e) {
    throw new CanvasGenerateError(
      'server',
      e instanceof Error ? e.message : 'Error de red'
    );
  }

  if (res.status === 202) {
    const json = await res.json();
    return CanvasGenerateEnqueuedSchema.parse(json);
  }

  // Body de error — el backend siempre devuelve JSON con `error` y a veces
  // `existingCanvas` / `existingJob` / `hint`.
  let body: { error?: string; existingCanvas?: unknown; existingJob?: unknown; hint?: string } = {};
  try {
    body = await res.json();
  } catch {
    // body no JSON — usamos statusText.
  }
  const msg = body.error ?? `Backend ${res.status}: ${res.statusText}`;

  if (res.status === 400) {
    throw new CanvasGenerateError('bad-request', msg);
  }
  if (res.status === 404) {
    throw new CanvasGenerateError('not-found-song', msg);
  }
  if (res.status === 503) {
    throw new CanvasGenerateError('no-credentials', msg);
  }
  if (res.status === 409) {
    if (body.existingCanvas !== undefined) {
      const canvas = CanvasEntrySchema.safeParse(body.existingCanvas);
      throw new CanvasGenerateError(
        'existing-canvas',
        msg,
        canvas.success ? canvas.data : undefined,
        undefined
      );
    }
    if (body.existingJob !== undefined) {
      const job = CanvasGenerationJobSchema.safeParse(body.existingJob);
      throw new CanvasGenerateError(
        'existing-job',
        msg,
        undefined,
        job.success ? job.data : undefined
      );
    }
    throw new CanvasGenerateError('server', msg);
  }
  throw new CanvasGenerateError('server', msg);
}

/** Estado de un job. 404 → null. Otros errores tiran `CanvasGenerateError`
    con `kind: 'server'`. */
export async function getCanvasJob(jobId: string): Promise<CanvasGenerationJob | null> {
  let res: Response;
  try {
    res = await backendService.authedFetch(
      `/api/canvas/generate/jobs/${encodeURIComponent(jobId)}`,
      { headers: authHeaders() }
    );
  } catch (e) {
    throw new CanvasGenerateError(
      'server',
      e instanceof Error ? e.message : 'Error de red'
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new CanvasGenerateError('server', `Backend ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  return CanvasGenerationJobSchema.parse(json);
}

/** Lista jobs en memoria del backend. Útil para histórico reciente. */
export async function listCanvasJobs(): Promise<CanvasGenerationJobList> {
  let res: Response;
  try {
    res = await backendService.authedFetch('/api/canvas/generate/jobs', {
      headers: authHeaders()
    });
  } catch (e) {
    throw new CanvasGenerateError(
      'server',
      e instanceof Error ? e.message : 'Error de red'
    );
  }
  if (!res.ok) {
    throw new CanvasGenerateError('server', `Backend ${res.status}: ${res.statusText}`);
  }
  const json = await res.json();
  return CanvasGenerationJobListSchema.parse(json);
}
