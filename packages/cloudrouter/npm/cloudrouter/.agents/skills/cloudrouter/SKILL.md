---
name: cloudrouter
description: Manage cloud development sandboxes with cloudrouter. Create, sync, and access remote VMs with GPU support, Docker, and browser automation. Use when asked to create a sandbox, spin up a dev environment, run code in the cloud, use GPUs, automate a browser, or interact with remote VMs.
license: MIT
metadata:
  author: manaflow-ai
  version: "0.0.2"
---

# cloudrouter - Cloud Sandboxes for Development

cloudrouter manages cloud sandboxes for development. Use these commands to create, manage, and access remote development environments with GPU support, Docker, and browser automation.

## When this skill is invoked

When the user invokes `/cloudrouter` or `/cr` without a specific task, present the available modes:

```
cloudrouter - Cloud Development Sandboxes

  Modes:
    cloudrouter start .                    Sync current directory to a cloud sandbox
    cloudrouter start --docker .           Sandbox with Docker support
    cloudrouter start --gpu T4 .           Sandbox with T4 GPU (16GB VRAM)
    cloudrouter start --gpu A100 .         Sandbox with A100 GPU (40GB VRAM)
    cloudrouter start --gpu H100 .         Sandbox with H100 GPU (80GB VRAM)

  Manage:
    cloudrouter ls                         List all sandboxes
    cloudrouter code <id>                  Open VS Code in browser
    cloudrouter pty <id>                   Open terminal session
    cloudrouter vnc <id>                   Open VNC desktop
    cloudrouter stop <id>                  Stop sandbox

  Browser automation:
    cloudrouter computer open <id> <url>   Navigate to URL
    cloudrouter computer snapshot <id>     Get accessibility tree
    cloudrouter computer screenshot <id>   Take screenshot

  Run "cloudrouter start --help" for all options.
```

## Installation

If cloudrouter is not installed, help the user install it:

```bash
npm install -g @manaflow-ai/cloudrouter
```

This installs both `cloudrouter` and `cr` (shorthand) as CLI commands.

Then authenticate:

```bash
cloudrouter login
```

If the user hasn't logged in yet, prompt them to run `cloudrouter login` first before using any other commands.

## Quick Start

```bash
cloudrouter login                        # Authenticate (opens browser)
cloudrouter start .                      # Create sandbox from current directory
cloudrouter start --gpu T4 .             # Create sandbox with GPU
cloudrouter start --docker .             # Create sandbox with Docker
cloudrouter code <id>                    # Open VS Code
cloudrouter pty <id>                     # Open terminal session
cloudrouter ls                           # List all sandboxes
```

> **Preferred:** Always use `cloudrouter start .` or `cloudrouter start <local-path>` to sync your local directory to a cloud sandbox. This is the recommended workflow over cloning from a git repo.

## Commands

### Authentication

```bash
cloudrouter login               # Login (opens browser)
cloudrouter logout              # Logout and clear credentials
cloudrouter whoami              # Show current user and team
```

### Creating Sandboxes

```bash
# Standard sandbox (syncs local directory)
cloudrouter start .                        # Create from current directory (recommended)
cloudrouter start ./my-project             # Create from a specific local directory
cloudrouter start -o .                     # Create and open VS Code immediately
cloudrouter start -n my-sandbox .          # Create with a custom name

# With Docker support
cloudrouter start --docker .               # Sandbox with Docker enabled

# With GPU
cloudrouter start --gpu T4 .               # T4 GPU (16GB VRAM)
cloudrouter start --gpu L4 .               # L4 GPU (24GB VRAM)
cloudrouter start --gpu A10G .             # A10G GPU (24GB VRAM)
cloudrouter start --gpu A100 .             # A100 GPU (40GB VRAM) - requires approval
cloudrouter start --gpu H100 .             # H100 GPU (80GB VRAM) - requires approval
cloudrouter start --gpu H100:2 .           # Multi-GPU: 2x H100

# With custom resources
cloudrouter start --cpu 8 .                # Custom CPU cores
cloudrouter start --memory 16384 .         # Custom memory (MiB)
cloudrouter start --image ubuntu:22.04 .   # Custom container image

# From git repo
cloudrouter start --git user/repo          # Clone a git repo into sandbox
cloudrouter start --git user/repo -b main  # Clone specific branch

# Provider selection
cloudrouter start -p e2b .                 # Use E2B provider (default)
cloudrouter start -p modal .               # Use Modal provider
```

### GPU Options

| GPU | VRAM | Best For | Availability |
|-----|------|----------|-------------|
| T4 | 16GB | Inference, fine-tuning small models | Self-serve |
| L4 | 24GB | Inference, image generation | Self-serve |
| A10G | 24GB | Training medium models | Self-serve |
| L40S | 48GB | Inference, video generation | Requires approval |
| A100 | 40GB | Training large models (7B-70B) | Requires approval |
| A100-80GB | 80GB | Very large models | Requires approval |
| H100 | 80GB | Fast training, research | Requires approval |
| H200 | 141GB | Maximum memory capacity | Requires approval |
| B200 | 192GB | Latest gen, frontier models | Requires approval |

GPUs requiring approval: contact founders@manaflow.com.

Multi-GPU: append `:N` to the GPU type, e.g. `--gpu H100:2` for 2x H100.

### All `start` Flags

```
-n, --name <name>       Name for the sandbox
-o, --open              Open VS Code after creation
    --docker            Enable Docker support (E2B only)
    --gpu <type>        GPU type (T4, L4, A10G, L40S, A100, H100, H200, B200)
    --cpu <cores>       CPU cores (e.g., 4, 8)
    --memory <MiB>      Memory in MiB (e.g., 8192, 65536)
    --image <image>     Container image (e.g., ubuntu:22.04)
    --git <repo>        Git repository URL or user/repo shorthand
-b, --branch <branch>   Git branch to clone
-p, --provider <name>   Sandbox provider: e2b (default), modal
-T, --template <id>     Template ID (overrides --docker) — DO NOT use template names from `cloudrouter templates`; use --docker or --gpu flags instead
```

> **Warning:** Do NOT pass template names (e.g. `cmux-devbox-base`) to the `-T` flag. These are display names, not valid E2B template IDs. Use `--docker` for Docker support and `--gpu <type>` for GPU support instead.

### Managing Sandboxes

```bash
cloudrouter ls                  # List all sandboxes
cloudrouter status <id>         # Show sandbox details and URLs
cloudrouter stop <id>           # Stop sandbox (can restart later)
cloudrouter extend <id>         # Extend sandbox timeout (default: +1 hour)
cloudrouter extend <id> --seconds 7200  # Extend by 2 hours
cloudrouter delete <id>         # Delete sandbox permanently
cloudrouter templates           # List available templates
```

### Access Sandbox

```bash
cloudrouter code <id>           # Open VS Code in browser
cloudrouter vnc <id>            # Open VNC desktop in browser
cloudrouter pty <id>            # Interactive terminal session
```

### Work with Sandbox

```bash
cloudrouter pty <id>                  # Interactive terminal session (use this to run commands)
cloudrouter exec <id> <command>       # Execute a one-off command
```

> **Important:** Prefer `cloudrouter pty` for interactive work. Use `cloudrouter exec` only for quick one-off commands.

### File Transfer

Upload and download files or directories between local machine and sandbox.

**Command signatures:**
- `cloudrouter upload <id> [local-path]` — accepts 1-2 positional args: sandbox ID and optional local path
- `cloudrouter download <id> [local-path]` — accepts 1-2 positional args: sandbox ID and optional local path
- Use `-r <remote-path>` flag to specify a non-default remote directory (default: `/home/user/workspace`)
- **Do NOT pass remote paths as positional arguments** — this will error. Always use the `-r` flag.

```bash
# Upload (local -> sandbox)
cloudrouter upload <id>                            # Upload current dir to /home/user/workspace
cloudrouter upload <id> ./my-project               # Upload directory to workspace
cloudrouter upload <id> ./config.json              # Upload single file to workspace
cloudrouter upload <id> . -r /home/user/app        # Upload to specific remote path
cloudrouter upload <id> . --watch                  # Watch and re-upload on changes
cloudrouter upload <id> . --delete                 # Delete remote files not present locally
cloudrouter upload <id> . -e "*.log"               # Exclude patterns

# Download (sandbox -> local)
cloudrouter download <id>                          # Download workspace to current dir
cloudrouter download <id> ./output                 # Download workspace to ./output
cloudrouter download <id> ./output -r /home/user/app  # Download specific remote dir to ./output
```

> **Warning:** The `-r` flag expects a **directory** path, not a file path. To download a single file, download its parent directory and then access the file locally.
>
> **Common mistake:** `cloudrouter download <id> /remote/path /local/path` — this passes 3 positional args and will fail. Use `cloudrouter download <id> /local/path -r /remote/path` instead.

### Browser Automation (cloudrouter computer)

Control Chrome browser via CDP in the sandbox's VNC desktop.

> **Startup delay:** Chrome CDP may not be ready immediately after sandbox creation. If a `computer` command fails right after `cloudrouter start`, wait a few seconds and retry. This is rare but expected — Chrome needs a moment to boot inside the sandbox.

#### Navigation

```bash
cloudrouter computer open <id> <url>    # Navigate to URL
cloudrouter computer back <id>          # Navigate back
cloudrouter computer forward <id>       # Navigate forward
cloudrouter computer reload <id>        # Reload page
cloudrouter computer url <id>           # Get current URL
cloudrouter computer title <id>         # Get page title
```

#### Inspect Page

```bash
cloudrouter computer snapshot <id>             # Get accessibility tree with element refs (@e1, @e2...)
cloudrouter computer screenshot <id>           # Take screenshot (base64 to stdout)
cloudrouter computer screenshot <id> out.png   # Save screenshot to file
```

#### Interact with Elements

```bash
cloudrouter computer click <id> <selector>      # Click element (@e1 or CSS selector)
cloudrouter computer type <id> "text"           # Type into focused element
cloudrouter computer fill <id> <sel> "value"    # Clear input and fill with value
cloudrouter computer press <id> <key>           # Press key (Enter, Tab, Escape, etc.)
cloudrouter computer hover <id> <selector>      # Hover over element
cloudrouter computer scroll <id> [direction]    # Scroll page (up/down/left/right)
cloudrouter computer wait <id> <selector>       # Wait for element to appear
```

#### Element Selectors

Two ways to select elements:
- **Element refs** from snapshot: `@e1`, `@e2`, `@e3`...
- **CSS selectors**: `#id`, `.class`, `button[type="submit"]`

## Sandbox IDs

Sandbox IDs look like `cr_abc12345`. Use the full ID when running commands. Get IDs from `cloudrouter ls` or `cloudrouter start` output.

## Common Workflows

### Create and develop in a sandbox (preferred: local-to-cloud)

```bash
cloudrouter start ./my-project        # Creates sandbox, uploads files
cloudrouter code cr_abc123            # Open VS Code
cloudrouter pty cr_abc123             # Open terminal to run commands (e.g. npm install && npm run dev)
```

### GPU workflow: ML training

```bash
cloudrouter start --gpu A100 ./ml-project    # Sandbox with A100 GPU
cloudrouter pty cr_abc123                    # Open terminal
# Inside: pip install -r requirements.txt && python train.py
cloudrouter download cr_abc123 ./checkpoints # Download trained model
```

### Docker workflow

```bash
cloudrouter start --docker ./my-app          # Sandbox with Docker
cloudrouter pty cr_abc123                    # Open terminal
# Inside: docker compose up -d
```

### File transfer workflow

```bash
cloudrouter upload cr_abc123 ./my-project     # Push local files to sandbox
# ... do work in sandbox ...
cloudrouter download cr_abc123 ./output       # Pull files from sandbox to local
```

### Browser automation: Login to a website

```bash
cloudrouter computer open cr_abc123 "https://example.com/login"
cloudrouter computer snapshot cr_abc123
# Output: @e1 [input] Email, @e2 [input] Password, @e3 [button] Sign In

cloudrouter computer fill cr_abc123 @e1 "user@example.com"
cloudrouter computer fill cr_abc123 @e2 "password123"
cloudrouter computer click cr_abc123 @e3
cloudrouter computer screenshot cr_abc123 result.png
```

### Browser automation: Scrape data

```bash
cloudrouter computer open cr_abc123 "https://example.com/data"
cloudrouter computer snapshot cr_abc123   # Get structured accessibility tree
cloudrouter computer screenshot cr_abc123 # Visual capture
```

### Sandbox Lifecycle & Cleanup

**Concurrency limit:** Users can have a maximum of **10 concurrently running sandboxes**. If the user is approaching this limit, alert them and suggest cleaning up unused sandboxes. If they need a higher limit, they should contact **founders@manaflow.ai** (the CLI will also display this message when the limit is hit).

**Cleanup rules — be careful and deliberate:**

1. **Only touch sandboxes you created in this session.** Never stop or delete sandboxes you didn't create or don't recognize. If you see unknown sandboxes in `cloudrouter ls`, leave them alone — they may belong to the user or another workflow.

2. **Extend before cleanup.** Before stopping or deleting a sandbox you created, consider whether the user might want to inspect it. If you built something the user should see (a running app, a trained model, browser automation results, etc.), **extend the sandbox** with `cloudrouter extend <id>` so the user has time to check it out. Share the relevant URL (VS Code, VNC, etc.) so they can access it.
   - Use `--seconds <N>` to set a custom duration (default is 3600 = 1 hour). **Do NOT use `--timeout`** — that flag does not exist.
   - Example: `cloudrouter extend cr_abc123 --seconds 1800` extends by 30 minutes.

3. **Stop, don't delete, by default.** Prefer `cloudrouter stop <id>` over `cloudrouter delete <id>` unless the sandbox is clearly disposable (e.g., a quick test that produced no artifacts). Stopped sandboxes can be restarted; deleted ones are gone forever.

4. **Clean up when you're done.** When your task is complete and the user no longer needs the sandbox, stop it. Don't leave sandboxes running indefinitely — they count toward the concurrency limit.

5. **Monitor concurrency.** Before creating a new sandbox, run `cloudrouter ls` to check how many are running. If there are 8+ active sandboxes, warn the user and ask if any can be stopped before creating another. Never silently hit the limit.

6. **If the limit is reached:** Tell the user they've hit the 10-sandbox concurrency limit. Suggest stopping sandboxes they no longer need. If they need more capacity, direct them to contact **founders@manaflow.ai** to request a higher limit.

**Cleanup workflow:**

```bash
cloudrouter ls                  # Check running sandboxes and count
cloudrouter extend cr_abc123                # Extend by 1 hour (default)
cloudrouter extend cr_abc123 --seconds 3600 # Extend by custom duration
# ... share URLs, let user verify ...
cloudrouter stop cr_abc123      # Stop when done (can restart later)
cloudrouter delete cr_abc123    # Delete only if clearly disposable
```

## Surfacing URLs and Screenshots

Proactively share authenticated sandbox URLs and screenshots with the user when it helps build trust or verify progress. The user cannot see what's happening inside the sandbox — showing them evidence of your work is important.

**When to surface URLs:**
- After creating a sandbox or setting up an environment, share the VS Code URL (`cloudrouter code <id>`) so the user can inspect the workspace
- After deploying or starting a service, share the VNC URL (`cloudrouter vnc <id>`) so the user can see it running
- When Jupyter is running, share the Jupyter URL so the user can verify notebooks
- Whenever the user might want to verify, inspect, or interact with the sandbox themselves

**When to take and share screenshots:**
- After completing a visual task (e.g., UI changes, web app deployment) — take a screenshot with `cloudrouter computer screenshot <id> out.png` and show it
- When something looks wrong or unexpected — screenshot it for the user to confirm
- After browser automation steps that produce visible results (form submissions, page navigations, login flows)
- When the user asks you to check or verify something visually

**General rule:** If you think the user would benefit from seeing proof of what you did, surface the URL or screenshot. Err on the side of showing more rather than less — it builds trust and keeps the user in the loop.

## Security: Dev Server URLs

**CRITICAL: NEVER share or output raw E2B port-forwarded URLs.**

When a dev server runs in the sandbox (e.g., Vite on port 5173, Next.js on port 3000), E2B creates publicly accessible URLs like `https://5173-xxx.e2b.app`. These URLs have **NO authentication** — anyone with the link can access the running application.

**Rules:**
- **NEVER** output URLs like `https://5173-xxx.e2b.app`, `https://3000-xxx.e2b.app`, or any `https://<port>-xxx.e2b.app` URL
- **NEVER** construct or guess E2B port URLs from sandbox metadata
- **ALWAYS** tell the user to view dev servers through VNC: `cloudrouter vnc <id>`
- VNC is protected by token authentication (`?tkn=`) and is the only safe way to view dev server output
- **DO** share authenticated URLs: VS Code (`cloudrouter code <id>`), VNC (`cloudrouter vnc <id>`), and Jupyter URLs — these have proper token auth and are safe to surface

**When a dev server is started:**
```
Dev server running on port 5173
  View it in your sandbox's VNC desktop: cloudrouter vnc <id>
  (The browser inside VNC can access http://localhost:5173)
```

**NEVER do this:**
```
Frontend: https://5173-xxx.e2b.app   <- WRONG: publicly accessible, no auth
```

## Global Flags

```
-t, --team <team>   Team slug (overrides default)
-v, --verbose       Verbose output
    --json          Machine-readable JSON output
```
