#!/bin/bash
#
# cmux Self-Hosting Quick Start Script
#
# Usage:
#   ./scripts/selfhost-quickstart.sh [standalone|full]
#
# Modes:
#   standalone - Run a single sandbox (default)
#   full       - Run full stack with Convex backend
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${BLUE}=== $1 ===${NC}\n"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    print_header "Checking Requirements"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    print_success "Docker installed"

    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        print_error "Docker Compose v2 is not available. Please update Docker."
        exit 1
    fi
    print_success "Docker Compose v2 available"

    # Check Docker running
    if ! docker info &> /dev/null; then
        print_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
    print_success "Docker daemon running"
}

run_standalone() {
    print_header "Starting cmux in Standalone Mode"

    echo "Pulling latest image..."
    docker pull manaflow/cmux:latest

    # Check if container already exists
    if docker ps -a --format '{{.Names}}' | grep -q '^cmux-standalone$'; then
        print_warning "Container 'cmux-standalone' already exists"
        read -p "Remove existing container? (y/N): " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            docker rm -f cmux-standalone
        else
            echo "Aborting."
            exit 1
        fi
    fi

    echo "Starting container..."
    docker run -d \
        --name cmux-standalone \
        --privileged \
        --cgroupns host \
        -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
        -v cmux-standalone-workspace:/root/workspace \
        -v cmux-standalone-docker:/var/lib/docker \
        -p 8080:39378 \
        -p 8081:39380 \
        -p 8082:39377 \
        -e WORKER_ID=cmux-standalone \
        -e IS_SANDBOX=1 \
        ${ANTHROPIC_API_KEY:+-e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"} \
        ${OPENAI_API_KEY:+-e OPENAI_API_KEY="$OPENAI_API_KEY"} \
        ${GITHUB_TOKEN:+-e GITHUB_TOKEN="$GITHUB_TOKEN"} \
        manaflow/cmux:latest

    print_success "Container started"

    echo ""
    echo "Waiting for services to start (this may take 30-60 seconds)..."

    # Wait for health check
    for i in {1..60}; do
        if curl -sf http://localhost:8082/health > /dev/null 2>&1; then
            print_success "Worker service is healthy"
            break
        fi
        sleep 2
    done

    print_header "cmux is Ready!"
    echo ""
    echo "Access your cmux environment:"
    echo ""
    echo "  VS Code IDE:  http://localhost:8080"
    echo "  VNC Desktop:  http://localhost:8081"
    echo "  Worker API:   http://localhost:8082/health"
    echo ""
    echo "Useful commands:"
    echo ""
    echo "  # View logs"
    echo "  docker logs -f cmux-standalone"
    echo ""
    echo "  # Access shell"
    echo "  docker exec -it cmux-standalone bash"
    echo ""
    echo "  # Stop"
    echo "  docker stop cmux-standalone"
    echo ""
    echo "  # Remove (keeps volumes)"
    echo "  docker rm cmux-standalone"
    echo ""
}

run_full() {
    print_header "Starting cmux Full Stack"

    cd "$PROJECT_DIR"

    # Check for .env.selfhost
    if [[ ! -f ".env.selfhost" ]]; then
        print_warning ".env.selfhost not found"

        if [[ -f ".env.selfhost.template" ]]; then
            echo "Creating .env.selfhost from template..."
            cp .env.selfhost.template .env.selfhost

            # Generate secrets
            echo "" >> .env.selfhost
            echo "# Auto-generated secrets" >> .env.selfhost
            echo "CONVEX_INSTANCE_SECRET=$(openssl rand -hex 32)" >> .env.selfhost
            echo "CMUX_TASK_RUN_JWT_SECRET=$(openssl rand -hex 32)" >> .env.selfhost

            print_success "Created .env.selfhost with generated secrets"
            print_warning "Please edit .env.selfhost to add your API keys before continuing"
            echo ""
            echo "Required: Set HOST_IP to your server's IP address"
            echo "Optional: Add ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN"
            echo ""
            exit 0
        else
            print_error ".env.selfhost.template not found"
            exit 1
        fi
    fi

    echo "Pulling images..."
    docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost pull

    echo "Starting services..."
    docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d

    print_header "Full Stack Started"
    echo ""
    echo "Services:"
    echo ""
    echo "  Convex Backend:    http://localhost:9777"
    echo "  Convex Dashboard:  http://localhost:6791 (if enabled)"
    echo "  cmux IDE:          http://localhost:39378"
    echo "  cmux VNC:          http://localhost:39380"
    echo "  Worker API:        http://localhost:39377/health"
    echo ""
    echo "View logs:"
    echo "  docker compose -f docker-compose.selfhost.yml logs -f"
    echo ""
    echo "Stop:"
    echo "  docker compose -f docker-compose.selfhost.yml down"
    echo ""
}

# Main
MODE="${1:-standalone}"

check_requirements

case "$MODE" in
    standalone)
        run_standalone
        ;;
    full)
        run_full
        ;;
    *)
        echo "Usage: $0 [standalone|full]"
        echo ""
        echo "Modes:"
        echo "  standalone - Run a single sandbox (default)"
        echo "  full       - Run full stack with Convex backend"
        exit 1
        ;;
esac
