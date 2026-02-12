# cloudrouter

Cloud sandboxes for development. Spin up a sandbox from your local directory, run commands, transfer files, and automate browsers — all from the command line or as an agent skill.

## Install

Install cloudrouter as a skill for Claude Code, Codex, or other coding agents:

```bash
npx skills add manaflow-ai/cloudrouter
```

Or install as a standalone CLI:

```bash
npm install -g @manaflow-ai/cloudrouter
```

Then authenticate:

```bash
cloudrouter login
```

### Build from source

```bash
cd packages/cloudrouter
make build-dev
make install-dev
```

## Quick start

```bash
# Create a sandbox from the current directory
cloudrouter start .

# Open VS Code in the browser
cloudrouter code cr_abc123

# Or get a terminal
cloudrouter pty cr_abc123

# Run a command
cloudrouter exec cr_abc123 "npm install && npm run dev"

# Open VNC desktop
cloudrouter vnc cr_abc123
```

## Browser automation

Every sandbox includes Chrome CDP integration. Navigate, interact with elements using accessibility tree refs, take screenshots, and scrape data.

```bash
# Open a URL in the sandbox browser
cloudrouter computer open cr_abc123 "https://example.com"

# Get the accessibility tree with element refs
cloudrouter computer snapshot cr_abc123
# → @e1 [input] Email  @e2 [input] Password  @e3 [button] Sign In

# Interact with elements
cloudrouter computer fill cr_abc123 @e1 "user@example.com"
cloudrouter computer fill cr_abc123 @e2 "password123"
cloudrouter computer click cr_abc123 @e3

# Take a screenshot
cloudrouter computer screenshot cr_abc123 result.png
```

Additional browser commands:

```bash
cloudrouter computer type <id> <text>           # Type text
cloudrouter computer press <id> <key>           # Press key (Enter, Tab, etc.)
cloudrouter computer scroll <id> <direction>    # Scroll (up/down)
cloudrouter computer back <id>                  # Navigate back
cloudrouter computer forward <id>               # Navigate forward
cloudrouter computer reload <id>                # Reload page
cloudrouter computer url <id>                   # Get current URL
cloudrouter computer title <id>                 # Get page title
cloudrouter computer wait <id> <selector>       # Wait for element
cloudrouter computer hover <id> <selector>      # Hover over element
```

## File transfer

```bash
# Upload files to sandbox
cloudrouter upload cr_abc123 ./src /home/user/project/src

# Download from sandbox
cloudrouter download cr_abc123 /home/user/project/dist ./dist

# Watch mode — auto re-upload on changes
cloudrouter upload cr_abc123 ./src /home/user/project/src --watch
```

## Sandbox management

```bash
# Create sandboxes
cloudrouter start                      # Empty sandbox
cloudrouter start .                    # From current directory
cloudrouter start --gpu T4             # With GPU
cloudrouter start --docker             # With Docker support

# List running sandboxes
cloudrouter ls

# Check status
cloudrouter status cr_abc123

# Extend timeout
cloudrouter extend cr_abc123

# Stop a sandbox
cloudrouter stop cr_abc123

# Delete a sandbox
cloudrouter delete cr_abc123
```

## Flags

| Flag | Description |
|------|-------------|
| `-t, --team` | Team slug (auto-detected from login) |
| `-o, --open` | Open VSCode after creation (with `start`) |
| `--json` | Output as JSON |
| `-v, --verbose` | Verbose output |

## License

MIT
