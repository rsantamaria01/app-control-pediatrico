# syntax=docker/dockerfile:1.7
# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# pnpm via corepack (matches root packageManager)
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Install only files needed to resolve workspace deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/

# Install dependencies (cached unless lockfile changes)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source and build
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api
COPY data data

RUN pnpm --filter @app/shared build \
 && pnpm --filter @app/database build \
 && pnpm --filter @app/api build

# ---- dev (used by docker-compose for hot reload) ----
# Same image as builder but stays in the foreground running nest in
# watch mode. Compose mounts the source dirs over /repo so saving a
# .ts file triggers a rebuild + restart inside the container.
FROM builder AS dev
WORKDIR /repo
ENV NODE_ENV=development
ENV LMS_DATA_DIR=/repo/data/lms
ENV API_PORT=3001
EXPOSE 3001
CMD ["pnpm", "--filter", "@app/api", "dev"]

# ---- runner (production) ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Production-only install of the api workspace
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# Built artifacts
COPY --from=builder /repo/apps/api/dist ./apps/api/dist
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder /repo/packages/database/dist ./packages/database/dist

# Bake the static CDC LMS CSV files into the image so the container can
# run without any external mount; the data is read once at startup.
COPY data/lms ./data/lms

# wget is used by the docker-compose healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*

ENV LMS_DATA_DIR=/app/data/lms
ENV API_PORT=3001
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
