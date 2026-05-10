/**
 * BackendService — cliente del Audiorr Backend (Node.js).
 *
 * Mirrors iOS BackendService. El backend siempre está accesible (mismo
 * stack Docker, misma red), por eso no hay probe ni gate de disponibilidad.
 *
 * URL base resuelta en orden:
 *   1. **dev**: vacío → rutas relativas (Vite proxy intercepta /api/*).
 *   2. **prod**: `window.__AUDIORR_BACKEND_URL__` (runtime Docker env.js).
 *   3. **prod fallback**: `PUBLIC_BACKEND_URL` (build-time .env).
 *   4. cadena vacía si nada → asume same-origin (Docker reverse proxy).
 */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import type { z } from 'zod';

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

function resolveBaseUrl(): string {
  if (import.meta.env.DEV) return '';
  if (browser && window.__AUDIORR_BACKEND_URL__) {
    return window.__AUDIORR_BACKEND_URL__.replace(/\/+$/, '');
  }
  const fromEnv = env.PUBLIC_BACKEND_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return '';
}

class BackendServiceImpl {
  readonly baseUrl: string = resolveBaseUrl();

  /**
   * GET tipado. 404 → null (recurso no encontrado, caso normal para Canvas);
   * 5xx u otros errores tiran `BackendError`.
   *
   * `headers` permite enviar `x-navidrome-user` (algunos endpoints como
   * /api/daily-mixes y /api/smart-playlists exigen el username vía header
   * cuando difiere del configurado en el server).
   */
  async get<T>(
    path: string,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T | null> {
    const res = await this.rawFetch(path, headers);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * PUT tipado con body JSON. Usado para mutations de settings/preferences
   * (admin). 4xx → BackendError con el statusText; 5xx idem. La response
   * se parsea con el schema dado, igual que `get`.
   */
  async put<T>(
    path: string,
    body: unknown,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: 'PUT',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {})
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * POST tipado. Body opcional (algunas mutations admin no lo necesitan,
   * ej. `/api/smart-playlists/generate-all`). Si el server responde 429
   * (rate-limit/cooldown), `BackendError.status === 429` y el caller puede
   * leer el `retryAfterMs` del body si parsea.
   */
  async post<T>(
    path: string,
    body: unknown | undefined,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const init: RequestInit = {
      method: 'POST',
      credentials: 'omit',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers ?? {})
      }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(url, init);
    if (!res.ok) {
      throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * DELETE — para mutations que eliminan recursos. Devuelve el body parseado
   * con el schema dado (algunos endpoints devuelven `{ status: 'ok' }`).
   */
  async delete<T>(
    path: string,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'omit',
      ...(headers ? { headers } : {})
    });
    if (!res.ok) {
      throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * DELETE sin body en la respuesta (HTTP 204) — algunos endpoints como
   * `/api/diagnostics/transitions/:id/comment` no devuelven payload. No-op
   * silencioso si OK; tira `BackendError` si !ok.
   */
  async deleteVoid(path: string, headers?: Record<string, string>): Promise<void> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: 'DELETE',
      credentials: 'omit',
      ...(headers ? { headers } : {})
    });
    if (!res.ok) {
      throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
    }
  }

  /**
   * PATCH tipado — usado por mutations parciales (ej. ratear una
   * transición sin tocar el resto del record). Body JSON, response parseada
   * con el schema dado. Mismo error handling que put/post.
   */
  async patch<T>(
    path: string,
    body: unknown,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: 'PATCH',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {})
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
    }
    const json = await res.json();
    return schema.parse(json);
  }

  /** URL absoluta a un asset estático del backend (mp4, etc). */
  fileUrl(path: string): string {
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${clean}`;
  }

  private async rawFetch(path: string, headers?: Record<string, string>): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    return fetch(url, { credentials: 'omit', ...(headers ? { headers } : {}) });
  }
}

export const backendService = new BackendServiceImpl();
