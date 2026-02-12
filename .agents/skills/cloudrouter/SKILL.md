---
name: cloudrouter
description: Manage cloud development sandboxes with cloudrouter. Create, sync, and access remote VMs. Includes browser automation via Chrome CDP for scraping, testing, and web interaction. Use when asked to create a sandbox, spin up a dev environment, run code in the cloud, automate a browser, or interact with remote VMs.
license: MIT
metadata:
  author: manaflow-ai
  version: "0.0.1"
---

# cloudrouter - Cloud Sandboxes for Development

cloudrouter manages cloud sandboxes for development. Use these commands to create, manage, and access remote development environments with built-in browser automation.

## Installation

If cloudrouter is not installed, help the user install it:

```bash
npm install -g cloudrouter
```

Then authenticate:

```bash
cloudrouter login
```

If the user hasn't logged in yet, prompt them to run `cloudrouter login` first before using any other commands.

## Quick Start

```bash
cloudrouter login                      # Authenticate (opens browser)
cloudrouter start ./my-project         # Create sandbox, upload directory → returns ID
cloudrouter start .                    # Or use current directory
cloudrouter code <id>                  # Open VS Code
cloudrouter pty <id>                   # Open terminal session
cloudrouter upload <id> ./my-project   # Upload files/directories to sandbox
cloudrouter download <id> ./output     # Download files from sandbox
cloudrouter computer screenshot <id>   # Take browser screenshot
cloudrouter stop <id>                  # Stop sandbox
cloudrouter delete <id>                # Delete sandbox
cloudrouter ls                         # List all sandboxes
```

> **Preferred:** Always use `cloudrouter start .` or `cloudrouter start <local-path>` to sync your local directory to a cloud sandbox. This is the recommended workflow over cloning from a git repo.

## Commands

### Authentication

```bash
cloudrouter login               # Login (opens browser)
cloudrouter logout              # Logout and clear credentials
cloudrouter whoami              # Show current user and team
```

### Sandbox Lifecycle

```bash
# Preferred: local-to-cloud (syncs your local directory to the sandbox)
cloudrouter start .             # Create sandbox from current directory (recommended)
cloudrouter start ./my-project  # Create sandbox from a specific local directory
cloudrouter start -o .          # Create from local dir and open VS Code immediately

# Alternative: clone from git
cloudrouter start --git user/repo  # Clone a git repo into sandbox

cloudrouter start --docker      # Create sandbox with Docker support
cloudrouter ls                  # List all sandboxes
cloudrouter status <id>         # Show sandbox details and URLs
cloudrouter stop <id>           # Stop sandbox
cloudrouter extend <id>         # Extend sandbox timeout
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

```bash
# Upload (local → sandbox)
cloudrouter upload <id>                            # Upload current dir to /home/user/workspace
cloudrouter upload <id> ./my-project               # Upload directory to workspace
cloudrouter upload <id> ./config.json              # Upload single file to workspace
cloudrouter upload <id> . -r /home/user/app        # Upload to specific remote path
cloudrouter upload <id> . --watch                  # Watch and re-upload on changes
cloudrouter upload <id> . --delete                 # Delete remote files not present locally
cloudrouter upload <id> . -e "*.log"              # Exclude patterns

# Download (sandbox → local)
cloudrouter download <id>                          # Download workspace to current dir
cloudrouter download <id> ./output                 # Download workspace to ./output
cloudrouter download <id> . -r /home/user/app      # Download from specific remote path
```

### Browser Automation (cloudrouter computer)

Control Chrome browser via CDP in the sandbox's VNC desktop.

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
cloudrouter code cr_abc123          # Open VS Code
cloudrouter pty cr_abc123           # Open terminal to run commands (e.g. npm install && npm run dev)
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

### Clean up

```bash
cloudrouter stop cr_abc123      # Stop (can restart later)
cloudrouter delete cr_abc123    # Delete permanently
```

## Security: Dev Server URLs

**CRITICAL: NEVER share or output raw E2B port-forwarded URLs.**

When a dev server runs in the sandbox (e.g., Vite on port 5173, Next.js on port 3000), E2B creates publicly accessible URLs like `https://5173-xxx.e2b.app`. These URLs have **NO authentication** — anyone with the link can access the running application.

**Rules:**
- **NEVER** output URLs like `https://5173-xxx.e2b.app`, `https://3000-xxx.e2b.app`, or any `https://<port>-xxx.e2b.app` URL
- **NEVER** construct or guess E2B port URLs from sandbox metadata
- **ALWAYS** tell the user to view dev servers through VNC: `cloudrouter vnc <id>`
- VNC is protected by token authentication (`?tkn=`) and is the only safe way to view dev server output
- Only VSCode URLs (`cloudrouter code <id>`) and VNC URLs (`cloudrouter vnc <id>`) should be shared — these have proper token auth

**When a dev server is started:**
```
Dev server running on port 5173
  View it in your sandbox's VNC desktop: cloudrouter vnc <id>
  (The browser inside VNC can access http://localhost:5173)
```

**NEVER do this:**
```
Frontend: https://5173-xxx.e2b.app   ← WRONG: publicly accessible, no auth
```

## Tips

- Run `cloudrouter login` first if not authenticated
- Use `--json` flag for machine-readable output
- Use `-t <team>` to override default team
- Use `-v` for verbose output
- Always run `snapshot` first to see available elements before browser automation
- Use element refs (`@e1`) for reliability over CSS selectors
