#!/bin/bash
#
# up.sh - Set up the cmux project (install dependencies and pull submodules)
#
# Usage: ./scripts/up.sh
#
# This script runs in parallel:
#   - bun install
#   - git submodule update --init --recursive --depth 1 --jobs 8
#
# Note: Submodules are cloned with --depth 1 for faster setup and --jobs 8
# to clone multiple submodules in parallel. Git submodules work by commit SHA
# (not branch name), so this works regardless of whether the upstream repo
# uses main, master, dev, or any other default branch.
#

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$(dirname "$SCRIPT_DIR")"

cd "$APP_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Setting up cmux...${NC}"

# Run bun install and git submodule update in parallel
echo -e "${GREEN}Running bun install and git submodule update in parallel...${NC}"

# Track PIDs and exit codes
BUN_PID=""
GIT_PID=""
BUN_EXIT=0
GIT_EXIT=0

# Start bun install in background
(bun install) &
BUN_PID=$!

# Start git submodule update in background with shallow clone
# Using --depth 1 for faster clones since we only need the latest state
# Using --jobs 8 to clone multiple submodules in parallel
(git submodule update --init --recursive --depth 1 --jobs 8) &
GIT_PID=$!

# Wait for both and capture exit codes
wait $BUN_PID || BUN_EXIT=$?
wait $GIT_PID || GIT_EXIT=$?

# Report results
if [ $BUN_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ bun install completed${NC}"
else
    echo -e "${RED}✗ bun install failed (exit code: $BUN_EXIT)${NC}"
fi

if [ $GIT_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ git submodule update completed${NC}"
else
    echo -e "${RED}✗ git submodule update failed (exit code: $GIT_EXIT)${NC}"
fi

# Exit with error if either failed
if [ $BUN_EXIT -ne 0 ] || [ $GIT_EXIT -ne 0 ]; then
    echo -e "${RED}Setup failed${NC}"
    exit 1
fi

echo -e "${GREEN}Setup complete!${NC}"
