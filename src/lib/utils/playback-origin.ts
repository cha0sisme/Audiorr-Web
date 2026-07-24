/**
 * playback-origin — parsea `player.contextUri` al ORIGEN de la reproducción
 * ("Reproduciendo desde …"). Puro y testeable: solo trocea el URI en tipo + id.
 *
 * El NOMBRE mostrado NO se resuelve aquí — se deriva del `id` en el punto de
 * uso (TanStack cacheado) en vez de puentear/persistir un `contextName` por
 * todos los call sites de `queueManager.play`. El `contextUri` ya se persiste
 * en lastPlayback y se restaura, así que derivar del id sobrevive al refresh
 * gratis. Mirror conceptual de `PlaybackOrigin` en iOS
 * (NowPlayingViewerView.swift), adaptado a web.
 *
 * Esquemas de `contextUri` que setea la web:
 *   - `album:<id>`      → Del álbum
 *   - `playlist:<id>`   → De la playlist  (favoritos se detecta al resolver)
 *   - `smartmix:<id>`   → De la playlist  (se rotula como su playlist de origen)
 *   - `artist:<id>`     → De {artista}
 *   - `playlist:top-weekly` → Lo más escuchado esta semana (id centinela, NO
 *                             es una playlist real → no navegable)
 */

export type ParsedOrigin =
  | { kind: 'album'; id: string }
  | { kind: 'playlist'; id: string }
  | { kind: 'artist'; id: string }
  | { kind: 'top-weekly' };

export function parseOrigin(contextUri: string | null | undefined): ParsedOrigin | null {
  if (!contextUri) return null;

  // Centinela del "Lo más escuchado esta semana": la web lo dispara como
  // `playlist:top-weekly`, con id centinela que NO corresponde a ninguna
  // playlist real (iría a /playlist/top-weekly → 404). Caso especial primero.
  if (contextUri === 'playlist:top-weekly') return { kind: 'top-weekly' };

  const colon = contextUri.indexOf(':');
  if (colon === -1) return null;
  const scheme = contextUri.slice(0, colon);
  const id = contextUri.slice(colon + 1);
  if (!id) return null;

  switch (scheme) {
    case 'album':
      return { kind: 'album', id };
    case 'playlist':
    case 'smartmix':
      // smartmix se rotula como su playlist de origen (la firma "AutoMix" ya
      // vive en otros indicadores); el destino es la playlist con ese id.
      return { kind: 'playlist', id };
    case 'artist':
      return { kind: 'artist', id };
    default:
      return null;
  }
}
