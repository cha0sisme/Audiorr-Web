/**
 * Historial de búsquedas — últimas N queries persistidas en localStorage.
 *
 * Por qué un store con runes y no un useState efímero:
 *   - Sobrevive a navegación dentro de la app y a recargas.
 *   - Permite que MULTIPLE entradas de UI (search input + recent chips)
 *     compartan el mismo estado sin prop drilling.
 *
 * NO sincronizamos entre tabs (no escuchamos `storage` event) — multi-tab
 * search history feels inconsistente y nadie lo necesita.
 */

import { browser } from '$app/environment';

const KEY = 'audiorr-search-history';
const MAX = 8;

function load(): string[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX);
  } catch {
    return [];
  }
}

function persist(items: string[]) {
  if (!browser) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // localStorage lleno o disabled (private mode) — silencioso.
  }
}

class SearchHistoryStore {
  items = $state<string[]>(load());

  /** Registra una query exitosa. Mueve duplicados al frente, capa a MAX,
      ignora strings vacías o solo whitespace. */
  push(query: string) {
    const q = query.trim();
    if (!q) return;
    const without = this.items.filter((x) => x.toLowerCase() !== q.toLowerCase());
    this.items = [q, ...without].slice(0, MAX);
    persist(this.items);
  }

  /** Quita una entrada específica. */
  remove(query: string) {
    this.items = this.items.filter((x) => x !== query);
    persist(this.items);
  }

  clear() {
    this.items = [];
    persist(this.items);
  }
}

export const searchHistory = new SearchHistoryStore();
