#!/bin/sh
# docker-entrypoint.sh — Audiorr-Web (SvelteKit/adapter-node).
#
# Reescribe `build/client/env.js` con la URL pública del backend antes
# de arrancar el server. El cliente lee `window.__AUDIORR_BACKEND_URL__`
# desde ese script en el primer paint (BackendService.resolveBaseUrl).
#
# Resolución de URL en orden:
#   1. VITE_API_URL   — nombre legacy (compatibilidad con el compose
#                       existente del homelab).
#   2. PUBLIC_BACKEND_URL — nombre canónico que el código fuente lee
#                       directamente vía `$env/dynamic/public`.
#   3. (vacío)        — same-origin: el frontend asume que /api/* va
#                       proxado por un reverse proxy externo.
set -e

ENV_FILE="/app/build/client/env.js"
BACKEND_URL="${VITE_API_URL:-${PUBLIC_BACKEND_URL:-}}"

if [ -n "$BACKEND_URL" ]; then
  echo "[entrypoint] window.__AUDIORR_BACKEND_URL__ = $BACKEND_URL"
  cat > "$ENV_FILE" <<EOF
// Runtime config — escrito por docker-entrypoint.sh en cada start.
// Cambiar VITE_API_URL en el compose y \`docker compose up -d\` basta.
window.__AUDIORR_BACKEND_URL__ = '$BACKEND_URL';
EOF
else
  echo "[entrypoint] No backend URL configured — leaving env.js as same-origin"
fi

exec "$@"
