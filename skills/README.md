# cmux Skills

Agent skills for the cmux CLI - a tool for starting VMs and cloud sandboxes.

## Installation

```bash
npx skills add manaflow-ai/cmux
```

Or install globally:

```bash
npx skills add manaflow-ai/cmux -g -y
```

## Available Skills

| Skill | Description |
|-------|-------------|
| cmux | CLI for starting VMs and cloud sandboxes |

## What is cmux?

cmux is a CLI for managing cloud development sandboxes. It allows you to:

- Create isolated cloud sandboxes for development
- Sync local files to remote environments
- Execute commands in sandboxes
- Automate browser interactions via Chrome CDP
- Access VS Code and VNC in the browser

## Quick Start

```bash
# Install the CLI
npm install -g cmux

# Login
cmux login

# Create a sandbox with your project
cmux start ./my-project

# Open VS Code
cmux code cmux_abc123

# Run commands
cmux exec cmux_abc123 "npm install && npm run dev"
```

## Links

- [cmux Documentation](https://cmux.sh/docs)
- [Skills CLI](https://github.com/vercel-labs/skills)
