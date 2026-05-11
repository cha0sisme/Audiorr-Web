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

  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%audiorr.backend_url%', literal)
  });

  // SvelteKit emite un `Link:` header gigante (varios KB) con todos los
  // `modulepreload` de los chunks JS en una sola línea HTTP. Nginx con
  // buffer default 4-8KB lo rechaza → 502 "upstream sent too big header".
  // El head del HTML ya lleva los mismos `<link rel="modulepreload">`,
  // así que estripeando el header solo perdemos la pista HTTP/2-push (que
  // ni siquiera está activo por defecto). Cero impacto funcional, evita
  // tener que tocar `proxy_buffer_size` en cada reverse-proxy aguas
  // arriba (NPM/Caddy/Traefik).
  response.headers.delete('Link');
  return response;
};
