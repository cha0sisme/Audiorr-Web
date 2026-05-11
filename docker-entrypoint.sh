#!/bin/sh
# docker-entrypoint.sh — Audiorr-Web (SvelteKit/adapter-node).
#
# La URL pública del backend ahora se inyecta INLINE en el HTML via
# `src/hooks.server.ts` en cada render SSR — no usamos un asset
# externo `env.js` cacheable. Este entrypoint solo loguea la config
# detectada y arranca el server. La env la lee SvelteKit en runtime
# desde `$env/dynamic/private`.
#
# Variables que lee el hook:
#   1. VITE_API_URL        (nombre legacy del homelab compose).
#   2. PUBLIC_BACKEND_URL  (nombre canónico).
#   Sin ninguna → cadena vacía → same-origin (proxy externo).
set -e

BACKEND_URL="${VITE_API_URL:-${PUBLIC_BACKEND_URL:-}}"

if [ -n "$BACKEND_URL" ]; then
  echo "[entrypoint] backend URL para SSR inline: $BACKEND_URL"
else
  echo "[entrypoint] sin backend URL → same-origin (proxy externo asumido)"
fi

exec "$@"
