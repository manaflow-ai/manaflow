# cmux

Cloud VMs for development - spawn isolated dev environments instantly.

## Installation

```bash
npm install -g cmux
```

## Quick Start

```bash
# Login
cmux login

# Create a VM
cmux start                     # Returns ID like cmux_abc123

# Access the VM
cmux code cmux_abc123          # Open VS Code in browser
cmux ssh cmux_abc123           # SSH into VM

# Run commands
cmux exec cmux_abc123 "npm install"

# Manage lifecycle
cmux pause cmux_abc123         # Pause (preserves state)
cmux resume cmux_abc123        # Resume
cmux delete cmux_abc123        # Delete permanently

# List all VMs
cmux ls
```

## Commands

| Command | Description |
|---------|-------------|
| `cmux login` | Login via browser |
| `cmux start [path]` | Create new VM, optionally sync directory |
| `cmux ls` | List all VMs |
| `cmux code <id>` | Open VS Code in browser |
| `cmux vnc <id>` | Open VNC desktop in browser |
| `cmux ssh <id>` | SSH into VM |
| `cmux pty <id>` | Open interactive terminal |
| `cmux exec <id> "cmd"` | Execute command |
| `cmux sync <id> <path>` | Sync files to VM |
| `cmux pause <id>` | Pause VM |
| `cmux resume <id>` | Resume VM |
| `cmux delete <id>` | Delete VM |

## Browser Automation

Control Chrome in the VNC desktop:

```bash
cmux computer open cmux_abc123 https://example.com
cmux computer snapshot cmux_abc123       # Get interactive elements
cmux computer click cmux_abc123 @e1      # Click element
cmux computer type cmux_abc123 "hello"   # Type text
cmux computer screenshot cmux_abc123     # Take screenshot
```

## Platform Support

- macOS (Apple Silicon & Intel)
- Linux (x64 & ARM64)
- Windows (x64)

## License

MIT
