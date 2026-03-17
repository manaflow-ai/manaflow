#!/bin/bash
set -e

# Upload host-screenshot-collector to Convex file storage
# Usage: ./scripts/upload-to-convex.sh [--staging|--production]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

# Default to staging
IS_STAGING="false"
ENVIRONMENT="staging"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --staging)
      IS_STAGING="false"
      ENVIRONMENT="staging"
      shift
      ;;
    --production)
      IS_STAGING="false"
      ENVIRONMENT="production"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--staging|--production]"
      exit 1
      ;;
  esac
done

# Get Convex URL from environment or use default
if [[ -n "$CONVEX_SITE_URL" ]]; then
  CONVEX_URL="$CONVEX_SITE_URL"
elif [[ -n "$CONVEX_URL" ]]; then
  # Convert .cloud to .site for HTTP endpoints
  CONVEX_URL="${CONVEX_URL/.convex.cloud/.convex.site}"
else
  # Default to the dev deployment
  CONVEX_URL="https://famous-camel-162.convex.site"
fi

# Generate version
VERSION=$(node -p "require('$PACKAGE_DIR/package.json').version")
TIMESTAMP=$(date +%Y%m%d%H%M%S)
SHORT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "local")
FULL_VERSION="${VERSION}-${TIMESTAMP}-${SHORT_SHA}"
COMMIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "local")

echo "=== Host Screenshot Collector Upload ==="
echo "Environment: $ENVIRONMENT"
echo "Version: $FULL_VERSION"
echo "Commit: $COMMIT_SHA"
echo "Convex URL: $CONVEX_URL"
echo ""

# Build the package
echo "Building package..."
cd "$PACKAGE_DIR"
bun run build

DIST_FILE="$PACKAGE_DIR/dist/index.js"
if [[ ! -f "$DIST_FILE" ]]; then
  echo "Error: Build output not found at $DIST_FILE"
  exit 1
fi

# Inject version and build time into the built file
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "Injecting version: $FULL_VERSION, build time: $BUILD_TIME"
sed -i.bak "s/__COLLECTOR_VERSION__/$FULL_VERSION/g" "$DIST_FILE"
sed -i.bak "s/__COLLECTOR_BUILD_TIME__/$BUILD_TIME/g" "$DIST_FILE"
rm -f "$DIST_FILE.bak"

FILE_SIZE=$(wc -c < "$DIST_FILE")
echo "Built: $DIST_FILE ($FILE_SIZE bytes)"
echo ""

# Upload to Convex
echo "Uploading to Convex..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${CONVEX_URL}/api/host-screenshot-collector/sync" \
  -H "Content-Type: application/octet-stream" \
  -H "X-Version: ${FULL_VERSION}" \
  -H "X-Commit-SHA: ${COMMIT_SHA}" \
  -H "X-Is-Staging: ${IS_STAGING}" \
  --data-binary @"$DIST_FILE")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "✅ Upload successful!"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
  echo "❌ Upload failed (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi

echo ""

# Verify the upload
echo "Verifying upload..."
VERIFY_RESPONSE=$(curl -s "${CONVEX_URL}/api/host-screenshot-collector/latest?staging=${IS_STAGING}")
echo "$VERIFY_RESPONSE" | jq . 2>/dev/null || echo "$VERIFY_RESPONSE"

echo ""
echo "=== Done ==="
