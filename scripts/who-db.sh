#!/usr/bin/env bash
# Generate data/who.db from WHO Child Growth Standards LMS Excel tables.
#
# Usage:
#   bash scripts/who-db.sh [--force]
#
# This script:
#   1. Verifies python3 is available.
#   2. Creates a temporary virtualenv at scripts/.venv (idempotent).
#   3. Installs requests + openpyxl into the venv (only).
#   4. Runs scripts/who-db.py to download the WHO Excel tables and
#      build data/who.db.
#   5. Prints the resulting file size.
#
# data/who.db is committed to the repository and is read-only at runtime.
# Re-run this script only if WHO updates their LMS reference tables.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$REPO_ROOT/scripts"
VENV_DIR="$SCRIPTS_DIR/.venv"
DATA_DIR="$REPO_ROOT/data"
WHO_DB="$DATA_DIR/who.db"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '1,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: bash scripts/who-db.sh [--force]" >&2
      exit 2
      ;;
  esac
done

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 is required but was not found in PATH." >&2
  echo "Install Python 3.9+ and retry." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

if [[ -f "$WHO_DB" && "$FORCE" -ne 1 ]]; then
  echo "WARNING: $WHO_DB already exists."
  read -r -p "Overwrite? [y/N] " response
  case "$response" in
    [yY]|[yY][eE][sS]) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating Python venv at $VENV_DIR ..."
  python3 -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

python -m pip install --quiet --upgrade pip
python -m pip install --quiet "requests>=2.31" "openpyxl>=3.1"

python "$SCRIPTS_DIR/who-db.py" --output "$WHO_DB"

deactivate

if [[ -f "$WHO_DB" ]]; then
  size_bytes=$(stat -c%s "$WHO_DB" 2>/dev/null || stat -f%z "$WHO_DB")
  size_kb=$(( size_bytes / 1024 ))
  echo "OK: $WHO_DB created (${size_kb} KB)."
else
  echo "ERROR: $WHO_DB was not created." >&2
  exit 1
fi
