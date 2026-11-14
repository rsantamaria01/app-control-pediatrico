FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine AS ops
WORKDIR /app
ENV COREPACK_HOME=/usr/local/share/corepack
RUN corepack enable && corepack install --global pnpm@12.15.0 && chmod -R a+rX /usr/local/share/corepack
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml drizzle.config.ts ./
COPY --chown=node:node server/db/schema.ts ./server/db/schema.ts
COPY --chown=node:node server/db/migrations ./server/db/migrations
COPY --chown=node:node server/services/credentials.ts ./server/services/credentials.ts
COPY --chown=node:node scripts/bootstrap-admin.ts ./scripts/bootstrap-admin.ts
USER node
ENTRYPOINT ["pnpm", "run"]
CMD ["db:migrate"]

FROM node:24-alpine AS app
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
