#!/bin/bash
# Setup esctest and esctest2 for terminal testing
# Run this script once to clone the test suites

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS_DIR="$SCRIPT_DIR/../tools"

echo "Setting up esctest test suites..."

# Clone esctest (original, from migueldeicaza's mirror)
if [ ! -d "$TOOLS_DIR/esctest" ]; then
    echo "Cloning esctest..."
    git clone --depth 1 https://github.com/migueldeicaza/esctest.git "$TOOLS_DIR/esctest"
else
    echo "esctest already exists"
fi

# Clone esctest2 (Thomas Dickey's version, Python 3)
if [ ! -d "$TOOLS_DIR/esctest2" ]; then
    echo "Cloning esctest2..."
    git clone --depth 1 https://github.com/ThomasDickey/esctest2.git "$TOOLS_DIR/esctest2"
else
    echo "esctest2 already exists"
fi

echo "Setup complete!"
echo ""
echo "To run tests inside cmux/dmux:"
echo "  ./scripts/run-esctest.sh      # Run esctest (all tests)"
echo "  ./scripts/run-esctest2.sh     # Run esctest2 (all tests)"
echo "  ./scripts/run-esctest2.sh --include='DA' # Run specific tests"
