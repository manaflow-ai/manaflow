#!/bin/bash
# Run esctest (original) against the current terminal
# This script must be run INSIDE dmux/cmux to test the virtual terminal
#
# Usage:
#   ./scripts/run-esctest.sh                    # Run all tests
#   ./scripts/run-esctest.sh --include='DA'     # Run DA tests only
#   ./scripts/run-esctest.sh --stop-on-failure  # Stop on first failure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESCTEST_DIR="$SCRIPT_DIR/../tools/esctest/esctest"

if [ ! -d "$ESCTEST_DIR" ]; then
    echo "Error: esctest not found. Run ./scripts/setup-esctest.sh first"
    exit 1
fi

# Check if python2 is available (esctest requires Python 2.7)
if command -v python2 &> /dev/null; then
    PYTHON_CMD="python2"
elif command -v python2.7 &> /dev/null; then
    PYTHON_CMD="python2.7"
else
    echo "Warning: Python 2.7 not found, trying python3 (may not work)"
    PYTHON_CMD="python3"
fi

cd "$ESCTEST_DIR"

echo "Running esctest..."
echo "Python: $PYTHON_CMD"
echo "Directory: $ESCTEST_DIR"
echo ""

# Run esctest with provided arguments
# Default to cmux terminal type (we can customize this later)
$PYTHON_CMD esctest.py \
    --expected-terminal=xterm \
    --max-vt-level=4 \
    --logfile=/tmp/esctest.log \
    --timeout=2 \
    "$@"

echo ""
echo "Logs written to /tmp/esctest.log"
