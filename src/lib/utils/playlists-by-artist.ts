/**
 * Playlists con un artista — filtros restrictivos: SOLO Editorial o "This is …".
 *
 * Diseño:
 * - "This is {artist}" se resuelve sin descargar las entries (match por nombre).
 * - Editoriales necesitan un fetch de detail por playlist para ver si contienen
 *   al artista. Se hace con concurrencia limitada (6) para no saturar Navidrome.
 * - Loose match en el campo `song.artist` (string concatenado tipo "A & B feat. C")
 *   replicando el algoritmo de iOS NavidromeService.artistMatches.
 *
 * Orden de salida:
 *   1. "This is {artistName}" — siempre primero si existe (oficial del artista).
 *   2. Editoriales que contienen al artista, en su orden original de Navidrome.
 *   3. Otras "This is X" donde el artista aparece como feat. (al final — son del
 *      artista principal de esa playlist, nuestro target solo es invitado).
 *
 * Mirrors `getPlaylistsByArtist` de iOS, pero con el filtro adicional Editorial/
 * This-is del director (iOS escanea CUALQUIER playlist, este solo las
 * curated/editoriales — más rápido y más relevante).
 */

import type { NavidromePlaylist, NavidromeSong } from '$types/navidrome';
import { isEditorial } from './playlist-section-mappers';

/** Una playlist tipo "This is …" — opcional prefijo `[Spotify] ` legacy. */
export function isThisIs(p: NavidromePlaylist): boolean {
  const clean = stripSpotifyPrefix(p.name ?? '');
  return /^this is\b/i.test(clean);
}

/** Extrae el nombre del artista desde "This is X" / "[Spotify] This is X". */
export function thisIsArtistName(p: NavidromePlaylist): string | null {
  const clean = stripSpotifyPrefix(p.name ?? '');
  const m = clean.match(/^this is\s+(.+)$/i);
  return m && m[1] ? m[1].trim() : null;
}

/** Editorial o "This is …". Conjunto de candidatos para esta sección. */
export function isArtistFocusedPlaylist(p: NavidromePlaylist): boolean {
  return isEditorial(p) || isThisIs(p);
}

function stripSpotifyPrefix(name: string): string {
  return name.replace(/^\[spotify\]\s*/i, '').trim();
}

/**
 * Loose match — busca `needle` como artista único o dentro de un string
 * concatenado tipo "A & B feat. C", "A, B, C", "A and B". Idéntico a
 * NavidromeService.artistMatches en iOS:539-590.
 */
export function artistMatches(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase().trim();
  const h = haystack.toLowerCase();
  if (!n) return false;
  if (h === n) return true;
  if (h.includes(`${n},`)) return true;
  if (h.includes(`, ${n}`)) return true;
  if (h.includes(`${n} &`)) return true;
  if (h.includes(`& ${n}`)) return true;
  if (h.includes(`${n} and`)) return true;
  if (h.includes(`and ${n}`)) return true;
  if (h.includes(n) && (h.startsWith(`${n} `) || h.endsWith(` ${n}`))) return true;
  return false;
}

/** Pool worker simple — N tareas concurrentes, mantiene orden de input. */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    })
  );
  return results;
}

type PlaylistDetail = { entry?: NavidromeSong[] | undefined };

/**
 * Resuelve las playlists artist-focused que matchean al artista.
 *
 * @param artistName  Nombre del artista (case-insensitive).
 * @param allPlaylists Catálogo completo de Navidrome (passable desde el cache TanStack).
 * @param getDetail   Función para descargar entries de una playlist (Subsonic getPlaylist).
 *                    Inyectable para tests; en prod se pasa `nav.getPlaylist`.
 * @param concurrency Tareas paralelas para fetchear editoriales. Default 6 (límite
 *                    típico de conexiones HTTP/1.1 por origen en browsers).
 */
export async function findPlaylistsByArtist(
  artistName: string,
  allPlaylists: NavidromePlaylist[],
  getDetail: (id: string) => Promise<PlaylistDetail>,
  concurrency = 6
): Promise<NavidromePlaylist[]> {
  if (!artistName) return [];
  const target = artistName.toLowerCase().trim();

  // 1. Primer pase: separar candidates en "This is …" vs Editorial.
  const officialThisIs: NavidromePlaylist[] = [];
  const otherThisIs: NavidromePlaylist[] = [];
  const editorialCandidates: NavidromePlaylist[] = [];

  for (const p of allPlaylists) {
    if (!isArtistFocusedPlaylist(p)) continue;
    const tin = thisIsArtistName(p);
    if (tin) {
      // Match exacto por nombre del artista — iOS prefiere esto antes que Editorial.
      if (tin.toLowerCase() === target) {
        officialThisIs.push(p);
      } else {
        // "This is OtherArtist" — entra como editorial-candidate. Se evalúa
        // por entries (puede contener al artista como feature).
        otherThisIs.push(p);
      }
    } else if (isEditorial(p)) {
      editorialCandidates.push(p);
    }
  }

  // 2. Scanear editoriales + otras "This is …" en paralelo, manteniendo los
  // dos buckets separados para que el orden de salida respete: editoriales
  // antes que "This is OtherArtist". "This is {artistName}" oficial NO se
  // evalúa — matchea por contrato (es la playlist principal del artista).
  type Tag = 'editorial' | 'otherThisIs';
  const toScan: { pl: NavidromePlaylist; tag: Tag }[] = [
    ...editorialCandidates.map((pl) => ({ pl, tag: 'editorial' as const })),
    ...otherThisIs.map((pl) => ({ pl, tag: 'otherThisIs' as const }))
  ];

  const matched = await runWithConcurrency(toScan, concurrency, async ({ pl, tag }) => {
    try {
      const detail = await getDetail(pl.id);
      const songs = detail.entry ?? [];
      const hit = songs.some((s) => artistMatches(target, s.artist ?? ''));
      return hit ? { pl, tag } : null;
    } catch {
      // Una playlist que falla no debe tirar todo — la ignoramos.
      return null;
    }
  });

  const editorialMatches: NavidromePlaylist[] = [];
  const otherThisIsMatches: NavidromePlaylist[] = [];
  for (const m of matched) {
    if (!m) continue;
    if (m.tag === 'editorial') editorialMatches.push(m.pl);
    else otherThisIsMatches.push(m.pl);
  }

  // 3. Salida: oficial → editoriales → other "This is X".
  return [...officialThisIs, ...editorialMatches, ...otherThisIsMatches];
}
