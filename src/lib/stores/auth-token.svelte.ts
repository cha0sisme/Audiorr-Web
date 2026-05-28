/**
 * AuthTokenStore — sesión Bearer del Audiorr Backend.
 *
 * El backend emite un par sessionToken+refreshToken tras validar las
 * credenciales Subsonic contra Navidrome (`POST /api/auth/login`). Este
 * store lo persiste para que `BackendService` lo adjunte como
 * `Authorization: Bearer` en cada llamada y pueda rotarlo en un 401.
 *
 * Persistencia: localStorage (plain), mismo patrón que credentials.svelte.ts.
 * El sessionToken es opaco y de vida corta; el riesgo de XSS es aceptable
 * para uso doméstico con Cloudflare Access OAuth delante. Carga sincrónica
 * al boot (cliente-side: SSR no tiene localStorage, queda null hasta
 * hidratar).
 *
 * Mirror conceptual del manejo de sesión Bearer del cliente iOS.
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'audiorr-session';

export type AuthSession = {
  sessionToken: string;
  refreshToken: string;
  /** Epoch ms en que expira el sessionToken (derivado de expiresIn al guardar). */
  expiresAt: number;
  /** Privilegios admin derivados del adminRole de Navidrome por el backend. */
  isAdmin: boolean;
};

function loadFromStorage(): AuthSession | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.sessionToken === 'string' &&
      typeof parsed?.refreshToken === 'string' &&
      typeof parsed?.expiresAt === 'number' &&
      typeof parsed?.isAdmin === 'boolean'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

class AuthTokenStore {
  current = $state<AuthSession | null>(loadFromStorage());

  isAuthenticated = $derived(this.current !== null);

  /** Guarda la sesión a partir del shape que devuelve `/api/auth/login`. */
  set(session: AuthSession) {
    this.current = session;
    if (browser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    }
  }

  /** Actualiza solo el par de tokens tras un refresh (login devuelve
      username, refresh no — pero isAdmin sí viene en ambos). */
  update(patch: Partial<AuthSession>) {
    if (!this.current) return;
    this.current = { ...this.current, ...patch };
    if (browser) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    }
  }

  clear() {
    this.current = null;
    if (browser) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}

export const authToken = new AuthTokenStore();
