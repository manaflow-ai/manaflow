#!/bin/bash
# Regenerate Freestyle Python client from OpenAPI spec
# Uses openapi-generator with asyncio=true for async support

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPEC_URL="https://api.freestyle.sh/openapi.json"
SPEC_FILE="$SCRIPT_DIR/openapi.json"

echo "Fetching OpenAPI spec from $SPEC_URL..."
curl -sS "$SPEC_URL" -o "$SPEC_FILE"

echo "Regenerating Python client with async support..."

# Backup old client
if [ -d "$SCRIPT_DIR/freestyle_client" ]; then
    rm -rf "$SCRIPT_DIR/freestyle_client.bak"
    mv "$SCRIPT_DIR/freestyle_client" "$SCRIPT_DIR/freestyle_client.bak"
fi

# Generate with asyncio support using npx (no global install needed)
# The python generator supports asyncio=true for async methods
npx @openapitools/openapi-generator-cli generate \
    -i "$SPEC_FILE" \
    -g python \
    -o "$SCRIPT_DIR" \
    --package-name freestyle_client \
    --additional-properties=asyncio=true,library=asyncio

if [ -d "$SCRIPT_DIR/freestyle_client" ]; then
    echo "✓ Generated async client at $SCRIPT_DIR/freestyle_client"
    rm -rf "$SCRIPT_DIR/freestyle_client.bak"
else
    echo "✗ Failed to generate client"
    # Restore backup
    if [ -d "$SCRIPT_DIR/freestyle_client.bak" ]; then
        mv "$SCRIPT_DIR/freestyle_client.bak" "$SCRIPT_DIR/freestyle_client"
    fi
    exit 1
fi

echo "Done!"
