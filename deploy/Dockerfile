# Author: ramanpal singh | URL: https://kwebby.com
# Exact multi-architecture image digest verified against Docker Hub 2026-10-09.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS application
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends clamdscan ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable && corepack prepare pnpm@11.22.0 --activate && mkdir -p /data /run/clinic-pdf /run/clinic-analyzer && chown -R node:node /data /run/clinic-pdf /run/clinic-analyzer
COPY --from=build --chown=node:node /app /app
COPY deploy/clamav/client.conf /etc/clamav/clamd.conf
USER node
EXPOSE 4000
CMD ["node", "dist/apps/api/src/main.js"]

FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone /app
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM application AS pdf
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm exec playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
USER node
CMD ["node", "dist/packages/platform/src/pdf-worker.js"]
