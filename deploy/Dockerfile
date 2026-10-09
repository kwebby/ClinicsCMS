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

# Production dependencies of the root package only (no web, build or test tooling), installed from the same lockfile.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS production-dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --prod --filter clinicscms

# Runtime base: the Node runtime without npm, npx, corepack or yarn.
FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm /root/.cache
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

FROM runtime AS application
RUN apt-get update && apt-get install -y --no-install-recommends clamdscan ca-certificates && rm -rf /var/lib/apt/lists/* && mkdir -p /data /run/clinic-pdf /run/clinic-analyzer && chown -R node:node /data /run/clinic-pdf /run/clinic-analyzer
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY deploy/clamav/client.conf /etc/clamav/clamd.conf
USER node
EXPOSE 4000
CMD ["node", "dist/apps/api/src/main.js"]

FROM runtime AS web
COPY --from=build --chown=node:node /app/apps/web/.next/standalone /app
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# PDF renderer: production dependencies plus the Chromium build pinned by playwright-core; no scanner client.
FROM runtime AS pdf
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=production-dependencies /app/package.json ./package.json
COPY --from=production-dependencies /app/node_modules ./node_modules
RUN node node_modules/playwright-core/cli.js install --with-deps chromium && rm -rf /var/lib/apt/lists/* && chmod -R a+rX /ms-playwright && mkdir -p /run/clinic-pdf && chown node:node /run/clinic-pdf
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/packages/platform/src/pdf-worker.js"]
