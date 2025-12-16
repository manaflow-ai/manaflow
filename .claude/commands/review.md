Run the codex code review against main branch and report findings:

```bash
cd "$CLAUDE_PROJECT_DIR"
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

script -q "$TMPFILE" codex \
  --dangerously-bypass-approvals-and-sandbox \
  --model gpt-5.2 \
  -c model_reasoning_effort="high" \
  review --base main 2>&1 || true

# Extract findings after last "codex" marker
FINDINGS=$(awk '/^codex$/ { found=1; content=""; next } found { content = content $0 "\n" } END { print content }' "$TMPFILE" | sed 's/\x1b\[[0-9;]*m//g' | sed '/^$/d')

echo "## Codex Review Findings"
echo "$FINDINGS"
```

Analyze these findings and address any issues found.
