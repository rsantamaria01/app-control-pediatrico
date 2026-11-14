#!/bin/sh
set -eu

[ ! -e .env ]
[ -z "${WHO_ALLOW_CLINICAL_IMPORT:-}" ]
project="ops-smoke-$(openssl rand -hex 6)"
image="${project}-ops"
compose() {
  docker compose --env-file /dev/null --project-name "$project" --profile full "$@"
}
cleanup() {
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

docker build --target ops -t "$image" .
if output=$(docker run --rm --network none --read-only -e DB_PASSWORD -e DB_HOST=127.0.0.1 -e COREPACK_HOME=/unwritable-corepack "$image" db:migrate 2>&1); then
  exit 1
fi
case "$output" in
  *Corepack*|*corepack*|*EACCES*|*download*) exit 1 ;;
esac
case "$output" in
  *ECONNREFUSED*|*ENETUNREACH*|*connect*) ;;
  *) exit 1 ;;
esac
for approval in unset true; do
  if [ "$approval" = unset ]; then
    if output=$(docker run --rm --network none --read-only "$image" who-import import 2>&1); then
      exit 1
    fi
  else
    if output=$(docker run --rm --network none --read-only -e WHO_ALLOW_CLINICAL_IMPORT=true "$image" who-import import 2>&1); then
      exit 1
    fi
  fi
  case "$output" in
    *'Explicit WHO import approval required'*) ;;
    *) exit 1 ;;
  esac
done

compose up -d --build
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

compose run --rm -T --no-deps --entrypoint node ops -e 'const fs = require("node:fs"); if (process.getuid() === 0) process.exit(1); fs.writeFileSync("/who-source/ci-volume-check", "ok")'
compose run --rm -T --no-deps --entrypoint node ops -e 'const fs = require("node:fs"); if (fs.readFileSync("/who-source/ci-volume-check", "utf8") !== "ok") process.exit(1)'

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
