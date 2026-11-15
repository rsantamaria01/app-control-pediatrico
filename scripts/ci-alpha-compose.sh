#!/bin/sh
set -eu
[ ! -e .env ]
[ -z "${WHO_ALLOW_CLINICAL_IMPORT:-}" ]
project="alphacheckpoint$(openssl rand -hex 6)"
export DB_NAME="pediatrico_alpha_$(openssl rand -hex 6)_test"
export DB_PASSWORD="$(openssl rand -hex 24)"
export S3_ACCESS_KEY="$(openssl rand -hex 16)"
export S3_SECRET_KEY="$(openssl rand -hex 24)"
export NUXT_APP_SECRET="$(openssl rand -hex 32)"
export RECOVERY_QUEUE_SECRET="$(openssl rand -hex 32)"
export NUXT_PUBLIC_SITE_URL=https://127.0.0.1:3443
export APP_BIND_ADDRESS=127.0.0.1
export SMTP_HOST=mailpit
export SMTP_PORT=1025
export SMTP_FROM=checkpoint@example.test
export SMTP_SECURE=false
export ALPHA_PUBLIC_ORIGIN="$NUXT_PUBLIC_SITE_URL"
export COMPOSE_PARALLEL_LIMIT=2
export COMPOSE_PROJECT_NAME="$project"
compose() {
  docker compose --env-file /dev/null --project-name "$project" --profile full "$@"
}
phase=preflight
proxy_cert=
proxy_key=
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then printf 'alpha checkpoint failed phase=%s\n' "$phase" >&2; fi
  docker rm -f "${project}-proxy" "${project}-mailpit" "${project}-pgtest" >/dev/null 2>&1 || true
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  if [ -n "$proxy_cert" ]; then rm -f "$proxy_cert"; fi
  if [ -n "$proxy_key" ]; then rm -f "$proxy_key"; fi
}
trap 'exit 1' INT TERM
trap cleanup EXIT
umask 077
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  for value in "$DB_PASSWORD" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" "$NUXT_APP_SECRET" "$RECOVERY_QUEUE_SECRET"; do printf '::add-mask::%s\n' "$value"; done
fi
phase=build
compose build app ops
phase=migrate
compose up -d db cache storage
phase=mailpit
docker run -d --name "${project}-mailpit" -p 127.0.0.1:8025:8025 axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce >/dev/null
docker network connect --alias mailpit "${project}_default" "${project}-mailpit"
network_subnet=$(docker network inspect --format '{{(index .IPAM.Config 0).Subnet}}' "${project}_default")
network_gateway=$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' "${project}_default")
case "$network_subnet" in
  *.*.*.0/24) ;;
  *) exit 1 ;;
esac
case "$network_gateway" in
  *.*.*.*) network_prefix=${network_gateway%.*} ;;
  *) exit 1 ;;
esac
export ALPHA_DIRECT_PEER_IP="${network_prefix}.250"
export ALPHA_PROXY_IP="${network_prefix}.251"
export ALPHA_COMPOSE_PROJECT="$project"
export AUTH_TRUSTED_PROXY_CIDR="${ALPHA_PROXY_IP}/32"
compose up -d app
[ "$(compose exec -T db psql -U pediatrico -d "$DB_NAME" -Atqc 'SELECT count(*) FROM who_dataset')" = 0 ]
[ "$(compose exec -T db psql -U pediatrico -d "$DB_NAME" -Atqc 'SELECT count(*) FROM drizzle.__drizzle_migrations')" -gt 0 ]
phase=tls
proxy_cert=$(mktemp)
proxy_key=$(mktemp)
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$proxy_key" -out "$proxy_cert" -days 1 -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' >/dev/null 2>&1
export NODE_EXTRA_CA_CERTS="$proxy_cert"
docker run -d --name "${project}-proxy" --network "${project}_default" --ip "$ALPHA_PROXY_IP" -p 127.0.0.1:3443:443 -v "$PWD/scripts/ci-alpha-proxy.conf:/etc/nginx/conf.d/default.conf:ro" -v "$proxy_cert:/etc/nginx/tls/cert.pem:ro" -v "$proxy_key:/etc/nginx/tls/key.pem:ro" nginx:1.27-alpine >/dev/null
phase=ready
ops_id=$(compose ps -a -q ops)
app_id=$(compose ps --status running -q app)
[ -n "$ops_id" ] && [ -n "$app_id" ]
[ "$(docker inspect --format '{{.State.ExitCode}}' "$ops_id")" = 0 ]
ready=false
for attempt in $(seq 1 60); do
  if curl --insecure -fsS --max-time 3 -o /dev/null "$NUXT_PUBLIC_SITE_URL/"; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ]
phase=bootstrap
export BOOTSTRAP_ADMIN_USERNAME=firstadmin
export BOOTSTRAP_ADMIN_EMAIL=first@example.test
export ALPHA_ADMIN_PASSWORD="$(compose run --rm -T --no-deps -e BOOTSTRAP_ADMIN_USERNAME -e BOOTSTRAP_ADMIN_EMAIL ops bootstrap-admin --generated-password)"
[ "${#ALPHA_ADMIN_PASSWORD}" -eq 43 ]
if [ "${GITHUB_ACTIONS:-}" = true ]; then printf '::add-mask::%s\n' "$ALPHA_ADMIN_PASSWORD"; fi
if compose run --rm -T --no-deps -e BOOTSTRAP_ADMIN_USERNAME -e BOOTSTRAP_ADMIN_EMAIL ops bootstrap-admin --generated-password >/dev/null 2>&1; then exit 1; fi
phase=fixture
node --experimental-transform-types scripts/import-who.ts download >/dev/null
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; const manifest=JSON.parse(readFileSync("scripts/who-2006-manifest.json")); for(const file of manifest.files){const bytes=readFileSync(`/tmp/opencode/who-2006/${file.name}-expanded.xlsx`); if(createHash("sha256").update(bytes).digest("hex")!==file.sha256) throw Error(`WHO source mismatch: ${file.name}`)}'
docker run --rm --network "${project}_default" -v "$PWD:/app" -v /tmp/opencode/who-2006:/tmp/opencode/who-2006:ro -w /app -e DB_NAME -e DB_PASSWORD -e DB_HOST=db node:24-alpine node --experimental-transform-types scripts/ci-alpha-fixture.ts
[ "$(compose exec -T db psql -U pediatrico -d "$DB_NAME" -Atqc 'SELECT count(*) FROM who_dataset')" = 12 ]
phase=clinical-integration
compose exec -T db createdb -U pediatrico pediatrico_who_slice3_test
[ "$(compose exec -T db psql -U pediatrico -d pediatrico_who_slice3_test -Atqc 'SELECT current_database()')" = pediatrico_who_slice3_test ]
docker run -d --name "${project}-pgtest" --network "${project}_default" -p 127.0.0.1:5433:5432 node:24-alpine node -e 'const net = require("node:net"); net.createServer(peer => { const db = net.connect(5432, "db"); peer.pipe(db); db.pipe(peer); peer.on("error", () => db.destroy()); db.on("error", () => peer.destroy()) }).listen(5432, "0.0.0.0")' >/dev/null
export WHO_TEST_DATABASE_URL="postgres://pediatrico:${DB_PASSWORD}@127.0.0.1:5433/pediatrico_who_slice3_test"
node --input-type=module -e 'import pg from "pg"; const pool = new pg.Pool({connectionString: process.env.WHO_TEST_DATABASE_URL, connectionTimeoutMillis: 5000}); try { const result = await pool.query("select current_database() as name"); if(result.rows[0]?.name !== "pediatrico_who_slice3_test") process.exitCode = 1 } finally { await pool.end() }'
pnpm exec vitest run --config vitest.integration.config.ts test/integration/who-reference.test.ts test/integration/reference-selection.test.ts --reporter=json --outputFile=/tmp/opencode/alpha-who-integration.json
node --input-type=module -e 'import {readFileSync} from "node:fs"; const result=JSON.parse(readFileSync("/tmp/opencode/alpha-who-integration.json")); if(result.numPassedTests < 20 || result.numPendingTests !== 0 || result.numFailedTests !== 0 || result.numFailedTestSuites !== 0 || result.testResults.length !== 2) process.exit(1); for(const name of ["who-reference.test.ts", "reference-selection.test.ts"]) if(!result.testResults.some(file=>file.name.endsWith(name) && file.status === "passed")) process.exit(1); console.log(`WHO/Anthro isolated integration: ${result.numPassedTests} passed, 0 skipped`)'
phase=journey
ALPHA_COMPOSE_E2E=1 pnpm exec playwright test test/e2e/alpha-journey.spec.ts --workers=1
phase=security
ALPHA_COMPOSE_E2E=1 pnpm exec vitest run --config vitest.integration.config.ts test/integration/security.test.ts
phase=gate
[ "$(compose exec -T db psql -U pediatrico -d "$DB_NAME" -Atqc 'SELECT count(*) FROM who_reference_row')" = 17260 ]
printf 'alpha checkpoint passed: isolated production Compose, migration, WHO verified fixture, journey, security\n'
