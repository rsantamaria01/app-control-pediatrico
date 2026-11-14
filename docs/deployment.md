# Deployment runbook

Deploy one Compose project and one database per clinic. TLS termination and the public HTTPS origin belong to the external reverse proxy; the app listens on port 3000. Restrict direct access to port 3000 and configure the proxy to overwrite forwarded headers. Do not put credentials or bootstrap links in source control, shell history, tickets or shared logs.

## Configuration

Create a local, git-ignored `.env` from `.env.example` and set unique production values before starting. Compose uses `DB_PASSWORD` for PostgreSQL and the app/ops database connection, and `S3_ACCESS_KEY` and `S3_SECRET_KEY` for RustFS and the app. Set `NUXT_APP_SECRET` (stable, random, at least 32 characters), `RECOVERY_QUEUE_SECRET` (stable 32 random bytes in hex), and `NUXT_PUBLIC_SITE_URL` (externally reachable HTTPS origin). Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_SECURE`, and, for authenticated SMTP, both `SMTP_USER` and `SMTP_PASS`. Set `AUTH_TRUSTED_PROXY_CIDR` only for a proxy that overwrites forwarded headers and blocks direct access. Optional branding uses `NUXT_PUBLIC_CLINIC_PRIMARY` and `NUXT_PUBLIC_CLINIC_LOGO`. Do not use example passwords in a public deployment.

Compose passes the raw `DB_PASSWORD` with fixed `DB_HOST=db` and `DB_NAME=pediatrico` to the app and ops; the Node entrypoint percent-encodes the password into `DATABASE_URL` for each child and removes the raw variable from the child environment. Do not assemble `DATABASE_URL` by string interpolation or override it in `.env`; delimiters in passwords must remain valid. The app gets `REDIS_URL` and S3 connection details; ops gets the same database password and the `.env` values needed for bootstrap. Avoid changing `DB_PASSWORD` without also updating the PostgreSQL user's password in the existing volume. Pin and review the RustFS image version before production use.

## First deployment

1. Provision a clinic-specific host, external TLS proxy, DNS, secure local `.env` and backup destination; verify the proxy and outbound SMTP configuration.
2. Run `docker compose --profile full up -d --build`. The `ops` container waits for a healthy database, runs committed Drizzle migrations, and exits successfully before the `app` starts. If migration fails, the app must not start: inspect `docker compose --profile full logs ops`, fix the cause and retry. Do not bypass the migration gate.
3. Set `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_EMAIL` temporarily in the git-ignored `.env` (restrict its permissions). Run `docker compose run --rm ops bootstrap-admin`. The command requires the HTTPS site URL and an empty user table with no prior bootstrap marker; it prints one single-use, seven-day invitation link. Deliver it privately to the administrator, set a password via the link, then remove the temporary bootstrap variables. Do not rerun bootstrap after users exist.
4. Verify sign-in, invitation email delivery, application logs, and the protected clinical access path with a real authorized account.

## Upgrades and recovery

### Upgrade with a write-free window

Schedule maintenance and block all external writes at the proxy (including direct port 3000 access), then wait for in-flight requests to drain. Keep the exact application version and matching database and RustFS backups together. Take and verify both backups with writes quiesced. In the project directory run:

```sh
sh scripts/upgrade.sh
```

The script builds both new images first, stops the old `app`, checks `docker compose --profile full ps --status running -q app` is empty, explicitly runs `ops db:migrate`, then starts the full profile. A failed stop, a still-running app or a failed migration exits before startup; keep the proxy in maintenance mode and investigate `docker compose --profile full logs ops` and the one-shot command output. `service_completed_successfully` also gates app startup; **it does not stop an already-running app**. Run the script only as the single deployment operator, not concurrently with other `docker compose up` commands or other writers. Do not use `docker compose --profile full up -d --build` for upgrades while the old app serves traffic. Keep maintenance active until the new app and protected access checks pass; only then reopen writes. Do not run `bootstrap-admin` during upgrades. Restore a compatible backup before rolling back an incompatible schema. A missing-schema recovery worker logs `schema not migrated` once and retries with a five-second backoff; migration failure still requires operator action.

### Backup and isolated restore drill

Use `pg_dump --format=custom --file /secure/backup/clinic.dump --dbname pediatrico` against the clinic-specific PostgreSQL database, with **all** schemas and tables, including `drizzle.__drizzle_migrations` and auth tables; choose a protected output location, enter credentials privately and encrypt the dump before off-host transfer. Back up RustFS object data at a matching point in the write-free window using RustFS vendor-supported snapshot/export procedures; preserve its configuration and encryption keys. Store the encrypted database dump and storage snapshot together off-host with access control and retention. Valkey (`cache-data`) is ephemeral cache/rate-limit state, not a database or object-storage backup.

Test a restore on a **separate isolated host and Compose project** with its own volumes, credentials and proxy disabled. Never point this drill at the live host or live volumes. With the isolated PostgreSQL service up and the app/ops services stopped, supply the encrypted backup to the isolated host securely, decrypt to a protected local file and use a test-only database name distinct from `pediatrico`. The dump/restore example uses a privileged isolated database role; this is not permission to grant CREATEDB to the production app role. The isolated PostgreSQL instance must listen on `127.0.0.1:5432` (or adjust the host/port consistently) and must **never** be a tunnel to the live clinic. Verify the endpoint and database name with the isolated operator before running `createdb`:

```sh
createdb --host 127.0.0.1 --username pediatrico pediatrico_restore_test
pg_restore --host 127.0.0.1 --username pediatrico --dbname pediatrico_restore_test --no-owner --no-acl --exit-on-error /secure/backup/clinic.dump
psql --host 127.0.0.1 --username pediatrico --dbname pediatrico_restore_test --no-psqlrc --command 'SELECT count(*) FROM drizzle.__drizzle_migrations;'
psql --host 127.0.0.1 --username pediatrico --dbname pediatrico_restore_test --no-psqlrc --command 'SELECT count(*) FROM "user";'
```

These commands require an isolated PostgreSQL endpoint exposed on that host; provide credentials through protected local mechanisms (not command arguments or logs). The role must have CREATEDB privilege and permission to create the restored `drizzle` schema. Confirm expected migration count, user count and representative clinical records against backup metadata, then restore the paired RustFS snapshot using the vendor's documented procedure to **isolated** storage. Verify object count/checksums and read a representative authorized record and object with test access controls, without emailing real users. Destroy the isolated project and plaintext dump securely after the drill. A real incident restore requires a separately reviewed maintenance plan, confirmed backup compatibility and explicit target verification; never run these commands against live production.
