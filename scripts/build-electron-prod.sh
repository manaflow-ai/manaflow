#!/bin/bash
set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"

# Prefer production env for local packaging; fall back to .env if missing
ENV_FILE="$ROOT_DIR/.env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
fi

echo "==> Using env file: $ENV_FILE"

(cd "$CLIENT_DIR" && bun run --env-file "$ENV_FILE" build:mac:workaround)
