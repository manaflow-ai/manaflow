#!/bin/bash
# scripts/verify_services.sh
#
# Verify all cmux devbox services are running correctly inside a Morph VM.
# Run this script inside the VM to check the health of all services.
#
# Usage:
#   ./verify_services.sh              # Full verification
#   ./verify_services.sh --quick      # Quick check (services only)
#   ./verify_services.sh --json       # Output results as JSON
#
# Exit codes:
#   0 - All services OK
#   1 - Some services failed

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
QUICK_MODE=false
JSON_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --json)
            JSON_MODE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--quick] [--json]"
            echo ""
            echo "Options:"
            echo "  --quick    Quick check (services only, skip detailed tests)"
            echo "  --json     Output results as JSON"
            echo "  --help     Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Track failures
FAILED=0
RESULTS=()

# Add result to tracking
add_result() {
    local category=$1
    local name=$2
    local status=$3
    local details=$4

    if [ "$JSON_MODE" = true ]; then
        RESULTS+=("{\"category\":\"$category\",\"name\":\"$name\",\"status\":\"$status\",\"details\":\"$details\"}")
    else
        if [ "$status" = "ok" ]; then
            echo -e "${GREEN}[OK]${NC} $name${details:+ - $details}"
        elif [ "$status" = "warn" ]; then
            echo -e "${YELLOW}[WARN]${NC} $name${details:+ - $details}"
        else
            echo -e "${RED}[FAIL]${NC} $name${details:+ - $details}"
            FAILED=1
        fi
    fi
}

# Check if a systemd service is active
check_service() {
    local name=$1
    if systemctl is-active --quiet "$name" 2>/dev/null; then
        add_result "service" "$name" "ok" "active"
    else
        local status=$(systemctl is-active "$name" 2>/dev/null || echo "unknown")
        add_result "service" "$name" "fail" "$status"
    fi
}

# Check if a port is listening
check_port() {
    local port=$1
    local name=$2

    if command -v nc &> /dev/null; then
        if nc -z localhost "$port" 2>/dev/null; then
            add_result "port" "$name (port $port)" "ok" "listening"
        else
            add_result "port" "$name (port $port)" "fail" "not listening"
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tlnp 2>/dev/null | grep -q ":$port "; then
            add_result "port" "$name (port $port)" "ok" "listening"
        else
            add_result "port" "$name (port $port)" "fail" "not listening"
        fi
    else
        add_result "port" "$name (port $port)" "warn" "cannot check (no nc or netstat)"
    fi
}

# Check HTTP endpoint
check_http() {
    local url=$1
    local name=$2
    local expected=$3

    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>/dev/null || echo "000")

    if [ "$response" = "200" ] || [ "$response" = "302" ]; then
        add_result "http" "$name" "ok" "HTTP $response"
    elif [ "$expected" != "" ] && [ "$response" = "$expected" ]; then
        add_result "http" "$name" "ok" "HTTP $response (expected)"
    elif [ "$response" = "000" ]; then
        add_result "http" "$name" "fail" "connection failed"
    else
        add_result "http" "$name" "warn" "HTTP $response"
    fi
}

# Get Chrome version from CDP
check_chrome_cdp() {
    local cdp_response
    cdp_response=$(curl -s --connect-timeout 5 http://localhost:9222/json/version 2>/dev/null || echo "")

    if [ -n "$cdp_response" ]; then
        local browser
        browser=$(echo "$cdp_response" | jq -r '.Browser // "Unknown"' 2>/dev/null || echo "Unknown")
        if [ "$browser" != "Unknown" ] && [ "$browser" != "null" ]; then
            add_result "chrome" "Chrome CDP" "ok" "$browser"
        else
            add_result "chrome" "Chrome CDP" "warn" "responding but browser info unavailable"
        fi
    else
        add_result "chrome" "Chrome CDP" "fail" "not responding"
    fi
}

# Check X11 display
check_display() {
    if [ -e /tmp/.X11-unix/X1 ]; then
        add_result "display" "X11 Display :1" "ok" "socket exists"
    else
        add_result "display" "X11 Display :1" "fail" "socket not found"
    fi
}

# Check cmux user
check_user() {
    if id "cmux" &>/dev/null; then
        add_result "user" "cmux user" "ok" "exists"
    else
        add_result "user" "cmux user" "fail" "not found"
    fi
}

# Check snapshot marker
check_snapshot_marker() {
    if [ -f /cmux_base_snapshot_valid ]; then
        add_result "marker" "Snapshot marker" "ok" "valid"
    else
        add_result "marker" "Snapshot marker" "warn" "not found (may not be a cmux devbox snapshot)"
    fi
}

# Check Docker
check_docker() {
    local docker_version
    docker_version=$(docker --version 2>/dev/null || echo "")

    if [ -n "$docker_version" ]; then
        add_result "docker" "Docker" "ok" "$docker_version"
    else
        add_result "docker" "Docker" "fail" "not available"
    fi
}

# Main execution
if [ "$JSON_MODE" = false ]; then
    echo "=============================================="
    echo "    cmux devbox Service Verification         "
    echo "=============================================="
    echo ""
    echo "Checking at: $(date)"
    echo ""
fi

# Section: Systemd Services
if [ "$JSON_MODE" = false ]; then
    echo "Systemd Services:"
fi

check_service "vncserver"
check_service "xfce-session"
check_service "chrome-cdp"
check_service "novnc"
check_service "code-server"
check_service "nginx"
check_service "docker"

if [ "$JSON_MODE" = false ]; then
    echo ""
    echo "Network Ports:"
fi

# Section: Ports
check_port 80 "nginx"
check_port 5901 "VNC"
check_port 6080 "noVNC"
check_port 9222 "Chrome CDP"
check_port 10080 "code-server"

if [ "$QUICK_MODE" = false ]; then
    if [ "$JSON_MODE" = false ]; then
        echo ""
        echo "HTTP Endpoints:"
    fi

    # Section: HTTP endpoints
    check_http "http://localhost/health" "nginx health" "200"
    check_http "http://localhost:10080" "code-server" ""
    check_http "http://localhost:6080" "noVNC" ""

    if [ "$JSON_MODE" = false ]; then
        echo ""
        echo "Chrome DevTools Protocol:"
    fi

    # Section: Chrome CDP
    check_chrome_cdp

    if [ "$JSON_MODE" = false ]; then
        echo ""
        echo "System Checks:"
    fi

    # Section: System checks
    check_display
    check_user
    check_snapshot_marker
    check_docker
fi

# Output JSON if requested
if [ "$JSON_MODE" = true ]; then
    echo "{"
    echo "  \"timestamp\": \"$(date -Iseconds)\","
    echo "  \"hostname\": \"$(hostname)\","
    echo "  \"all_ok\": $([ $FAILED -eq 0 ] && echo 'true' || echo 'false'),"
    echo "  \"results\": ["
    first=true
    for result in "${RESULTS[@]}"; do
        if [ "$first" = true ]; then
            first=false
        else
            echo ","
        fi
        echo -n "    $result"
    done
    echo ""
    echo "  ]"
    echo "}"
else
    # Summary
    echo ""
    echo "=============================================="
    if [ $FAILED -eq 0 ]; then
        echo -e "${GREEN}       All services OK!                    ${NC}"
    else
        echo -e "${RED}       Some services FAILED                ${NC}"
    fi
    echo "=============================================="
fi

exit $FAILED
