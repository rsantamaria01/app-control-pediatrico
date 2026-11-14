# Deployment runbook

Deploy one Compose project and one database per clinic. TLS termination and the public HTTPS origin belong to the external reverse proxy; the app listens on port 3000. Restrict direct access to port 3000 and configure the proxy to overwrite forwarded headers. Do not put credentials or bootstrap links in source control, shell history, tickets or shared logs.

## Configuration

Create a local, git-ignored `.env` from `.env.example` and set unique production values before starting. Compose uses `DB_PASSWORD` for PostgreSQL and the app/ops database connection, and `S3_ACCESS_KEY` and `S3_SECRET_KEY` for RustFS and the app. Set `NUXT_APP_SECRET` (stable, random, at least 32 characters), `RECOVERY_QUEUE_SECRET` (stable 32 random bytes in hex), and `NUXT_PUBLIC_SITE_URL` (externally reachable HTTPS origin). Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_SECURE`, and, for authenticated SMTP, both `SMTP_USER` and `SMTP_PASS`. Set `AUTH_TRUSTED_PROXY_CIDR` only for a proxy that overwrites forwarded headers and blocks direct access. Optional branding uses `NUXT_PUBLIC_CLINIC_PRIMARY` and `NUXT_PUBLIC_CLINIC_LOGO`. Do not use example passwords in a public deployment.

The app's Compose environment explicitly sets `DATABASE_URL`, `REDIS_URL`, and S3 connection details. The ops service gets the same database URL and the `.env` values needed for the one-time bootstrap. Avoid changing `DB_PASSWORD` without also updating the PostgreSQL user's password in the existing volume. Pin and review the RustFS image version before production use.

## First deployment

1. Provision a clinic-specific host, external TLS proxy, DNS, secure local `.env` and backup destination; verify the proxy and outbound SMTP configuration.
2. Run `docker compose --profile full up -d --build`. The `ops` container waits for a healthy database, runs committed Drizzle migrations, and exits successfully before the `app` starts. If migration fails, the app must not start: inspect `docker compose --profile full logs ops`, fix the cause and retry. Do not bypass the migration gate.
3. Set `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_EMAIL` temporarily in the git-ignored `.env` (restrict its permissions). Run `docker compose run --rm ops bootstrap-admin`. The command requires the HTTPS site URL and an empty user table with no prior bootstrap marker; it prints one single-use, seven-day invitation link. Deliver it privately to the administrator, set a password via the link, then remove the temporary bootstrap variables. Do not rerun bootstrap after users exist.
4. Verify sign-in, invitation email delivery, application logs, and the protected clinical access path with a real authorized account.

## Upgrades and recovery

Before each upgrade, take and verify a PostgreSQL backup and a consistent RustFS object-data backup. Keep the exact application version and the matching database backup together. Stop writes during backup/restore and coordinate application downtime for schema-changing releases. Build and start with `docker compose --profile full up -d --build`; `ops` applies outstanding migrations before starting the new app. If an upgrade fails, inspect the ops logs; restore from a compatible backup before rolling back an incompatible schema. Do not run `bootstrap-admin` during upgrades. A missing-schema recovery worker logs `schema not migrated` once and retries with a five-second backoff; migration failure still requires operator action.

For database backups, use `pg_dump`/`pg_restore` against the clinic-specific PostgreSQL database, including the Drizzle migrations history and auth tables. For RustFS, follow the storage vendor's snapshot/export and restore procedure for `storage-data`; test restoring both data stores together in a separate environment before relying on them. Treat dumps as clinical data: encrypt, restrict access, define retention and test recovery regularly. Valkey (`cache-data`) is ephemeral cache/rate-limit state and is not a substitute for PostgreSQL or object-storage backups. Never run destructive restore commands against the live clinic without a verified target and maintenance window.
