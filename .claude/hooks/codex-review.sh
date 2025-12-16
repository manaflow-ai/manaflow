#!/bin/bash
# Runs codex code review and outputs only the findings

set -euo pipefail

# Skip if disabled via env var
if [ "${CODEX_REVIEW_DISABLED:-}" = "1" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Read session_id from hook stdin JSON
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "default"' 2>/dev/null || echo "default")

# Hard stop after 5 failures to prevent excessive loops (per session)
FAIL_COUNT_FILE="/tmp/codex-review-fails-${SESSION_ID}"
FAIL_COUNT=0
if [ -f "$FAIL_COUNT_FILE" ]; then
  FAIL_COUNT=$(cat "$FAIL_COUNT_FILE")
fi
if [ "$FAIL_COUNT" -ge 5 ]; then
  exit 0  # Hit limit, stop showing issues
fi

# Create temp file for output
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

# Run codex with unbuffer to capture TTY output (script doesn't work without real TTY)
unbuffer codex \
  --dangerously-bypass-approvals-and-sandbox \
  --model gpt-5.2 \
  -c model_reasoning_effort="high" \
  review --base "Review compared to main, including including staged, unstaged, and untracked changes." > "$TMPFILE" 2>&1 || true

# Strip ANSI codes first, then extract final codex response
CLEAN=$(sed 's/\x1b\[[0-9;]*m//g' "$TMPFILE")

# Extract just the final codex response (after the last "codex" marker)
FINDINGS=$(echo "$CLEAN" | awk '
  /^codex$/ { found=1; content=""; next }
  found { content = content $0 "\n" }
  END { print content }
' | sed '/^$/d' | grep -v '^tokens used' | head -50)

if [ -z "$FINDINGS" ]; then
  exit 0  # No output from codex
fi

# Use opencode to check if review passed (lgtm) or has issues
VERDICT=$(opencode run "Output: $FINDINGS

If the output indicates code review passed with no issues, return exactly 'lgtm'. Otherwise return 'issues'." --model opencode/big-pickle 2>/dev/null || echo "issues")

if echo "$VERDICT" | grep -qi "lgtm"; then
  rm -f "$FAIL_COUNT_FILE"  # Reset counter on success
  exit 0  # Review passed, don't bother Claude
fi

# Has issues - increment counter and show to Claude
echo $((FAIL_COUNT + 1)) > "$FAIL_COUNT_FILE"
echo "## Codex Code Review Findings (attempt $((FAIL_COUNT + 1))/5)" >&2
echo "" >&2
echo "$FINDINGS" >&2
exit 2
