/**
 * session-format — helpers de presentación para las sesiones activas
 * (`/api/auth/sessions`). Compartidos entre el panel admin del Housekeeping
 * (sesiones de todos, agrupadas por usuario) y el panel propio de Ajustes.
 *
 * Todo es presentación pura; los datos crudos vienen del `SessionView` del
 * backend. Copy honesto: país solo se puebla con `cf-ipcountry` (Cloudflare),
 * así que en LAN sale "Desconocido".
 */

import type { SessionView } from '$types/backend';

/** Clave de plataforma normalizada — driva icono, etiqueta y color. */
export type PlatformTone = 'web' | 'ios' | 'android' | 'unknown';

export function platformTone(platform: SessionView['platform']): PlatformTone {
  return platform === 'web' || platform === 'ios' || platform === 'android'
    ? platform
    : 'unknown';
}

/** Etiqueta legible de la plataforma para mostrar bajo el dispositivo. */
export function platformLabel(platform: SessionView['platform']): string {
  return platformLabelFromTone(platformTone(platform));
}

/** Etiqueta a partir del tone ya resuelto (incluye la inferencia por UA). */
export function platformLabelFromTone(tone: PlatformTone): string {
  switch (tone) {
    case 'web':
      return 'Navegador';
    case 'ios':
      return 'iPhone · iPad';
    case 'android':
      return 'Android';
    default:
      return 'Dispositivo desconocido';
  }
}

/**
 * Tone de la sesión con fallback: si el backend no clasificó `platform`
 * (null/unknown — p.ej. una sesión Android cuyo header no llegó), se infiere
 * del `userAgent`. Evita que dispositivos reales caigan a "Desconocido".
 */
export function platformToneFromSession(s: SessionView): PlatformTone {
  const t = platformTone(s.platform);
  if (t !== 'unknown') return t;
  const ua = (s.userAgent ?? '').toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod|\bios\b|cfnetwork|darwin|audiorr.*ios/.test(ua)) return 'ios';
  if (/mozilla|applewebkit|chrome|firefox|safari|edg|gecko/.test(ua)) return 'web';
  return 'unknown';
}

/** Nombre del país en español desde ISO-3166 alpha-2 (ES → "España"). API
    nativa `Intl.DisplayNames`, cero deps, funciona en Windows/Chrome — a
    diferencia de los emojis regional-indicator, que Chromium en Windows NO
    renderiza (salían como el código duplicado). `null` si no hay país (LAN).
    La instancia se crea UNA vez a nivel de módulo, no por render. */
const REGION_NAMES = new Intl.DisplayNames(['es'], { type: 'region' });

export function countryName(country: string | null): string | null {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return null;
  try {
    return REGION_NAMES.of(country.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

const ABSOLUTE_FMT = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

/** Fecha absoluta legible — para "iniciada" (`createdAt`). */
export function formatAbsolute(epochMs: number): string {
  return ABSOLUTE_FMT.format(new Date(epochMs));
}

/** Tiempo relativo compacto — para "vista por última vez" (`lastSeen`). */
export function formatRelative(epochMs: number): string {
  const abs = Math.abs(Date.now() - epochMs);
  const min = Math.round(abs / 60_000);
  const hr = Math.round(abs / 3_600_000);
  const day = Math.round(abs / 86_400_000);
  if (abs < 60_000) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (hr < 24) return `hace ${hr} h`;
  return `hace ${day} ${day === 1 ? 'día' : 'días'}`;
}

/** Ordena sesiones: la actual primero, el resto por última actividad desc. */
export function sortSessions(list: SessionView[]): SessionView[] {
  return [...list].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.lastSeen - a.lastSeen;
  });
}
