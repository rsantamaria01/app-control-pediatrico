# AGENTS.md — app-control-pediatrico

Clinical web app (installable PWA) for doctors to record pediatric measurements and plot verified
WHO growth standards. Guardians see only their own children's approved shareable information.

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
- Indicators: length/height-for-age, weight-for-age, weight-for-length/height, BMI-for-age,
  head-circumference-for-age (WHO 2006, 0–5 years). WHO 2007 height/BMI-for-age (5–19 years)
  and weight-for-age (5–10 years) are later scope: show unavailable until validated; never use
  2006 rows outside their coverage.
- Sex is always filtered strictly (MALE/FEMALE); never mix reference curves.
- Base measurements are weight, measured length/height with position, head circumference and
  age; BMI, Z and percentiles are derived. Preserve immutable results with reference version/age basis.
- Reference data must come from official WHO tables with provenance and independent validation.
  Never generate, guess or mock LMS values in code that can reach a user. Board curves are fictional.
- Length (recumbent, < 24 months) and height (standing) require separate tables and verified
  0.7 cm adjustment. Corrected age applies through 24 months, or individually through 36 for
  extreme preterm patients; no Fenton in alpha, pending pediatrician review.
- Show raw Z (decimal comma and true minus), optionally WHO names, and provisional percentiles;
  no traffic-light labels. Strict unrounded comparisons at ±2/±3; no automatic trend flag.
  Provisional names, family wording, percentiles and thresholds need pediatrician demo review.
- The service worker must never cache authenticated HTML or clinical data: `/api/**` stays
  NetworkOnly; offline views show no cached records.
- Roles: ADMIN, DOCTOR, ASSISTANT, PATIENT. Doctors see all clinic patients; ADMIN alone has no
  clinical access. ASSISTANT manages scheduling and grants only with limited name/contact/status
  data, never charts. Guardians only see their own children's approved shareable information.
- One independent deployment and database per clinic; only logo and primary palette vary. Public
  base URL is deployment-configured, TLS is external, and app listens on port 3000.

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
this app's screens, charts, Z labels and copy (control-pediatrico-ui).
