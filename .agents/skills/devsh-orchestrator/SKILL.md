---
name: devsh-orchestrator
description: Multi-agent orchestration skill for spawning and coordinating sub-agents in sandboxes. Enables head agents (like Claude Code CLI) to manage parallel task execution, inter-agent messaging, and workflow coordination.
---

# devsh-orchestrator - Multi-Agent Orchestration Skill

> **Purpose**: Enable head agents (like Claude Code CLI running locally or in cloud workspaces) to orchestrate multiple sub-agents running in cloud sandboxes. Supports parallel task execution, dependency management, real-time status updates, and inter-agent coordination.

## Use Cases

1. **Parallel Development**: Spawn multiple agents to work on different parts of a codebase simultaneously
2. **Task Distribution**: Break down complex tasks and assign to specialized agents
3. **Review Coordination**: Have one agent write code while another reviews
4. **Test Automation**: Run tests in parallel across different environments
5. **Head Agent Mode**: Run as a cloud workspace that coordinates sub-agents

## Quick Start

```bash
# Spawn a sub-agent to work on a specific task
devsh orchestrate spawn --agent claude/haiku-4.5 --repo owner/repo "Fix the auth bug in login.ts"

# Spawn as a cloud workspace (head agent) for coordinating sub-agents
devsh orchestrate spawn --cloud-workspace --agent claude/opus-4.6 "Coordinate feature implementation"

# Check status of spawned agents (with real-time updates)
devsh orchestrate status <orch-task-id> --watch

# Get aggregated results from all sub-agents
devsh orchestrate results <orchestration-id>

# Wait for an orchestration task to complete
devsh orchestrate wait <orch-task-id>

# Send a message to a running agent (uses task-run-id)
devsh orchestrate message <task-run-id> "Please also update the tests" --type request

# Cancel an orchestration task
devsh orchestrate cancel <orch-task-id>
```

## Commands

### Spawn Agent

Spawn a new sub-agent in a sandbox to work on a task.

```bash
devsh orchestrate spawn [flags] "prompt"

# Flags:
#   --agent <name>        Agent to use (default: claude/haiku-4.5)
#   --repo <owner/repo>   GitHub repository to clone
#   --branch <name>       Branch to checkout (default: main)
#   --pr-title <title>    Pull request title
#   --priority <n>        Task priority (0 = highest, default: 5)
#   --depends-on <id>     Task ID this depends on (can repeat)
#   --use-env-jwt         Use CMUX_TASK_RUN_JWT for auth (for sub-agent spawning)
#   --cloud-workspace     Spawn as orchestration head (cloud workspace)
#   --json                Output result as JSON
```

**Examples:**

```bash
# Simple spawn
devsh orchestrate spawn --agent claude/haiku-4.5 --repo owner/repo "Add input validation to the API"

# Spawn as orchestration head (cloud workspace)
devsh orchestrate spawn --cloud-workspace --agent claude/opus-4.6 "Coordinate feature implementation across multiple agents"

# Spawn with dependencies
devsh orchestrate spawn \
  --agent codex/gpt-5.1-codex-mini \
  --depends-on ns7abc123 \
  "Write tests for the changes made in the previous task"

# Spawn from within a head agent (uses JWT auth)
devsh orchestrate spawn --use-env-jwt --agent claude/haiku-4.5 "Sub-task from coordinator"
```

### Get Orchestration Task Status

Get detailed status of a specific orchestration task.

```bash
devsh orchestrate status <orch-task-id> [flags]

# Flags:
#   --watch, -w           Continuously monitor status (exits on terminal state)
#   --interval <seconds>  Polling interval for watch mode (default: 3)
#   --json                Output as JSON
```

**Watch Mode:**

Watch mode provides real-time status updates and automatically exits when the task reaches a terminal state (completed, failed, or cancelled).

```bash
# Monitor task with live updates
devsh orchestrate status k97xcv2... --watch

# Custom polling interval
devsh orchestrate status k97xcv2... --watch --interval 5
```

### Get Orchestration Results

Get aggregated results from all sub-agents in an orchestration.

```bash
devsh orchestrate results <orchestration-id> [flags]

# Flags:
#   --use-env-jwt  Use CMUX_TASK_RUN_JWT for auth (for head agents)
#   --json         Output as JSON
```

**Examples:**

```bash
# Get results for an orchestration
devsh orchestrate results orch_abc123

# Get results as JSON (for parsing)
devsh orchestrate results orch_abc123 --json

# Get results from within a head agent
devsh orchestrate results orch_abc123 --use-env-jwt
```

### List Agents

List all spawned sub-agents and their status.

```bash
devsh orchestrate list [flags]

# Flags:
#   --status <state>   Filter by status (pending, running, completed, failed)
#   --json             Output as JSON
```

### Wait for Orchestration Task

Wait for an orchestration task to complete (or timeout).

```bash
devsh orchestrate wait <orch-task-id> [flags]

# Flags:
#   --timeout <duration>  Timeout duration (default: 5m)
#   --json                Output as JSON
```

### Send Message

Send a message to a running agent via the mailbox.

```bash
devsh orchestrate message <task-run-id> "message" [flags]

# Flags:
#   --type <type>      Message type: handoff, request, status (required)
```

### Cancel Orchestration Task

Cancel an orchestration task.

```bash
devsh orchestrate cancel <orch-task-id>
```

## Head Agent Mode

Cloud workspaces spawned with `--cloud-workspace` act as **orchestration head agents** that coordinate multiple sub-agents. Head agents receive:

1. **Special Environment Variables:**
   - `CMUX_IS_ORCHESTRATION_HEAD=1` - Identifies this as a head agent
   - `CMUX_ORCHESTRATION_ID` - Unique orchestration session ID

2. **Head Agent Instructions:** A file at `/root/lifecycle/memory/orchestration/HEAD_AGENT_INSTRUCTIONS.md` with coordination guidance

3. **Bi-directional Sync:** Access to `pull_orchestration_updates` MCP tool for syncing local state with server

### Head Agent Responsibilities

1. **Plan the Work**: Break down the overall task into discrete sub-tasks
2. **Spawn Sub-Agents**: Use `devsh orchestrate spawn` to create sub-agents
3. **Monitor Progress**: Use `devsh orchestrate status --watch` to track completion
4. **Collect Results**: Use `devsh orchestrate results` to aggregate outputs
5. **Coordinate**: Handle dependencies and sequencing between tasks

### Bi-directional Sync

Head agents can sync their local PLAN.json with the server state using MCP:

```javascript
// Pull latest state from server
pull_orchestration_updates()  // Returns aggregated state from all sub-agents
```

This updates local PLAN.json with:
- Current status of all sub-agent tasks
- Unread messages from the mailbox
- Aggregated completion counts

## Real-Time Updates (SSE)

The orchestration system supports Server-Sent Events for real-time updates:

### SSE Endpoint

```
GET /api/orchestrate/events/<orchestration-id>
```

Events sent:
- `connected` - Connection established
- `task_status` - Task status changed
- `task_completed` - Task completed (with result)
- `heartbeat` - Keep-alive every 30 seconds

### Using SSE in Watch Mode

The `--watch` flag automatically uses SSE when available for minimal latency:

```bash
devsh orchestrate status <id> --watch
```

## Orchestration Patterns

### 1. Sequential Pipeline

Run agents in sequence where each depends on the previous.

```bash
# Step 1: Implement feature
RUN1=$(devsh orchestrate spawn --json --agent claude/sonnet-4.5 "Implement user authentication" | jq -r '.orchestrationTaskId')

# Step 2: Write tests (depends on step 1)
RUN2=$(devsh orchestrate spawn --json --depends-on $RUN1 --agent codex/gpt-5.1-codex-mini "Write tests for auth" | jq -r '.orchestrationTaskId')

# Step 3: Review (depends on step 2)
devsh orchestrate spawn --depends-on $RUN2 --agent claude/opus-4.5 "Review the implementation and tests"

# Wait for final task
devsh orchestrate status $RUN3 --watch
```

### 2. Parallel Fan-Out

Spawn multiple agents to work on independent tasks simultaneously.

```bash
# Spawn multiple agents in parallel
devsh orchestrate spawn --agent claude/haiku-4.5 "Fix bug in auth.ts" &
devsh orchestrate spawn --agent claude/haiku-4.5 "Fix bug in api.ts" &
devsh orchestrate spawn --agent claude/haiku-4.5 "Fix bug in db.ts" &
wait

# Wait for all to complete using watch mode
for id in $(devsh orchestrate list --status running --json | jq -r '.[].orchestrationTaskId'); do
  devsh orchestrate status $id --watch &
done
wait
```

### 3. Leader-Worker Pattern

One cloud workspace coordinates, workers execute.

```bash
# Spawn a head agent (cloud workspace) to coordinate
devsh orchestrate spawn --cloud-workspace --agent claude/opus-4.6 \
  "Analyze the codebase and coordinate implementing user roles across multiple agents"
```

Inside the cloud workspace, the head agent can:

```bash
# Spawn workers for specific tasks
devsh orchestrate spawn --use-env-jwt --agent claude/haiku-4.5 "Implement role model"
devsh orchestrate spawn --use-env-jwt --agent claude/haiku-4.5 "Add role-based middleware"
devsh orchestrate spawn --use-env-jwt --agent codex/gpt-5.1-codex-mini "Write role tests"

# Monitor all tasks
devsh orchestrate status $TASK_ID --watch

# Collect results
devsh orchestrate results $CMUX_ORCHESTRATION_ID --use-env-jwt
```

### 4. Review Loop

Implementation and review workflow.

```bash
# Implement
RUN1=$(devsh orchestrate spawn --json --agent claude/sonnet-4.5 "Implement feature X" | jq -r '.orchestrationTaskId')

# Wait for implementation
devsh orchestrate status $RUN1 --watch

# Review
devsh orchestrate spawn --agent claude/opus-4.5 \
  "Review the changes from task $RUN1. Check for bugs, security issues, and code quality."
```

## Memory Structure

Orchestration data is stored at `/root/lifecycle/memory/orchestration/`:

```
orchestration/
├── PLAN.json                   # Current orchestration plan
├── AGENTS.json                 # Spawned sub-agents registry
├── EVENTS.jsonl                # Event log for debugging
└── HEAD_AGENT_INSTRUCTIONS.md  # Coordination guidance (head agents only)
```

### PLAN.json

Stores the orchestration plan for the current workflow.

```json
{
  "version": 1,
  "orchestrationId": "orch_abc123",
  "createdAt": "2025-02-23T12:00:00Z",
  "status": "running",
  "headAgent": "claude/opus-4.6",
  "isOrchestrationHead": true,
  "description": "Implement user authentication feature",
  "tasks": [
    {
      "id": "task_001",
      "prompt": "Implement auth endpoints",
      "agentName": "claude/sonnet-4.5",
      "status": "completed",
      "orchestrationTaskId": "ns7abc123",
      "result": "Successfully implemented auth endpoints"
    },
    {
      "id": "task_002",
      "prompt": "Write auth tests",
      "agentName": "codex/gpt-5.1-codex-mini",
      "status": "running",
      "dependsOn": ["task_001"],
      "orchestrationTaskId": "ns7def456"
    }
  ]
}
```

### AGENTS.json

Tracks all spawned agents for this orchestration session.

```json
{
  "version": 1,
  "orchestrationId": "orch_abc123",
  "agents": [
    {
      "orchestrationTaskId": "ns7abc123",
      "taskRunId": "tr_xyz789",
      "agentName": "claude/sonnet-4.5",
      "status": "completed",
      "spawnedAt": "2025-02-23T12:00:00Z",
      "completedAt": "2025-02-23T12:15:00Z",
      "prompt": "Implement auth endpoints",
      "sandboxId": "morphvm_abc123"
    }
  ]
}
```

### EVENTS.jsonl

Append-only log of orchestration events.

```jsonl
{"timestamp":"2025-02-23T12:00:00Z","event":"agent_spawned","agentName":"claude/sonnet-4.5","orchestrationTaskId":"ns7abc123"}
{"timestamp":"2025-02-23T12:15:00Z","event":"agent_completed","orchestrationTaskId":"ns7abc123","status":"completed"}
{"timestamp":"2025-02-23T12:15:01Z","event":"message_sent","from":"head","to":"ns7def456","type":"handoff"}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CMUX_IS_ORCHESTRATION_HEAD` | Set to `1` when running as orchestration head |
| `CMUX_ORCHESTRATION_ID` | Unique ID for this orchestration session |
| `CMUX_TASK_RUN_JWT` | JWT for authenticating sub-agent spawns |
| `CMUX_HEAD_AGENT` | Name of the head agent coordinating |
| `CMUX_PARENT_TASK_RUN_ID` | Parent task run ID (for nested orchestration) |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orchestrate/spawn` | POST | Spawn agent with orchestration tracking |
| `/api/orchestrate/status/{id}` | GET | Get task status with taskRun details |
| `/api/orchestrate/results/{id}` | GET | Get aggregated results from sub-agents |
| `/api/orchestrate/events/{id}` | GET | SSE stream for real-time updates |
| `/api/orchestrate/list` | GET | List orchestration tasks |
| `/api/orchestrate/cancel/{id}` | POST | Cancel an orchestration task |
| `/api/orchestration/pull` | GET | Pull orchestration state (for head agents) |

## Best Practices

1. **Use specialized agents**: Assign tasks to agents that are good at them (e.g., haiku for quick fixes, opus for complex reasoning)

2. **Use cloud workspaces for coordination**: When coordinating multiple agents, spawn as a cloud workspace with `--cloud-workspace`

3. **Monitor with watch mode**: Use `--watch` flag for real-time status updates instead of polling manually

4. **Collect results**: Use `devsh orchestrate results` to aggregate outputs from all sub-agents

5. **Set reasonable timeouts**: Don't wait forever - use `--timeout` to prevent stuck workflows

6. **Handle failures gracefully**: Check agent status and have fallback plans

7. **Use dependencies wisely**: Only add dependencies when truly needed to maximize parallelism

8. **Keep prompts focused**: Each sub-agent should have a clear, specific task

9. **Monitor with events log**: Check `EVENTS.jsonl` when debugging coordination issues

10. **Use bi-directional sync**: In head agents, use `pull_orchestration_updates` MCP tool to keep local state in sync

## Integration with MCP

When running as a head agent with MCP, you can use these tools programmatically:

```typescript
// Example MCP tool calls
await spawn_agent({
  agentName: "claude/haiku-4.5",
  repo: "owner/repo",
  prompt: "Fix the bug"
});

const status = await get_agent_status({ orchestrationTaskId: "ns7abc123" });

await send_message({
  to: "ns7abc123",
  message: "Please also check the edge cases",
  type: "request"
});

// Head agent: pull updates from server
const updates = await pull_orchestration_updates({
  orchestrationId: "orch_abc123"
});
```

## Creating Symlinks

To use this skill with other agents:

```bash
mkdir -p .claude/skills
ln -s ../../.agents/skills/devsh-orchestrator .claude/skills/devsh-orchestrator
```
