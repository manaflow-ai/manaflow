This project is called cmux. cmux is a web app that spawns Claude Code, Codex CLI, Gemini CLI, Amp, Opencode, and other coding agent CLIs in parallel across multiple tasks. For each run, cmux spawns an isolated openvscode instance via Docker or a configurable sandbox provider. The openvscode instance by default opens the git diff UI and a terminal with the running dev server (configurable via devcontainer.json).

# Repository Targets

- Primary upstream for this workspace is `manaflow-ai/manaflow`, with fork target `karlorz/cmux`.
- Terminal project is separate: upstream `manaflow-ai/cmux`, fork `karl-digi/cmux`, and should be handled in a separate workspace (for example `/Users/karlchow/Desktop/code/cmux-terminal`).

# Git Policy (IMPORTANT)

**All agents (Claude, Codex, Gemini, etc.) MUST follow these rules:**

1. **NO direct commits to main/master** - Always create a feature branch first
2. **NO direct push to main/master** - Push to feature branches only
3. **NO merging PRs without explicit user approval** - Create PR, wait for user to review and approve
4. **NO force push to main/master** - This destroys history

**Workflow:**
1. Create feature branch: `git checkout -b <type>/<description>`
2. Make changes and commit to feature branch
3. Push feature branch: `git push -u origin <branch>`
4. Create PR: `gh pr create --base main`
5. **STOP and wait for user approval before merging**
6. Only merge after user explicitly says "merge" or "approve"

# Code Review

When reviewing code, apply the guidelines in REVIEW.md at the project root.

# Config

Use bun to install dependencies and run the project.
`./scripts/dev.sh` will start the project. Optional flags:

- `--force-docker-build`: Rebuild worker image even if cached.

If you make code changes, run `bun check` and fix errors after completing a task.

# Backend

This project uses Convex and Hono.
Hono is defined in apps/www/lib/hono-app.ts as well as apps/www/lib/routes/\*
The Hono app generates a client in @cmux/www-openapi-client. This is automatically re-generated when the dev-server is running. If you change the Hono app (and the dev server isn't running), you should run `(cd apps/www && bun run generate-openapi-client)` to re-generate the client. Note that the generator is in www and not www-openapi-client.
We MUST force validation of requests that do not have the proper `Content-Type`. Set the value of `request.body.required` to `true`. For example:

```ts
app.openapi(
  createRoute({
    method: "post",
    path: "/books",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              title: z.string(),
            }),
          },
        },
        required: true, // <== add
      },
    },
    responses: {
      200: {
        description: "Success message",
      },
    },
  }),
  (c) => c.json(c.req.valid("json"))
);
```

## Convex

This project supports both **Convex Cloud** and **self-hosted Convex**. Mode is auto-detected by `scripts/setup-convex-env.sh`:

- **Cloud mode**: `CONVEX_DEPLOY_KEY` is set -> uses `NEXT_PUBLIC_CONVEX_URL`
- **Self-hosted mode**: `CONVEX_SELF_HOSTED_ADMIN_KEY` is set -> uses `CONVEX_SELF_HOSTED_URL`

Schemas are defined in packages/convex/convex/schema.ts.
If you're working in Convex dir, you cannot use node APIs/import from "node:\*"
Use crypto.subtle instead of node:crypto
Exception is if the file defines only actions and includes a "use node" directive at the top of the file

### Querying Convex Data

Always use `--env-file` to ensure correct backend connection:

```bash
cd packages/convex
bunx convex data <table> --format jsonl --env-file ../../.env | rg "pattern"
# Example:
bunx convex data sessions --format jsonl --env-file ../../.env | rg "mn7abc123"
```

The `--env-file` flag is required - it reads either `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` (for self-hosted) or `CONVEX_DEPLOY_KEY` (for cloud) from `.env`.

## Sandboxes

This project uses Morph sandboxes for running Claude Code/Codex/other coding CLIs inside.
To inspect Morph instances, use the morphcloud cli with the corresponding morphvm\_ id:

```bash
uvx --env-file .env morphcloud instance exec morphvm_q11mhv3p "ls"
🏁  Command execution complete!
--- Stdout ---
server.log
xagi-server
--- Exit Code: 0 ---
```

Morph snapshots capture RAM state. So after snapshot, running processes will still be running.
To modify and rebuild all snapshots, edit `./scripts/snapshot.py` and run `uv run --env-file .env ./scripts/snapshot.py`
After building a snapshot, you should always use the `say` command to notify the user to verify the changes that were made to the snapshot.
After the say command, you should give the user a table with the snapshot preset and vnc/vscode/xterm urls.
.env sometimes might not exist, but you can still run the script if `echo $MORPH_API_KEY` works.

# Frontend

This project uses React, TanStack Router, TanStack Query, Shadcn UI, and Tailwind CSS.
Always use tailwind `neutral` instead of `gray` for gray colors.
Always support both light and dark mode.

# Misc

Always use "node:" prefixes for node imports
Do not use the "any" type
Do not use casts unless absolutely necessary. Most casts may be solved with zod parsing.
Don't modify README.md unless explicitly asked
Do not write docs unless explicitly asked
Do not use dynamic imports unless absolutely necessary. Exceptions include when you're following existing patterns in the codebase
We're using Node 24, which supports global fetch
When using try/catch, never suppress errors. Always console.error any errors.

# Tests

Use vitest
Place test files next to the file they test using a .test.ts extension
Do not use mocks
Do not do early returns (eg. skipping tests if we're missing environment variables)
Make tests resilient

## Logs

When running `./scripts/dev.sh`, service logs are written to `logs/{type}.log`:

- docker-compose.log: Output from `.devcontainer` Docker Compose stack. Hidden from console by default; use `--show-compose-logs` to stream.
- convex-dev.log: Convex development server (`bunx convex dev`).
- server.log: Backend dev server in `apps/server`.
- client.log: Frontend dev server in `apps/client` (Vite).

Log files are overwritten on each run. Use `tail -f logs/<file>` to follow live output.

## devsh CLI

The devsh CLI manages sandbox lifecycle (create, exec, delete). See `packages/sandbox/` for implementation.

```bash
# Development build (local API URLs from .env)
make install-devsh-dev

# Production build (production API URLs from .env.production)
make install-devsh-prod

# Publish devsh to npm (usual order)
cd packages/devsh && make npm-version VERSION=x.y.z
make devsh-npm-republish-prod-dry DEVSH_NPM_VERSION=x.y.z
make devsh-npm-republish-prod DEVSH_NPM_VERSION=x.y.z

# Usage
devsh start -p pve-lxc          # Create sandbox
devsh exec <sandbox-id> "cmd"   # Execute command
devsh delete <sandbox-id>       # Delete sandbox
```

# Agent Memory Protocol

Agents running in cmux sandboxes have access to persistent memory at `/root/lifecycle/memory/`. This is outside the git workspace to avoid polluting repositories.

## Memory Structure

```
/root/lifecycle/memory/
├── knowledge/MEMORY.md   # Long-term insights (P0/P1/P2 priority tiers)
├── daily/{date}.md       # Daily session logs (ephemeral)
├── TASKS.json            # Task registry
├── MAILBOX.json          # Inter-agent messages
├── sync.sh               # Memory sync to Convex
└── mcp-server.js         # MCP server for programmatic access
```

## Priority Tiers (knowledge/MEMORY.md)

- **P0 Core**: Never expires - project fundamentals, invariants
- **P1 Active**: 90-day TTL - ongoing work, current strategies
- **P2 Reference**: 30-day TTL - temporary findings, debug notes

Format: `- [YYYY-MM-DD] Your insight here`

## Inter-Agent Messaging (MAILBOX.json)

Agents can coordinate via the mailbox using MCP tools or direct file access:

- `send_message(to, message, type)` - Send to agent or "*" for broadcast
- `get_my_messages()` - Get messages addressed to this agent
- `mark_read(messageId)` - Mark message as read

Message types: `handoff`, `request`, `status`

## Validation Scripts

```bash
./scripts/test-memory-protocol.sh       # S1: Memory seeding/read/write
./scripts/test-two-agent-coordination.sh # S2: Mailbox coordination
./scripts/test-memory-sync-latency.sh   # S3: Convex sync
./scripts/test-mcp-server.sh            # S4: MCP server tools
```

## Related Files

- `packages/shared/src/agent-memory-protocol.ts` - Protocol implementation
- `packages/convex/convex/agentMemory_http.ts` - Convex sync endpoint
- `packages/convex/convex/agentMemoryQueries.ts` - Memory queries
