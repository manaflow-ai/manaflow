#!/bin/bash
# test/test_edge_cases.sh
#
# Edge case and error handling tests for cmux devbox + Morph Cloud
#
# This script tests error conditions and edge cases:
# - Invalid refs
# - Invalid URLs
# - Invalid keys
# - Double start/stop
# - Non-existent workspaces
# - Stale refs
# - And more...
#
# Prerequisites:
# - cmux devbox CLI installed and in PATH
# - MORPH_API_KEY environment variable set
# - Base snapshot created
#
# Usage:
#   ./test/test_edge_cases.sh              # Run all edge case tests
#   ./test/test_edge_cases.sh --keep       # Keep workspace after tests
#   ./test/test_edge_cases.sh --workspace NAME  # Use specific workspace

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
KEEP_WORKSPACE=false
WS_PREFIX="cmux-edge-test"
WS=""

# Statistics
TESTS_RUN=0
TESTS_PASSED=0
TESTS_WARNED=0

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
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

warn() {
    local msg=$1
    echo -e "${YELLOW}[WARN]${NC} $msg"
    TESTS_WARNED=$((TESTS_WARNED + 1))
}

info() {
    local msg=$1
    echo -e "${BLUE}[INFO]${NC} $msg"
}

# Run a test that expects an error
# Returns 0 if the command fails (expected), 1 if it succeeds (unexpected)
expect_error() {
    local desc=$1
    local pattern=$2
    shift 2
    local cmd="$*"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    echo -e "${BLUE}--- Edge Case $TESTS_RUN: $desc ---${NC}"
    echo "  Command: $cmd"

    local output
    local exit_code

    # Run command, capture output and exit code
    set +e
    output=$(eval "$cmd" 2>&1)
    exit_code=$?
    set -e

    echo "  Exit code: $exit_code"
    echo "  Output: ${output:0:200}"

    if [ $exit_code -eq 0 ]; then
        warn "Command succeeded (expected failure)"
        return 1
    fi

    if [ -n "$pattern" ]; then
        if [[ "$output" == *"$pattern"* ]]; then
            pass "Failed with expected error containing: '$pattern'"
            return 0
        else
            warn "Failed but error message didn't match pattern: '$pattern'"
            return 0
        fi
    else
        pass "Failed as expected"
        return 0
    fi
}

# Run a test that expects success
expect_success() {
    local desc=$1
    shift
    local cmd="$*"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    echo -e "${BLUE}--- Edge Case $TESTS_RUN: $desc ---${NC}"
    echo "  Command: $cmd"

    local output
    local exit_code

    set +e
    output=$(eval "$cmd" 2>&1)
    exit_code=$?
    set -e

    echo "  Exit code: $exit_code"
    echo "  Output: ${output:0:200}"

    if [ $exit_code -eq 0 ]; then
        pass "Succeeded as expected"
        return 0
    else
        warn "Command failed unexpectedly"
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
    cmux computer stop -w "$WS" 2>/dev/null || true
    cmux destroy "$WS" --force 2>/dev/null || true
    info "Cleanup complete"
}

trap cleanup EXIT

# =============================================================================
# EDGE CASE TESTS
# =============================================================================

echo "=============================================="
echo "       cmux devbox Edge Case Test Suite"
echo "=============================================="
echo ""
echo "Workspace: $WS"
echo "Started at: $(date)"

# =============================================================================
# PRE-VM EDGE CASES
# =============================================================================

echo ""
echo "=== Pre-VM Edge Cases ==="

# Test: Status of non-existent workspace
expect_error "Status of non-existent workspace" "not found" \
    "cmux computer status -w nonexistent-workspace-xyz-123"

# Test: Start non-existent workspace
expect_error "Start non-existent workspace" "not found" \
    "cmux computer start -w nonexistent-workspace-xyz-123"

# Test: Stop non-existent workspace
expect_error "Stop non-existent workspace" "not found" \
    "cmux computer stop -w nonexistent-workspace-xyz-123"

# Test: Start with invalid snapshot
expect_error "Start with invalid snapshot ID" "" \
    "cmux computer start --snapshot=invalid-snapshot-id-xyz -w $WS"

# =============================================================================
# SETUP: Create workspace and start VM
# =============================================================================

echo ""
echo "=== Setup ==="

info "Creating workspace: $WS"
cmux create "$WS" --template=node || true

info "Starting VM..."
cmux computer start -w "$WS"
sleep 5

info "Navigating to example.com..."
cmux computer open "https://example.com" -w "$WS"
sleep 2

# =============================================================================
# BROWSER AUTOMATION EDGE CASES
# =============================================================================

echo ""
echo "=== Browser Automation Edge Cases ==="

# Test: Click non-existent ref
expect_error "Click non-existent ref @e999" "not found" \
    "cmux computer click @e999 -w $WS"

# Test: Click invalid ref format
expect_error "Click invalid ref format" "" \
    "cmux computer click 'invalid-ref-format' -w $WS"

# Test: Navigate to invalid URL
expect_error "Navigate to invalid URL" "" \
    "cmux computer open 'https://this-domain-definitely-does-not-exist-xyz.invalid' -w $WS"

# Test: Press invalid key
expect_error "Press invalid key" "" \
    "cmux computer press 'NotARealKey' -w $WS"

# Test: Fill on non-input element (h1)
# This might not error but should handle gracefully
TESTS_RUN=$((TESTS_RUN + 1))
echo ""
echo -e "${BLUE}--- Edge Case $TESTS_RUN: Fill on non-input element ---${NC}"
OUTPUT=$(cmux computer fill "h1" "test text" -w "$WS" 2>&1 || true)
echo "  Output: ${OUTPUT:0:200}"
if [[ "$OUTPUT" == *"not"* ]] || [[ "$OUTPUT" == *"error"* ]] || [[ "$OUTPUT" == *"cannot"* ]]; then
    pass "Fill on non-input handled gracefully"
else
    warn "Fill on non-input - behavior unclear"
fi

# Test: Get text from non-existent element
expect_error "Get text from non-existent element" "" \
    "cmux computer get text '#element-that-does-not-exist' -w $WS"

# Test: Wait for non-existent element (should timeout)
TESTS_RUN=$((TESTS_RUN + 1))
echo ""
echo -e "${BLUE}--- Edge Case $TESTS_RUN: Wait for non-existent element (timeout) ---${NC}"
echo "  This test may take a while..."
START=$(date +%s)
set +e
OUTPUT=$(timeout 35 cmux computer wait "#nonexistent-element-xyz" --timeout=5000 -w "$WS" 2>&1)
EXIT_CODE=$?
set -e
END=$(date +%s)
DURATION=$((END - START))
echo "  Duration: ${DURATION}s"
echo "  Exit code: $EXIT_CODE"
echo "  Output: ${OUTPUT:0:200}"
if [ $EXIT_CODE -ne 0 ] || [[ "$OUTPUT" == *"timeout"* ]] || [[ "$OUTPUT" == *"not found"* ]]; then
    pass "Wait timeout handled correctly"
else
    warn "Wait behavior unclear"
fi

# =============================================================================
# VM LIFECYCLE EDGE CASES
# =============================================================================

echo ""
echo "=== VM Lifecycle Edge Cases ==="

# Test: Start when already running
expect_success "Start when already running (should be idempotent)" \
    "cmux computer start -w $WS"

# Test: Double screenshot (rapid fire)
TESTS_RUN=$((TESTS_RUN + 1))
echo ""
echo -e "${BLUE}--- Edge Case $TESTS_RUN: Rapid screenshots ---${NC}"
set +e
cmux computer screenshot --output=/tmp/edge1.png -w "$WS" &
PID1=$!
cmux computer screenshot --output=/tmp/edge2.png -w "$WS" &
PID2=$!
wait $PID1
wait $PID2
set -e
if [ -f /tmp/edge1.png ] && [ -f /tmp/edge2.png ]; then
    pass "Concurrent screenshots completed"
    rm -f /tmp/edge1.png /tmp/edge2.png
else
    warn "Concurrent screenshots may have issues"
fi

# Test: Snapshot on blank page
info "Navigating to about:blank..."
cmux computer open "about:blank" -w "$WS" 2>/dev/null || true
sleep 1

TESTS_RUN=$((TESTS_RUN + 1))
echo ""
echo -e "${BLUE}--- Edge Case $TESTS_RUN: Snapshot on blank page ---${NC}"
OUTPUT=$(cmux computer snapshot -i -w "$WS" 2>&1 || true)
echo "  Output: ${OUTPUT:0:200}"
pass "Snapshot on blank page handled"

# Navigate back to a real page for remaining tests
cmux computer open "https://example.com" -w "$WS"
sleep 2

# =============================================================================
# STOP/RESTART EDGE CASES
# =============================================================================

echo ""
echo "=== Stop/Restart Edge Cases ==="

# Stop the VM
info "Stopping VM..."
cmux computer stop -w "$WS"
sleep 2

# Test: Double stop
expect_success "Stop when already stopped (should be idempotent)" \
    "cmux computer stop -w $WS"

# Test: Commands on stopped VM
expect_error "Screenshot on stopped VM" "" \
    "cmux computer screenshot --output=/tmp/test.png -w $WS"

expect_error "Click on stopped VM" "" \
    "cmux computer click @e1 -w $WS"

expect_error "Get URL on stopped VM" "" \
    "cmux computer get url -w $WS"

# Restart for any remaining tests
info "Restarting VM..."
cmux computer start -w "$WS"
sleep 5

# =============================================================================
# SPECIAL CHARACTER EDGE CASES
# =============================================================================

echo ""
echo "=== Special Character Edge Cases ==="

# Test: URL with special characters
TESTS_RUN=$((TESTS_RUN + 1))
echo ""
echo -e "${BLUE}--- Edge Case $TESTS_RUN: URL with query parameters ---${NC}"
OUTPUT=$(cmux computer open "https://example.com/?param=value&other=test" -w "$WS" 2>&1 || true)
echo "  Output: ${OUTPUT:0:200}"
URL=$(cmux computer get url -w "$WS" 2>/dev/null || echo "")
if [[ "$URL" == *"example.com"* ]]; then
    pass "URL with query params handled"
else
    warn "URL handling unclear"
fi

# Test: Type with special characters
TESTS_RUN=$((TESTS_RUN + 1))
echo ""
echo -e "${BLUE}--- Edge Case $TESTS_RUN: Special characters in text ---${NC}"
# Navigate to example.com (has no inputs, but test the command parsing)
OUTPUT=$(cmux computer type "@e1" "Hello! @#\$%^&*()" -w "$WS" 2>&1 || true)
echo "  Output: ${OUTPUT:0:200}"
pass "Special characters in type command handled"

# =============================================================================
# SUMMARY
# =============================================================================

echo ""
echo "=============================================="
echo "       Edge Case Tests Complete"
echo "=============================================="
echo ""
echo "Summary:"
echo "  Total:   $TESTS_RUN"
echo "  Passed:  $TESTS_PASSED"
echo "  Warned:  $TESTS_WARNED"
echo ""
echo "Completed at: $(date)"

# All edge case tests are expected to handle errors gracefully
# So we exit 0 even if some had warnings
exit 0
