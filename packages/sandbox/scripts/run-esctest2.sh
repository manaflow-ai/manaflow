#!/bin/bash
# Run esctest2 (Thomas Dickey's version) against the current terminal
# This script must be run INSIDE dmux/cmux to test the virtual terminal
#
# Usage:
#   ./scripts/run-esctest2.sh                    # Run all tests
#   ./scripts/run-esctest2.sh --include='DA'     # Run DA tests only
#   ./scripts/run-esctest2.sh --include='CUP'    # Run cursor position tests
#   ./scripts/run-esctest2.sh --stop-on-failure  # Stop on first failure
#   ./scripts/run-esctest2.sh --action=list-known-bugs  # List known bugs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ESCTEST2_DIR="$SCRIPT_DIR/../tools/esctest2/esctest"

if [ ! -d "$ESCTEST2_DIR" ]; then
    echo "Error: esctest2 not found. Run ./scripts/setup-esctest.sh first"
    exit 1
fi

cd "$ESCTEST2_DIR"

echo "Running esctest2..."
echo "Python: python3"
echo "Directory: $ESCTEST2_DIR"
echo ""

# Run esctest2 with provided arguments
# Use xterm as expected terminal (closest to our implementation)
python3 esctest.py \
    --expected-terminal=xterm \
    --max-vt-level=4 \
    --logfile=/tmp/esctest2.log \
    --timeout=2 \
    "$@"

echo ""
echo "Logs written to /tmp/esctest2.log"
