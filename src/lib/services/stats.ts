/**
 * stats — cliente de los endpoints `/api/stats/*` del backend Audiorr.
 *
 * Mirrors el subset de iOS BackendService.swift relacionado con stats.
 *
 * Funciones puras que delegan a `backendService.get<T>(path, schema)` para
 * el HTTP + parsing. No mantenemos clase porque no hay estado interno.
 */

import { backendService } from './BackendService.svelte';
import { RecentContextsSchema, type RecentContextItem } from '$types/backend';

/**
 * Últimos contextos únicos escuchados — feed de "Volver a escuchar"
 * (Jump Back In). Devuelve hasta 8 items ordenados por última escucha.
 *
 * Si el backend aún no tiene wrapped.db (instalación nueva, sin scrobbles)
 * devuelve `[]` y la sección se omite en la home.
 */
export async function getRecentContexts(username: string): Promise<RecentContextItem[]> {
  const path = `/api/stats/recent-contexts?username=${encodeURIComponent(username)}`;
  const data = await backendService.get(path, RecentContextsSchema);
  return data ?? [];
}
