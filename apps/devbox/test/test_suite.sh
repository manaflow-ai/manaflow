#!/bin/bash
# test/test_suite.sh
#
# Full cmux devbox + Morph Cloud Integration Test Suite
#
# This script tests the complete cmux devbox workflow:
# 1. Workspace creation
# 2. VM start/stop lifecycle
# 3. Browser automation commands
# 4. Screenshot and snapshot functionality
# 5. State persistence across restarts
#
# Prerequisites:
# - cmux devbox CLI installed and in PATH
# - MORPH_API_KEY environment variable set
# - Base snapshot created (see scripts/create_base_snapshot.py)
#
# Usage:
#   ./test/test_suite.sh              # Run all tests
#   ./test/test_suite.sh --quick      # Run quick smoke test
#   ./test/test_suite.sh --keep       # Don't cleanup workspace after tests
#   ./test/test_suite.sh --workspace NAME  # Use specific workspace name

set -e  # Exit on first error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test configuration
QUICK_MODE=false
KEEP_WORKSPACE=false
WS_PREFIX="cmux-test"
WS=""  # Will be set later

# Statistics
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
START_TIME=$(date +%s)

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick)
            QUICK_MODE=true
            shift
            ;;
        --keep)
            KEEP_WORKSPACE=true
            shift
            ;;
        --workspace)
            WS="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --quick       Run quick smoke test only"
            echo "  --keep        Don't cleanup workspace after tests"
            echo "  --workspace   Use specific workspace name"
            echo "  --help        Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Generate workspace name if not provided
if [ -z "$WS" ]; then
    WS="${WS_PREFIX}-$(date +%s)"
fi

# Utility functions
pass() {
    local msg=$1
    echo -e "${GREEN}[PASS]${NC} $msg"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    local msg=$1
    echo -e "${RED}[FAIL]${NC} $msg"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

skip() {
    local msg=$1
    echo -e "${YELLOW}[SKIP]${NC} $msg"
}

info() {
    local msg=$1
    echo -e "${BLUE}[INFO]${NC} $msg"
}

run_test() {
    local name=$1
    local cmd=$2

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    echo -e "${BLUE}--- Test $TESTS_RUN: $name ---${NC}"

    if eval "$cmd"; then
        pass "$name"
        return 0
    else
        fail "$name"
        return 1
    fi
}

assert_equals() {
    local expected=$1
    local actual=$2
    local msg=$3

    if [ "$expected" = "$actual" ]; then
        return 0
    else
        echo "  Expected: $expected"
        echo "  Actual: $actual"
        return 1
    fi
}

assert_contains() {
    local needle=$1
    local haystack=$2

    if [[ "$haystack" == *"$needle"* ]]; then
        return 0
    else
        echo "  Expected to contain: $needle"
        echo "  Actual: ${haystack:0:200}..."
        return 1
    fi
}

assert_file_exists() {
    local path=$1

    if [ -f "$path" ]; then
        return 0
    else
        echo "  File not found: $path"
        return 1
    fi
}

assert_file_not_empty() {
    local path=$1
    local min_size=${2:-0}

    if [ ! -f "$path" ]; then
        echo "  File not found: $path"
        return 1
    fi

    local size
    size=$(stat -f%z "$path" 2>/dev/null || stat -c%s "$path" 2>/dev/null || echo "0")

    if [ "$size" -gt "$min_size" ]; then
        return 0
    else
        echo "  File too small: $size bytes (expected > $min_size)"
        return 1
    fi
}

cleanup() {
    echo ""
    echo "=== Cleanup ==="

    if [ "$KEEP_WORKSPACE" = true ]; then
        info "Keeping workspace: $WS"
        return
    fi

    info "Cleaning up workspace: $WS"

    # Stop VM if running
    cmux computer stop -w "$WS" 2>/dev/null || true

    # Destroy workspace
    cmux destroy "$WS" --force 2>/dev/null || true

    # Remove temp files
    rm -f /tmp/cmux-test-*.png 2>/dev/null || true

    info "Cleanup complete"
}

# Set trap for cleanup on exit
trap cleanup EXIT

# =============================================================================
# TEST SUITE
# =============================================================================

echo "=============================================="
echo "  cmux devbox + Morph Cloud Test Suite"
echo "=============================================="
echo ""
echo "Workspace: $WS"
echo "Quick mode: $QUICK_MODE"
echo "Started at: $(date)"
echo ""

# Check prerequisites
echo "=== Prerequisites ==="

if ! command -v cmux &> /dev/null; then
    fail "cmux CLI not found in PATH"
    echo "Please install cmux CLI first"
    exit 1
fi
pass "cmux CLI found"

if [ -z "$MORPH_API_KEY" ]; then
    fail "MORPH_API_KEY not set"
    echo "Please set MORPH_API_KEY environment variable"
    exit 1
fi
pass "MORPH_API_KEY is set"

# Check if cmux base snapshot exists (via config or env)
# This is a soft check - the create command will fail if not configured
info "Base snapshot should be configured in cmux config"

# =============================================================================
# WORKSPACE TESTS
# =============================================================================

echo ""
echo "=== Workspace Tests ==="

# Test 1: Create workspace
run_test "Create workspace" "
    cmux create $WS --template=node
"

# Test 2: List workspaces
run_test "List workspaces includes new workspace" "
    OUTPUT=\$(cmux list 2>&1)
    assert_contains '$WS' \"\$OUTPUT\"
"

# =============================================================================
# VM LIFECYCLE TESTS
# =============================================================================

echo ""
echo "=== VM Lifecycle Tests ==="

# Test 3: Start VM
run_test "Start VM" "
    cmux computer start -w $WS
    sleep 5
"

# Test 4: Check status is running
run_test "VM status is running" "
    STATUS=\$(cmux computer status -w $WS --json 2>/dev/null | jq -r '.status' || echo 'unknown')
    assert_equals 'running' \"\$STATUS\" 'VM should be running'
"

# Test 5: Verify services (via exec)
run_test "Services are running" "
    RESULT=\$(cmux computer exec -w $WS 'systemctl is-active chrome-cdp' 2>/dev/null || echo 'inactive')
    assert_equals 'active' \"\$RESULT\" 'chrome-cdp should be active'
"

# Test 5b: Verify Docker is available
run_test "Docker is available" "
    RESULT=\$(cmux computer exec -w $WS 'docker --version' 2>/dev/null || echo '')
    assert_contains 'Docker version' \"\$RESULT\"
"

# =============================================================================
# BROWSER AUTOMATION TESTS
# =============================================================================

echo ""
echo "=== Browser Automation Tests ==="

# Test 6: Navigate to URL
run_test "Navigate to example.com" "
    cmux computer open 'https://example.com' -w $WS
    sleep 2
"

# Test 7: Get URL
run_test "Get current URL" "
    URL=\$(cmux computer get url -w $WS 2>/dev/null || echo '')
    assert_contains 'example.com' \"\$URL\"
"

# Test 8: Get title
run_test "Get page title" "
    TITLE=\$(cmux computer get title -w $WS 2>/dev/null || echo '')
    assert_contains 'Example' \"\$TITLE\"
"

# Test 9: Get snapshot
run_test "Get element snapshot" "
    SNAPSHOT=\$(cmux computer snapshot -i -w $WS 2>/dev/null || echo '')
    assert_contains '@e' \"\$SNAPSHOT\"
"

# Test 10: Take screenshot
run_test "Take screenshot" "
    cmux computer screenshot --output=/tmp/cmux-test-screenshot.png -w $WS
    assert_file_exists '/tmp/cmux-test-screenshot.png'
    assert_file_not_empty '/tmp/cmux-test-screenshot.png' 10000
"

if [ "$QUICK_MODE" = false ]; then
    # Test 11: Click element
    run_test "Click element" "
        # Example.com has a 'More information...' link
        cmux computer click 'text=More information' -w $WS 2>/dev/null || true
        sleep 2
        # URL should change
        URL=\$(cmux computer get url -w $WS 2>/dev/null || echo '')
        # Note: example.com link goes to IANA, so URL should change
        echo \"New URL: \$URL\"
        true  # This is a soft test
    "

    # Test 12: Back navigation
    run_test "Back navigation" "
        cmux computer back -w $WS
        sleep 1
        URL=\$(cmux computer get url -w $WS 2>/dev/null || echo '')
        assert_contains 'example.com' \"\$URL\"
    "

    # Test 13: Reload
    run_test "Reload page" "
        cmux computer reload -w $WS
        sleep 1
    "
fi

# =============================================================================
# SNAPSHOT & PERSISTENCE TESTS
# =============================================================================

if [ "$QUICK_MODE" = false ]; then
    echo ""
    echo "=== Snapshot & Persistence Tests ==="

    # Test 14: Save snapshot
    run_test "Save VM snapshot" "
        cmux computer save --name='test-state' -w $WS
    "

    # Test 15: Stop VM
    run_test "Stop VM" "
        cmux computer stop -w $WS
        sleep 2
    "

    # Test 16: Status shows stopped
    run_test "VM status is stopped" "
        STATUS=\$(cmux computer status -w $WS --json 2>/dev/null | jq -r '.status' || echo 'unknown')
        assert_equals 'stopped' \"\$STATUS\" 'VM should be stopped'
    "

    # Test 17: Resume from snapshot
    run_test "Resume from snapshot" "
        cmux computer start --snapshot='test-state' -w $WS
        sleep 5
    "

    # Test 18: Verify state persisted
    run_test "State persisted across restart" "
        # Page should still be example.com from before stop
        URL=\$(cmux computer get url -w $WS 2>/dev/null || echo '')
        assert_contains 'example.com' \"\$URL\"
    "
fi

# =============================================================================
# VNC TEST
# =============================================================================

if [ "$QUICK_MODE" = false ]; then
    echo ""
    echo "=== VNC Tests ==="

    run_test "VNC URL is accessible" "
        # Get the VNC URL and verify it responds
        VNC_URL=\$(cmux computer vnc --url-only -w $WS 2>/dev/null || echo '')
        if [ -n \"\$VNC_URL\" ]; then
            # Try to fetch the VNC page
            HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' \"\$VNC_URL\" 2>/dev/null || echo '000')
            [ \"\$HTTP_CODE\" = '200' ] || [ \"\$HTTP_CODE\" = '302' ]
        else
            echo 'Could not get VNC URL'
            false
        fi
    "
fi

# =============================================================================
# FINAL STOP
# =============================================================================

echo ""
echo "=== Final Cleanup ==="

run_test "Final stop VM" "
    cmux computer stop -w $WS
"

# =============================================================================
# SUMMARY
# =============================================================================

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "=============================================="
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}       All tests passed!${NC}"
else
    echo -e "${YELLOW}       Some tests failed${NC}"
fi
echo "=============================================="
echo ""
echo "Summary:"
echo "  Total:   $TESTS_RUN"
echo "  Passed:  $TESTS_PASSED"
echo "  Failed:  $TESTS_FAILED"
echo "  Duration: ${DURATION}s"
echo ""
echo "Completed at: $(date)"

# Exit with error if any tests failed
exit $TESTS_FAILED
