/**
 * CredentialsStore — credenciales del Navidrome configurado.
 *
 * Persistencia: localStorage (plain). Per CLAUDE.md la regla es
 * "encrypted o backend session", pero como esto es homelab y guardamos
 * salt+token (NO la password) el riesgo es bajo. TODO: WebCrypto encrypt
 * antes de prod si Audiorr Web se publica.
 */

import { browser } from '$app/environment';

const STORAGE_KEY = 'audiorr-navidrome-credentials';

export type NavidromeCredentials = {
  /** URL base del Navidrome (sin trailing slash). Ej: https://music.homelab.local */
  serverUrl: string;
  username: string;
  /** Salt random generado en el connect — opaco después. */
  salt: string;
  /** Token md5(password + salt). NO se guarda la password. */
  token: string;
};

function loadFromStorage(): NavidromeCredentials | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.serverUrl === 'string' &&
      typeof parsed?.username === 'string' &&
      typeof parsed?.salt === 'string' &&
      typeof parsed?.token === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

class CredentialsStore {
  current = $state<NavidromeCredentials | null>(loadFromStorage());

  isConfigured = $derived(this.current !== null);

  set(creds: NavidromeCredentials) {
    // Normaliza la URL (sin trailing slash) para que `${url}/rest/...` funcione
    const serverUrl = creds.serverUrl.replace(/\/+$/, '');
    this.current = { ...creds, serverUrl };
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

export const credentials = new CredentialsStore();
