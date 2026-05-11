import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/**
 * Inyección runtime de la URL pública del backend en cada render SSR.
 *
 * `app.html` lleva un placeholder `%audiorr.backend_url%` dentro de un
 * script inline; este hook lo reemplaza por el valor actual de la env
 * (VITE_API_URL legacy o PUBLIC_BACKEND_URL canónico). Como el HTML va
 * por SSR siempre, el browser nunca ve un valor stale — ningún cache
 * de asset externo entra en juego.
 *
 * `$env/dynamic/private` se lee en runtime, no en build → cambiar la
 * env y reiniciar el container basta, sin rebuild.
 */

/** Serializa un valor como literal JS seguro para incrustar dentro de
    un `<script>` inline. `JSON.stringify` cuida comillas/backslashes;
    los `replace` neutralizan `</script>` y separadores de línea Unicode
    (U+2028/U+2029) que JS sí trata como line terminators pero JSON
    deja sin escapar — defensa XSS estándar para SSR inline scripting. */
function safeScriptLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export const handle: Handle = async ({ event, resolve }) => {
  const backendUrl = (env.VITE_API_URL || env.PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
  const literal = safeScriptLiteral(backendUrl);

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%audiorr.backend_url%', literal)
  });
};
