#!/usr/bin/env bash
set -euo pipefail

IMAGE_BASENAME="cmux-local-sanity"
KEEP_SANITY_CONTAINER=0
IMAGE_BASENAME_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-container)
      KEEP_SANITY_CONTAINER=1
      shift
      ;;
    --image-basename)
      if [[ $# -lt 2 ]]; then
        echo "[sanity] ERROR: --image-basename requires a value" >&2
        exit 1
      fi
      IMAGE_BASENAME="$2"
      IMAGE_BASENAME_SET=1
      shift 2
      ;;
    *)
      if [[ "$IMAGE_BASENAME_SET" == "0" ]]; then
        IMAGE_BASENAME="$1"
        IMAGE_BASENAME_SET=1
        shift
      else
        echo "[sanity] ERROR: Unknown argument $1" >&2
        exit 1
      fi
      ;;
  esac
done
OPENVSCODE_URL="http://localhost:39378/?folder=/root/workspace"
NOVNC_URL="http://localhost:39380/vnc.html"
CDP_PORT=39381
FORCE_DIND=${FORCE_DIND:-0}

declare -a ACTIVE_CONTAINERS=()

cleanup_containers() {
  if [[ -z "${ACTIVE_CONTAINERS+x}" ]]; then
    return
  fi

  for container in "${ACTIVE_CONTAINERS[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
      docker rm -f "$container" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup_containers EXIT

platform_slug() {
  local slug="${1//\//-}"
  slug="${slug//:/-}"
  echo "$slug"
}

platform_supported() {
  local platform="$1"
  local probe_image="${PLATFORM_PROBE_IMAGE:-ubuntu:24.04}"

  if docker run --rm --platform "$platform" --entrypoint /bin/true "$probe_image" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

cleanup_container() {
  local container="$1"
  if docker ps -a --format '{{.Names}}' | grep -Fxq "$container"; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
}

remove_active_container() {
  local container="$1"
  for i in "${!ACTIVE_CONTAINERS[@]}"; do
    if [[ "${ACTIVE_CONTAINERS[$i]}" == "$container" ]]; then
      unset 'ACTIVE_CONTAINERS[$i]'
      break
    fi
  done
}

wait_for_openvscode() {
  local container="$1"
  local url="$2"
  local platform="$3"
  echo "[sanity][$platform] Waiting for OpenVSCode to respond..."
  for i in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[sanity][$platform] OpenVSCode reachable at $url"
      return
    fi
    sleep 1
  done

  echo "[sanity][$platform] ERROR: OpenVSCode did not become ready within 60s" >&2
  docker logs "$container" || true
  exit 1
}

wait_for_novnc() {
  local container="$1"
  local url="$2"
  local platform="$3"
  echo "[sanity][$platform] Waiting for noVNC to respond..."
  for i in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[sanity][$platform] noVNC reachable at $url"
      return
    fi
    sleep 1
  done

  echo "[sanity][$platform] ERROR: noVNC did not become ready within 60s" >&2
  docker logs "$container" || true
  exit 1
}

wait_for_cdp() {
  local port="$1"
  local platform="$2"
  local url="http://127.0.0.1:${port}/json/version"
  echo "[sanity][$platform] Waiting for Chrome DevTools at ${url}..."
  for _ in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[sanity][$platform] DevTools reachable at $url"
      return
    fi
    sleep 1
  done
  echo "[sanity][$platform] ERROR: DevTools endpoint did not become ready within 60s" >&2
  exit 1
}

check_vnc_handshake() {
  local container="$1"
  local platform="$2"
  echo "[sanity][$platform] Checking TigerVNC handshake on 127.0.0.1:5901..."
  if ! docker exec "$container" python3 - <<'PY'
import socket
import sys

addr = ("127.0.0.1", 5901)
try:
    with socket.create_connection(addr, timeout=5) as sock:
        sock.settimeout(5)
        banner = sock.recv(12)
        if not banner.startswith(b"RFB "):
            print(f"Unexpected banner: {banner!r}", file=sys.stderr)
            sys.exit(1)
        sock.sendall(b"RFB 003.008\n")
        response = sock.recv(4)
        if not response:
            print("Empty security response from server", file=sys.stderr)
            sys.exit(1)
except Exception as exc:
    print(f"Handshake failed: {exc}", file=sys.stderr)
    sys.exit(1)
PY
  then
    echo "[sanity][$platform] ERROR: TigerVNC handshake failed" >&2
    docker exec "$container" ss -ltnp | grep 5901 || true
    docker exec "$container" bash -lc 'tail -n 80 /var/log/cmux/tigervnc.log 2>/dev/null || true' || true
    exit 1
  fi
  echo "[sanity][$platform] TigerVNC handshake succeeded"
}

check_vnc_websocket() {
  local container="$1"
  local platform="$2"
  echo "[sanity][$platform] Checking VNC websocket proxy upgrade on 127.0.0.1:39380..."
  if ! docker exec "$container" python3 - <<'PY'
import os
import socket
import sys

host = "127.0.0.1"
port = 39380
path = "/websockify"
key = os.urandom(16)
import base64
sec_key = base64.b64encode(key).decode()

request = (
    f"GET {path} HTTP/1.1\r\n"
    f"Host: {host}:{port}\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {sec_key}\r\n"
    "Sec-WebSocket-Version: 13\r\n"
    "\r\n"
)

with socket.create_connection((host, port), timeout=5) as sock:
    sock.settimeout(5)
    sock.sendall(request.encode("ascii"))
    resp = sock.recv(1024).decode("latin1", "replace")

status_line = resp.splitlines()[0] if resp else ""
if not status_line.startswith("HTTP/1.1 101"):
    print(f"Unexpected websocket response: {status_line!r}", file=sys.stderr)
    sys.exit(1)
PY
  then
    echo "[sanity][$platform] ERROR: VNC websocket proxy handshake failed" >&2
    docker exec "$container" systemctl status cmux-vnc-proxy.service --no-pager || true
    docker exec "$container" bash -lc 'tail -n 80 /var/log/cmux/vnc-proxy.log 2>/dev/null || true' || true
    exit 1
  fi
  echo "[sanity][$platform] VNC websocket proxy handshake succeeded"
}

check_unit() {
  local container="$1"
  local unit="$2"
  if ! docker exec "$container" systemctl is-active --quiet "$unit"; then
    echo "[sanity] ERROR: systemd unit $unit is not active" >&2
    docker exec "$container" systemctl status "$unit" || true
    exit 1
  fi
  echo "[sanity] systemd unit $unit is active"
}

check_gh_cli() {
  local container="$1"
  local platform="$2"
  if ! docker exec "$container" bash -lc 'set -euo pipefail; command -v gh >/dev/null 2>&1; gh --version >/dev/null'; then
    echo "[sanity][$platform] ERROR: GitHub CLI (gh) not available" >&2
    exit 1
  fi
  echo "[sanity][$platform] GitHub CLI available"
}

wait_for_command_in_container() {
  local container="$1"
  local platform="$2"
  local description="$3"
  local cmd="$4"
  local max_attempts="${5:-60}"

  echo "[sanity][$platform] Waiting for ${description}..."
  for _ in $(seq 1 "$max_attempts"); do
    if docker exec "$container" bash -lc "$cmd" >/dev/null 2>&1; then
      echo "[sanity][$platform] ${description} ready"
      return 0
    fi
    sleep 1
  done
  echo "[sanity][$platform] ERROR: ${description} not ready after ${max_attempts}s" >&2
  return 1
}

cleanup_vite_server() {
  local container="$1"
  docker exec "$container" bash -lc 'if [[ -f /tmp/vite-dev.pid ]]; then kill "$(cat /tmp/vite-dev.pid)" >/dev/null 2>&1 || true; rm -f /tmp/vite-dev.pid; fi' >/dev/null 2>&1 || true
}

run_vite_proxy_sanity() {
  local container="$1"
  local platform="$2"
  local app_dir="/root/vite-sanity"

  echo "[sanity][$platform] Creating Vite sample app via bun..."
  docker exec "$container" bash -lc "set -euo pipefail; rm -rf ${app_dir}; cd /root; bun create vite@latest vite-sanity -- --template react >/tmp/vite-create.log 2>&1"

  echo "[sanity][$platform] Installing dependencies..."
  docker exec "$container" bash -lc "set -euo pipefail; cd ${app_dir}; bun install >/tmp/vite-install.log 2>&1"

  echo "[sanity][$platform] Starting Vite dev server on port 3006..."
  cleanup_vite_server "$container"
  docker exec "$container" bash -lc "set -euo pipefail; cd ${app_dir}; nohup bun run dev -- --host 0.0.0.0 --port 3006 >/tmp/vite-dev.log 2>&1 & echo \$! >/tmp/vite-dev.pid"

  if ! wait_for_command_in_container "$container" "$platform" "local Vite dev server" "curl -fsS http://127.0.0.1:3006" 60; then
    docker exec "$container" bash -lc 'cat /tmp/vite-dev.log || true' >&2 || true
    cleanup_vite_server "$container"
    exit 1
  fi

  echo "[sanity][$platform] Curling Vite through cmux proxy (port 39379)..."
  local proxy_url="http://127.0.0.1:39379/"
  local success=0
  for _ in $(seq 1 60); do
    if curl -fsS "$proxy_url" \
      -H "X-Cmux-Port-Internal: 3006" \
      -H "X-Cmux-Host-Override: localhost:3006" \
      -H "Host: localhost:3006" | grep -qi "vite"; then
      success=1
      break
    fi
    sleep 1
  done

  if [[ "$success" != "1" ]]; then
    echo "[sanity][$platform] ERROR: cmux proxy could not reach Vite dev server" >&2
    exit 1
  fi

  local host_curl_cmd='curl --http2-prior-knowledge -i "http://127.0.0.1:39379/" -H "X-Cmux-Port-Internal: 3006" -H "X-Cmux-Host-Override: localhost:3006" -H "Host: localhost:3006"'
  echo "[sanity][$platform] Host curl command to hit Vite via proxy:"
  echo "  $host_curl_cmd"

  if [[ "$KEEP_SANITY_CONTAINER" != "1" ]]; then
    cleanup_vite_server "$container"
    docker exec "$container" bash -lc "rm -rf ${app_dir}" >/dev/null 2>&1 || true
  else
    local vite_pid
    vite_pid=$(docker exec "$container" bash -lc 'cat /tmp/vite-dev.pid 2>/dev/null || echo unavailable')
    echo "[sanity][$platform] Keeping Vite dev server running (PID ${vite_pid})"
  fi

  echo "[sanity][$platform] Vite dev server reachable via cmux proxy"
}

HOST_ARCH=$(uname -m)
HOST_PLATFORM=""
case "$HOST_ARCH" in
  x86_64|amd64)
    HOST_PLATFORM="linux/amd64"
    ;;
  arm64|aarch64)
    HOST_PLATFORM="linux/arm64/v8"
    ;;
esac

run_dind_hello_world() {
  local container="$1"
  local platform="$2"

  case "$platform" in
    linux/amd64)
      if [[ "$HOST_ARCH" == "x86_64" || "$HOST_ARCH" == "amd64" ]]; then
        echo "[sanity][$platform] Running DinD hello-world test..."
        docker exec "$container" docker run --rm hello-world >/dev/null
        echo "[sanity][$platform] DinD hello-world succeeded"
      elif [[ "$HOST_ARCH" == "arm64" || "$HOST_ARCH" == "aarch64" ]]; then
        if [[ "$FORCE_DIND" == "1" ]]; then
          echo "[sanity][$platform] Force-running DinD hello-world on arm host (qemu emulation)..."
          docker exec "$container" docker run --rm hello-world >/dev/null
          echo "[sanity][$platform] DinD hello-world succeeded (forced run)"
        else
          echo "[sanity][$platform] Skipping DinD hello-world on host arch $HOST_ARCH (known qemu instability)." >&2
          echo "[sanity][$platform] Set FORCE_DIND=1 to attempt the DinD check under qemu anyway." >&2
        fi
      else
        echo "[sanity][$platform] Skipping DinD hello-world on unsupported host arch $HOST_ARCH." >&2
      fi
      ;;
    linux/arm64*)
      echo "[sanity][$platform] Running DinD hello-world test..."
      docker exec "$container" docker run --rm hello-world >/dev/null
      echo "[sanity][$platform] DinD hello-world succeeded"
      ;;
    *)
      if [[ "$FORCE_DIND" == "1" ]]; then
        echo "[sanity][$platform] Force-running DinD hello-world..."
        docker exec "$container" docker run --rm hello-world >/dev/null
        echo "[sanity][$platform] DinD hello-world succeeded"
      else
        echo "[sanity][$platform] Skipping DinD hello-world on platform $platform. Set FORCE_DIND=1 to force." >&2
      fi
      ;;
  esac
}

run_checks_for_platform() {
  local platform="$1"
  local suffix
  suffix=$(platform_slug "$platform")
  local image_name="${IMAGE_BASENAME}-${suffix}"
  local container_name="cmux-local-sanity-${suffix}"
  local volume_name="cmux-local-docker-${suffix}"

  if ! platform_supported "$platform" && [[ "${FORCE_CROSS_BUILD:-0}" != "1" ]]; then
    echo "[sanity][$platform] Skipping build: platform not runnable on this host (set FORCE_CROSS_BUILD=1 to force)." >&2
    return
  fi

  echo "[sanity][$platform] Building local runtime image ($image_name)..."
  docker build --platform "$platform" -t "$image_name" .

  if [[ -n "$HOST_PLATFORM" && "$platform" != "$HOST_PLATFORM" && "${FORCE_CROSS_RUN:-0}" != "1" ]]; then
    echo "[sanity][$platform] Skipping runtime checks on host arch $HOST_ARCH (set FORCE_CROSS_RUN=1 to force)." >&2
    return
  fi

  remove_active_container "$container_name"
  cleanup_container "$container_name"

  echo "[sanity][$platform] Starting container..."
  docker run -d \
    --rm \
    --privileged \
    --cgroupns=host \
    --tmpfs /run \
    --tmpfs /run/lock \
    -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    -v "$volume_name":/var/lib/docker \
    -p 39375:39375 \
    -p 39376:39376 \
    -p 39377:39377 \
    -p 39378:39378 \
    -p 39379:39379 \
    -p 39380:39380 \
    -p 39381:39381 \
    --name "$container_name" \
    "$image_name" >/dev/null

  ACTIVE_CONTAINERS+=("$container_name")

  wait_for_openvscode "$container_name" "$OPENVSCODE_URL" "$platform"
  wait_for_novnc "$container_name" "$NOVNC_URL" "$platform"
  wait_for_cdp "$CDP_PORT" "$platform"

  check_unit "$container_name" cmux-tigervnc.service
  check_unit "$container_name" cmux-vnc-proxy.service
  check_vnc_handshake "$container_name" "$platform"
  check_vnc_websocket "$container_name" "$platform"
  check_unit "$container_name" cmux-openvscode.service
  check_unit "$container_name" cmux-worker.service
  check_gh_cli "$container_name" "$platform"
  run_vite_proxy_sanity "$container_name" "$platform"

  run_dind_hello_world "$container_name" "$platform"

  if [[ "$KEEP_SANITY_CONTAINER" == "1" ]]; then
    local host_curl_cmd='curl --http2-prior-knowledge -i "http://127.0.0.1:39379/" -H "X-Cmux-Port-Internal: 3006" -H "X-Cmux-Host-Override: localhost:3006" -H "Host: localhost:3006"'
    echo "[sanity][$platform] Container $container_name is still running for manual inspection."
    echo "[sanity][$platform] From the host, run:"
    echo "  $host_curl_cmd"
    read -n 1 -s -r -p "[sanity][$platform] Press any key to stop and remove $container_name..." _
    echo
  fi

  cleanup_vite_server "$container_name"
  docker exec "$container_name" bash -lc "rm -rf /root/vite-sanity" >/dev/null 2>&1 || true

  cleanup_container "$container_name"
  remove_active_container "$container_name"
}

BUILD_PLATFORMS=("linux/amd64")
if [[ -n "$HOST_PLATFORM" && "$HOST_PLATFORM" != "linux/amd64" ]]; then
  BUILD_PLATFORMS+=("$HOST_PLATFORM")
fi

for platform in "${BUILD_PLATFORMS[@]}"; do
  run_checks_for_platform "$platform"
done

echo "[sanity] All checks passed for platforms: ${BUILD_PLATFORMS[*]}"
