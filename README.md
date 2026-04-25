# app-control-pediatrico

Clinical web application for tracking infant and child growth
measurements (weight, height, age) and visualising them against the
CDC growth-chart LMS curves with computed Z-scores.

- Doctors record measurements; the API computes HAZ / WAZ / WHZ / BAZ
  using the LMS formula with the WHO disjoint regression cap.
- Parents (PATIENT role) get a read-only view of their child's chart.
- Patients are **never self-registered** — a doctor or admin creates
  them and links a parent.
- Reference LMS data lives as static **CSV files** under `data/lms/`
  (one file per indicator+age range; no database needed for the
  reference data). The application's own data lives in **Postgres**.

## Repository layout

```
apps/
  api/          NestJS (port 3001)
  web/          Next.js App Router (port 3000), Tailwind, ECharts
packages/
  shared/       DTOs, enums, Z-score utility (LMS + disjoint cap)
  database/     TypeORM entities, App DataSource (Postgres), migrations
data/
  lms/          CDC growth-chart CSV files (committed, read-only)
scripts/
  lms-csv-mock.py  Generates mock CDC LMS CSVs for the demo
docker-compose.yml  Single-file production-style stack (api + web + db)
```

## Toolchain

- Node 20 LTS (a `.nvmrc` is included; Node 22 also works)
- pnpm 9.x via `corepack` (the root `package.json` pins `packageManager`)
- Docker + docker-compose
- Python 3.9+ only when regenerating the mock CSVs

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

That brings up Postgres, the API (which auto-runs migrations on boot)
and the web UI:

- Web on http://localhost:3000
- API on http://localhost:3001/api/v1 (Swagger: /api/docs)
- Postgres on localhost:5432 (`app` / `app`)

A bootstrap ADMIN user is seeded on first boot using
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (defaults
`admin@example.com` / `changeme1234`). Sign in via
`/login/password` to get started, then create DOCTOR users.

## Local dev (no Docker)

You still need a Postgres instance. The simplest path is to run only
the `db` service from compose and run the rest natively:

```bash
docker compose up -d db
corepack enable
pnpm install
cp .env.example .env  # DATABASE_URL defaults work for the db container
pnpm dev              # turbo runs api + web + shared/db builds
```

## End-to-end demo flow

1. Sign in as ADMIN at http://localhost:3000/login/password.
2. Create a DOCTOR user under **Users**.
3. Sign out, sign back in as the DOCTOR.
4. Create a parent under **Parents**, add an email or phone contact.
   (If no notification channel is configured the contact is marked
   verified automatically; otherwise click **Send code**.)
5. Create a patient under **Patients**, link the parent.
6. Open the patient → **Record measurement** (date, kg, cm). The API
   responds with HAZ / WAZ / WHZ / BAZ inline.
7. Toggle **Chart** ↔ **Table**. Switch indicators with the chart's
   buttons; the LMS band lines come from the CSV files filtered by
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
inverse used to render the reference percentile lines on the chart.

## CDC LMS reference data (CSV files)

The application reads every `*.csv` in `LMS_DATA_DIR` (default
`./data/lms`) once at startup and indexes the rows by indicator and
gender. Files follow a strict naming convention:

```
<xAxis>_<yAxis>_<initialMonth>_<lastMonth>.csv
```

Letters: `a`=age (months), `w`=weight (kg), `h`=height/stature (cm),
`l`=length (cm), `b`=BMI, `hc`=head circumference (cm).

Examples shipped under `data/lms/`:

| File | Indicator | Range |
|------|-----------|-------|
| `h_a_0_240.csv`  | height-for-age (length 0–24 mo, stature 24–240 mo) | 0–240 months |
| `w_a_0_240.csv`  | weight-for-age | 0–240 months |
| `b_a_24_240.csv` | BMI-for-age   | 24–240 months |
| `hc_a_0_36.csv`  | head-circumference-for-age | 0–36 months |
| `w_h_45_121.csv` | weight-for-stature (x-axis is cm, not months) | 45–121 cm |

CSV column layout matches the CDC published tables:

```
Sex,X,L,M,S,P3,P5,P10,P25,P50,P75,P85,P90,P95,P97
```

`Sex` is `1` for male, `2` for female. The API uses only `L`, `M`,
`S`; the percentile columns are included so the file is
self-describing.

To regenerate the demo mock files:

```bash
python3 scripts/lms-csv-mock.py
```

To use real reference data, download the CDC tables from
<https://www.cdc.gov/growthcharts/cdc-data-files.htm>, convert each
table to the layout above, name the files using the convention, and
drop them in `data/lms/` (overwriting the mocks).

## Notification channels (all optional)

Each channel auto-enables when its credentials env vars are present:

| Channel  | Enabled when… |
|----------|---------------|
| EMAIL    | `SMTP_HOST` is set |
| SMS      | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM` are set |
| WHATSAPP | `WHATSAPP_API_KEY` is set |
| TELEGRAM | `TELEGRAM_BOT_TOKEN` is set |

Effects when no channels are configured (the default `.env.example`):

- The doctor or admin enters parent contact data; contacts are marked
  verified automatically since there is no way to send a code.
- OTP login is unavailable. Users sign in via password.

The web UI calls `GET /auth/config` to discover the active channels
and adapt accordingly.

## Roles

- **ADMIN**: full access; manages users.
- **DOCTOR**: creates/reads/updates patients, parents and measurements.
- **PATIENT** (the parent's user account): read-only access to their
  linked children's data.

## Authentication

- Primary: 6-digit OTP, argon2-hashed in `otp_codes`, 10-minute TTL —
  available only when at least one notification channel is enabled.
- Always available: email + password (argon2 on `users.password_hash`).
- JWT access (15 min) + refresh (7 d) pair; refresh tokens are
  rotated on every use, the previous hash is revoked.
- Role enforcement via `@Roles(...)` + global `RolesGuard`. `@Public()`
  opts out of auth (used on OTP request/verify, password, refresh,
  `/auth/config`).

## Running tests

```bash
pnpm test          # vitest in @app/shared (z-score)
```

End-to-end smoke (after `docker compose up` is healthy):

```bash
curl -s http://localhost:3001/api/v1/auth/password \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"changeme1234"}'
```
