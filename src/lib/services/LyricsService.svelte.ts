/**
 * LyricsService — port web del iOS LyricsService.swift.
 *
 * Cadena de prioridad para resolver letras de una canción:
 *
 *   1. Embedded (Navidrome `getLyricsBySongId`): letras en el ID3 USLT/SYLT
 *      del archivo o en un .lrc al lado. Server-side parsing — equivale al
 *      AVAsset.metadata de iOS pero sin tener que descargar el archivo.
 *   2. LRCLib (`https://lrclib.net/api/get`): synced > plain. Servicio
 *      público gratuito con buena cobertura de música popular.
 *   3. Navidrome legacy `getLyrics`: busca por title+artist en el plugin
 *      Last.fm del server. Plain text. Último fallback.
 *
 * Fast-path: los 3 fetches arrancan en paralelo. Si LRCLib devuelve synced,
 * gana inmediatamente — es el formato que iOS define como "highest quality"
 * (ver LyricsService.swift:82-86). En cualquier otro caso esperamos los 3 y
 * elegimos en el orden documentado.
 *
 * Cache: songId → result, LRU con tope `CACHE_CAP`. JS Map preserva orden
 * de inserción, así que un `delete + set` en cada `get` lleva la entrada
 * al final → la cabeza del Map es siempre la menos recientemente usada.
 * NO cacheamos resultados vacíos para que el path de retry (cuando el
 * title llega después del songId vía race) pueda recuperar — mismo
 * razonamiento que iOS líneas 51-60.
 */

import {
  getLyricsBySongId,
  getLyricsByQuery
} from './NavidromeService';
import type { StructuredLyrics } from '$types/navidrome';

export type LyricLine = {
  /** Índice secuencial — sirve como key estable en el render. */
  id: number;
  /** Tiempo en segundos. -1 si la línea no está sincronizada. */
  time: number;
  text: string;
};

export type LyricsSource = 'embedded' | 'lrclib' | 'navidrome';

export type LyricsResult = {
  lines: LyricLine[];
  isSynced: boolean;
  source: LyricsSource;
};

export const EMPTY_LYRICS: LyricsResult = Object.freeze({
  lines: [],
  isSynced: false,
  source: 'embedded'
});

// ============================================================================
// LRC Parser — mismo regex que iOS y la versión React anterior:
//   [MM:SS.ms] text
// Línea sin match se ignora; orden final por timestamp ascendente.
// ============================================================================

const LRC_LINE_RE = /\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)/;

export function parseLRC(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LRC_LINE_RE.exec(raw);
    if (!m) continue;
    const minutes = Number(m[1]) || 0;
    const seconds = Number(m[2]) || 0;
    const lineText = (m[3] ?? '').trim();
    if (!lineText) continue;
    const time = minutes * 60 + seconds;
    out.push({ id: out.length, time, text: lineText });
  }
  out.sort((a, b) => a.time - b.time);
  // Re-numerar id tras el sort para mantener orden estable visual.
  return out.map((l, i) => ({ ...l, id: i }));
}

/** Convierte plain text en líneas unsynced (time=-1). Filtra blanks. */
function parsePlain(text: string, source: LyricsSource): LyricsResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map<LyricLine>((t, i) => ({ id: i, time: -1, text: t }));
  return { lines, isSynced: false, source };
}

// ============================================================================
// Service singleton
// ============================================================================

/** Tope del cache en memoria. ~150 letras ≈ 750KB-1.5MB con peor caso
    text-heavy. Suficiente para una sesión larga sin acumular indefinida-
    mente. Cuando se rebasa, eviccionamos la entrada menos reciente. */
const CACHE_CAP = 150;

class LyricsServiceImpl {
  private cache = new Map<string, LyricsResult>();
  private pending = new Map<string, Promise<LyricsResult>>();

  async fetch(songId: string, title: string, artist: string): Promise<LyricsResult> {
    if (!songId) return EMPTY_LYRICS;

    const cached = this.cache.get(songId);
    if (cached) {
      // Touch: re-insertar al final para marcar como "recientemente usado".
      // En JS Map el orden es inserción — re-set lleva al final sin cambiar
      // el valor (operación O(1) amortizada).
      this.cache.delete(songId);
      this.cache.set(songId, cached);
      return cached;
    }

    const existing = this.pending.get(songId);
    if (existing) return existing;

    const task = this.doFetch(songId, title, artist);
    this.pending.set(songId, task);
    const result = await task;
    this.pending.delete(songId);

    // Solo cacheamos si hay contenido — empty results pueden venir de un
    // race donde title/artist llegaron después del songId (Navidrome
    // legacy y LRCLib necesitan título). El próximo fetch con metadata
    // completa recupera. Mismo razonamiento que iOS líneas 51-60.
    if (result.lines.length > 0) {
      this.cache.set(songId, result);
      // Eviction LRU: si rebasamos el cap, eliminar la primera key (la
      // menos recientemente usada). Map.keys().next() es O(1).
      if (this.cache.size > CACHE_CAP) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    return result;
  }

  invalidate(songId: string): void {
    this.cache.delete(songId);
  }

  /** Vacía el cache entero. Pensado para usuarios que cambian de servidor
      (los songIds son del servidor anterior y ya no apuntan a nada). */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  // ──────────────────────────────────────────────────────────────────────
  // doFetch: chain order del iOS
  // ──────────────────────────────────────────────────────────────────────

  private async doFetch(
    songId: string,
    title: string,
    artist: string
  ): Promise<LyricsResult> {
    const embeddedP = this.fetchEmbedded(songId);
    const lrclibP = this.fetchLRCLib(title, artist);
    const navidromeP = this.fetchNavidromeLegacy(title, artist);

    // Fast path: LRCLib synced gana inmediato (mismo orden que iOS:84).
    const lrclib = await lrclibP;
    if (lrclib && lrclib.isSynced) return lrclib;

    const embedded = await embeddedP;
    const navidrome = await navidromeP;

    // 1. Embedded synced multi-line (good quality).
    if (embedded && embedded.isSynced && embedded.lines.length > 1) {
      return embedded;
    }

    // 2. LRCLib plain.
    if (lrclib) return lrclib;

    // 3. Navidrome legacy.
    if (navidrome) return navidrome;

    // 4. Embedded low quality fallback.
    if (embedded) return embedded;

    return EMPTY_LYRICS;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 1. Embedded vía Navidrome OpenSubsonic getLyricsBySongId
  // ──────────────────────────────────────────────────────────────────────

  private async fetchEmbedded(songId: string): Promise<LyricsResult | null> {
    try {
      const variants = await getLyricsBySongId(songId);
      // Preferimos la primera variante synced; si ninguna es synced, la
      // primera plain. Algunos archivos tienen varias (multi-language).
      const syncedVariant = variants.find((v) => v.synced && v.line.length > 0);
      const plainVariant = variants.find((v) => !v.synced && v.line.length > 0);

      const chosen: StructuredLyrics | undefined = syncedVariant ?? plainVariant;
      if (!chosen || chosen.line.length === 0) return null;

      const lines: LyricLine[] = chosen.line
        .filter((l) => l.value.trim().length > 0)
        .map((l, i) => ({
          id: i,
          time: chosen.synced && typeof l.start === 'number' ? l.start / 1000 : -1,
          text: l.value
        }));

      if (lines.length === 0) return null;
      return {
        lines,
        isSynced: chosen.synced === true,
        source: 'embedded'
      };
    } catch {
      // Endpoint no soportado por el server (Subsonic <1.16.1) o error
      // de red — caemos a las otras fuentes.
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // 2. LRCLib API
  // ──────────────────────────────────────────────────────────────────────

  private async fetchLRCLib(title: string, artist: string): Promise<LyricsResult | null> {
    if (!title.trim() || !artist.trim()) return null;
    try {
      const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
        artist
      )}&track_name=${encodeURIComponent(title)}`;
      // No User-Agent custom — los browsers lo bloquean (forbidden header).
      // LRCLib acepta requests sin UA explícito sin problema.
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
      };

      if (json.syncedLyrics && json.syncedLyrics.length > 0) {
        const parsed = parseLRC(json.syncedLyrics);
        if (parsed.length > 0) {
          return { lines: parsed, isSynced: true, source: 'lrclib' };
        }
      }
      if (json.plainLyrics && json.plainLyrics.length > 0) {
        const result = parsePlain(json.plainLyrics, 'lrclib');
        if (result.lines.length > 0) return result;
      }
    } catch {
      // Network / CORS / JSON parse errors — skip.
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────
  // 3. Navidrome legacy getLyrics (Last.fm plugin)
  // ──────────────────────────────────────────────────────────────────────

  private async fetchNavidromeLegacy(
    title: string,
    artist: string
  ): Promise<LyricsResult | null> {
    if (!title.trim()) return null;
    const text = await getLyricsByQuery(artist, title);
    if (!text) return null;

    // El value puede ser LRC (con timestamps) o plain. Probamos LRC primero.
    const parsed = parseLRC(text);
    if (parsed.length > 0) {
      return { lines: parsed, isSynced: true, source: 'navidrome' };
    }
    const plain = parsePlain(text, 'navidrome');
    if (plain.lines.length > 0) return plain;
    return null;
  }
}

export const lyricsService = new LyricsServiceImpl();
