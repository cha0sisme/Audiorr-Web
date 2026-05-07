/**
 * playlist-covers — registry global de `coverContentHash` por playlist.
 *
 * El backend cachea covers generadas en SQLite con un `contentHash`. Si el
 * cliente añade `?v=<hash>` a la URL y coincide con el hash actual, el
 * server responde `Cache-Control: public, max-age=31536000, immutable` —
 * el cover queda cacheado en el browser un año entero, sin revalidación.
 *
 * Si NO añadimos `?v=`, el server responde `max-age=1800,
 * stale-while-revalidate=86400` (30 min TTL) — funcional pero menos eficiente.
 *
 * Mirrors el `PlaylistCoverCache` de iOS (NavidromeService.swift:744+).
 *
 * Cómo se llena este registry:
 *   1. Bulk: cuando llega la respuesta de `/api/daily-mixes` o
 *      `/api/smart-playlists`, registramos los `coverContentHash` de cada
 *      playlist (uno por uno).
 *   2. ETag fallback (TODO): para playlists sin hash en bulk (editorial,
 *      Spotify, custom) iOS hace HEAD requests y lee el ETag. Diferido
 *      porque aún no tenemos esos features.
 */

class PlaylistCoverCacheStore {
  /** id Subsonic → contentHash actual (string del backend, no número). */
  private hashes = $state(new Map<string, string>());

  /** Registra el hash de una playlist. Si cambia respecto al previo, las
      consumers que lean `getHash()` reactivamente recalcularán la URL —
      el ?v= cambia y el browser hace nuevo GET. */
  set(id: string, hash: string | null | undefined): void {
    if (!id) return;
    if (hash == null || hash.length === 0) return;
    const next = new Map(this.hashes);
    if (next.get(id) === hash) return;
    next.set(id, hash);
    this.hashes = next;
  }

  /** Bulk register (post-fetch de daily mixes / smart playlists). */
  setMany(entries: Array<{ id: string | null; hash: string | null | undefined }>): void {
    let dirty = false;
    const next = new Map(this.hashes);
    for (const { id, hash } of entries) {
      if (!id || !hash) continue;
      if (next.get(id) === hash) continue;
      next.set(id, hash);
      dirty = true;
    }
    if (dirty) this.hashes = next;
  }

  get(id: string): string | undefined {
    return this.hashes.get(id);
  }

  clear(): void {
    this.hashes = new Map();
  }
}

export const playlistCovers = new PlaylistCoverCacheStore();
