/**
 * artist-format — formato de listas de artistas estilo Apple Music.
 *
 * Port de los helpers estáticos `ItemArtist.displayName` / `featuringText`
 * del iOS (NavidromeModels.swift). iOS los cuelga del struct `ItemArtist`;
 * en web son funciones puras sobre `NavidromeItemArtist[]` (mismo criterio
 * que el resto de mappers: módulo de funciones donde Swift usa un struct).
 *
 * Apple obliga al sello a poner el `feat.` en el TÍTULO de la canción; el
 * campo de artista solo lista nombres. Aquí concatenamos con el separador
 * correcto y aplicamos el patrón "feat." en la capa de display.
 */

import type { NavidromeItemArtist } from '$types/navidrome';

/** Une nombres con la regla "último con &, resto con comas":
    1 → "A", 2 → "A & B", 3+ → "A, B & C". */
function joinAmpersand(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1] ?? '';
  return `${head} & ${tail}`;
}

/**
 * Formatea una lista de artistas estilo Apple Music:
 * 1 → "A", 2 → "A & B", 3+ → "A, B & C". Cae a `fallback` si la lista viene
 * vacía. Mirror `ItemArtist.displayName(of:fallback:)` (iOS).
 */
export function displayArtistName(
  artists: NavidromeItemArtist[],
  fallback = ''
): string {
  const names = artists.map((a) => a.name).filter((n) => n.length > 0);
  return names.length === 0 ? fallback : joinAmpersand(names);
}

/** Segmento de una lista de artistas renderizable con links individuales.
    `artist` lleva nombre + id opcional (link cuando hay id); `sep` es texto
    plano (", ", " & ", " feat. ") que NUNCA es link. */
export type ArtistSegment =
  | { kind: 'artist'; name: string; id?: string | undefined }
  | { kind: 'sep'; text: string };

/**
 * Descompone una lista de artistas en segmentos para renderizar cada nombre
 * como link y los separadores como texto plano. Patrón Apple Music tratando
 * el primer artista como titular: "Titular feat. Invitado1 & Invitado2".
 *
 * - 0 artistas en la lista → un único segmento desde `fallbackName` (+
 *   `fallbackId` si existe). Cubre las fuentes que solo traen el string
 *   `artist` + `artistId` (single-artist legacy).
 * - 1 artista → solo ese nombre.
 * - 2+ → primero + " feat. " + resto unido con comas y " & " final.
 *
 * Cada nombre arrastra su `id` (cuando el server expone `artists[]`); sin id,
 * el segmento se renderiza como texto sin link. El consumidor (ArtistLinks)
 * decide el markup.
 */
export function artistSegments(
  artists: NavidromeItemArtist[],
  fallbackName: string,
  fallbackId?: string
): ArtistSegment[] {
  const list = artists.filter((a) => a.name.length > 0);

  if (list.length === 0) {
    if (fallbackName.length === 0) return [];
    return [{ kind: 'artist', name: fallbackName, ...(fallbackId ? { id: fallbackId } : {}) }];
  }
  if (list.length === 1) {
    const a = list[0]!;
    return [{ kind: 'artist', name: a.name, ...(a.id ? { id: a.id } : {}) }];
  }

  const segs: ArtistSegment[] = [];
  const head = list[0]!;
  const rest = list.slice(1);
  segs.push({ kind: 'artist', name: head.name, ...(head.id ? { id: head.id } : {}) });
  segs.push({ kind: 'sep', text: ' feat. ' });
  rest.forEach((a, i) => {
    if (i > 0) segs.push({ kind: 'sep', text: i === rest.length - 1 ? ' & ' : ', ' });
    segs.push({ kind: 'artist', name: a.name, ...(a.id ? { id: a.id } : {}) });
  });
  return segs;
}

/**
 * Para una canción dentro del contexto de un álbum, devuelve el texto del
 * artista SOLO si hay featurings reales (artistas distintos del titular del
 * álbum), formateado "Drake feat. Snoop Dogg". Devuelve `null` si la canción
 * es solo del titular sin invitados (el caller no renderiza nada — coincide
 * con cómo Apple Music omite el artista en las pistas que son solo del
 * titular). Mirror `ItemArtist.featuringText(artists:fallback:albumArtist:)`.
 */
export function featuringText(
  artists: NavidromeItemArtist[],
  fallback: string,
  albumArtist: string
): string | null {
  const names = artists.map((a) => a.name).filter((n) => n.length > 0);

  // Solo 1 artista (o ninguno en artists[]) — si coincide con el del álbum o
  // está vacío, se oculta.
  if (names.length <= 1) {
    const only = names[0] ?? fallback;
    return only === albumArtist || only.length === 0 ? null : only;
  }

  // Múltiples artistas. Si el álbum aparece en la lista, los demás son
  // featurings → "Titular feat. Invitado1 & Invitado2".
  if (names.includes(albumArtist)) {
    const featuring = names.filter((n) => n !== albumArtist);
    if (featuring.length === 0) return null;
    return `${albumArtist} feat. ${joinAmpersand(featuring)}`;
  }

  // El álbum no está en la lista → canción de invitado: mostrar todo.
  return displayArtistName(artists, fallback);
}
