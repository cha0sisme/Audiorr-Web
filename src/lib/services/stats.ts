/**
 * stats — cliente de los endpoints `/api/stats/*` del backend Audiorr.
 *
 * Mirrors el subset de iOS BackendService.swift relacionado con stats.
 *
 * Funciones puras que delegan a `backendService.get<T>(path, schema)` para
 * el HTTP + parsing. No mantenemos clase porque no hay estado interno.
 */

import { backendService } from './BackendService.svelte';
import {
  RecentContextsSchema,
  TopWeeklyResponseSchema,
  UserStatsSchema,
  type RecentContextItem,
  type TopWeeklySong,
  type UserStats,
  type StatsPeriod
} from '$types/backend';

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

/**
 * Estadísticas del usuario (Wrapped-lite) — total plays, top 5 songs/artists/
 * genres, BPM y energía medios pesados por play count, en el período pedido.
 *
 * `period` default 'week' (últimos 7 días). 'month' = últimos 30 días.
 *
 * Devuelve un objeto con `total_plays: 0` y arrays vacíos si no hay datos
 * (instalación nueva sin scrobbles). Nunca devuelve null en este caso —
 * el backend siempre construye el shape completo.
 */
export async function getUserStats(
  username: string,
  period: StatsPeriod = 'week'
): Promise<UserStats | null> {
  const path = `/api/stats/user-stats?username=${encodeURIComponent(username)}&period=${period}`;
  return backendService.get(path, UserStatsSchema);
}

/**
 * Top 10 global semanal con tendencias (rank, trend up/down/same/new, change).
 * Mirrors `BackendService.getTopWeekly()` de iOS. El backend lo calcula desde
 * `wrapped.db` comparando últimos 7 días vs los 7 anteriores. Devuelve `[]`
 * si la base de datos está vacía.
 */
export async function getTopWeekly(): Promise<TopWeeklySong[]> {
  const data = await backendService.get('/api/stats/top-weekly', TopWeeklyResponseSchema);
  return data ?? [];
}
