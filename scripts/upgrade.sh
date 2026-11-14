#!/bin/sh
set -eu
docker compose --profile full build app ops
docker compose --profile full stop app
running=$(docker compose --profile full ps --status running -q app)
if [ -n "$running" ]; then
  exit 1
fi
if [ -z "${BACKUP_DIR:-}" ] || [ ! -d "$BACKUP_DIR" ] || [ -L "$BACKUP_DIR" ]; then
  exit 1
fi
umask 077
set -C
docker compose --profile full exec -T db pg_dump -U pediatrico -d pediatrico -Fc > "$BACKUP_DIR/clinic.dump"
docker compose --profile full exec -T db pg_restore --list < "$BACKUP_DIR/clinic.dump" > /dev/null
if [ ! -s "$BACKUP_DIR/clinic.dump" ]; then
  exit 1
fi
printf 'Verify the paired RustFS snapshot outside this script; type snapshot-verified to proceed: ' >&2
read -r confirmation
if [ "$confirmation" != 'snapshot-verified' ]; then
  exit 1
fi
docker compose --profile full run --rm ops db:migrate
docker compose --profile full up -d --no-build
