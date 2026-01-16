#!/usr/bin/env bash
# Cleanup orphaned dev server processes for this project (or all projects)
# Usage:
#   ./scripts/cleanup-dev.sh        # Clean up this project only
#   ./scripts/cleanup-dev.sh --all  # Clean up all dev-server instances
set -euo pipefail

hash_path() {
    local input=$1
    if command -v md5sum >/dev/null 2>&1; then
        printf '%s' "$input" | md5sum | awk '{print $1}' | cut -c1-8
    elif command -v md5 >/dev/null 2>&1; then
        printf '%s' "$input" | md5 | awk '{print $NF}' | cut -c1-8
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$input" | shasum -a 256 | awk '{print $1}' | cut -c1-8
    else
        printf '%s' "nohash"
    fi
}

is_dev_script_pid() {
    local pid=$1
    if [ -z "$pid" ]; then
        return 1
    fi
    local cmd
    cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
    case "$cmd" in
        *"scripts/dev.sh"*) return 0 ;;
        *) return 1 ;;
    esac
}

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$(dirname "$SCRIPT_DIR")"

# Kill all descendant processes of a given PID (recursive)
kill_descendants() {
    local pid=$1
    local signal=${2:-9}
    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
        kill_descendants "$child" "$signal"
    done
    kill -"$signal" "$pid" 2>/dev/null || true
}

kill_process_group() {
    local pid=$1
    local signal=${2:-TERM}
    if [ -z "$pid" ]; then
        return
    fi
    if kill -0 "$pid" 2>/dev/null; then
        kill -"$signal" -- "-$pid" 2>/dev/null || true
    fi
}

# Clean up a single dev server instance by its hash
cleanup_instance() {
    local hash=$1
    local lockfile="/tmp/dev-server-${hash}.lock"
    local lockdir="/tmp/dev-server-${hash}.lockdir"
    local pidfile="/tmp/dev-server-${hash}.pid"
    local pathfile="/tmp/dev-server-${hash}.path"
    local should_clear=true

    local project_path="unknown"
    [ -f "$pathfile" ] && project_path=$(cat "$pathfile")

    if [ -f "$pidfile" ]; then
        local pid
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then
            if ! is_dev_script_pid "$pid"; then
                echo "Skipping PID $pid (does not look like dev.sh) for: $project_path"
                should_clear=false
            else
                echo "Killing dev server (PID: $pid) for: $project_path"
                kill_process_group "$pid" TERM
                kill_descendants "$pid" TERM
                sleep 2
                kill_process_group "$pid" 9
                kill_descendants "$pid" 9
                if kill -0 "$pid" 2>/dev/null; then
                    echo "PID $pid is still running; leaving lock files in place."
                    should_clear=false
                fi
            fi
        else
            echo "Stale pidfile for: $project_path (process not running)"
        fi
    fi

    # Clean up docker compose if we know the project path
    if [ -d "$project_path/.devcontainer" ]; then
        echo "Stopping docker compose in: $project_path"
        for compose_file in "$project_path/.devcontainer"/docker-compose*.yml; do
            if [ -f "$compose_file" ]; then
                docker compose -f "$compose_file" down 2>/dev/null || true
            fi
        done
    fi

    # Remove temp files
    if [ "$should_clear" = "true" ]; then
        rm -rf "$lockfile" "$lockdir" "$pidfile" "$pathfile" 2>/dev/null || true
    fi
}

echo "Cleaning up dev server processes..."

if [ "${1:-}" = "--all" ]; then
    # Clean up ALL dev-server instances
    echo "Cleaning up all dev-server instances..."
    for pidfile in /tmp/dev-server-*.pid; do
        [ -f "$pidfile" ] || continue
        hash=$(basename "$pidfile" | sed 's/dev-server-//' | sed 's/\.pid//')
        cleanup_instance "$hash"
    done
else
    # Clean up only this project
    PROJECT_HASH=$(hash_path "$APP_DIR")
    cleanup_instance "$PROJECT_HASH"
fi

# Show status
echo ""
echo "Cleanup complete"
echo ""
echo "Active dev-server instances:"
found_any=false
for pidfile in /tmp/dev-server-*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    hash=$(basename "$pidfile" | sed 's/dev-server-//' | sed 's/\.pid//')
    pathfile="/tmp/dev-server-${hash}.path"
    path="unknown"
    [ -f "$pathfile" ] && path=$(cat "$pathfile")
    if kill -0 "$pid" 2>/dev/null && is_dev_script_pid "$pid"; then
        echo "  PID $pid: $path"
        found_any=true
    fi
done
if [ "$found_any" = false ]; then
    echo "  (none)"
fi
