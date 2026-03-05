---
name: head-agent
description: Background polling loop skill that monitors GitHub Projects for new items and auto-dispatches agents for discovered work.
---

# head-agent - GitHub Projects Polling Loop

> **Purpose**: Run a background loop that polls GitHub Projects for items in "Backlog" (or a configurable status) that don't have linked tasks, then automatically dispatches agents to work on them. Enables fully autonomous development workflows driven by project boards.

## Use Cases

1. **Continuous Development**: Automatically pick up backlog items and start working on them
2. **Team Automation**: Keep development moving without manual task dispatch
3. **Board-Driven Development**: Let the project board drive what work gets done
4. **Scheduled Processing**: Process backlog items at regular intervals

## Quick Start

```bash
# Start a head agent polling loop (polls every 5 minutes by default)
devsh head-agent start \
  --project-id PVT_xxx \
  --installation-id 12345 \
  --repo owner/repo \
  --agent claude/haiku-4.5

# Poll once and dispatch (no loop)
devsh head-agent poll-once \
  --project-id PVT_xxx \
  --installation-id 12345 \
  --repo owner/repo \
  --agent claude/haiku-4.5

# Check items that would be dispatched (dry run)
devsh project items \
  --project-id PVT_xxx \
  --installation-id 12345 \
  --status Backlog \
  --no-linked-task
```

## Architecture

```
                    GitHub Project (v2)
                           |
                           v
+--------------------------------------------------+
|               Head Agent Polling Loop             |
|                                                   |
|  1. Poll: devsh project items                     |
|           --status Backlog --no-linked-task       |
|                                                   |
|  2. For each new item:                            |
|     devsh task create --from-project-item PVTI_   |
|                       --agent <configured-agent>  |
|                                                   |
|  3. Sleep for poll interval                       |
|                                                   |
|  4. Repeat                                        |
+--------------------------------------------------+
                           |
                           v
               +---------------------+
               |  Spawned Agents     |
               |  (in sandboxes)     |
               +---------------------+
                           |
                           v
               +---------------------+
               |  GitHub PRs         |
               |  (auto-created)     |
               +---------------------+
```

## Shell Script Implementation

You can implement a head agent polling loop using a simple shell script:

```bash
#!/usr/bin/env bash
# head-agent-loop.sh - Polls GitHub Project and dispatches agents for new backlog items
set -euo pipefail

# Configuration
PROJECT_ID="${HEAD_AGENT_PROJECT_ID:-}"
INSTALLATION_ID="${HEAD_AGENT_INSTALLATION_ID:-}"
REPO="${HEAD_AGENT_REPO:-}"
AGENT="${HEAD_AGENT_AGENT:-claude/haiku-4.5}"
POLL_INTERVAL="${HEAD_AGENT_POLL_INTERVAL:-300}"  # 5 minutes default
STATUS="${HEAD_AGENT_STATUS:-Backlog}"
MAX_ITEMS_PER_POLL="${HEAD_AGENT_MAX_ITEMS:-5}"
LOG_FILE="${HEAD_AGENT_LOG_FILE:-/tmp/head-agent.log}"

# Validate configuration
if [[ -z "$PROJECT_ID" || -z "$INSTALLATION_ID" || -z "$REPO" ]]; then
  echo "ERROR: Missing required configuration"
  echo "Set HEAD_AGENT_PROJECT_ID, HEAD_AGENT_INSTALLATION_ID, HEAD_AGENT_REPO"
  exit 1
fi

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

poll_and_dispatch() {
  log "Polling project $PROJECT_ID for items with status '$STATUS' and no linked task..."

  # Get items that need work
  items=$(devsh project items \
    --project-id "$PROJECT_ID" \
    --installation-id "$INSTALLATION_ID" \
    --status "$STATUS" \
    --no-linked-task \
    --first "$MAX_ITEMS_PER_POLL" \
    --json 2>/dev/null || echo '{"items":[]}')

  count=$(echo "$items" | jq '.items | length')
  log "Found $count item(s) ready for dispatch"

  if [[ "$count" -eq 0 ]]; then
    return 0
  fi

  # Dispatch agents for each item
  echo "$items" | jq -r '.items[].id' | while read -r item_id; do
    log "Dispatching agent for item: $item_id"

    result=$(devsh task create \
      --from-project-item "$item_id" \
      --gh-project-id "$PROJECT_ID" \
      --gh-project-installation-id "$INSTALLATION_ID" \
      --repo "$REPO" \
      --agent "$AGENT" \
      --json 2>&1) || true

    if echo "$result" | jq -e '.taskId' >/dev/null 2>&1; then
      task_id=$(echo "$result" | jq -r '.taskId')
      log "SUCCESS: Created task $task_id for item $item_id"
    else
      log "ERROR: Failed to dispatch for $item_id: $result"
    fi

    # Small delay between dispatches to avoid overwhelming the API
    sleep 2
  done
}

main_loop() {
  log "Starting head agent loop"
  log "  Project ID: $PROJECT_ID"
  log "  Installation ID: $INSTALLATION_ID"
  log "  Repo: $REPO"
  log "  Agent: $AGENT"
  log "  Poll Interval: ${POLL_INTERVAL}s"
  log "  Status Filter: $STATUS"

  while true; do
    poll_and_dispatch
    log "Sleeping for ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
  done
}

# Entry point
case "${1:-loop}" in
  loop|start)
    main_loop
    ;;
  once|poll-once)
    poll_and_dispatch
    ;;
  *)
    echo "Usage: $0 [loop|once]"
    exit 1
    ;;
esac
```

### Running the Loop

```bash
# Set configuration via environment
export HEAD_AGENT_PROJECT_ID="PVT_xxx"
export HEAD_AGENT_INSTALLATION_ID="12345"
export HEAD_AGENT_REPO="owner/repo"
export HEAD_AGENT_AGENT="claude/haiku-4.5"
export HEAD_AGENT_POLL_INTERVAL="300"  # 5 minutes

# Start the polling loop
./head-agent-loop.sh loop

# Or run once (for testing)
./head-agent-loop.sh once
```

### Running as a Background Service

```bash
# Using systemd (create /etc/systemd/system/head-agent.service)
[Unit]
Description=Head Agent Polling Loop
After=network.target

[Service]
Type=simple
Environment=HEAD_AGENT_PROJECT_ID=PVT_xxx
Environment=HEAD_AGENT_INSTALLATION_ID=12345
Environment=HEAD_AGENT_REPO=owner/repo
Environment=HEAD_AGENT_AGENT=claude/haiku-4.5
ExecStart=/usr/local/bin/head-agent-loop.sh loop
Restart=always
RestartSec=60

[Install]
WantedBy=multi-user.target

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable head-agent
sudo systemctl start head-agent
```

## MCP Integration

When running as a head agent in a cloud workspace, you can use MCP tools for orchestration:

```typescript
// Poll for new items programmatically
async function pollForNewItems() {
  // Use devsh CLI to get items
  const result = await execAsync(`devsh project items \
    --project-id ${projectId} \
    --installation-id ${installationId} \
    --status Backlog \
    --no-linked-task \
    --json`);

  const items = JSON.parse(result.stdout).items;

  for (const item of items) {
    // Spawn agent for each item
    await spawn_agent({
      prompt: `Work on project item: ${item.content?.title}\n\n${item.content?.body || ''}`,
      agentName: "claude/haiku-4.5",
      repo: "owner/repo",
    });
  }
}

// Run polling loop
async function headAgentLoop(pollIntervalMs = 300000) {
  while (true) {
    try {
      await pollForNewItems();
    } catch (err) {
      console.error("Poll error:", err);
    }
    await sleep(pollIntervalMs);
  }
}
```

## Configuration Reference

| Environment Variable | CLI Flag | Default | Description |
|---------------------|----------|---------|-------------|
| `HEAD_AGENT_PROJECT_ID` | `--project-id` | (required) | GitHub Project node ID (PVT_xxx) |
| `HEAD_AGENT_INSTALLATION_ID` | `--installation-id` | (required) | GitHub App installation ID |
| `HEAD_AGENT_REPO` | `--repo` | (required) | Repository in owner/repo format |
| `HEAD_AGENT_AGENT` | `--agent` | `claude/haiku-4.5` | Agent to dispatch |
| `HEAD_AGENT_POLL_INTERVAL` | `--poll-interval` | `300` | Seconds between polls |
| `HEAD_AGENT_STATUS` | `--status` | `Backlog` | Project status to filter by |
| `HEAD_AGENT_MAX_ITEMS` | `--max-items` | `5` | Max items to dispatch per poll |
| `HEAD_AGENT_LOG_FILE` | `--log-file` | `/tmp/head-agent.log` | Log file path |

## Workflow Integration

### Project Board Setup

1. **Create a GitHub Project (v2)** with columns:
   - `Backlog` - Items ready for agents to work on
   - `In Progress` - Items with active agent work
   - `Done` - Completed items

2. **Configure Project Status Field**: Ensure your project has a "Status" single-select field with the column names above.

3. **Add Items to Backlog**: Add issues, PRs, or draft items to the project and set their status to "Backlog".

### Automatic Status Updates

When agents complete work, the status field is automatically updated:
- Task created: Status changes to "In Progress"
- Agent completes: Status changes to "Done" (if PR merged) or stays "In Progress"

## Best Practices

1. **Start with Low Concurrency**: Begin with `MAX_ITEMS_PER_POLL=1` to validate your workflow before scaling up.

2. **Use Appropriate Agents**: Match agent capability to task complexity:
   - `claude/haiku-4.5` - Quick fixes, simple tasks
   - `claude/sonnet-4.5` - Medium complexity features
   - `claude/opus-4.5` - Complex architectural changes

3. **Monitor Logs**: Watch the log file for errors and dispatch success rates.

4. **Set Reasonable Poll Intervals**: 5-15 minutes is usually sufficient. Too frequent polling wastes API calls.

5. **Use Dry Runs First**: Test with `devsh project items --status Backlog --no-linked-task` to see what would be dispatched.

6. **Configure Auto-PR**: Enable Auto-PR in settings so completed work automatically creates pull requests.

7. **Handle Failures**: If a task fails, the item won't be re-dispatched (it has a linked task). Review failed tasks manually.

## Troubleshooting

### No Items Being Dispatched

```bash
# Check if there are items in the target status
devsh project items --project-id PVT_xxx --installation-id 12345 --status Backlog

# Check if items already have linked tasks
devsh project items --project-id PVT_xxx --installation-id 12345 --status Backlog --no-linked-task

# Verify authentication
devsh auth status
```

### Task Creation Failures

```bash
# Test task creation manually
devsh task create \
  --from-project-item PVTI_xxx \
  --gh-project-id PVT_xxx \
  --gh-project-installation-id 12345 \
  --repo owner/repo \
  --agent claude/haiku-4.5 \
  --json
```

### Finding Project and Installation IDs

```bash
# List projects
devsh project list --installation-id <installation-id>

# Get installation ID from GitHub App settings
# Or use: gh api /user/installations | jq '.installations[] | {id, account: .account.login}'
```

## Related Skills

- **devsh-orchestrator**: For coordinating multiple agents on complex tasks
- **devsh**: Core CLI for sandbox management and task creation
