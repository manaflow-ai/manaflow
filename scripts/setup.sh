#!/usr/bin/env bash

set -e

mkdir -p ./logs
DATETIME="$(date '+%Y%m%d-%H%M%S')"

echo "Starting setup..."

# Run bun install and uv sync in parallel
echo "Installing dependencies..."
bun install >"./logs/bun-install-$DATETIME.log" 2>&1 &
BUN_PID=$!

uv sync >"./logs/uv-sync-$DATETIME.log" 2>&1 &
UV_PID=$!

# Wait for both to complete
wait $BUN_PID
echo "bun install completed"

wait $UV_PID
echo "uv sync completed"

# Run convex setup
echo "Setting up Convex..."
bun run convex:setup

echo "Setup complete!"
