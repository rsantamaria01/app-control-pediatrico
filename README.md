# Control Pediátrico

Clinical web app (installable PWA) for doctors to record infant measurements and plot them
against the WHO Child Growth Standards (LMS method, Z-scores). Parents get a read-only view.

> The April 2026 NestJS/Next.js version is archived on branch `legacy/nest-next`.

## Stack
Nuxt 4 · Nuxt UI v4 · PostgreSQL 18 + Drizzle · Valkey · RustFS (S3) · Better Auth (planned)
· ECharts · @vite-pwa/nuxt · Vitest · Playwright. One Nuxt app; no separate API.

## Develop (devcontainer)
1. Open the repo on the dev host (`ssh root@10.10.1.35`, `/root/projects/app-control-pediatrico`)
   with VS Code Remote-SSH, then **Reopen in Container**.
   CLI alternative: `devcontainer up --workspace-folder .`
2. The devcontainer starts `db`, `cache` and `storage` from `compose.yaml` and installs dependencies.
3. `pnpm dev` → http://localhost:3000 (VS Code forwards the port to your machine).

Agent keys (`OMNIROUTE_API_KEY`, `HINDSIGHT_API_KEY`) are read from
`/root/.config/app-monitoreo-pediatrico/secrets.env` on the dev host. Never commit secrets.

## Commands
| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm test` / `pnpm test:e2e` | Unit tests / Playwright |
| `pnpm lint` / `pnpm typecheck` | Quality gates |
| `pnpm build` | Production build (`.output/`) |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |

## Prod-like run
```bash
cp .env.example .env   # set real passwords
docker compose --profile full up -d --build
```

See [deployment runbook](docs/deployment.md) for migrations, first-admin bootstrap, upgrades and backups.

## PWA
Installable from the browser. Service workers need a secure context: `localhost` works
(through the forwarded port); phones need HTTPS, which is added outside the app later.
The service worker never caches `/api/**` (no clinical data on devices).

## AI agents
`AGENTS.md` (also `CLAUDE.md`) holds the rules. OpenCode config: `opencode.json` (models via
OmniRoute, MCP: Hindsight, Nuxt, Nuxt UI, Context7, Playwright). Skills: `.agents/skills/`.

## WHO reference data
Not included yet. It must be imported from the official WHO tables; mock values are not allowed.
