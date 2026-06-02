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
 *
 * Auth Bearer: TODA petición pasa por `authedFetch`, que adjunta
 * `Authorization: Bearer <sessionToken>` cuando hay sesión y, ante un 401,
 * intenta UNA rotación vía `/api/auth/refresh` (Promise compartida para que
 * múltiples requests concurrentes no disparen N refreshes). Si el refresh
 * falla, limpia la sesión y redirige a /login. Contrato: especificación de
 * autenticación del Audiorr Backend (/api/auth/login|refresh|logout).
 */

import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';
import { goto } from '$app/navigation';
import type { z } from 'zod';
import { authToken } from '$stores/auth-token.svelte';

export class BackendError extends Error {
  /** Segundos a esperar antes de reintentar, leído del header `Retry-After`
      en respuestas 429. Undefined si no aplica. */
  retryAfter?: number;
  constructor(
    public status: number,
    message: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'BackendError';
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
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
  /** Getter (no field assignment): `resolveBaseUrl()` se evalúa cada
      vez que se accede, NO en el module-init. Crítico para
      adapter-node SSR: la singleton `backendService` se instancia
      durante el render server-side donde `browser` es `false` →
      `window.__AUDIORR_BACKEND_URL__` no existe y el campo readonly
      quedaba congelado en cadena vacía para siempre, mandando todas
      las llamadas /api/* al SvelteKit server (404) en vez de al
      backend Audiorr real. */
  get baseUrl(): string {
    return resolveBaseUrl();
  }

  /** Refresh en vuelo compartido. Si dos requests reciben 401 a la vez,
      ambas esperan la MISMA promesa en lugar de rotar el token dos veces
      (la segunda rotación invalidaría el token recién emitido). */
  private refreshInFlight: Promise<boolean> | null = null;

  /**
   * GET tipado. 404 → null (recurso no encontrado, caso normal para Canvas);
   * 5xx u otros errores tiran `BackendError`.
   *
   * `headers` permite enviar `x-navidrome-user` (algunos endpoints como
   * /api/daily-mixes y /api/smart-playlists exigen el username vía header —
   * el backend aún no lo deriva del Bearer, así que coexisten).
   */
  async get<T>(
    path: string,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T | null> {
    const res = await this.authedFetch(path, { method: 'GET', ...(headers ? { headers } : {}) });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res);
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * PUT tipado con body JSON. Usado para mutations de settings/preferences
   * (admin). La response se parsea con el schema dado, igual que `get`.
   */
  async put<T>(
    path: string,
    body: unknown,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    const res = await this.authedFetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await this.toError(res);
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * POST tipado. Body opcional (algunas mutations admin no lo necesitan,
   * ej. `/api/smart-playlists/generate-all`). Si el server responde 429,
   * `BackendError.status === 429` y `retryAfter` trae los segundos del
   * header `Retry-After`.
   */
  async post<T>(
    path: string,
    body: unknown | undefined,
    schema: z.ZodSchema<T>,
    headers?: Record<string, string>
  ): Promise<T> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers ?? {})
      }
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.authedFetch(path, init);
    if (!res.ok) throw await this.toError(res);
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
    const res = await this.authedFetch(path, {
      method: 'DELETE',
      ...(headers ? { headers } : {})
    });
    if (!res.ok) throw await this.toError(res);
    const json = await res.json();
    return schema.parse(json);
  }

  /**
   * DELETE sin body en la respuesta (HTTP 204) — algunos endpoints como
   * `/api/diagnostics/transitions/:id/comment` no devuelven payload. No-op
   * silencioso si OK; tira `BackendError` si !ok.
   */
  async deleteVoid(path: string, headers?: Record<string, string>): Promise<void> {
    const res = await this.authedFetch(path, {
      method: 'DELETE',
      ...(headers ? { headers } : {})
    });
    if (!res.ok) throw await this.toError(res);
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
    const res = await this.authedFetch(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw await this.toError(res);
    const json = await res.json();
    return schema.parse(json);
  }

  /** URL absoluta a un asset estático del backend (mp4, etc). */
  fileUrl(path: string): string {
    const clean = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${clean}`;
  }

  /**
   * Fetch de bajo nivel con Bearer + refresh-on-401. Público para los pocos
   * call sites que necesitan parsear el body de error a mano (ej.
   * CanvasGenerationService, que lee `kind`/`existingJob` del 4xx). Devuelve
   * la `Response` cruda — 403/429/503 NO se tocan aquí, los traduce el caller
   * según su contexto (login vs admin vs cooldown). Solo el 401 dispara
   * rotación de sesión.
   */
  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, this.withAuth(init));
    if (res.status !== 401) return res;

    // 401 → intentar rotar sesión UNA vez y reintentar la request original.
    const session = authToken.current;
    if (!session?.refreshToken) {
      this.failSession();
      return res;
    }
    const refreshed = await this.refreshSession();
    if (!refreshed) {
      this.failSession();
      return res;
    }
    // Reintento con el token rotado. Si AÚN devuelve 401, la sesión está
    // irrecuperable (token nuevo rechazado) → limpiar y mandar a /login en
    // vez de propagar un 401 silencioso al caller.
    const retry = await fetch(url, this.withAuth(init));
    if (retry.status === 401) this.failSession();
    return retry;
  }

  /** Clona el init añadiendo `Authorization: Bearer` (si hay sesión),
      `X-Client-Platform: web` (para que el backend clasifique las sesiones de
      la web como `'web'` limpio en vez de inferirlas por parse-UA) y forzando
      `credentials: 'omit'` — la sesión va por header, no por cookie. */
  private withAuth(init: RequestInit): RequestInit {
    const token = authToken.current?.sessionToken;
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Client-Platform', 'web');
    return { ...init, credentials: 'omit', headers };
  }

  /** Rota el par de tokens vía `/api/auth/refresh`. Comparte la promesa en
      vuelo para evitar rotaciones concurrentes. Devuelve true si la sesión
      quedó renovada. */
  private refreshSession(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const refreshToken = authToken.current?.refreshToken;
    if (!refreshToken) return Promise.resolve(false);

    this.refreshInFlight = (async () => {
      try {
        const url = `${this.baseUrl}/api/auth/refresh`;
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (typeof data?.token !== 'string' || typeof data?.refreshToken !== 'string') {
          return false;
        }
        authToken.update({
          sessionToken: data.token,
          refreshToken: data.refreshToken,
          ...(typeof data.isAdmin === 'boolean' ? { isAdmin: data.isAdmin } : {}),
          ...(typeof data.expiresIn === 'number'
            ? { expiresAt: Date.now() + data.expiresIn * 1000 }
            : {})
        });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  /** Sesión irrecuperable: limpia el store y manda a /login (solo browser). */
  private failSession(): void {
    authToken.clear();
    if (browser) void goto('/login', { replaceState: true });
  }

  /** Traduce una Response no-ok a BackendError, capturando `Retry-After` en
      el caso 429 para que la UI pueda mostrar el contador. */
  private async toError(res: Response): Promise<BackendError> {
    if (res.status === 429) {
      const header = res.headers.get('Retry-After');
      const seconds = header ? Number.parseInt(header, 10) : NaN;
      return new BackendError(
        429,
        `Backend 429: ${res.statusText}`,
        Number.isFinite(seconds) ? seconds : undefined
      );
    }
    return new BackendError(res.status, `Backend ${res.status}: ${res.statusText}`);
  }
}

export const backendService = new BackendServiceImpl();
