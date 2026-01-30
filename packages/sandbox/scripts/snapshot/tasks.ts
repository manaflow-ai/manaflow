/**
 * Provisioning tasks for ACP sandbox setup.
 *
 * Defines tasks with dependencies that are executed using the DAG engine.
 * These tasks configure a VM with all necessary tools for Claude Code ACP.
 */

import { TaskRegistry, type TaskContext } from "./dag";
import type { VmHandle } from "./providers";

/**
 * Extended task context with VM handle for provisioning operations.
 */
export interface ProvisioningContext extends TaskContext {
  /** The VM to provision */
  vm: VmHandle;
  /** Execute a command quietly (only show output on failure) */
  run(label: string, command: string): Promise<string>;
  /** Task outputs for host-side validation */
  outputs: Map<string, string>;
}

/**
 * Options for creating a provisioning context.
 */
export interface ProvisioningContextOptions {
  /** Show verbose output (default: false) */
  verbose?: boolean;
}

/**
 * Create a provisioning context for a VM.
 * Output is quiet by default - only shows step names and errors.
 */
export function createProvisioningContext(
  vm: VmHandle,
  options: ProvisioningContextOptions = {}
): ProvisioningContext {
  const { verbose = false } = options;
  const timings = new Map<string, number>();
  const outputs = new Map<string, string>();

  return {
    vm,
    outputs,
    log: (message: string) => {
      // Only log DAG-level messages (task start/complete)
      if (verbose || message.startsWith("→") || message.startsWith("✓") || message.startsWith("✗")) {
        console.log(message);
      }
    },
    recordTiming: (name: string, durationMs: number) => timings.set(name, durationMs),
    async run(label: string, command: string): Promise<string> {
      const start = performance.now();
      try {
        const result = await vm.exec(command);
        const duration = performance.now() - start;

        if (verbose) {
          // Show output in verbose mode
          const lines = result.split("\n").filter((l) => l.trim());
          for (const line of lines.slice(0, 5)) {
            console.log(`  ${line}`);
          }
          if (lines.length > 5) {
            console.log(`  ... (${lines.length - 5} more lines)`);
          }
        }

        return result;
      } catch (error) {
        const duration = performance.now() - start;
        // Always show error output
        console.error(`\n[${label}] FAILED after ${(duration / 1000).toFixed(2)}s`);
        if (error instanceof Error) {
          console.error(`  Error: ${error.message}`);
        } else {
          console.error(`  Error: ${String(error)}`);
        }
        throw error;
      }
    },
  };
}

/**
 * Create the standard provisioning task registry.
 *
 * Task graph structure:
 *
 *                               apt-update
 *                                    │
 *       ┌──────────┬─────────────────┼────────────────┬──────────────┬──────────────┬──────────────┐
 *       │          │                 │                │              │              │              │
 *   setup-user  install-deps    install-node    install-rust    install-uv    install-docker       │
 *       │          │                 │                │              │              │              │
 *       │          │                 └────────────────┼──────────────┼──────────────┼──────────────┘
 *       │          │                                  │              │              │
 *       │          │                           install-bun           │              │
 *       │          │                                  │              │              │
 *       │          │                           install-acp           │              │
 *       │          │                                  │              │              │
 *       │          └──────────────────────────────────┴──────────────┴──────────────┘
 *       │                                             │
 *       │                                        setup-dirs
 *       │                                             │
 *       └─────────────────────────────────────────────┤
 *                                                     │
 *                                                  verify
 *                                                     │
 *                                                final-test
 */
export function createProvisioningRegistry(): TaskRegistry<ProvisioningContext> {
  const registry = new TaskRegistry<ProvisioningContext>();

  // =========================================================================
  // System Packages
  // =========================================================================

  registry.register({
    name: "apt-install",
    description: "Update apt and install base packages",
    func: async (ctx) => {
      await ctx.run(
        "apt-install",
        `set -e
        apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
          sudo curl git build-essential pkg-config libssl-dev ca-certificates zsh jq`
      );
    },
  });

  registry.register({
    name: "install-desktop",
    description: "Install VNC, minimal desktop, and Chrome dependencies",
    deps: ["install-node"],
    func: async (ctx) => {
      await ctx.run(
        "install-desktop",
        `set -e
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
          tigervnc-standalone-server tigervnc-common \
          xvfb x11-xserver-utils novnc dbus-x11 openbox \
          libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
          libxrandr2 libxrender1 libxtst6 libnss3 libatk1.0-0 \
          libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2 \
          libpango-1.0-0 libcairo2 fonts-liberation xauth

        arch="$(dpkg --print-architecture)"
        case "$arch" in
          amd64) chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" ;;
          arm64) chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb" ;;
          *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
        esac
        cd /tmp
        curl -fsSL -o chrome.deb "$chrome_url"
        DEBIAN_FRONTEND=noninteractive apt-get install -y ./chrome.deb || true
        DEBIAN_FRONTEND=noninteractive apt-get install -yf
        rm -f chrome.deb
        rm -rf /var/lib/apt/lists/*
        `
      );
    },
  });

  registry.register({
    name: "install-node",
    description: "Install Node.js 22",
    deps: ["apt-install"],
    func: async (ctx) => {
      await ctx.run(
        "install-node",
        `set -e
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
        node --version && npm --version`
      );
    },
  });

  registry.register({
    name: "install-docker-repo",
    description: "Add Docker apt repository",
    deps: ["apt-install"],  // Only needs curl, can run in parallel with other apt-install dependents
    func: async (ctx) => {
      await ctx.run(
        "install-docker-repo",
        `set -e
        # Add Docker's official GPG key
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc

        # Add the repository to Apt sources
        echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list`
      );
    },
  });

  registry.register({
    name: "install-docker",
    description: "Install Docker packages",
    deps: ["install-docker-repo", "install-desktop"],  // Wait for desktop install to avoid apt lock
    func: async (ctx) => {
      await ctx.run(
        "install-docker",
        `set -e
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
        docker --version`
      );
    },
  });

  registry.register({
    name: "setup-docker",
    description: "Configure Docker with BuildKit and start via systemd",
    deps: ["install-docker"],
    func: async (ctx) => {
      await ctx.run(
        "setup-docker",
        `set -e
        # Enable BuildKit by default
        mkdir -p /etc/docker
        echo '{"features":{"buildkit":true}}' > /etc/docker/daemon.json

        # Enable and start Docker via systemd
        systemctl enable docker
        systemctl start docker

        # Verify Docker is running
        docker info`
      );
    },
  });

  // =========================================================================
  // User Setup (depends on apt-install for sudo)
  // =========================================================================

  registry.register({
    name: "setup-user",
    description: "Create non-root user with passwordless sudo",
    deps: ["apt-install"],
    func: async (ctx) => {
      await ctx.run(
        "setup-user",
        `
        set -e

        # Create cmux user if it doesn't exist
        if ! id -u cmux > /dev/null 2>&1; then
          useradd -m -s /bin/bash cmux
        fi

        # Add cmux to sudo group
        usermod -aG sudo cmux

        # Enable passwordless sudo for cmux
        echo "cmux ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/cmux
        chmod 440 /etc/sudoers.d/cmux

        # Verify
        echo "Created user: cmux"
        id cmux
        `
      );
    },
  });

  // =========================================================================
  // Tool Installation (can run in parallel after system packages)
  // =========================================================================

  registry.register({
    name: "install-rust",
    description: "Install Rust toolchain",
    deps: ["apt-install"],
    func: async (ctx) => {
      await ctx.run(
        "install-rust",
        `
        set -e
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
        rustc --version
        `
      );
    },
  });

  registry.register({
    name: "install-uv",
    description: "Install uv (Python package manager)",
    deps: ["apt-install"],
    func: async (ctx) => {
      await ctx.run(
        "install-uv",
        `
        set -e
        curl -LsSf https://astral.sh/uv/install.sh | sh
        export PATH="$HOME/.local/bin:$PATH"
        uv --version
        `
      );
    },
  });

  // =========================================================================
  // Bun (depends on system packages which include node)
  // =========================================================================

  registry.register({
    name: "install-bun",
    description: "Install Bun runtime",
    deps: ["apt-install"],
    func: async (ctx) => {
      await ctx.run(
        "install-bun",
        `
        set -e
        curl -fsSL https://bun.sh/install | bash
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
        bun --version
        bunx --version
        `
      );
    },
  });

  // =========================================================================
  // CLI Tools (depends on bun)
  // =========================================================================

  registry.register({
    name: "install-acp",
    description: "Install Claude Code ACP, Codex ACP, Gemini CLI, and OpenCode",
    deps: ["install-bun"],
    func: async (ctx) => {
      await ctx.run(
        "install-acp",
        `
        set -e
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
        bun add -g @zed-industries/claude-code-acp@latest @zed-industries/codex-acp@latest @google/gemini-cli@latest opencode-ai@latest

        PATCH_FILE="/root/.bun/install/global/node_modules/@zed-industries/claude-code-acp/dist/acp-agent.js"
        if [ ! -f "$PATCH_FILE" ]; then
          echo "ERROR: claude-code-acp not found at $PATCH_FILE"
          exit 1
        fi

        node - << 'NODE'
const fs = require("node:fs");

const path = "/root/.bun/install/global/node_modules/@zed-industries/claude-code-acp/dist/acp-agent.js";
const text = fs.readFileSync(path, "utf8");

if (text.includes("sawStreamEvent")) {
  console.log("claude-code-acp patch already applied");
  process.exit(0);
}

const target = "const { query, input } = this.sessions[params.sessionId];";
if (!text.includes(target)) {
  throw new Error("Failed to find prompt setup line");
}
let next = text.replace(target, target + "\\n        let sawStreamEvent = false;");

const streamCase = 'case "stream_event": {';
if (!next.includes(streamCase)) {
  throw new Error("Failed to find stream_event case");
}
next = next.replace(streamCase, streamCase + "\\n                    sawStreamEvent = true;");

const filterExpr =
  'message.message.content.filter((item) => !["text", "thinking"].includes(item.type))';
if (!next.includes(filterExpr)) {
  throw new Error("Failed to find assistant text filter");
}
next = next.replace(
  filterExpr,
  'message.message.content.filter((item) => !["text", "thinking"].includes(item.type) || !sawStreamEvent)'
);

fs.writeFileSync(path, next);
console.log("Patched claude-code-acp to emit non-streamed assistant text");
NODE
        `
      );
    },
  });

  registry.register({
    name: "install-agent-browser",
    description: "Install agent-browser CLI",
    deps: ["install-node", "install-desktop"],
    func: async (ctx) => {
      await ctx.run(
        "install-agent-browser",
        `
        set -e
        npm install -g agent-browser
        agent-browser --version
        AGENT_BROWSER_BIN="$(command -v agent-browser)"
        if [ -n "$AGENT_BROWSER_BIN" ] && [ ! -x /usr/local/bin/agent-browser-real ]; then
          mv "$AGENT_BROWSER_BIN" /usr/local/bin/agent-browser-real
          cat > /usr/local/bin/agent-browser << 'EOF'
#!/bin/sh
set -e
REAL="/usr/local/bin/agent-browser-real"
if [ ! -x "$REAL" ]; then
  echo "agent-browser-real not found" >&2
  exit 1
fi
case "$1" in
  connect|launch|close)
    exec "$REAL" "$@"
    ;;
esac
for arg in "$@"; do
  case "$arg" in
    --cdp|--cdp=*)
      exec "$REAL" "$@"
      ;;
  esac
done
exec "$REAL" --cdp "\${AGENT_BROWSER_CDP_PORT:-9222}" "$@"
EOF
          chmod +x /usr/local/bin/agent-browser
        fi
        `
      );
    },
  });

  registry.register({
    name: "install-cmux-code",
    description: "Install cmux-code (VS Code server)",
    deps: ["apt-install"],
    func: async (ctx) => {
      await ctx.run(
        "install-cmux-code",
        `
        set -e
        mkdir -p /app/cmux-code
        if [ ! -f /tmp/cmux-code.tar.gz ]; then
          echo "cmux-code tarball missing at /tmp/cmux-code.tar.gz" >&2
          exit 1
        fi
        tar xf /tmp/cmux-code.tar.gz -C /app/cmux-code --strip-components=1
        rm -f /tmp/cmux-code.tar.gz

        mkdir -p /root/.vscode-server-oss/data/User
        cat > /root/.vscode-server-oss/data/User/settings.json << 'EOF'
{
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.verifySignature": false
}
EOF
        `
      );
    },
  });

  // =========================================================================
  // cmux-acp-server (Rust binary, depends on rust and deps)
  // =========================================================================

  registry.register({
    name: "build-cmux-acp-server",
    description: "Build and install cmux-acp-server and cmux-pty binaries",
    deps: ["install-rust"],
    func: async (ctx) => {
      await ctx.run(
        "build-cmux-acp-server",
        `
        set -e  # Exit on any error

        source "$HOME/.cargo/env"
        export PATH="$HOME/.cargo/bin:$PATH"

        # Verify source was uploaded
        if [ ! -d /tmp/cmux-build/sandbox ]; then
          echo "ERROR: Source directory /tmp/cmux-build/sandbox not found!"
          echo "Contents of /tmp:"
          ls -la /tmp/
          exit 1
        fi

        # Source is already uploaded to /tmp/cmux-build/sandbox by snapshot.ts
        cd /tmp/cmux-build/sandbox

        # Build the cmux-acp-server binary in release mode
        echo "Building cmux-acp-server..."
        cargo build --release --bin cmux-acp-server

        # Verify binary was created
        if [ ! -f target/release/cmux-acp-server ]; then
          echo "ERROR: Binary not found at target/release/cmux-acp-server"
          exit 1
        fi

        # Install to /usr/local/bin
        cp target/release/cmux-acp-server /usr/local/bin/
        chmod +x /usr/local/bin/cmux-acp-server

        # Verify installation
        /usr/local/bin/cmux-acp-server --help > /dev/null
        echo "cmux-acp-server installed successfully"

        # Install cmux-pty (prebuilt binary preferred)
        if [ -f /tmp/cmux-build/sandbox/cmux-pty ]; then
          echo "Installing prebuilt cmux-pty..."
          cp /tmp/cmux-build/sandbox/cmux-pty /usr/local/bin/cmux-pty
          chmod +x /usr/local/bin/cmux-pty
        else
          echo "Prebuilt cmux-pty not found; building from source..."
          if [ -f /tmp/cmux-build/crates/cmux-pty/Cargo.toml ]; then
            cargo build --release --manifest-path /tmp/cmux-build/crates/cmux-pty/Cargo.toml
            if [ ! -f /tmp/cmux-build/crates/cmux-pty/target/release/cmux-pty ]; then
              echo "ERROR: Binary not found at /tmp/cmux-build/crates/cmux-pty/target/release/cmux-pty"
              exit 1
            fi
            cp /tmp/cmux-build/crates/cmux-pty/target/release/cmux-pty /usr/local/bin/cmux-pty
            chmod +x /usr/local/bin/cmux-pty
          else
            echo "ERROR: cmux-pty source not found"
            exit 1
          fi
        fi

        # Verify installation
        /usr/local/bin/cmux-pty --help > /dev/null
        echo "cmux-pty installed successfully"

        # Install MCP upload tool script
        if [ -f /tmp/cmux-build/sandbox/scripts/mcp-upload.mjs ]; then
          cp /tmp/cmux-build/sandbox/scripts/mcp-upload.mjs /usr/local/bin/mcp-upload
          chmod +x /usr/local/bin/mcp-upload
          echo "mcp-upload installed successfully"
        else
          echo "ERROR: MCP upload script not found at /tmp/cmux-build/sandbox/scripts/mcp-upload.mjs"
          exit 1
        fi

        `
      );
    },
  });

  // =========================================================================
  // CLI Configuration (depends on CLI installations)
  // =========================================================================

  registry.register({
    name: "setup-cli-configs",
    description: "Create config files for CLI tools (Codex, etc.)",
    deps: ["install-acp"],
    func: async (ctx) => {
      await ctx.run(
        "setup-cli-configs",
        `
        set -e

        # Create Codex CLI config
        # This sets up a custom provider that doesn't require OpenAI auth
        # and routes requests through our proxy
        mkdir -p /root/.codex
        cat > /root/.codex/config.toml << 'EOF'
# Codex CLI configuration for cmux sandbox
# Uses a custom provider to bypass OpenAI authentication

approval_policy = "never"
sandbox_mode = "danger-full-access"
model_provider = "cmux-proxy"

[model_providers.cmux-proxy]
name = "cmux-proxy"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
# CRITICAL: This must be inside the provider section to skip auth
requires_openai_auth = false
EOF

        echo "Created /root/.codex/config.toml"
        cat /root/.codex/config.toml

        # Create Claude Code settings to bypass permission prompts
        mkdir -p /root/.claude
        cat > /root/.claude/settings.json << 'EOF'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
EOF

        echo "Created /root/.claude/settings.json"
        cat /root/.claude/settings.json

        # Create Claude Code config to skip onboarding/trust prompts
        cat > /root/.claude.json << 'EOF'
{
  "projects": {
    "/root": {
      "allowedTools": [],
      "history": [],
      "mcpContextUris": [],
      "mcpServers": {},
      "enabledMcpjsonServers": [],
      "disabledMcpjsonServers": [],
      "hasTrustDialogAccepted": true,
      "projectOnboardingSeenCount": 0,
      "hasClaudeMdExternalIncludesApproved": false,
      "hasClaudeMdExternalIncludesWarningShown": false
    },
    "/root/workspace": {
      "allowedTools": [],
      "history": [],
      "mcpContextUris": [],
      "mcpServers": {},
      "enabledMcpjsonServers": [],
      "disabledMcpjsonServers": [],
      "hasTrustDialogAccepted": true,
      "projectOnboardingSeenCount": 0,
      "hasClaudeMdExternalIncludesApproved": false,
      "hasClaudeMdExternalIncludesWarningShown": false
    }
  },
  "isQualifiedForDataSharing": false,
  "hasCompletedOnboarding": true,
  "bypassPermissionsModeAccepted": true,
  "hasAcknowledgedCostThreshold": true
}
EOF

        echo "Created /root/.claude.json"
        cat /root/.claude.json

        # Mirror configs for non-root users (e.g., E2B)
        if id -u user >/dev/null 2>&1; then
          mkdir -p /home/user/.claude /home/user/.codex
          cp /root/.codex/config.toml /home/user/.codex/config.toml
          cp /root/.claude/settings.json /home/user/.claude/settings.json
          cp /root/.claude.json /home/user/.claude.json
          chown -R user:user /home/user/.claude /home/user/.codex /home/user/.claude.json
        fi
        `
      );
    },
  });

  // =========================================================================
  // Desktop + Agent Browser Setup
  // =========================================================================

  registry.register({
    name: "install-openbox-config",
    description: "Install Openbox menu configuration",
    deps: ["install-desktop"],
    func: async (ctx) => {
      await ctx.run(
        "install-openbox-config",
        `
        set -e
        mkdir -p /root/.config/openbox
        if [ -f /tmp/cmux-build/configs/openbox/menu.xml ]; then
          cp /tmp/cmux-build/configs/openbox/menu.xml /root/.config/openbox/menu.xml
        else
          cat > /root/.config/openbox/menu.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_menu>
  <menu id="root-menu" label="Applications">
    <item label="Chrome">
      <action name="Execute">
        <command>/usr/local/bin/cmux-start-chrome</command>
      </action>
    </item>
    <separator />
    <item label="Reconfigure">
      <action name="Reconfigure" />
    </item>
  </menu>
</openbox_menu>
EOF
        fi
        `
      );
    },
  });

  registry.register({
    name: "install-chrome-launcher",
    description: "Install cmux-start-chrome helper",
    deps: ["install-desktop"],
    func: async (ctx) => {
      await ctx.run(
        "install-chrome-launcher",
        `
        set -e
        if [ -f /tmp/cmux-build/sandbox/scripts/cmux-start-chrome.sh ]; then
          install -m 0755 /tmp/cmux-build/sandbox/scripts/cmux-start-chrome.sh /usr/local/bin/cmux-start-chrome
        else
          echo "ERROR: cmux-start-chrome not found in repo" >&2
          exit 1
        fi
        `
      );
    },
  });

  registry.register({
    name: "install-agent-browser-skill",
    description: "Install agent-browser skill for supported CLIs",
    deps: ["install-agent-browser", "setup-cli-configs"],
    func: async (ctx) => {
      await ctx.run(
        "install-agent-browser-skill",
        `
        set -e
        SKILL_SOURCE="/tmp/cmux-build/sandbox/skills/agent-browser/SKILL.md"
        if [ ! -f "$SKILL_SOURCE" ]; then
          echo "ERROR: agent-browser skill not found at $SKILL_SOURCE" >&2
          exit 1
        fi
        for dir in /root/.claude/skills/agent-browser /root/.codex/skills/agent-browser /root/.agents/skills/agent-browser /root/.config/opencode/skills/agent-browser; do
          mkdir -p "$dir"
          cp "$SKILL_SOURCE" "$dir/SKILL.md"
        done
        if id -u user >/dev/null 2>&1; then
          for dir in /home/user/.claude/skills/agent-browser /home/user/.codex/skills/agent-browser /home/user/.agents/skills/agent-browser /home/user/.config/opencode/skills/agent-browser; do
            mkdir -p "$dir"
            cp "$SKILL_SOURCE" "$dir/SKILL.md"
          done
          chown -R user:user /home/user/.claude /home/user/.codex /home/user/.agents /home/user/.config/opencode
        fi
        `
      );
    },
  });

  registry.register({
    name: "cleanup-build-dir",
    description: "Remove temporary build directory",
    deps: ["install-openbox-config", "install-chrome-launcher", "install-agent-browser-skill"],
    func: async (ctx) => {
      await ctx.run(
        "cleanup-build-dir",
        `
        set -e
        if [ -d /tmp/cmux-build ]; then
          rm -rf /tmp/cmux-build
        fi
        `
      );
    },
  });

  // =========================================================================
  // Directory Setup (depends on key installations)
  // =========================================================================

  registry.register({
    name: "setup-dirs",
    description: "Create cmux directories",
    deps: ["install-acp"],
    func: async (ctx) => {
      await ctx.run(
        "setup-dirs",
        "mkdir -p /etc/cmux /var/log/cmux /workspace"
      );
    },
  });

  registry.register({
    name: "setup-acp-service",
    description: "Install and enable cmux-acp-server, cmux-pty, and opencode-serve systemd services",
    deps: ["build-cmux-acp-server", "setup-dirs"],
    func: async (ctx) => {
      await ctx.run(
        "setup-acp-service",
        `
        set -e

        # Create systemd unit file for cmux-pty
        cat > /etc/systemd/system/cmux-pty.service << 'SERVICE'
[Unit]
Description=cmux PTY server
After=network.target

[Service]
Type=simple
Environment="PATH=/root/.bun/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="PTY_SERVER_HOST=0.0.0.0"
Environment="PTY_SERVER_PORT=39383"
ExecStart=/usr/local/bin/cmux-pty
Restart=on-failure
RestartSec=2
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
SERVICE

        # Create systemd unit file for cmux-acp-server
        # The server starts without config and waits for /api/acp/configure call
        cat > /etc/systemd/system/cmux-acp-server.service << 'SERVICE'
[Unit]
Description=cmux ACP server for sandbox integration
After=network.target

[Service]
Type=simple
# Include paths for bun-installed CLIs, cargo, uv, and local bins
Environment="PATH=/root/.bun/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/local/bin/cmux-acp-server
Restart=always
RestartSec=5
KillMode=process
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
SERVICE

        # Create systemd unit file for opencode-serve (headless web UI)
        # Runs on port 39385, proxied via cmux-acp-server at /api/opencode/*
        cat > /etc/systemd/system/opencode-serve.service << 'SERVICE'
[Unit]
Description=OpenCode headless server
After=network.target

[Service]
Type=simple
Environment="PATH=/root/.bun/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin"
Environment="HOME=/root"
WorkingDirectory=/workspace
ExecStart=/root/.bun/bin/opencode serve --port 39385 --hostname 127.0.0.1
Restart=on-failure
RestartSec=2
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
SERVICE

        # Reload systemd to pick up the new service
        systemctl daemon-reload

        # Enable the services (so they start on boot / after snapshot restore)
        systemctl enable cmux-pty
        systemctl enable cmux-acp-server
        systemctl enable opencode-serve

        # Start cmux-pty now - ensure terminal backend is ready in snapshots
        if ! systemctl start cmux-pty; then
          echo "cmux-pty failed to start"
          systemctl status cmux-pty --no-pager || true
          journalctl -u cmux-pty -n 100 --no-pager || true
          exit 1
        fi

        # Start the service now - since Morph uses memory snapshots,
        # the running process will be included in the snapshot
        if ! systemctl start cmux-acp-server; then
          echo "cmux-acp-server failed to start"
          systemctl status cmux-acp-server --no-pager || true
          journalctl -u cmux-acp-server -n 100 --no-pager || true
          exit 1
        fi

        # Start opencode-serve
        if ! systemctl start opencode-serve; then
          echo "opencode-serve failed to start"
          systemctl status opencode-serve --no-pager || true
          journalctl -u opencode-serve -n 100 --no-pager || true
          exit 1
        fi

        # Wait for it to be ready
        sleep 2

        # Verify services are running
        if ! systemctl is-active --quiet cmux-pty; then
          echo "cmux-pty failed to start"
          systemctl status cmux-pty --no-pager || true
          journalctl -u cmux-pty -n 100 --no-pager || true
          exit 1
        fi

        if ! systemctl is-active --quiet cmux-acp-server; then
          echo "cmux-acp-server failed to start"
          systemctl status cmux-acp-server --no-pager || true
          journalctl -u cmux-acp-server -n 100 --no-pager || true
          exit 1
        fi

        if ! systemctl is-active --quiet opencode-serve; then
          echo "opencode-serve failed to start"
          systemctl status opencode-serve --no-pager || true
          journalctl -u opencode-serve -n 100 --no-pager || true
          exit 1
        fi

        echo "cmux-pty, cmux-acp-server, and opencode-serve systemd services installed and started"
        `
      );
    },
  });

  // =========================================================================
  // Verification
  // =========================================================================

  registry.register({
    name: "allow-acp-port",
    description: "Allow ACP port through firewall",
    deps: ["setup-acp-service"],
    func: async (ctx) => {
      await ctx.run(
        "allow-acp-port",
        `
        set -e

        echo "Ensuring ACP port is reachable..."

        if command -v ufw > /dev/null 2>&1; then
          if ufw status | grep -q "Status: active"; then
            ufw allow 39384/tcp || true
            echo "✓ ufw rule added for 39384/tcp"
          else
            echo "ufw inactive"
          fi
        else
          echo "ufw not installed"
        fi

        if command -v iptables > /dev/null 2>&1; then
          if iptables -C INPUT -p tcp --dport 39384 -j ACCEPT 2>/dev/null; then
            echo "iptables rule already present"
          else
            iptables -I INPUT -p tcp --dport 39384 -j ACCEPT
            echo "✓ iptables rule added for 39384/tcp"
          fi
        else
          echo "iptables not installed"
        fi

        if command -v ip6tables > /dev/null 2>&1; then
          if ip6tables -C INPUT -p tcp --dport 39384 -j ACCEPT 2>/dev/null; then
            echo "ip6tables rule already present"
          else
            # ip6tables may fail if IPv6 kernel support is unavailable
            if ip6tables -I INPUT -p tcp --dport 39384 -j ACCEPT 2>/dev/null; then
              echo "✓ ip6tables rule added for 39384/tcp"
            else
              echo "ip6tables failed (IPv6 may not be supported), continuing..."
            fi
          fi
        else
          echo "ip6tables not installed"
        fi

        ss -ltnp | grep ':39384' || true
        `
      );
    },
  });

  registry.register({
    name: "verify",
    description: "Verify all installations",
    deps: [
      "setup-dirs",
      "setup-user",
      "install-bun",
      "install-rust",
      "install-uv",
      "install-desktop",
      "install-agent-browser",
      "install-cmux-code",
      "install-openbox-config",
      "install-chrome-launcher",
      "install-agent-browser-skill",
      "cleanup-build-dir",
      "setup-docker",
      "setup-acp-service",
      "setup-cli-configs",
      "allow-acp-port",
    ],
    func: async (ctx) => {
      await ctx.run(
        "verify",
        `
        set -e  # Exit on any error

        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
        source "$HOME/.cargo/env" 2>/dev/null || true

        echo "Checking user setup..."
        id cmux > /dev/null
        echo "✓ cmux user exists"
        sudo -u cmux sudo -n true > /dev/null 2>&1
        echo "✓ cmux has passwordless sudo"

        echo "Checking installed tools..."
        node --version > /dev/null
        echo "✓ Node.js"
        npm --version > /dev/null
        echo "✓ npm"
        bun --version > /dev/null
        echo "✓ bun"
        bunx --version > /dev/null
        echo "✓ bunx"
        rustc --version > /dev/null
        echo "✓ Rust"
        uv --version > /dev/null
        echo "✓ uv"
        docker --version > /dev/null
        echo "✓ Docker"
        which claude-code-acp > /dev/null
        echo "✓ Claude Code ACP"
        which codex-acp > /dev/null
        echo "✓ Codex ACP"
        which gemini > /dev/null
        echo "✓ Gemini CLI"
        which opencode > /dev/null
        echo "✓ OpenCode"
        agent-browser --version > /dev/null
        echo "✓ agent-browser"
        vncserver -version > /dev/null
        echo "✓ tigervnc"
        if command -v google-chrome-stable > /dev/null 2>&1; then
          google-chrome-stable --version > /dev/null
          echo "✓ Google Chrome"
        elif command -v google-chrome > /dev/null 2>&1; then
          google-chrome --version > /dev/null
          echo "✓ Google Chrome"
        else
          echo "Chrome not found"
          exit 1
        fi
        which cmux-acp-server > /dev/null
        echo "✓ cmux-acp-server"
        if [ -x /app/cmux-code/bin/code-server-oss ]; then
          /app/cmux-code/bin/code-server-oss --version > /dev/null
          echo "✓ cmux-code"
        else
          echo "cmux-code not found"
          exit 1
        fi

        echo "Checking systemd services..."
        systemctl is-active cmux-acp-server > /dev/null
        echo "✓ cmux-acp-server service running"
        systemctl is-active opencode-serve > /dev/null
        echo "✓ opencode-serve service running"

        echo "All tools verified!"
        `
      );
    },
  });

  // =========================================================================
  // Final Tests (comprehensive testing)
  // =========================================================================

  registry.register({
    name: "final-test",
    description: "Run final integration tests",
    deps: ["verify"],
    func: async (ctx) => {
      // Test Docker hello-world
      await ctx.run(
        "test-docker",
        `
        # Ensure Docker daemon is running
        if ! docker info > /dev/null 2>&1; then
          echo "Starting Docker daemon..."
          dockerd &
          sleep 5
        fi

        # Test hello-world (with --rm to clean up)
        docker run --rm hello-world
        `
      );

      // Test Docker BuildKit
      await ctx.run(
        "test-buildkit",
        `
        # Create a simple Dockerfile to test BuildKit
        mkdir -p /tmp/buildkit-test
        cat > /tmp/buildkit-test/Dockerfile << 'EOF'
# syntax=docker/dockerfile:1
FROM alpine:latest
RUN echo "BuildKit test successful"
EOF

        # Build with BuildKit explicitly enabled
        DOCKER_BUILDKIT=1 docker build --no-cache -t buildkit-test /tmp/buildkit-test

        # Clean up
        docker rmi buildkit-test
        rm -rf /tmp/buildkit-test
        `
      );

      // Test that key services/commands work
      await ctx.run(
        "test-tools",
        `
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
        source "$HOME/.cargo/env" 2>/dev/null || true

        # Test Node.js can execute
        node -e "console.log('Node.js OK')"

        # Test npm can install packages
        npm --version > /dev/null

        # Test Bun can execute
        bun -e "console.log('Bun OK')"

        # Test Rust can compile
        echo 'fn main() { println!("Rust OK"); }' > /tmp/test.rs
        rustc /tmp/test.rs -o /tmp/test && /tmp/test
        rm -f /tmp/test.rs /tmp/test

        # Test uv can create venv
        uv venv /tmp/test-venv --quiet
        rm -rf /tmp/test-venv

        echo "All tool tests passed!"
        `
      );

      // Test cmux-acp-server + cmux-pty + opencode-serve healthchecks (using systemd services)
      await ctx.run(
        "test-cmux-acp-server",
        `
        # The server is already running via systemd, just test the health endpoint
        HEALTH_RESPONSE=$(curl -s http://localhost:39384/health)
        echo "Health response: $HEALTH_RESPONSE"

        # Verify response contains "ok"
        if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
          echo "✓ cmux-acp-server healthcheck passed"
        else
          echo "✗ cmux-acp-server healthcheck failed"
          exit 1
        fi

        PTY_RESPONSE=$(curl -s http://localhost:39383/health)
        echo "PTY response: $PTY_RESPONSE"

        if echo "$PTY_RESPONSE" | grep -q '"status":"ok"'; then
          echo "✓ cmux-pty healthcheck passed"
        else
          echo "✗ cmux-pty healthcheck failed"
          exit 1
        fi

        # Test opencode-serve health (via proxy)
        OPENCODE_RESPONSE=$(curl -s http://localhost:39384/api/opencode/global/health)
        echo "OpenCode response: $OPENCODE_RESPONSE"

        # OpenCode returns {"healthy":true} for health
        if echo "$OPENCODE_RESPONSE" | grep -q '"healthy":true'; then
          echo "✓ opencode-serve healthcheck passed (via proxy)"
        else
          echo "✗ opencode-serve healthcheck failed"
          # Also try direct access
          DIRECT_RESPONSE=$(curl -s http://localhost:39385/global/health)
          echo "Direct opencode response: $DIRECT_RESPONSE"
          exit 1
        fi

        echo "All integration tests passed!"
        `
      );

      // Test that systemd service PATH includes /root/.bun/bin
      // This is critical for CLI spawning to work
      await ctx.run(
        "test-systemd-path",
        `
        set -e

        # Get the PATH from the running cmux-acp-server process
        PID=$(pgrep -f cmux-acp-server | head -1)
        if [ -z "$PID" ]; then
          echo "✗ cmux-acp-server not running"
          exit 1
        fi

        PATH_ENV=$(cat /proc/$PID/environ | tr '\\0' '\\n' | grep '^PATH=')
        echo "Service PATH: $PATH_ENV"

        # Verify /root/.bun/bin is in PATH
        if echo "$PATH_ENV" | grep -q '/root/.bun/bin'; then
          echo "✓ PATH includes /root/.bun/bin"
        else
          echo "✗ PATH missing /root/.bun/bin - CLI spawning will fail!"
          exit 1
        fi

        # Verify CLIs are accessible from service PATH
        export $PATH_ENV
        which claude-code-acp && echo "✓ claude-code-acp found in PATH"
        which codex-acp && echo "✓ codex-acp found in PATH"

        echo "Systemd PATH test passed!"
        `
      );
    },
  });

  registry.register({
    name: "start-desktop",
    description: "Start VNC desktop and warm Chrome CDP",
    deps: [
      "final-test",
      "install-openbox-config",
      "install-chrome-launcher",
      "install-cmux-code",
    ],
    func: async (ctx) => {
      await ctx.run(
        "start-desktop",
        `
        set -e
        mkdir -p /root/.vnc /var/log/cmux
        rm -f /root/.vnc/passwd
        cat > /root/.vnc/config << 'VNC_CONF'
SecurityTypes=None
VNC_CONF
        cat > /root/.vnc/xstartup << 'EOF'
#!/bin/sh
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
xrdb "$HOME/.Xresources" 2>/dev/null || true
openbox-session >/var/log/cmux/openbox.log 2>&1 &
exec sleep infinity
EOF
        chmod +x /root/.vnc/xstartup

        vncserver -kill :1 >/dev/null 2>&1 || true
        vncserver :1 -geometry 1920x1080 -depth 24 -SecurityTypes None

        export DISPLAY=:1
        export CDP_TARGET_PORT=9222
        nohup /usr/local/bin/cmux-start-chrome > /var/log/cmux/chrome.log 2>&1 &

        if [ -x /app/cmux-code/bin/code-server-oss ]; then
          nohup /app/cmux-code/bin/code-server-oss \
            --host 0.0.0.0 --port 39378 \
            --without-connection-token \
            --disable-workspace-trust \
            --disable-telemetry \
            --telemetry-level off \
            /workspace > /var/log/cmux/cmux-code.log 2>&1 &
        else
          echo "WARNING: cmux-code not installed" >&2
        fi

        for i in $(seq 1 20); do
          if curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
            echo "✓ Chrome DevTools ready on 9222"
            exit 0
          fi
          sleep 1
        done
        echo "ERROR: Chrome DevTools did not start on 9222" >&2
        exit 1
        `
      );
    },
  });

  // =========================================================================
  // Expose HTTP and Verify Public Access
  // =========================================================================

  registry.register({
    name: "expose-http",
    description: "Expose ACP server HTTP port and verify public access",
    deps: ["start-desktop"],
    func: async (ctx) => {
      // Expose the ACP server port to the public internet
      if (!ctx.vm.exposeHttp) {
        ctx.log("⚠ Provider does not support exposeHttp, skipping public access test");
        return;
      }

      ctx.log("Exposing port 39384 as 'acp'...");
      const { url } = await ctx.vm.exposeHttp("acp", 39384);
      ctx.log(`✓ Exposed at: ${url}`);
      ctx.outputs.set("acpPublicUrl", url);
    },
  });

  return registry;
}
