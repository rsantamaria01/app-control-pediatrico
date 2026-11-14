#!/bin/sh
set -eu
docker compose --profile full build app ops
docker compose --profile full stop app
running=$(docker compose --profile full ps --status running -q app)
if [ -n "$running" ]; then
  exit 1
fi
docker compose --profile full run --rm ops db:migrate
docker compose --profile full up -d --no-build
