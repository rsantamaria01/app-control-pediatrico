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

RUN pnpm --filter @app/shared build \
 && pnpm --filter @app/database build \
 && pnpm --filter @app/api build

# ---- runner ----
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

ENV LMS_DATA_DIR=/app/data/lms
ENV API_PORT=3001
EXPOSE 3001

CMD ["node", "apps/api/dist/main.js"]
