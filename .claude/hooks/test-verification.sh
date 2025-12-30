#!/bin/bash
# Test verification hook - ensures tests exist and pass for modified code
# Part of the closed-loop verification harness

set -euo pipefail

# Skip if disabled via env var
if [ "${TEST_VERIFICATION_DISABLED:-}" = "1" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Read session_id from hook stdin JSON
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "default"' 2>/dev/null || echo "default")

# Hard stop after 5 attempts to prevent excessive loops (per session)
ATTEMPT_COUNT_FILE="/tmp/test-verification-${SESSION_ID}"
ATTEMPT_COUNT=0
if [ -f "$ATTEMPT_COUNT_FILE" ]; then
  ATTEMPT_COUNT=$(cat "$ATTEMPT_COUNT_FILE")
fi
if [ "$ATTEMPT_COUNT" -ge 5 ]; then
  exit 0  # Hit limit, stop checking
fi

# Get modified TypeScript files (excluding test files, node_modules, dist)
MODIFIED_FILES=$(git diff --name-only HEAD 2>/dev/null | grep '\.ts$' | grep -v '\.test\.ts$' | grep -v 'node_modules' | grep -v '/dist/' || echo "")

if [ -z "$MODIFIED_FILES" ]; then
  # No modified TS files, check staged files
  MODIFIED_FILES=$(git diff --cached --name-only 2>/dev/null | grep '\.ts$' | grep -v '\.test\.ts$' | grep -v 'node_modules' | grep -v '/dist/' || echo "")
fi

if [ -z "$MODIFIED_FILES" ]; then
  rm -f "$ATTEMPT_COUNT_FILE"
  exit 0  # No files to check
fi

MISSING_TESTS=""
EXISTING_TESTS=""

# Check for corresponding test files
while IFS= read -r file; do
  [ -z "$file" ] && continue

  # Skip files that don't need tests (config, types-only, etc.)
  if echo "$file" | grep -qE '(config|schema|types|index)\.ts$'; then
    continue
  fi

  # Derive expected test file path
  TEST_FILE="${file%.ts}.test.ts"

  if [ -f "$TEST_FILE" ]; then
    EXISTING_TESTS="$EXISTING_TESTS $TEST_FILE"
  else
    # Check if there's a test file in the same directory with different naming
    DIR=$(dirname "$file")
    BASENAME=$(basename "$file" .ts)
    ALT_TEST="$DIR/${BASENAME}.test.ts"

    if [ -f "$ALT_TEST" ]; then
      EXISTING_TESTS="$EXISTING_TESTS $ALT_TEST"
    else
      MISSING_TESTS="$MISSING_TESTS\n- $file (expected: $TEST_FILE)"
    fi
  fi
done <<< "$MODIFIED_FILES"

# Trim whitespace
EXISTING_TESTS=$(echo "$EXISTING_TESTS" | xargs)

# Run existing tests
if [ -n "$EXISTING_TESTS" ]; then
  echo "Running tests for modified files..." >&2

  TEST_OUTPUT=$(bun test $EXISTING_TESTS 2>&1) || TEST_EXIT=$?
  TEST_EXIT=${TEST_EXIT:-0}

  if [ "$TEST_EXIT" -ne 0 ]; then
    echo $((ATTEMPT_COUNT + 1)) > "$ATTEMPT_COUNT_FILE"
    echo "## Test Verification Failed (attempt $((ATTEMPT_COUNT + 1))/5)" >&2
    echo "" >&2
    echo "**Tests failed:**" >&2
    echo "$TEST_OUTPUT" | tail -50 >&2
    echo "" >&2
    echo "**Action required:** Fix failing tests before completing." >&2
    exit 2
  fi
fi

# Report missing tests (warning, not blocking)
if [ -n "$MISSING_TESTS" ]; then
  echo "## Test Coverage Warning" >&2
  echo "" >&2
  echo "**Modified files without tests:**" >&2
  echo -e "$MISSING_TESTS" >&2
  echo "" >&2
  echo "Per closed-loop verification protocol, consider adding tests for these files." >&2
  echo "Skip this check by setting TEST_VERIFICATION_DISABLED=1" >&2
  echo "" >&2
  # Don't block, just warn
fi

# Success - reset counter
rm -f "$ATTEMPT_COUNT_FILE"
exit 0
