#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BUN_EXECUTABLE="${BUN_RUNTIME:-${BUN_BIN:-bun}}"

cd "${APP_ROOT}"

echo "[build.sh] Running Next.js build and Bun bundle in parallel..."

next build --turbo &
NEXT_PID=$!

"${BUN_EXECUTABLE}" build "scripts/pr-review/pr-review-inject.ts" \
  --outfile "scripts/pr-review/pr-review-inject.bundle.js" \
  --target "bun" \
  --external "@openai/codex-sdk" \
  --external "@openai/codex" \
  --external "zod" &
BUN_PID=$!

NEXT_STATUS=0
BUN_STATUS=0

wait "${NEXT_PID}" || NEXT_STATUS=$?
wait "${BUN_PID}" || BUN_STATUS=$?

if [ "${NEXT_STATUS}" -ne 0 ]; then
  echo "[build.sh] next build --turbo failed with exit code ${NEXT_STATUS}" >&2
fi

if [ "${BUN_STATUS}" -ne 0 ]; then
  echo "[build.sh] bun build for inject script failed with exit code ${BUN_STATUS}" >&2
fi

if [ "${NEXT_STATUS}" -ne 0 ] || [ "${BUN_STATUS}" -ne 0 ]; then
  exit 1
fi

echo "[build.sh] Build completed successfully."
