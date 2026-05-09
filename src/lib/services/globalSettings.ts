/**
 * globalSettings — cliente de `/api/settings/:key` del backend Audiorr.
 *
 * Settings globales persistidos por el admin desde la UI de configuración.
 * Key relevante para frontend: `homepage_layout` (orden + secciones de la
 * página de playlists).
 */

import { z } from 'zod';
import { backendService, BackendError } from './BackendService.svelte';
import {
  GlobalSettingResponseSchema,
  PlaylistSectionsArraySchema,
  type PlaylistSection
} from '$types/backend';

/**
 * GET tipado de un setting. El backend siempre devuelve `{key, value}`;
 * `value` es `unknown` y se valida con el schema dado por el caller.
 *
 * Devuelve null si:
 *   - el endpoint da 404 (setting nunca seteado)
 *   - el value parsea pero queda undefined/null (setting limpiado)
 *   - el value falla la validación contra el schema (datos corruptos —
 *     fail-soft para que el caller use defaults).
 */
export async function getGlobalSetting<T>(
  key: string,
  valueSchema: z.ZodSchema<T>
): Promise<T | null> {
  const path = `/api/settings/${encodeURIComponent(key)}`;
  try {
    const wrapper = await backendService.get(path, GlobalSettingResponseSchema);
    if (!wrapper || wrapper.value == null) return null;
    const parsed = valueSchema.safeParse(wrapper.value);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if (err instanceof BackendError && err.status === 404) return null;
    throw err;
  }
}

/** Layout de la página de playlists. null si nunca se configuró — el caller
    debe usar el default `[fixed_daily, fixed_smart, fixed_user]`. */
export async function getHomepageLayout(): Promise<PlaylistSection[] | null> {
  return getGlobalSetting('homepage_layout', PlaylistSectionsArraySchema);
}

/**
 * Mutation: setea un global setting. Usado por la sección Editorial del
 * panel de admin para persistir `homepage_layout`, `this_is_playlists`,
 * etc. La response del backend tiene la misma forma `{ key, value }` que
 * el GET.
 */
export async function setGlobalSetting<T>(key: string, value: T): Promise<void> {
  const path = `/api/settings/${encodeURIComponent(key)}`;
  // Backend devuelve `{ key, value }` con el value persistido. Solo nos
  // importa que pase el status check; el body lo descartamos.
  await backendService.put(path, { value }, GlobalSettingResponseSchema);
}

/**
 * Mapping `this_is_playlists`: nombre de artista → playlist id Navidrome.
 * Usado por el cover service del backend para resolver covers de playlists
 * "This is X" (ya tiene su propio store playlistCovers; aquí se administra
 * desde Editorial).
 */
const ThisIsMappingSchema = z.record(z.string(), z.string());
export type ThisIsMapping = z.infer<typeof ThisIsMappingSchema>;

export async function getThisIsMapping(): Promise<ThisIsMapping> {
  const data = await getGlobalSetting('this_is_playlists', ThisIsMappingSchema);
  return data ?? {};
}

export async function setThisIsMapping(mapping: ThisIsMapping): Promise<void> {
  await setGlobalSetting('this_is_playlists', mapping);
}

/** Setea solo el `homepage_layout` — wrapper tipado para evitar usar el
    helper genérico con el schema cada vez. */
export async function setHomepageLayout(sections: PlaylistSection[]): Promise<void> {
  await setGlobalSetting('homepage_layout', sections);
}

/** Layout default cuando el admin no ha configurado nada. Coincide con el
    `DEFAULT_LAYOUT` del legacy PlaylistsPage.tsx. */
export const DEFAULT_HOMEPAGE_LAYOUT: PlaylistSection[] = [
  { id: 'daily-mixes', title: 'Tus mixes diarios', type: 'fixed_daily' },
  { id: 'smart-playlists', title: 'Hecho especialmente para ti', type: 'fixed_smart' },
  { id: 'my-playlists', title: 'Mis playlists', type: 'fixed_user' }
];
