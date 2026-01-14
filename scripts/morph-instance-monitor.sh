#!/bin/bash
# Monitors Morph instances and alerts if any user has > 50 active instances

THRESHOLD=50

check_instances() {
  # Fetch all instances (paginated) into temp files
  temp_dir=$(mktemp -d)
  trap "rm -rf $temp_dir" EXIT

  for page in {1..30}; do
    uvx morphcloud instance list --json --limit 100 --page "$page" 2>/dev/null > "$temp_dir/page_$page.json"
    count=$(jq '.instances | length' "$temp_dir/page_$page.json")
    if [ "$count" -eq 0 ]; then
      rm "$temp_dir/page_$page.json"
      break
    fi
  done

  # Count instances per user
  offenders=$(jq -s --argjson threshold "$THRESHOLD" '
    [.[].instances[]] |
    map(select(.status == "ready")) |
    group_by(.metadata.userId // "no-user") |
    map({userId: (.[0].metadata.userId // "no-user"), count: length}) |
    map(select(.count > $threshold))
  ' "$temp_dir"/page_*.json 2>/dev/null)

  offender_count=$(echo "$offenders" | jq 'length' 2>/dev/null || echo "0")

  if [ "$offender_count" -gt 0 ] 2>/dev/null; then
    # Build alert message
    message=$(echo "$offenders" | jq -r '.[] | "\(.userId): \(.count) instances"' | tr '\n' ', ' | sed 's/, $//')

    # macOS notification
    osascript -e "display notification \"$message\" with title \"Morph Instance Alert\" sound name \"Submarine\""

    # Say command
    say "Warning: Morph instance threshold exceeded. $offender_count users have more than $THRESHOLD instances."

    echo "[$(date)] ALERT: $message"
  else
    echo "[$(date)] OK: No users exceed $THRESHOLD instances"
  fi
}

# Run once if called with --once, otherwise loop
if [ "$1" = "--once" ]; then
  check_instances
else
  echo "Starting Morph instance monitor (threshold: $THRESHOLD instances per user)"
  echo "Press Ctrl+C to stop"
  while true; do
    check_instances
    sleep 60
  done
fi
