FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS ops
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml drizzle.config.ts ./
COPY --chown=node:node server/db/schema.ts ./server/db/schema.ts
COPY --chown=node:node server/db/migrations ./server/db/migrations
COPY --chown=node:node server/services/credentials.ts ./server/services/credentials.ts
COPY --chown=node:node shared/utils/enums.ts ./shared/utils/enums.ts
COPY --chown=node:node shared/types/who.ts ./shared/types/who.ts
COPY --chown=node:node scripts/bootstrap-admin.ts scripts/database-env.mjs scripts/ops.mjs scripts/migrate.mjs scripts/import-who.ts scripts/who-2006-manifest.json ./scripts/
COPY --chown=node:node server/services/who-import.ts ./server/services/who-import.ts
RUN mkdir /who-source && chown node:node /who-source
ENV WHO_SOURCE_DIR=/who-source
USER node
ENTRYPOINT ["node", "scripts/ops.mjs"]
CMD ["db:migrate"]

FROM node:24-alpine AS app
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
COPY --chown=node:node scripts/database-env.mjs ./scripts/database-env.mjs
USER node
EXPOSE 3000
CMD ["node", "scripts/database-env.mjs", "node", ".output/server/index.mjs"]
