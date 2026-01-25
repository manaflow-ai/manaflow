#!/usr/bin/env bash
# Self-hosting script for cmux
# Usage: ./scripts/run-selfhost.sh [workspace_path]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_PATH="${1:-$(pwd)}"
CONTAINER_NAME="cmux-selfhost"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[cmux]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[cmux]${NC} $1"
}

error() {
    echo -e "${RED}[cmux]${NC} $1"
}

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    error "Docker daemon is not running. Please start Docker."
    exit 1
fi

# Stop existing container if running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    log "Stopping existing container..."
    docker stop "${CONTAINER_NAME}" 2>/dev/null || true
    docker rm "${CONTAINER_NAME}" 2>/dev/null || true
fi

log "Starting cmux self-hosted environment..."
log "Workspace: ${WORKSPACE_PATH}"

# Pull latest image
log "Pulling latest image..."
docker pull manaflow/cmux:latest

# Run the container
log "Starting container..."
docker run -d \
    --name "${CONTAINER_NAME}" \
    --privileged \
    -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
    -v "${WORKSPACE_PATH}:/root/workspace" \
    -p 39378:39378 \
    -p 39377:39377 \
    -p 39380:39380 \
    --tmpfs /run:rw,mode=755 \
    --tmpfs /run/lock:rw,mode=755 \
    --stop-signal SIGRTMIN+3 \
    --restart unless-stopped \
    manaflow/cmux:latest

# Wait for services to start
log "Waiting for services to start..."
sleep 5

# Check if VS Code is ready
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:39378 | grep -q "200\|302"; then
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    warn "VS Code may still be starting up. Check logs with: docker logs ${CONTAINER_NAME}"
else
    log ""
    log "==========================================="
    log "  cmux is running!"
    log "==========================================="
    log ""
    log "  VS Code IDE: ${BLUE}http://localhost:39378${NC}"
    log "  Worker API:  http://localhost:39377"
    log "  VNC:         http://localhost:39380"
    log ""
    log "  Workspace:   ${WORKSPACE_PATH}"
    log ""
    log "  Stop:        docker stop ${CONTAINER_NAME}"
    log "  Logs:        docker logs -f ${CONTAINER_NAME}"
    log "==========================================="
fi
