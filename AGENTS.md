# AGENTS.md — app-control-pediatrico

Clinical web app (installable PWA) for doctors to record infant measurements and plot them
against the WHO Child Growth Standards. Parents get a read-only view of their own children.

## Stack
- Nuxt 4 (compatibility version 5), TypeScript, Vue pages + Nitro server routes, one app.
- Nuxt UI v4 (Tailwind CSS v4). UI text in Spanish; code, identifiers and commits in English.
- PostgreSQL 18 via Drizzle ORM (`server/db/schema.ts`, migrations in `server/db/migrations`).
- Valkey (Redis protocol) for cache, sessions and rate limits. RustFS (S3, path-style) for files.
- Auth: Better Auth through its Nuxt module (to be added): DB sessions, email OTP, roles.
- Charts: ECharts via `vue-echarts`, client-only components.
- PWA: `@vite-pwa/nuxt`. Validation: Zod, shared by forms and server routes.
- Tests: Vitest (`test/unit`), Playwright (`test/e2e`).

## Commands
- `pnpm dev` — dev server on :3000 (db/cache/storage come from the devcontainer compose)
- `pnpm test` — unit tests · `pnpm test:e2e` — Playwright
- `pnpm lint` · `pnpm typecheck` · `pnpm build`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations

Before calling work done: `pnpm lint && pnpm typecheck && pnpm test` must pass.

## Domain rules (non-negotiable)
- Z-scores use the WHO LMS method with the disjoint-regression cap beyond ±3 SD
  (`shared/utils/zscore.ts`). Change it only with tests that pin the expected values.
- Indicators: HEIGHT_FOR_AGE, WEIGHT_FOR_AGE, WEIGHT_FOR_HEIGHT, BMI_FOR_AGE.
- Sex is always filtered strictly (MALE/FEMALE); never mix reference curves.
- Base measurements are weight, height and age; BMI and other values are derived.
- Reference data must come from the official WHO tables. Never generate, guess or mock
  LMS values in code that can reach a user. The old mock CDC CSVs were removed on purpose.
- Known gap to handle when importing WHO data: length (recumbent, < 24 months) vs height
  (standing) tables and the 0.7 cm adjustment.
- The service worker must never cache clinical data: `/api/**` stays NetworkOnly.
- Roles: ADMIN, DOCTOR, PATIENT. A parent/patient only ever sees their own children.
- Pending update: `docs/decisions/2026-11-10-ui-and-clinical.md` adds the ASSISTANT role,
  head circumference, WHO 2007 (5–19 years) and new Z display rules. Those decisions win over
  this list; rewrite the list once they are verified (see `docs/handoff/planning.md`).

## Secrets
- Never commit secrets. Dev keys come from the host file
  `/root/.config/app-monitoreo-pediatrico/secrets.env` through the devcontainer env.
- `.env` is for prod-like local runs only and is git-ignored.

## Memory (Hindsight MCP)
- Use only the bank `app-monitoreo-pediatrico` (the MCP URL is already scoped to it).
  Never read or write any other bank.
- Recall before starting a task; retain decisions, fixes and what was learned after it.

## Design reference
- The approved UI v1 lives in `docs/design/` (board sources, screenshots, prototype).
  Start at `docs/design/README.md`. Sample data and curves there are fictional.
- Decisions: `docs/decisions/`. Build planning: `docs/handoff/planning.md`.

## Skills
Project skills live in `.agents/skills/`. Prefer them for: workflow and TDD (superpowers),
UI/UX design (ui-ux-pro-max), Nuxt UI components (nuxt-ui), browser testing (webapp-testing),
this app's screens, charts, Z labels and copy (control-pediatrico-ui, draft until verified).
