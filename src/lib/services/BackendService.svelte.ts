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
