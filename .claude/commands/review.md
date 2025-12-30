---
description: Run multi-agent code review checkpoint (USE PROACTIVELY during big changes, not just at end)
---

# Multi-Agent Code Review Checkpoint

**RUN THIS PROACTIVELY DURING IMPLEMENTATION, NOT JUST AT THE END.**

## When to Run This

Run `/review` when:
- You've made significant changes (>50 lines, >2 files)
- You're unsure if an approach is correct
- Before moving to the next beads issue
- After implementing a new feature or fixing a complex bug
- When you want a mid-implementation sanity check

**Don't wait until you're "done" - checkpoint early and often.**

## Review Process

Run comprehensive review with multiple AI perspectives:

```bash
cd "$CLAUDE_PROJECT_DIR"

# Get the diff to review
DIFF=$(git diff main...HEAD 2>/dev/null || git diff HEAD 2>/dev/null || echo "No changes")

echo "## Running Multi-Agent Review..."
echo ""

# Temp files for parallel execution
CODEX_OUT=$(mktemp)
GEMINI_OUT=$(mktemp)
trap 'rm -f "$CODEX_OUT" "$GEMINI_OUT"' EXIT

# Run Codex review
echo "### Codex Code Quality Review"
unbuffer codex \
  --dangerously-bypass-approvals-and-sandbox \
  --model gpt-5.2-codex \
  -c model_reasoning_effort="high" \
  review --base "Review for code quality, bugs, and architectural concerns." 2>&1 | tee "$CODEX_OUT" || true

echo ""
echo "---"
echo ""

# Run Gemini protocol compliance review
echo "### Gemini Protocol Compliance Check"
PROTOCOL_PROMPT='Review this code change for protocol compliance:
1. Were success/failure criteria defined before implementation?
2. Were multiple architectural approaches considered for significant decisions?
3. Was verification performed (tests written, manual checks)?
4. Any decisions that should have been escalated for human review?

Be specific about what was missing or could be improved.'

echo "$DIFF" | gemini -p "$PROTOCOL_PROMPT" | tee "$GEMINI_OUT" || true

echo ""
echo "---"
echo ""
echo "## Summary"
echo "Review complete. Address issues and continue working."
```

## After Review - ACTION (not asking)

**DO NOT ASK. JUST DO.**

1. **CRITICAL issues** - Fix immediately, don't ask permission
2. **MAJOR issues** - Fix now or create beads issue
3. **MINOR issues** - Create beads issue for later:
   ```bash
   bd create --title="Address review feedback: ..." --type=task --priority=2 --labels $(git rev-parse --abbrev-ref HEAD)
   ```

4. **Continue working** - The review is a checkpoint, not a stopping point

## After Fixing Issues

```bash
# Check remaining beads work
bd ready --label $(git rev-parse --abbrev-ref HEAD)
```

Then pick up the next issue and keep going. **Don't stop to ask if you should continue.**
