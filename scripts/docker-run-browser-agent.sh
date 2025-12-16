#!/bin/bash

set -euo pipefail

IMAGE_NAME="cmux-shell"
CONTAINER_NAME="cmux-browser-agent"
WORKER_PORT=39377
CDP_PORT=39382
PROMPT=""
OPENVSCODE_PORT=39378
NOVNC_PORT=39380
KEEP_CONTAINER_RUNNING=false
WAIT_FOR_USER_EXIT=false
SCREENSHOT_DIR="${SCREENSHOT_DIR:-logs/browser-agent}"
SCREENSHOT_TMP_PATH="/tmp/cmux-browser-agent.png"
SCREENSHOT_HOST_PATH=""
SCREENSHOT_COPIED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt)
      if [[ $# -lt 2 ]]; then
        echo "Error: --prompt requires a value" >&2
        exit 1
      fi
      PROMPT="$2"
      shift 2
      ;;
    --prompt=*)
      PROMPT="${1#*=}"
      shift 1
      ;;
    --wait-for-exit|--interactive)
      WAIT_FOR_USER_EXIT=true
      shift 1
      ;;
    --keep-container|--keep-running)
      KEEP_CONTAINER_RUNNING=true
      shift 1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${PROMPT// }" ]]; then
  echo "Error: --prompt is required" >&2
  exit 1
fi

container_started=false

cleanup() {
  if [[ "$container_started" == true ]]; then
    copy_screenshot_from_container
    if [[ "$KEEP_CONTAINER_RUNNING" == true ]]; then
      echo "Leaving container '$CONTAINER_NAME' running for manual inspection."
    else
      echo "Stopping container..."
      docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    fi
    container_started=false
  fi
}

print_access_table() {
  if [[ "$container_started" != true ]]; then
    return
  fi

  local base_url="http://localhost:${OPENVSCODE_PORT}"
  local workspace_url="${base_url}/?folder=/root/workspace"
  local logs_url="${base_url}/?folder=/var/log/cmux"
  local novnc_url="http://localhost:${NOVNC_PORT}/vnc.html?autoconnect=1&resize=scale"
  local column1_width=32
  local column2_width=70
  local separator1 separator2
  separator1=$(printf '%*s' "$column1_width" '' | tr ' ' '-')
  separator2=$(printf '%*s' "$column2_width" '' | tr ' ' '-')

  printf "\nContainer access links (available while the container is running):\n"
  printf "+-%s-+-%s-+\n" "$separator1" "$separator2"
  printf "| %-*s | %-*s |\n" "$column1_width" "Workspace (/root/workspace)" "$column2_width" "$workspace_url"
  printf "| %-*s | %-*s |\n" "$column1_width" "Logs (/var/log/cmux)" "$column2_width" "$logs_url"
  printf "| %-*s | %-*s |\n" "$column1_width" "noVNC viewer" "$column2_width" "$novnc_url"
  printf "+-%s-+-%s-+\n" "$separator1" "$separator2"
  if [[ "$KEEP_CONTAINER_RUNNING" != true && "$WAIT_FOR_USER_EXIT" != true ]]; then
    printf "Re-run with --keep-container or --wait-for-exit to keep these endpoints available longer.\n"
  fi
}

resolve_abs_path() {
  local target="$1"
  if command -v realpath >/dev/null 2>&1; then
    local resolved
    if resolved=$(realpath "$target" 2>/dev/null); then
      printf "%s\n" "$resolved"
      return
    fi
  fi
  local dir
  local base
  dir="$(dirname "$target")"
  base="$(basename "$target")"
  if (
    cd "$dir" >/dev/null 2>&1 &&
    printf "%s/%s\n" "$(pwd)" "$base"
  ); then
    return
  fi
  printf "%s\n" "$target"
}

prepare_screenshot_dest() {
  if [[ -n "$SCREENSHOT_HOST_PATH" ]]; then
    return 0
  fi

  if ! mkdir -p "$SCREENSHOT_DIR"; then
    echo "Failed to create screenshot directory: $SCREENSHOT_DIR"
    return 1
  fi

  local abs_dir
  abs_dir="$(resolve_abs_path "$SCREENSHOT_DIR")"
  if [[ -z "$abs_dir" ]]; then
    abs_dir="$SCREENSHOT_DIR"
  fi

  local timestamp
  timestamp="$(date +"%Y%m%d-%H%M%S")"
  SCREENSHOT_HOST_PATH="${abs_dir%/}/cmux-browser-agent-${timestamp}.png"
  return 0
}

copy_screenshot_from_container() {
  if [[ "$container_started" != true ]]; then
    return
  fi
  if [[ "$SCREENSHOT_COPIED" == true ]]; then
    return
  fi
  if ! docker exec "$CONTAINER_NAME" bash -lc '[ -f "'"$SCREENSHOT_TMP_PATH"'" ]' >/dev/null 2>&1; then
    return
  fi
  if ! prepare_screenshot_dest; then
    return
  fi

  local tmp_copy
  tmp_copy="$(mktemp -t cmux-browser-agent-XXXXXX.png)"
  if docker cp "$CONTAINER_NAME:$SCREENSHOT_TMP_PATH" "$tmp_copy" >/dev/null 2>&1; then
    if mv "$tmp_copy" "$SCREENSHOT_HOST_PATH"; then
      SCREENSHOT_COPIED=true
      echo "Final screenshot saved to ${SCREENSHOT_HOST_PATH}"
      docker exec "$CONTAINER_NAME" bash -lc 'rm -f "'"$SCREENSHOT_TMP_PATH"'"' >/dev/null 2>&1 || true
    else
      echo "Failed to move screenshot into place: $SCREENSHOT_HOST_PATH"
      rm -f "$tmp_copy"
    fi
  else
    echo "Failed to copy screenshot from container"
    rm -f "$tmp_copy"
  fi
}

wait_for_user_to_finish() {
  if [[ "$WAIT_FOR_USER_EXIT" != true ]]; then
    return
  fi

  printf "\nInteractive session enabled (--wait-for-exit).\n"
  if [[ "$KEEP_CONTAINER_RUNNING" == true ]]; then
    printf "Press Enter to exit the script (container will stay running), or press Ctrl+C to exit immediately.\n"
  else
    printf "Press Enter when you're ready to stop the container, or press Ctrl+C to cancel early.\n"
  fi

  if [[ ! -t 0 ]]; then
    printf "Standard input is not a TTY; exiting immediately.\n"
    return
  fi

  # read returns on Enter; ctrl+c is handled by traps
  read -r -p "> " _ || true
}

trap cleanup EXIT
trap 'exit 1' INT TERM

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Error: ANTHROPIC_API_KEY not set. Add it to your environment or .env before running." >&2
  exit 1
fi

OPENAI_ENV_ARGS=()
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Warning: OPENAI_API_KEY not set. Continuing without it."
else
  OPENAI_ENV_ARGS+=("-e" "OPENAI_API_KEY=${OPENAI_API_KEY}")
fi

if [[ "${SKIP_BUILD:-}" = "1" ]]; then
  echo "Skipping Docker image build because SKIP_BUILD=1"
else
  echo "Building Docker image..."
  docker build -t "$IMAGE_NAME" .
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

echo "Starting container..."
docker run -d \
  --rm \
  --privileged \
  --cgroupns=host \
  --tmpfs /run \
  --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v docker-data:/var/lib/docker \
  -p 39375:39375 \
  -p 39376:39376 \
  -p 39377:39377 \
  -p 39378:39378 \
  -p 39379:39379 \
  -p 39380:39380 \
  -p 39381:39381 \
  -p 39382:39382 \
  -p 39383:39383 \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  "${OPENAI_ENV_ARGS[@]}" \
  --name "$CONTAINER_NAME" \
  "$IMAGE_NAME" >/dev/null
container_started=true

# ensure we start with a clean screenshot target in the container
docker exec "$CONTAINER_NAME" bash -lc "rm -f $SCREENSHOT_TMP_PATH" >/dev/null 2>&1 || true

# Allow services to initialize
sleep 5

printf "Waiting for worker health endpoint"
health_ready=false
for ((attempt=1; attempt<=120; attempt+=1)); do
  if curl -sSf "http://localhost:${WORKER_PORT}/health" >/dev/null 2>&1; then
    printf "\n"
    health_ready=true
    break
  fi
  printf "."
  sleep 1
done

if [[ "$health_ready" != true ]]; then
  echo ""
  echo "Worker health endpoint did not respond in time"
  exit 1
fi

echo "Running browser agent with provided prompt..."
docker_exec_args=(
  "--workdir" "/cmux"
  "--env" "BROWSER_AGENT_PROMPT=$PROMPT"
  "--env" "BROWSER_AGENT_SCREENSHOT_PATH=$SCREENSHOT_TMP_PATH"
)
if [[ "$KEEP_CONTAINER_RUNNING" == true || "$WAIT_FOR_USER_EXIT" == true ]]; then
  docker_exec_args+=("--env" "BROWSER_AGENT_SKIP_STOP=1")
fi
docker exec "${docker_exec_args[@]}" "$CONTAINER_NAME" node /builtins/build/runBrowserAgentFromPrompt.js

echo "Browser agent run completed."
print_access_table
copy_screenshot_from_container
wait_for_user_to_finish
if [[ "$KEEP_CONTAINER_RUNNING" == true && "$WAIT_FOR_USER_EXIT" != true ]]; then
  echo "Remember to run 'docker stop $CONTAINER_NAME' when you are finished inspecting the environment."
fi
