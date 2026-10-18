# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/worker/Dockerfile -t rebuttal-worker .
# The Playwright base image carries Chromium for C's HTML→PDF evidence packs.
# Keep PLAYWRIGHT_VERSION equal to the `playwright` version in packages/evidence.

ARG PLAYWRIGHT_VERSION=1.64.1

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS build
RUN npm install -g pnpm@12.14.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@rebuttal/worker..."

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app /app
USER pwuser
CMD ["sh", "-c", "cd /app/apps/worker && exec ./node_modules/.bin/tsx src/main.ts"]
