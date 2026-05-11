# syntax=docker/dockerfile:1.7
#
# Audiorr-Web — SvelteKit + adapter-node.
# Multistage build: deps → build → runtime mínimo.
#
# Runtime config (URL pública del backend para el navegador del user) NO
# se hornea en build. El entrypoint reescribe `build/client/env.js` en
# cada start del contenedor → cambiar VITE_API_URL en el compose y
# `docker compose up -d frontend` basta, sin rebuild.

# ─── deps stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─── build stage ─────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ─── runtime ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=2998
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && apk add --no-cache tini
COPY package.json pnpm-lock.yaml ./
# Prod-only install — adapter-node embebe la mayoría de dependencies en
# el bundle, pero algunas (ej. socket.io-client en runtime, polyfills)
# quedan como require dinámico → instalar prod deps por seguridad.
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/build ./build
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 2998

# tini reapea zombies de child processes (fetch/HTTP server forks) si
# alguna libería los deja huérfanos. Best practice para Node en Docker.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "build/index.js"]
