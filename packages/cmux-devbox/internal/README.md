# cmux devbox CLI (Internal)

This document is for maintainers working on `packages/cmux-devbox`.

## How it works (high level)

- Entry point: `cmd/cmux-devbox/main.go` wires version/build info, sets `CMUX_DEVBOX_DEV=1` for dev builds, and invokes the Cobra CLI.
- Commands: `internal/cli/*` defines Cobra commands. Most commands are directory-scoped (use the current working directory unless a path or `--instance` is provided).
- Auth: `internal/auth` handles Stack Auth login, caches tokens, and fetches team info. Tokens and cached profile live under `~/.config/cmux`.
- State: `internal/state` maps absolute local paths to Morph instance IDs in `~/.config/cmux/cmux_devbox_state_{dev,prod}.json`.
- VM API: `internal/vm` talks to Convex HTTP endpoints to create/resume/stop instances, exec commands, fetch SSH, and sync files (rsync over SSH).

## Install (make `cmux` available on PATH)

Pick one of the options below so you can run `cmux --help` directly.

Option A: Makefile install (copies to `/usr/local/bin`)

```bash
cd packages/cmux-devbox
make build
sudo make install
```

Option B: Go install to a user bin dir

```bash
cd packages/cmux-devbox
GOBIN="$HOME/.local/bin" go install ./cmd/cmux-devbox
export PATH="$HOME/.local/bin:$PATH"
```

Verify:

```bash
cmux --help
cmux version
```

## Run (local dev)

```bash
cmux auth login
cmux start
cmux code <id>
cmux sync <id> .
cmux delete <id>
```

Notes:
- Use `cmux start <path>` to bind a specific directory.
- Use `--instance=<id>` to target a VM directly, bypassing directory lookup.
- Set `CMUX_DEVBOX_DEV=1` to force dev auth/config. Set `CMUX_DEVBOX_PROD=1` to avoid auto-dev mode.

## Test

```bash
cd packages/cmux-devbox
go test ./...
```

Quick smoke checks:

```bash
cmux --help
cmux auth login
```
