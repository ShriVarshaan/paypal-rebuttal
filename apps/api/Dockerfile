# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile -t rebuttal-api .

FROM node:24-slim AS build
RUN npm install -g pnpm@12.14.0
WORKDIR /app
COPY . .
# Installs only the api and its workspace dependencies; @rebuttal/db's postinstall runs prisma generate.
RUN pnpm install --frozen-lockfile --filter "@rebuttal/api..."

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
# Migrations run on deploy, before the api starts taking webhooks.
CMD ["sh", "-c", "cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy && cd /app/apps/api && exec ./node_modules/.bin/tsx src/main.ts"]
