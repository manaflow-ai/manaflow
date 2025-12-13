#!/bin/bash

set -euo pipefail

IMAGE_NAME="cmux-shell"
CONTAINER_NAME="cmux-shell"
container_started=false

cleanup() {
  if [ "$container_started" = true ]; then
    echo "Stopping container..."
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    container_started=false
  fi
}

trap cleanup EXIT INT TERM

# Build the Docker image
echo "Building Docker image..."
docker build -t "$IMAGE_NAME" .

# Run the container with systemd as PID 1
echo "Starting container..."
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

docker run -d \
  --rm \
  --privileged \
  --cgroupns=host \
  --tmpfs /run \
  --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -v docker-data:/var/lib/docker \
  -p 39375:39375 \
  -p 39377:39377 \
  -p 39378:39378 \
  -p 39379:39379 \
  -p 39380:39380 \
  -p 39381:39381 \
  -p 39382:39382 \
  -p 39383:39383 \
  --name "$CONTAINER_NAME" \
  "$IMAGE_NAME"
container_started=true

# Give systemd a moment to start up
sleep 3

# Show service status and open shell
echo ""
echo "========================================="
echo "Container services starting under systemd"
echo "  - Worker: http://localhost:39377"
echo "  - VS Code: http://localhost:39378"
echo "  - cmux-proxy: http://localhost:39379"
echo "  - noVNC: http://localhost:39380/vnc.html"
echo "  - DevTools: http://localhost:39381/json/version"
echo "  - DevTools target: http://localhost:39382/json/version"
echo "  - cmux-xterm: http://localhost:39383/"
echo "========================================="
echo ""

docker exec -it "$CONTAINER_NAME" bash
