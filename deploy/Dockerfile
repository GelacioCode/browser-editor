# syntax=docker/dockerfile:1

# ---- Build the static site ------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

# Install dependencies first (cached unless manifests/lockfile change).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/project-core/package.json packages/project-core/
COPY packages/composition/package.json packages/composition/
COPY packages/media/package.json packages/media/
COPY packages/render/package.json packages/render/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---- Serve it ------------------------------------------------------------------------------
# Plain HTTP on :80 inside the container. TLS is terminated by the VPS reverse proxy
# (Traefik or Caddy) in front of it. There are no API or media endpoints: static files only.
FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1
