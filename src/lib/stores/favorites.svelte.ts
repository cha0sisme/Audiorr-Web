/**
 * favorites — favoritos del usuario vía Subsonic star/unstar.
 *
 * Fuente de verdad client-side: un Set de ids de canciones favoritas, sembrado
 * una vez por sesión desde `getStarred2` y mutado de forma optimista en cada
 * toggle (rollback + toast si el server falla). Los componentes consultan
 * `favorites.isSong(id)` — el campo `starred` embebido en las respuestas de
 * álbum/playlist no se usa porque queda stale al togglear desde otra vista.
 *
 * El Set se REASIGNA (inmutable) en cada mutación para que la reactividad de
 * runes propague sin depender de deep-tracking de colecciones.
 */
import * as nav from '$services/NavidromeService';
import { credentials } from './credentials.svelte';
import { toasts } from './toasts.svelte';

class FavoritesStore {
  songIds = $state<ReadonlySet<string>>(new Set());
  /** true cuando el seed inicial llegó — las vistas que FILTRAN por favorito
      (p.ej. /favorites) deben esperar a esto para no parpadear en vacío. */
  loaded = $state(false);

  private seeding: Promise<void> | null = null;

  isSong(id: string): boolean {
    return this.songIds.has(id);
  }

  /** Siembra el set desde el server. Idempotente; coalesce llamadas
      concurrentes. Si falla (red), se reintenta en la próxima invocación. */
  ensureLoaded(): Promise<void> {
    if (this.loaded || !credentials.isConfigured) return Promise.resolve();
    this.seeding ??= (async () => {
      try {
        const { songs } = await nav.getStarred2();
        this.songIds = new Set(songs.map((s) => s.id));
        this.loaded = true;
      } catch {
        this.seeding = null;
      }
    })();
    return this.seeding;
  }

  /** Toggle optimista: la UI cambia ya, el server confirma detrás. */
  async toggleSong(id: string): Promise<void> {
    const wasFav = this.songIds.has(id);
    this.songIds = this.apply(id, !wasFav);
    try {
      if (wasFav) {
        await nav.unstar({ id });
      } else {
        await nav.star({ id });
      }
    } catch (err) {
      this.songIds = this.apply(id, wasFav);
      toasts.error(
        'Favoritos',
        err instanceof Error ? err.message : 'No se ha podido guardar el cambio'
      );
    }
  }

  private apply(id: string, fav: boolean): ReadonlySet<string> {
    const next = new Set(this.songIds);
    if (fav) {
      next.add(id);
    } else {
      next.delete(id);
    }
    return next;
  }
}

export const favorites = new FavoritesStore();
