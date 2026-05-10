/**
 * DiagnosticsService — cliente del Audiorr Backend
 * `/api/diagnostics/*`. Mirror del flujo iOS TransitionDiagnosticsBackend.
 *
 * Endpoints consumidos:
 *   GET    /api/diagnostics/transitions     — lista paginada con filtros
 *   GET    /api/diagnostics/sessions        — resumen agrupado gap-based (≥30min)
 *   PATCH  /api/diagnostics/transitions/:id — actualiza userRating y/o userComment
 *   DELETE /api/diagnostics/transitions/:id/comment — soft-delete del comentario
 *
 * Auth: header `x-navidrome-user` con el username del director (lo lee del
 * credentials store). El backend filtra todas las queries por userId — sin
 * el header devuelve 401.
 *
 * Sin cache propia: las consultas son baratas (45 records hoy, todo cabe en
 * un `?limit=200`) y queremos que el viewer refleje cambios al instante.
 */

import { backendService } from './BackendService.svelte';
import { credentials } from '$stores/credentials.svelte';
import {
  TransitionListResponseSchema,
  SessionListResponseSchema,
  TransitionRecordSchema,
  type TransitionFilters,
  type TransitionListResponse,
  type SessionSummary,
  type TransitionRecord
} from '$types/diagnostics';

function userHeader(): Record<string, string> {
  const u = credentials.current?.username ?? '';
  return u ? { 'x-navidrome-user': u } : {};
}

function buildQuery(filters: TransitionFilters): string {
  const params = new URLSearchParams();
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  if (filters.minRating !== undefined) params.set('minRating', String(filters.minRating));
  if (filters.maxRating !== undefined) params.set('maxRating', String(filters.maxRating));
  if (filters.unrated) params.set('unrated', 'true');
  if (filters.sessionId) params.set('sessionId', filters.sessionId);
  if (filters.algorithmVersion) params.set('algorithmVersion', filters.algorithmVersion);
  if (filters.buildId) params.set('buildId', filters.buildId);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    for (const t of types) params.append('type', t);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

class DiagnosticsServiceImpl {
  /** GET /api/diagnostics/transitions — paginated + filtered. */
  async listTransitions(filters: TransitionFilters = {}): Promise<TransitionListResponse> {
    const path = `/api/diagnostics/transitions${buildQuery(filters)}`;
    const data = await backendService.get(path, TransitionListResponseSchema, userHeader());
    if (!data) {
      // 404 viene de un router mal montado o user inexistente. Tratamos
      // como vacío para que el viewer renderice el empty state.
      return { transitions: [], total: 0, limit: 0, offset: 0, hasMore: false };
    }
    return data;
  }

  /** GET /api/diagnostics/sessions — pre-agregado server-side (mean, count, diamonds). */
  async listSessions(limit = 100): Promise<SessionSummary[]> {
    const path = `/api/diagnostics/sessions?limit=${limit}`;
    const data = await backendService.get(path, SessionListResponseSchema, userHeader());
    return data?.sessions ?? [];
  }

  /** PATCH /api/diagnostics/transitions/:id — actualizar userRating y/o userComment.
      `null` para limpiar el campo (useful para "borrar rating"). El backend
      retorna el record completo con `ratedAt` ya seteado. */
  async rateTransition(
    id: string,
    payload: { userRating?: number | null; userComment?: string | null }
  ): Promise<TransitionRecord> {
    const path = `/api/diagnostics/transitions/${encodeURIComponent(id)}`;
    return backendService.patch(path, payload, TransitionRecordSchema, userHeader());
  }

  /** DELETE /api/diagnostics/transitions/:id/comment — soft-delete del comment.
      El rating se mantiene; solo userComment pasa a NULL y se setea deletedAt. */
  async deleteComment(id: string): Promise<void> {
    const path = `/api/diagnostics/transitions/${encodeURIComponent(id)}/comment`;
    return backendService.deleteVoid(path, userHeader());
  }
}

export const diagnosticsService = new DiagnosticsServiceImpl();

// Re-export types para conveniencia.
export type {
  TransitionRecord,
  SessionSummary,
  TransitionFilters,
  TransitionListResponse
} from '$types/diagnostics';
