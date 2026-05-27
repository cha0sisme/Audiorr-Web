/**
 * query-bus — registro global del QueryClient para que servicios plain TS
 * (sin acceso al context de Svelte) puedan invalidar queries de TanStack.
 *
 * Caso de uso original: cuando ScrobbleService emite un scrobble nuevo, el
 * backend acaba de registrar la pista en `recentContexts`. Sin invalidar la
 * query, el home espera al `staleTime` (60s) o a un refetch manual para
 * mostrar la nueva entrada en Jump Back In — el usuario percibe que su
 * reproducción no se refleja.
 *
 * Mirror funcional del iOS `NotificationCenter.default.post(.scrobbled)` que
 * los views observan para refetch.
 */

import type { QueryClient } from '@tanstack/svelte-query';

let _client: QueryClient | null = null;

/** Llamado una vez desde +layout.svelte tras crear el QueryClient. */
export function registerQueryClient(qc: QueryClient): void {
  _client = qc;
}

/** Marca la query `['recentContexts', ...]` como stale → TanStack refetchea
    al siguiente acceso (cuando el usuario navegue al home, o si ya está
    observada por un componente montado, inmediatamente). */
export function invalidateRecentContexts(): void {
  if (!_client) return;
  void _client.invalidateQueries({ queryKey: ['recentContexts'] });
}
