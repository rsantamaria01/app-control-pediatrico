#!/bin/sh
set -eu

[ ! -e .env ]
[ -z "${WHO_ALLOW_CLINICAL_IMPORT:-}" ]
project="ops-smoke-$(openssl rand -hex 6)"
image="${project}-ops"
compose() {
  docker compose --env-file /dev/null --project-name "$project" --profile full "$@"
}
phase=preflight
failure_code=COMMAND_FAILED
fail() {
  failure_code=$1
  exit 1
}
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf 'ops-smoke failed phase=%s code=%s\n' "$phase" "$failure_code" >&2
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -f .env
}
trap 'exit 1' INT TERM
trap cleanup EXIT

export COMPOSE_PARALLEL_LIMIT=2
export DB_PASSWORD="$(openssl rand -hex 24)"
export S3_ACCESS_KEY="$(openssl rand -hex 16)"
export S3_SECRET_KEY="$(openssl rand -hex 24)"
export NUXT_APP_SECRET="$(openssl rand -hex 32)"
export RECOVERY_QUEUE_SECRET="$(openssl rand -hex 32)"
export NUXT_PUBLIC_SITE_URL=https://clinic.example.test
umask 077
printf 'NUXT_APP_SECRET=%s\nRECOVERY_QUEUE_SECRET=%s\nNUXT_PUBLIC_SITE_URL=%s\n' "$NUXT_APP_SECRET" "$RECOVERY_QUEUE_SECRET" "$NUXT_PUBLIC_SITE_URL" > .env
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  for value in "$DB_PASSWORD" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" "$NUXT_APP_SECRET" "$RECOVERY_QUEUE_SECRET"; do
    printf '::add-mask::%s\n' "$value"
  done
fi

phase=build
docker build --target ops -t "$image" .
phase=offline-migration
if output=$(docker run --rm --network none --read-only -e DB_PASSWORD -e DB_HOST=127.0.0.1 -e COREPACK_HOME=/unwritable-corepack "$image" db:migrate 2>&1); then
  fail OFFLINE_UNEXPECTED_SUCCESS
fi
case "$output" in
  *Corepack*|*corepack*) fail OFFLINE_COREPACK ;;
esac
case "$output" in
  *EACCES*|*'permission denied'*) fail OFFLINE_PERMISSION ;;
esac
case "$output" in
  *'about to download'*|*'Downloading the pnpm'*|*'Downloading pnpm'*) fail OFFLINE_DOWNLOAD ;;
esac
case "$output" in
  *ECONNREFUSED*|*ENETUNREACH*) ;;
  *'docker: Error'*|*'Error response from daemon'*|*'Cannot connect to the Docker daemon'*) fail OFFLINE_DOCKER_ERROR ;;
  *'Cannot find module'*|*MODULE_NOT_FOUND*|*ERR_MODULE_NOT_FOUND*) fail OFFLINE_MODULE_NOT_FOUND ;;
  *'Cannot find package'*|*'Cannot resolve'*|*'Failed to resolve'*) fail OFFLINE_DEPENDENCY_ERROR ;;
  *"Error: ENOENT: no such file or directory, open "*) fail OFFLINE_ENOENT_OPEN ;;
  *"Error: ENOENT: no such file or directory, mkdir "*) fail OFFLINE_ENOENT_MKDIR ;;
  *"Error: ENOENT: no such file or directory, stat "*) fail OFFLINE_ENOENT_STAT ;;
  *"Error: ENOENT"*) fail OFFLINE_ENOENT_OTHER ;;
  *"/tmp/"*|*"/root/"*) fail OFFLINE_PATH_TMP ;;
  *ENOENT*|*'No such file or directory'*) fail OFFLINE_PATH_OTHER ;;
  *'Database credentials are missing'*|*'DATABASE_URL required'*|*'dbCredentials'*) fail OFFLINE_DB_CONFIG_ERROR ;;
  *TypeError*) fail OFFLINE_RUNTIME_TYPE_ERROR ;;
  *'Cannot find config file'*) fail OFFLINE_MISSING_CONFIG ;;
  *EROFS*|*'Read-only file system'*) fail OFFLINE_READ_ONLY ;;
  *SyntaxError*) fail OFFLINE_SYNTAX_ERROR ;;
  *'connect '*|*'Connection '*|*'connection '*) fail OFFLINE_CONNECTION_OTHER ;;
  *) fail OFFLINE_RUNTIME_OTHER ;;
esac
phase=who-gate
for approval in unset true; do
  if [ "$approval" = unset ]; then
    if output=$(docker run --rm --network none --read-only "$image" who-import import 2>&1); then
      fail WHO_GATE_UNEXPECTED_SUCCESS
    fi
  else
    if output=$(docker run --rm --network none --read-only -e WHO_ALLOW_CLINICAL_IMPORT=true "$image" who-import import 2>&1); then
      fail WHO_GATE_UNEXPECTED_SUCCESS
    fi
  fi
  case "$output" in
    *'Explicit WHO import approval required'*) ;;
    *) fail WHO_GATE_MISSING_APPROVAL_ERROR ;;
  esac
done

phase=compose-up
compose up -d --build
phase=compose-verify
ops_id=$(compose ps -a -q ops)
app_id=$(compose ps --status running -q app)
[ -n "$ops_id" ] && [ -n "$app_id" ]
[ "$(docker inspect --format '{{.State.Status}}' "$ops_id")" = exited ]
[ "$(docker inspect --format '{{.State.ExitCode}}' "$ops_id")" = 0 ]
[ "$(docker inspect --format '{{.State.Running}}' "$app_id")" = true ]
[ "$(compose exec -T db psql -U pediatrico -d pediatrico -Atqc 'SELECT count(*) FROM drizzle.__drizzle_migrations')" -gt 0 ]
[ "$(compose exec -T db psql -U pediatrico -d pediatrico -Atqc 'SELECT count(*) FROM who_dataset')" = 0 ]

ready=false
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 2 -o /dev/null http://127.0.0.1:3000/; then
    ready=true
    break
  fi
  if [ "$(docker inspect --format '{{.State.Running}}' "$app_id")" != true ]; then
    exit 1
  fi
  sleep 2
done
[ "$ready" = true ]

phase=who-volume
compose run --rm -T --no-deps --entrypoint node ops -e 'const fs = require("node:fs"); if (process.getuid() === 0) process.exit(1); fs.writeFileSync("/who-source/ci-volume-check", "ok")'
compose run --rm -T --no-deps --entrypoint node ops -e 'const fs = require("node:fs"); if (fs.readFileSync("/who-source/ci-volume-check", "utf8") !== "ok") process.exit(1)'

phase=bootstrap
link=$(compose run --rm -T --no-deps -e BOOTSTRAP_ADMIN_USERNAME=firstadmin -e BOOTSTRAP_ADMIN_EMAIL=first@example.test ops bootstrap-admin)
case "$link" in
  *https://clinic.example.test/invitacion/*) ;;
  *) exit 1 ;;
esac
[ "$(compose exec -T db psql -U pediatrico -d pediatrico -Atqc "SELECT count(*) FROM user_role WHERE role = 'ADMIN'")" = 1 ]
if compose run --rm -T --no-deps -e BOOTSTRAP_ADMIN_USERNAME=firstadmin -e BOOTSTRAP_ADMIN_EMAIL=first@example.test ops bootstrap-admin >/dev/null 2>&1; then
  exit 1
fi
[ "$(compose exec -T db psql -U pediatrico -d pediatrico -Atqc 'SELECT count(*) FROM who_dataset')" = 0 ]
