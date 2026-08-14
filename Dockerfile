# The bun binary is lifted from the official image rather than downloaded at build
# time, so the version is pinned and the build needs no network for it.
FROM oven/bun:1.3.14 AS bun

# Every source is now a plain HTTP call, so this no longer needs the puppeteer image
# and the ~1GB of bundled Chrome that came with it. Node is still the host for the
# Prisma CLI; bun runs the bot itself.
FROM node:22-slim

# Prisma's query engine links against OpenSSL, which slim images omit.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN npm install -g pnpm@10.34.5 && npm cache clean --force

WORKDIR /app
RUN chown node:node /app
# The base image ships an unprivileged `node` user; nothing here needs root.
USER node

# Manifests first so the dependency layer is only rebuilt when they change.
# pnpm-workspace.yaml carries the install settings and must be present here.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY --chown=node:node . .

# Emits the typed Prisma client into node_modules.
RUN pnpm exec prisma generate

# Bun.serve bundles the web UI at runtime; production mode minifies and serves
# hashed, cacheable assets instead of the dev/HMR path.
ENV NODE_ENV=production

# The web UI. Documentation only — publishing happens in docker-compose.yml.
EXPOSE 3000

CMD ["./start.sh"]
