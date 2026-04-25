# app-control-pediatrico

Clinical web application for tracking infant growth measurements (weight,
height, age) and visualising them against the WHO Child Growth Standards
LMS curves with computed Z-scores.

- Doctors record measurements; the API computes HAZ / WAZ / WHZ / BAZ
  using the LMS formula with the WHO disjoint regression cap.
- Parents (PATIENT role) get a read-only view of their child's chart.
- WHO LMS reference data ships as a pre-seeded read-only SQLite
  database (`data/who.db`). The application's own data lives in a
  second TypeORM DataSource that switches between SQLite and Postgres
  via env vars.

## Repository layout

```
apps/
  api/          NestJS (port 3001), TypeORM dual DataSource
  web/          Next.js App Router (port 3000), Tailwind, ECharts
packages/
  shared/       DTOs, enums, Z-score utility (LMS + disjoint cap)
  database/     TypeORM entities, App + WHO DataSources, migrations
data/
  who.db        Pre-seeded WHO LMS standards (read-only, committed)
  data.db       Runtime app DB (sqlite demo; gitignored)
scripts/
  who-db.sh     Bash entrypoint to (re)build data/who.db
  who-db.py     Downloads + parses 8 WHO Excel tables -> sqlite
  who-db-synthetic.py  Deterministic placeholder generator
docker-compose.yml          Production-style stack
docker-compose.override.yml Dev overrides (hot reload)
```

## Toolchain

- Node 20 LTS (a `.nvmrc` is included; Node 22 also works)
- pnpm 9.x via `corepack` (the root `package.json` pins `packageManager`)
- Python 3.9+ only when regenerating WHO data from cdn.who.int

## Local dev (no Docker)

```bash
corepack enable
pnpm install
cp .env.example .env

# Initialise the runtime app DB (sqlite by default)
pnpm --filter @app/database migration:run

# Run API + web with Turborepo
pnpm dev
```

- API on http://localhost:3001/api/v1 (Swagger: /api/docs)
- Web on http://localhost:3000

A bootstrap ADMIN user is seeded on first boot using
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults
`admin@example.com` / `changeme1234`). Sign in via
`/login/password` to get started, then create DOCTOR users.

## End-to-end demo flow

1. Sign in as ADMIN at http://localhost:3000/login/password.
2. Create a DOCTOR user under **Users**.
3. Sign out, sign back in as the DOCTOR (OTP via email or password).
4. Create a parent under **Parents**, add an email contact, click
   **Send code**, enter the OTP from the API logs to verify.
5. Create a patient under **Patients**, link the parent.
6. Open the patient → **Record measurement** (date, kg, cm). The API
   responds with HAZ / WAZ / WHZ / BAZ inline.
7. Toggle **Chart** ↔ **Table**. Switch indicators with the chart's
   buttons; the WHO band lines come from the LMS data filtered by
   the patient's gender.
8. The table view colours each Z-score by band:
   green ≤ |1| · yellow ≤ |2| · orange ≤ |3| · red > |3|.

## Z-score computation

Implemented in `packages/shared/src/zscore.ts`:

```
if L != 0:  Z = ((Y / M)^L − 1) / (L · S)
if L == 0:  Z = ln(Y / M) / S
```

Values beyond ±3 SD are remapped via the WHO disjoint regression rule
using `SD23 = SD3 − SD2` (and analogously below). `valueAtZ()` is the
inverse used to render the WHO reference lines on the chart.

## Switching SQLite ↔ Postgres

The same code runs on both engines. Edit `.env`:

```
DATABASE_TYPE=postgres
DATABASE_URL=postgres://app:app@db:5432/app
```

Then start with the postgres compose profile:

```bash
docker compose --profile postgres up --build
```

Run migrations once: `pnpm --filter @app/database migration:run`.

## Regenerating `data/who.db`

The WHO LMS reference table changes only when WHO publishes an update.
To regenerate:

```bash
bash scripts/who-db.sh --force
```

This:
- Verifies `python3` is available
- Creates `scripts/.venv` and installs `requests` + `openpyxl`
- Downloads 8 WHO `.xlsx` tables from `cdn.who.int`
- Parses L/M/S columns by header name (case-insensitive)
- Writes `data/who.db` atomically (temp file + rename)

> **Note:** the committed `data/who.db` was generated from
> `scripts/who-db-synthetic.py` because the build sandbox could not
> reach `cdn.who.int`. The schema and ranges match the real WHO data;
> values are deterministic plausible curves. Replace with real WHO data
> by running the script above on a machine with outbound HTTPS.

## Docker

Build and run the production stack:

```bash
docker compose up --build
```

- The API image bakes `data/who.db` into the layer at build time
  (read-only at runtime).
- The runtime app DB lives on the `app-data` named volume (sqlite by
  default, or use the `postgres` profile).
- A `docker-compose.override.yml` is layered automatically when running
  `docker compose up` locally; it volume-mounts source for hot reload.

## Notification channels

`NotificationModule` resolves active providers from
`NOTIFICATION_CHANNELS` (comma-separated): `EMAIL`, `SMS`, `WHATSAPP`,
`TELEGRAM`. Only `EmailProvider` is fully wired (Nodemailer / SMTP);
the rest are `console.log` stubs with TODOs for Twilio / WhatsApp
Business / Telegram Bot integrations.

When `SMTP_HOST` is empty the EmailProvider also logs to console — useful
for local dev without an SMTP server.

## Running tests

```bash
pnpm test          # vitest in @app/shared (z-score)
```

End-to-end smoke (after `pnpm dev` is up):

```bash
curl -s http://localhost:3001/api/v1/auth/password \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme1234"}'
```

## Authentication

- Primary: 6-digit OTP, argon2-hashed in `otp_codes`, 10-minute TTL.
- Fallback: email + password (argon2 on `users.password_hash`).
- JWT access (15 min) + refresh (7 d) pair; refresh tokens are
  rotated on every use, the previous hash is revoked.
- Role enforcement via `@Roles(...)` + global `RolesGuard`. `@Public()`
  opts out of auth (used on OTP request/verify, password, refresh).

## Roles

- **ADMIN**: full access; manages users.
- **DOCTOR**: creates/reads/updates patients, parents and measurements.
- **PATIENT** (the parent's user account): read-only access to their
  linked children's data.
