/**
 * sessions — cliente de `/api/auth/sessions` (backend eebf559).
 *
 * Gestor de "sesiones activas" estilo "Tus dispositivos" de Google. Todas las
 * llamadas van bajo Bearer (resuelto por `authedFetch`). El `id` que se pasa a
 * `closeSession` es el hash público estable de la sesión, NO el token.
 *
 *   - listSessions(user?)       → GET    /api/auth/sessions
 *   - listAllSessions()         → GET    /api/auth/sessions/all   (admin)
 *   - closeSession(id, user?)   → DELETE /api/auth/sessions/:id   (idempotente)
 *   - closeOtherSessions(user?) → DELETE /api/auth/sessions       → { closed: n }
 *
 * `user` es el override admin (`?user=<username>` para inspeccionar/cerrar las
 * de otro usuario); un no-admin pidiendo `?user=` ajeno recibe 403. El panel
 * admin del Housekeeping usa `listAllSessions` (agregado server-side) porque
 * Navidrome implementa Subsonic `getUsers` devolviendo solo al usuario
 * autenticado — el cliente no puede enumerar usuarios para hacer fan-out.
 */

import { backendService } from './BackendService.svelte';
import {
  SessionsResponseSchema,
  SessionsAllResponseSchema,
  CloseSessionsResultSchema,
  type SessionView,
  type UserSessionsView,
  type CloseSessionsResult
} from '$types/backend';

/** `?user=` codificado, o cadena vacía si se gestionan las propias. */
function userQuery(user?: string): string {
  return user ? `?user=${encodeURIComponent(user)}` : '';
}

/** Lista las sesiones vivas (las propias, o las de `user` si admin override). */
export async function listSessions(user?: string): Promise<SessionView[]> {
  const data = await backendService.get(
    `/api/auth/sessions${userQuery(user)}`,
    SessionsResponseSchema
  );
  return data?.sessions ?? [];
}

/** (admin) Todas las sesiones del servidor agrupadas por usuario. */
export async function listAllSessions(): Promise<UserSessionsView[]> {
  const data = await backendService.get('/api/auth/sessions/all', SessionsAllResponseSchema);
  return data?.users ?? [];
}

/** Cierra una sesión por su `id` público. Idempotente (204 aunque ya no exista). */
export async function closeSession(id: string, user?: string): Promise<void> {
  await backendService.deleteVoid(
    `/api/auth/sessions/${encodeURIComponent(id)}${userQuery(user)}`
  );
}

/** Cierra el resto de dispositivos, conservando la sesión actual. */
export async function closeOtherSessions(user?: string): Promise<CloseSessionsResult> {
  return backendService.delete(
    `/api/auth/sessions${userQuery(user)}`,
    CloseSessionsResultSchema
  );
}
