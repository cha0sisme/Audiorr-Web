/**
 * AuthInfoStore — info derivada de Subsonic getUser (adminRole, etc).
 *
 * El UserMenu y `/housekeeping/+layout` ya cargan esto via TanStack con la
 * key `['navidromeUser', username]`. Este store sirve para call sites donde
 * spammear createQuery sería caro (50+ SongRows por playlist) — hidrata una
 * vez al iniciar la sesión y expone `isAdmin` reactivo.
 *
 * Mirror de `BackendService.currentUserIsAdmin` de iOS.
 */

import { browser } from '$app/environment';
import { credentials } from './credentials.svelte';
import * as nav from '$services/NavidromeService';

class AuthInfoStore {
  /** True si el user actual tiene `adminRole === true` en Subsonic. */
  isAdmin = $state(false);
  /** Username actual — útil para invalidar al cambiar de cuenta. */
  username = $state<string | null>(null);
  /** True mientras `refresh()` está pendiente — evita parpadeo en menus. */
  loading = $state(false);

  private lastFetchedFor: string | null = null;

  async refresh(): Promise<void> {
    if (!browser) return;
    const u = credentials.current?.username;
    if (!u) {
      this.isAdmin = false;
      this.username = null;
      this.lastFetchedFor = null;
      return;
    }
    if (this.lastFetchedFor === u && this.username === u) return;
    this.username = u;
    this.lastFetchedFor = u;
    this.loading = true;
    try {
      const info = await nav.getUser(u);
      // Re-check: si el user cambió mientras estábamos pidiendo, descartar.
      if (credentials.current?.username !== u) return;
      this.isAdmin = info.adminRole === true;
    } catch {
      this.isAdmin = false;
    } finally {
      this.loading = false;
    }
  }
}

export const authInfo = new AuthInfoStore();
