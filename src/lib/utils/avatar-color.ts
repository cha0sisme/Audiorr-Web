/**
 * avatar-color — color determinístico atado al username.
 *
 * Mismo algoritmo que `avatarColor(for:)` en `ios/.../SettingsView.swift:7-17`
 * para que el color del avatar de un usuario sea idéntico en iOS y web. El
 * "color persistido" no es persistencia real (no hay storage) — es
 * persistencia *implícita* porque el username determina el color al 100%.
 *
 * Hash: variante DJB2-like usada por iOS:
 *   hash = (hash << 5) - hash + codePoint
 *   ≡ Math.imul(hash, 31) + codePoint con overflow 32-bit signed.
 *
 * Componentes HSL derivados:
 *   - hue:        abs(hash) % 360       → 0-359
 *   - saturation: 60 + abs(hash) % 21   → 60-80%
 *   - lightness:  45 + abs(hash >> 8) % 21 → 45-65%
 *
 * Iteramos por code points (`for ... of`) para tratar emoji/surrogates como
 * un único símbolo, igual que `String.unicodeScalars` de Swift.
 */

export type UserAvatarColor = {
  hue: number;
  saturation: number;
  lightness: number;
  /** Forma `hsl(h s% l%)` lista para usar en CSS. */
  css: string;
};

export function userAvatarColor(username: string): UserAvatarColor {
  let hash = 0;
  for (const c of username) {
    hash = (Math.imul(hash, 31) + (c.codePointAt(0) ?? 0)) | 0;
  }
  const abs = Math.abs(hash);
  const hue = abs % 360;
  const saturation = 60 + (abs % 21);
  const lightness = 45 + (Math.abs(hash >> 8) % 21);
  return {
    hue,
    saturation,
    lightness,
    css: `hsl(${hue}deg ${saturation}% ${lightness}%)`
  };
}

/** Inicial del username para el avatar. Misma lógica que iOS:19-22. */
export function userAvatarInitial(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length === 0) return '?';
  return [...trimmed][0]!.toUpperCase();
}
