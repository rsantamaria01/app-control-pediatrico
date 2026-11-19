# AGENTS.md — app-control-pediatrico

Clinical web app (installable PWA) for doctors to record pediatric measurements and plot verified
WHO growth standards. Guardians see only their own children's approved shareable information.

## Current mode (change only this block when Raul changes the mode)
- **Parity in progress** (Raul 2026-11-18): design parity is NOT approved yet. CI is back on.
- Commit locally as often as you like. **Never `git push` until Raul says OK in the chat**
  after he reviews your work in the Paseo shared browser (see Workflow). CI runs on every push.
- `docs/design/DESIGN.md` is the spec. The design-fidelity skill stays suspended: no screenshot
  loops and no artboard comparisons; Raul reviews by eye.
- Pending parity items: DESIGN.md «Pendiente de aprobación».

## Stack
- Nuxt 4 (compatibility version 5), TypeScript, Vue pages + Nitro server routes, one app.
- Nuxt UI v4 (Tailwind CSS v4). UI text in Spanish; code, identifiers and commits in English.
- PostgreSQL 18 via Drizzle ORM (`server/db/schema.ts`, migrations in `server/db/migrations`).
- Valkey (Redis protocol) for cache, sessions and rate limits. RustFS (S3, path-style) for files.
- Auth: Better Auth through its Nuxt module: username + password, DB sessions, invitation-only accounts and roles. Email is for invitation and password recovery, never OTP sign-in (P6 superseded 12 Nov 2026).
- Charts: ECharts via `vue-echarts`, client-only components.
- PWA: `@vite-pwa/nuxt`. Validation: Zod, shared by forms and server routes.
- Tests: Vitest (`test/unit`, `test/integration`), Playwright (`test/e2e`).

## Where you run
- Agents started from Paseo run on the host of CT 157 (`rs-lxc-35`, 8 GB RAM), repo at
  `/root/projects/app-control-pediatrico`. The devcontainer `app-control-pediatrico-workspace-1`
  mounts the same repo at `/workspaces/app-control-pediatrico`.
- Dev services are published on loopback for host-side agents. Load them before tests or scripts:
  `set -a; . /root/.config/app-monitoreo-pediatrico/host-dev.env; set +a`
  (Postgres `127.0.0.1:5433`, Valkey `127.0.0.1:6380`, RustFS `127.0.0.1:9010`). Test data only.
- Never bind dev services to `0.0.0.0`.

## Workflow (one job = one worktree = one branch)
1. Create your worktree inside the repo so the devcontainer can see it:
   `git worktree add .worktrees/<job> -b <branch> origin/feat/alpha`, then `pnpm install` in it.
2. Point the live server at it:
   `docker exec app-control-pediatrico-workspace-1 sh -c 'echo /workspaces/app-control-pediatrico/.worktrees/<job> > /tmp/relay/live/src'`.
   It mirrors your files every 2 s and restarts itself when deps or migrations change.
3. Raul reviews in the Paseo shared browser at `http://localhost:3200` (live dev, hot reload).
   The stable preview is `http://localhost:3100`. Keep the worktree buildable: a broken file shows
   Raul an error overlay.
4. Before asking Raul to review: `pnpm lint && pnpm typecheck && pnpm test`, plus the integration
   tests for what you touched (`pnpm exec vitest run -c vitest.integration.config.ts <files>`).
5. Commit locally. Tell Raul what to look at (URL path and role). Wait for his OK, then push and
   open the PR into `feat/alpha`. Never merge into `main`; merging is Raul's decision.
6. When the job ends, point the live server back to the previous source if Raul asks, and remove
   your worktree with `git worktree remove .worktrees/<job>`.

## Commands
- `pnpm test` — unit tests · `pnpm test:e2e` — Playwright
- `pnpm lint` · `pnpm typecheck` · `pnpm build`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations
- Do not run `pnpm dev`/`nuxt dev`: the live server already serves your worktree.

## Resource and safety rules (CT 157 has 8 GB; it ran out of RAM twice)
- No dev servers of your own, no watch modes, no parallel test suites or builds.
  Vitest at most 2 threads; Playwright at most 2 workers; one `pnpm build` at the end of a job.
- Stop every server, browser and background process you start when its step ends (check with `ps`).
- Never put large files in `/tmp` on the CT host: it is tmpfs and lives in RAM. Use `/root/scratch/`.
- Never stop, restart or edit anything under `/tmp/relay/live` except the `src` file, never use
  port 3300, and never touch `pediatria-live`, `pediatria-live-proxy` or the `pediatria-preview` stack.
- Databases: never drop, recreate or reset `pediatrico`, the live DB
  `pediatrico_design_000000000000_test` (name in `/tmp/relay/live/live-db.txt` in the devcontainer),
  or any database you did not create in the current job.
- Never run `git worktree prune`: other worktrees are registered with devcontainer paths.
- Never commit `.nuxtrc`, `.env` or anything under `.worktrees/`.

## Specs and policies
- Spec: `docs/superpowers/specs/2026-11-12-first-release-design.md`; plan
  `docs/superpowers/plans/2026-11-12-clinical-alpha.md`; decisions `docs/decisions/`;
  pediatrician feedback `docs/clinical/2026-11-14-pediatrician-feedback-round-1.md`.
- `docs/design/DESIGN.md` is the authoritative design. When it and the board PNGs differ,
  DESIGN.md wins. Every decision from Raul goes into DESIGN.md (section + changelog,
  «Decidido por Raul <fecha>») in the same commit as the code. If DESIGN.md is silent, write your
  decision under «Pendiente de aprobación» and keep going.
- Catalog/draft policy: draft badge "Borrador - pendiente de revisión", facts only, provenance per
  entry, never copy third-party prose, never invent clinical or legal wording.
- PR gates: lint, typecheck, unit, integration (including Docker-only), Playwright, build. CI jobs:
  ci, ops-smoke, docker-integration, alpha-production-checkpoint (extend the checkpoint journey
  with each slice's main flow). Any PR into `main` needs full gates, green CI and Raul's approval.
- Run any new seed or migration once against a test DB before committing it.

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
- Build planning: `docs/handoff/planning.md`.

## Skills
Project skills live in `.agents/skills/`. Prefer them for: workflow and TDD (superpowers),
UI/UX design (ui-ux-pro-max), Nuxt UI components (nuxt-ui), browser testing (webapp-testing),
modern HTML/CSS/client JS (modern-web-guidance), this app's screens, charts, Z labels and copy
(control-pediatrico-ui). design-fidelity is suspended (see Current mode).

## Reporting
- Keep replies short. End each turn with what changed, what Raul should look at
  (`localhost:3200` path and role), what is pending, and one line:
  `STATUS: OK`, `STATUS: NEEDS_REVIEW` or `STATUS: BLOCKED <reason>`.
