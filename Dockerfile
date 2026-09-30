# syntax=docker/dockerfile:1
#
# Fabricate production image. One image runs either process:
#
#   docker run -p 3000:3000 -v fabricate_storage:/app/storage fabricate            # web server
#   docker run -v fabricate_storage:/app/storage fabricate node dist/worker.cjs    # worker
#   docker run --rm -v fabricate_storage:/app/storage fabricate node dist/migrate.cjs
#
# The runtime stage contains Node.js and Git but no package manager: npm,
# npx, Corepack, pnpm, and Yarn are removed, so nothing can install or run
# an assessed repository's packages.

ARG NODE_VERSION=24.14.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js standalone server and the bundled worker. node-gyp needs
# Python to evaluate better-sqlite3's prebuild detection (and a compiler if no
# prebuild matches); none of this reaches the runtime stage.
FROM base AS build
RUN apt-get update -qq \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Runtime: Node.js, Git, and the SSH client for ssh:// sources.
FROM base AS runtime
RUN apt-get update -qq \
    && apt-get install --no-install-recommends -y git openssh-client ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
             /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

ENV NODE_ENV=production \
    FABRICATE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/config ./config
# The worker bundle loads the native SQLite binding from node_modules.
COPY --from=build --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3

RUN mkdir -p storage && chown node:node storage
USER node
VOLUME /app/storage
EXPOSE 3000

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
