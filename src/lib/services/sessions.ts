/**
 * sessions — cliente de `/api/auth/sessions` (backend eebf559).
 *
 * Gestor de "sesiones activas" estilo "Tus dispositivos" de Google. Todas las
 * llamadas van bajo Bearer (resuelto por `authedFetch`). El `id` que se pasa a
 * `closeSession` es el hash público estable de la sesión, NO el token.
 *
 *   - listSessions(user?)       → GET    /api/auth/sessions
 *   - closeSession(id, user?)   → DELETE /api/auth/sessions/:id   (idempotente)
 *   - closeOtherSessions(user?) → DELETE /api/auth/sessions       → { closed: n }
 *
 * `user` es el override admin (`?user=<username>` para inspeccionar/cerrar las
 * de otro usuario). La web ya corre como admin; un no-admin pidiendo `?user=`
 * ajeno recibe 403. En la iteración actual la UI solo gestiona las propias, así
 * que se invoca sin `user`, pero el parámetro queda disponible para el panel
 * admin futuro.
 */

import { backendService } from './BackendService.svelte';
import {
  SessionsResponseSchema,
  CloseSessionsResultSchema,
  type SessionView,
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
