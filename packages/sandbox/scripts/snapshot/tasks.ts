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

  return {
    vm,
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
          sudo curl git build-essential pkg-config libssl-dev ca-certificates`
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
    deps: ["install-docker-repo", "install-node"],  // Wait for install-node to avoid apt lock
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
        export BUN_INSTALL="$HOME/.bun"
        export PATH="$BUN_INSTALL/bin:$PATH"
        bun add -g @zed-industries/claude-code-acp@latest @zed-industries/codex-acp@latest @google/gemini-cli@latest opencode-ai@latest
        `
      );
    },
  });

  // =========================================================================
  // cmux-acp-server (Rust binary, depends on rust and deps)
  // =========================================================================

  registry.register({
    name: "build-cmux-acp-server",
    description: "Build and install cmux-acp-server binary",
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

        # Clean up build directory to save space
        cd /
        rm -rf /tmp/cmux-build
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
    description: "Install and enable cmux-acp-server systemd service",
    deps: ["build-cmux-acp-server", "setup-dirs"],
    func: async (ctx) => {
      await ctx.run(
        "setup-acp-service",
        `
        set -e

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

        # Reload systemd to pick up the new service
        systemctl daemon-reload

        # Enable the service (so it starts on boot / after snapshot restore)
        systemctl enable cmux-acp-server

        # Start the service now - since Morph uses memory snapshots,
        # the running process will be included in the snapshot
        systemctl start cmux-acp-server

        # Wait for it to be ready
        sleep 2

        # Verify it's running
        systemctl status cmux-acp-server --no-pager || true

        echo "cmux-acp-server systemd service installed and started"
        `
      );
    },
  });

  // =========================================================================
  // Verification
  // =========================================================================

  registry.register({
    name: "verify",
    description: "Verify all installations",
    deps: ["setup-dirs", "setup-user", "install-bun", "install-rust", "install-uv", "setup-docker", "setup-acp-service", "setup-cli-configs"],
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
        which cmux-acp-server > /dev/null
        echo "✓ cmux-acp-server"

        echo "Checking systemd services..."
        systemctl is-active cmux-acp-server > /dev/null
        echo "✓ cmux-acp-server service running"

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

      // Test cmux-acp-server healthcheck (using systemd service)
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

  // =========================================================================
  // Expose HTTP and Verify Public Access
  // =========================================================================

  registry.register({
    name: "expose-http",
    description: "Expose ACP server HTTP port and verify public access",
    deps: ["final-test"],
    func: async (ctx) => {
      // Expose the ACP server port to the public internet
      if (!ctx.vm.exposeHttp) {
        ctx.log("⚠ Provider does not support exposeHttp, skipping public access test");
        return;
      }

      ctx.log("Exposing port 39384 as 'acp'...");
      const { url } = await ctx.vm.exposeHttp("acp", 39384);
      ctx.log(`✓ Exposed at: ${url}`);

      // Verify the endpoint is accessible from the public internet
      // We do this from within the VM using curl to an external endpoint
      // This confirms the Morph HTTP proxy is routing correctly
      await ctx.run(
        "verify-public-access",
        `
        set -e

        PUBLIC_URL="${url}"
        echo "Testing public URL: $PUBLIC_URL"

        # Wait a moment for the HTTP service to be fully routed
        sleep 2

        # Test health endpoint from within VM (goes out to internet and back)
        RESPONSE=$(curl -sf "$PUBLIC_URL/health" || echo "FAILED")
        echo "Response: $RESPONSE"

        if echo "$RESPONSE" | grep -q '"status":"ok"'; then
          echo "✓ Public health endpoint accessible!"
        else
          echo "✗ Public health endpoint NOT accessible"
          echo "This means instances from this snapshot won't have working HTTP"
          exit 1
        fi

        # Also test the configure endpoint returns expected error (proves routing works)
        CONFIGURE_RESPONSE=$(curl -sf -X POST "$PUBLIC_URL/api/acp/configure" \
          -H "Content-Type: application/json" \
          -d '{"test":true}' 2>&1 || true)
        echo "Configure response: $CONFIGURE_RESPONSE"

        if echo "$CONFIGURE_RESPONSE" | grep -q "callback_url"; then
          echo "✓ ACP configure endpoint responding correctly"
        else
          echo "⚠ Unexpected configure response (may still be ok)"
        fi

        echo "Public HTTP access verified!"
        `
      );
    },
  });

  return registry;
}
