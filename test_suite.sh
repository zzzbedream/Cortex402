#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js no esta instalado o no esta en PATH"
  exit 1
fi

if [ -f "test_config.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "test_config.env"
  set +a
fi

node test_suite.js
