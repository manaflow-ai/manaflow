#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT_DIR/apps/client"
DEFAULT_APP_NAME="cmux-staging"
APP_BUNDLE_ID="com.cmux.app"
# 255 chars keeps us within the strictest common file-name limit (APFS/ext4/NTFS).
APP_NAME_MAX_LENGTH=255

wait_for_process_exit() {
  local pattern="$1"
  local timeout="${2:-10}"
  local deadline=$((SECONDS + timeout))

  while pgrep -f "$pattern" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      return 1
    fi
    sleep 0.5
  done

  return 0
}

stop_staging_app_instances() {
  local pattern="$1"
  local _bundle_id="$2"

  if ! pgrep -f "$pattern" >/dev/null 2>&1; then
    echo "==> No running $pattern instances detected."
    return 0
  fi

  echo "==> Forcing SIGKILL for $pattern..."
  pkill -KILL -f "$pattern" >/dev/null 2>&1 || true
  if wait_for_process_exit "$pattern" 5; then
    echo "==> $pattern processes terminated after SIGKILL."
    return 0
  fi

  echo "WARNING: $pattern processes still running after SIGKILL." >&2
  return 1
}

current_git_ref() {
  if ! command -v git >/dev/null 2>&1; then
    return 0
  fi

  local ref=""
  ref="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -n "$ref" && "$ref" != "HEAD" ]]; then
    printf '%s\n' "$ref"
    return 0
  fi

  ref="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -n "$ref" ]]; then
    printf '%s\n' "$ref"
  fi
}

sanitize_branch_name() {
  local branch="$1"
  if [[ -z "${branch:-}" ]]; then
    return 0
  fi

  if command -v iconv >/dev/null 2>&1; then
    local ascii_branch=""
    ascii_branch="$(printf '%s' "$branch" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || true)"
    if [[ -n "$ascii_branch" ]]; then
      branch="$ascii_branch"
    fi
  fi

  local sanitized=""
  sanitized="$(printf '%s' "$branch" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g' | sed -E 's/^-+|-+$//g')"
  printf '%s\n' "$sanitized"
}

compose_app_name() {
  local base="$1"
  local suffix="$2"
  local max_len="$3"

  if [[ -z "${suffix:-}" ]]; then
    printf '%s\n' "$base"
    return 0
  fi

  local candidate="${base}-${suffix}"
  if (( ${#candidate} <= max_len )); then
    printf '%s\n' "$candidate"
    return 0
  fi

  local allowance=$(( max_len - ${#base} - 1 ))
  if (( allowance <= 0 )); then
    printf '%.*s\n' "$max_len" "$base"
    return 0
  fi

  local truncated="${suffix:0:allowance}"
  truncated="$(printf '%s' "$truncated" | sed -E 's/-+$//')"

  if [[ -z "$truncated" ]]; then
    printf '%s\n' "$base"
    return 0
  fi

  printf '%s-%s\n' "$base" "$truncated"
}

# Check for env file - optional if env vars are already set (e.g., via direnv)
ENV_FILE=""
ENV_FILE_FLAG=""
if [[ -f "$ROOT_DIR/.env" ]]; then
  ENV_FILE="$ROOT_DIR/.env"
  ENV_FILE_FLAG="--env-file $ENV_FILE"
elif [[ -f "$ROOT_DIR/.env.production" ]]; then
  ENV_FILE="$ROOT_DIR/.env.production"
  ENV_FILE_FLAG="--env-file $ENV_FILE"
elif [[ -z "${NEXT_PUBLIC_CONVEX_URL:-}" ]]; then
  # No env file and no env vars set - this will likely fail
  echo "WARNING: No .env file found and NEXT_PUBLIC_CONVEX_URL not set." >&2
  echo "Either create .env/.env.production or use direnv to set env vars." >&2
fi

CURRENT_GIT_REF="$(current_git_ref)"
SANITIZED_BRANCH="$(sanitize_branch_name "$CURRENT_GIT_REF")"
APP_NAME="$(compose_app_name "$DEFAULT_APP_NAME" "$SANITIZED_BRANCH" "$APP_NAME_MAX_LENGTH")"

if [[ -n "$SANITIZED_BRANCH" && "$APP_NAME" != "${DEFAULT_APP_NAME}-${SANITIZED_BRANCH}" ]]; then
  echo "==> Truncated branch portion for app name to stay within ${APP_NAME_MAX_LENGTH} chars."
fi

stop_staging_app_instances "$APP_NAME" "$APP_BUNDLE_ID"

if [[ -n "$ENV_FILE" ]]; then
  if [[ -n "$CURRENT_GIT_REF" ]]; then
    echo "==> Building $APP_NAME (branch: $CURRENT_GIT_REF) with env file: $ENV_FILE"
  else
    echo "==> Building $APP_NAME with env file: $ENV_FILE"
  fi
else
  if [[ -n "$CURRENT_GIT_REF" ]]; then
    echo "==> Building $APP_NAME (branch: $CURRENT_GIT_REF) using environment variables"
  else
    echo "==> Building $APP_NAME using environment variables"
  fi
fi
(cd "$CLIENT_DIR" && CMUX_APP_NAME="$APP_NAME" bun run $ENV_FILE_FLAG build:mac:workaround)
