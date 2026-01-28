import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

/**
 * Build commands abstraction for DRY snapshot creation.
 *
 * Provides a provider-agnostic way to express provisioning steps that can be
 * converted to either:
 * - Runtime execution (Morph/Freestyle: exec commands on running VM)
 * - Dockerfile instructions (Daytona/E2B/Blaxel: build image)
 */

/**
 * A single build command that can be converted to different formats.
 */
export interface BuildCommand {
  /** Command type */
  type: "run" | "copy" | "env" | "workdir";
  /** Command arguments */
  args: string[];
  /** Human-readable description for logging */
  description?: string;
}

/**
 * Get the base provisioning commands for setting up a cmux ACP sandbox.
 *
 * These commands install all necessary tools and configure the environment.
 * They are designed to work both as shell commands (runtime) and Dockerfile
 * instructions (image build).
 */
export function getProvisioningCommands(): BuildCommand[] {
  const mcpUploadPath = resolvePath(process.cwd(), "scripts/mcp-upload.mjs");
  const mcpUploadBase64 = readFileSync(mcpUploadPath).toString("base64");
  return [
    // ==========================================================================
    // System Packages
    // ==========================================================================
    {
      type: "run",
      args: ["apt-get update"],
      description: "Update apt package list",
    },
    {
      type: "run",
      args: [
        "DEBIAN_FRONTEND=noninteractive apt-get install -y " +
          "sudo curl git build-essential pkg-config libssl-dev ca-certificates unzip coreutils passwd zsh",
      ],
      description: "Install base system packages (including passwd for useradd)",
    },

    // ==========================================================================
    // User Setup
    // ==========================================================================
    {
      type: "run",
      args: [
        "useradd -m -s /bin/bash cmux || true && " +
          "usermod -aG sudo cmux && " +
          'echo "cmux ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/cmux && ' +
          "chmod 440 /etc/sudoers.d/cmux",
      ],
      description: "Create cmux user with passwordless sudo",
    },

    // ==========================================================================
    // Node.js
    // ==========================================================================
    {
      type: "run",
      args: ["curl -fsSL https://deb.nodesource.com/setup_22.x | bash -"],
      description: "Setup Node.js 22 repository",
    },
    {
      type: "run",
      args: ["apt-get install -y nodejs"],
      description: "Install Node.js",
    },

    // ==========================================================================
    // Rust
    // ==========================================================================
    {
      type: "run",
      args: [
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
      ],
      description: "Install Rust toolchain",
    },
    {
      type: "env",
      args: ["PATH", "/root/.cargo/bin:$PATH"],
      description: "Add cargo to PATH",
    },

    // ==========================================================================
    // Bun
    // ==========================================================================
    {
      type: "run",
      args: ["curl -fsSL https://bun.sh/install | bash"],
      description: "Install Bun runtime",
    },
    {
      type: "env",
      args: ["BUN_INSTALL", "/root/.bun"],
    },
    {
      type: "env",
      args: ["PATH", "/root/.bun/bin:$PATH"],
      description: "Add bun to PATH",
    },

    // ==========================================================================
    // uv (Python package manager)
    // ==========================================================================
    {
      type: "run",
      args: ["curl -LsSf https://astral.sh/uv/install.sh | sh"],
      description: "Install uv",
    },
    {
      type: "env",
      args: ["PATH", "/root/.local/bin:$PATH"],
      description: "Add uv to PATH",
    },

    // ==========================================================================
    // ACP CLI Tools
    // ==========================================================================
    {
      type: "run",
      args: [
        "export BUN_INSTALL=/root/.bun && " +
          "export PATH=/root/.bun/bin:$PATH && " +
          "bun add -g @zed-industries/claude-code-acp@latest @zed-industries/codex-acp@latest @google/gemini-cli@latest opencode-ai@latest",
      ],
      description: "Install ACP CLI tools (claude-code-acp, codex-acp, gemini, opencode)",
    },

    // ==========================================================================
    // Make /root accessible to all users (for non-root access in E2B/container envs)
    // This allows symlinks in /usr/local/bin to resolve correctly
    // Also make .claude and .codex writable for CLI config/debug files
    // ==========================================================================
    {
      type: "run",
      args: [
        "chmod 755 /root && " +
          "chmod -R a+rX /root/.bun && " +
          "chmod -R a+rX /root/.cargo && " +
          "chmod -R a+rX /root/.local && " +
          "mkdir -p /root/.claude /root/.codex && " +
          "chmod -R a+rwX /root/.claude && " +
          "chmod -R a+rwX /root/.codex",
      ],
      description: "Make /root tool directories accessible to all users",
    },

    // ==========================================================================
    // Symlink CLIs to /usr/local/bin (for non-root access in E2B/container envs)
    // ==========================================================================
    {
      type: "run",
      args: [
        "ln -sf /root/.bun/bin/claude-code-acp /usr/local/bin/claude-code-acp && " +
          "ln -sf /root/.bun/bin/codex-acp /usr/local/bin/codex-acp && " +
          "ln -sf /root/.bun/bin/gemini /usr/local/bin/gemini && " +
          "ln -sf /root/.bun/bin/opencode /usr/local/bin/opencode && " +
          "ln -sf /root/.bun/bin/bun /usr/local/bin/bun && " +
          "ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx",
      ],
      description: "Symlink CLI tools to /usr/local/bin for global access",
    },
    {
      type: "run",
      args: [
        `printf '%s' '${mcpUploadBase64}' | base64 -d > /usr/local/bin/mcp-upload && chmod +x /usr/local/bin/mcp-upload`,
      ],
      description: "Install MCP upload tool",
    },

    // ==========================================================================
    // Directory Setup
    // ==========================================================================
    {
      type: "run",
      args: ["mkdir -p /etc/cmux /var/log/cmux /workspace"],
      description: "Create cmux directories",
    },

    // ==========================================================================
    // CLI Configurations
    // ==========================================================================
    {
      type: "run",
      args: [
        `mkdir -p /root/.codex && cat > /root/.codex/config.toml << 'CODEXEOF'
# Codex CLI configuration for cmux sandbox
approval_policy = "never"
sandbox_mode = "danger-full-access"
model_provider = "cmux-proxy"

[model_providers.cmux-proxy]
name = "cmux-proxy"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
requires_openai_auth = false
CODEXEOF`,
      ],
      description: "Create Codex CLI config",
    },
    {
      type: "run",
      args: [
        `mkdir -p /root/.claude && cat > /root/.claude/settings.json << 'CLAUDEEOF'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
CLAUDEEOF`,
      ],
      description: "Create Claude Code settings",
    },
    {
      type: "run",
      args: [
        `cat > /root/.claude.json << 'CLAUDEJSONEOF'
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
CLAUDEJSONEOF`,
      ],
      description: "Create Claude Code project config",
    },
    {
      type: "run",
      args: [
        "if id -u user >/dev/null 2>&1; then " +
          "mkdir -p /home/user/.claude /home/user/.codex && " +
          "cp /root/.codex/config.toml /home/user/.codex/config.toml && " +
          "cp /root/.claude/settings.json /home/user/.claude/settings.json && " +
          "cp /root/.claude.json /home/user/.claude.json && " +
          "chown -R user:user /home/user/.claude /home/user/.codex /home/user/.claude.json; " +
        "fi",
      ],
      description: "Mirror CLI configs for non-root user",
    },
  ];
}

/**
 * Generate the boot script content that starts cmux-acp-server.
 *
 * This script is used by container-based providers (Daytona/E2B/Blaxel)
 * to start the ACP server on container boot, since they don't capture
 * running processes like Morph/Freestyle RAM snapshots do.
 */
export function generateBootScript(): string {
  return `#!/bin/bash
# /etc/cmux/boot.sh - Boot script for cmux ACP sandbox
# Starts the cmux-acp-server and waits for it to be ready
set -e

# Ensure PATH includes all necessary tools
export PATH="/root/.bun/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin"
export BUN_INSTALL="/root/.bun"

# Start cmux-pty in the background
/usr/local/bin/cmux-pty &
PTY_PID=$!

# Start opencode serve in the background (proxied via cmux-acp-server at /api/opencode/*)
cd /workspace && /root/.bun/bin/opencode serve --port 39385 --hostname 127.0.0.1 &
OPENCODE_PID=$!

# Start cmux-acp-server in the background
/usr/local/bin/cmux-acp-server &
SERVER_PID=$!

# Wait for cmux-pty to be ready (max 15 seconds)
echo "Waiting for cmux-pty to be ready..."
for i in {1..15}; do
  if curl -sf http://localhost:39383/health > /dev/null 2>&1; then
    echo "cmux-pty is ready"
    break
  fi
  sleep 1
done

# Wait for health check to pass (max 30 seconds)
echo "Waiting for cmux-acp-server to be ready..."
for i in {1..30}; do
  if curl -sf http://localhost:39384/health > /dev/null 2>&1; then
    echo "cmux-acp-server is ready"
    # Keep the container running
    wait $SERVER_PID
    exit 0
  fi
  sleep 1
done

echo "ERROR: cmux-acp-server failed to start within 30 seconds"
exit 1
`;
}

/**
 * Generate a systemd service unit file for cmux-acp-server.
 *
 * This is used by runtime snapshot providers (Morph/Freestyle) that
 * can capture running processes.
 */
export function generateSystemdUnit(): string {
  return `[Unit]
Description=cmux ACP server for sandbox integration
After=network.target

[Service]
Type=simple
Environment="PATH=/root/.bun/bin:/root/.cargo/bin:/root/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/usr/local/bin/cmux-acp-server
Restart=always
RestartSec=5
KillMode=process
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Convert build commands to a Dockerfile string.
 *
 * @param commands The build commands to convert
 * @param options Additional options
 * @returns Dockerfile content as a string
 */
export function commandsToDockerfile(
  commands: BuildCommand[],
  options: {
    baseImage?: string;
    /** Extra lines to add at the start (e.g., COPY for sandbox API) */
    preamble?: string[];
    /** The entrypoint command */
    entrypoint?: string[];
  } = {}
): string {
  const {
    baseImage = "debian:bookworm",
    preamble = [],
    entrypoint = ["/etc/cmux/boot.sh"],
  } = options;

  const lines: string[] = [
    `FROM ${baseImage}`,
    "",
    "# Auto-generated by cmux snapshot builder",
    "",
  ];

  // Add preamble (e.g., Blaxel sandbox API)
  for (const line of preamble) {
    lines.push(line);
  }
  if (preamble.length > 0) {
    lines.push("");
  }

  // Track current environment for combining ENV statements
  const envVars: [string, string][] = [];

  for (const cmd of commands) {
    // Add description as comment if present
    if (cmd.description) {
      lines.push(`# ${cmd.description}`);
    }

    switch (cmd.type) {
      case "run":
        // Combine multiple shell commands into a single RUN for layer efficiency
        lines.push(`RUN ${cmd.args.join(" && ")}`);
        break;

      case "copy":
        lines.push(`COPY ${cmd.args[0]} ${cmd.args[1]}`);
        break;

      case "env":
        // Collect ENV vars to combine later
        envVars.push([cmd.args[0], cmd.args[1]]);
        lines.push(`ENV ${cmd.args[0]}="${cmd.args[1]}"`);
        break;

      case "workdir":
        lines.push(`WORKDIR ${cmd.args[0]}`);
        break;
    }
    lines.push("");
  }

  // Add entrypoint
  lines.push(`ENTRYPOINT ${JSON.stringify(entrypoint)}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Convert build commands to shell script for runtime execution.
 *
 * @param commands The build commands to convert
 * @returns Shell script content as a string
 */
export function commandsToShellScript(commands: BuildCommand[]): string {
  const lines: string[] = [
    "#!/bin/bash",
    "# Auto-generated provisioning script",
    "set -e",
    "",
  ];

  for (const cmd of commands) {
    if (cmd.description) {
      lines.push(`# ${cmd.description}`);
    }

    switch (cmd.type) {
      case "run":
        for (const arg of cmd.args) {
          lines.push(arg);
        }
        break;

      case "copy":
        // For shell script, COPY needs to be handled differently
        // This is a placeholder - actual file copy would need scp/rsync
        lines.push(`# COPY ${cmd.args[0]} -> ${cmd.args[1]}`);
        break;

      case "env":
        lines.push(`export ${cmd.args[0]}="${cmd.args[1]}"`);
        break;

      case "workdir":
        lines.push(`cd ${cmd.args[0]}`);
        break;
    }
    lines.push("");
  }

  return lines.join("\n");
}
