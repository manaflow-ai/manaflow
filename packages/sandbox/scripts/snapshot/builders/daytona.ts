/**
 * Daytona snapshot builder using the Image builder SDK.
 *
 * Daytona snapshots are built from Docker images using their declarative
 * Image builder API, then registered via snapshot.create().
 *
 * IMPORTANT: Daytona injects a toolbox daemon into sandboxes at runtime.
 * This daemon handles command execution, file operations, etc.
 * The image MUST:
 * 1. Have a 'daytona' user with passwordless sudo
 * 2. Use 'sleep infinity' as entrypoint (NOT a custom script)
 * 3. Have bash available and set as default shell
 */

import { Daytona, Image } from "@daytonaio/sdk";
import type { BuildCommand } from "../build-commands";
import type { BuildContext, SnapshotBuilder, SnapshotBuildResult } from "./index";

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Generate a Dockerfile string from build commands.
 *
 * IMPORTANT: Daytona's Image builder API has issues, so we generate
 * an explicit Dockerfile and use Image.fromDockerfile() instead.
 */
function generateDockerfile(commands: BuildCommand[]): string {
  const lines: string[] = [
    "FROM python:3.11-slim",
    "",
  ];

  // Collect environment variables
  const envVars: Record<string, string> = {};

  for (const cmd of commands) {
    switch (cmd.type) {
      case "run":
        // Combine multiple shell commands with &&
        lines.push(`RUN ${cmd.args.join(" && ")}`);
        break;

      case "copy":
        // COPY will be handled separately for files that need to be uploaded
        // For now, skip - we'll add them via addLocalFile after
        break;

      case "env":
        envVars[cmd.args[0]] = cmd.args[1];
        break;

      case "workdir":
        lines.push(`WORKDIR ${cmd.args[0]}`);
        break;
    }
  }

  // Add environment variables
  if (Object.keys(envVars).length > 0) {
    for (const [key, value] of Object.entries(envVars)) {
      lines.push(`ENV ${key}="${value}"`);
    }
  }

  return lines.join("\n");
}

/**
 * Finalize the Dockerfile with Daytona-specific setup.
 *
 * CRITICAL: Daytona requires:
 * 1. A 'daytona' user with passwordless sudo
 * 2. Default shell set to bash
 * 3. 'sleep infinity' as entrypoint (NOT a custom boot script)
 *
 * The cmux-acp-server must be started AFTER sandbox creation
 * via the Daytona SDK, not via entrypoint.
 *
 * Returns the finalized Dockerfile content and any local files to include.
 */
function finalizeDockerfile(
  dockerfile: string,
  bootScript?: string,
  acpServerBinaryPath?: string,
  ptyServerBinaryPath?: string
): { dockerfile: string; localFiles: Array<{ local: string; remote: string }> } {
  const lines = dockerfile.split("\n");
  const localFiles: Array<{ local: string; remote: string }> = [];

  // Create the 'daytona' user like official images do
  // This is critical - the toolbox daemon runs as this user
  lines.push("");
  lines.push("# Create daytona user for toolbox daemon");
  lines.push(
    "RUN useradd -m -s /bin/bash daytona && " +
      'echo "daytona ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/91-daytona'
  );

  // Make tools installed in /root/ accessible to daytona user
  lines.push("");
  lines.push("# Link tools to /usr/local/bin for daytona user access");
  lines.push(
    "RUN test -f /root/.bun/bin/bun && ln -sf /root/.bun/bin/bun /usr/local/bin/bun || true && " +
      "test -f /root/.bun/bin/bunx && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx || true && " +
      "test -d /root/.cargo/bin && find /root/.cargo/bin -type f -executable -exec ln -sf {} /usr/local/bin/ \\; || true && " +
      "test -f /root/.local/bin/uv && ln -sf /root/.local/bin/uv /usr/local/bin/uv || true && " +
      "test -f /root/.local/bin/uvx && ln -sf /root/.local/bin/uvx /usr/local/bin/uvx || true"
  );

  // Copy CLI configs from /root/ to /home/daytona/
  lines.push("");
  lines.push("# Copy CLI configs to daytona user home");
  lines.push(
    "RUN test -d /root/.codex && cp -r /root/.codex /home/daytona/.codex && chown -R daytona:daytona /home/daytona/.codex || true && " +
      "test -d /root/.claude && cp -r /root/.claude /home/daytona/.claude && chown -R daytona:daytona /home/daytona/.claude || true && " +
      "test -f /root/.claude.json && cp /root/.claude.json /home/daytona/.claude.json && chown daytona:daytona /home/daytona/.claude.json || true"
  );

  // Add cmux-acp-server binary if provided
  if (acpServerBinaryPath) {
    lines.push("");
    lines.push("# Add cmux-acp-server binary");
    lines.push("COPY cmux-acp-server /usr/local/bin/cmux-acp-server");
    lines.push("RUN chmod +x /usr/local/bin/cmux-acp-server");
    localFiles.push({ local: acpServerBinaryPath, remote: "cmux-acp-server" });
  }

  if (ptyServerBinaryPath) {
    lines.push("");
    lines.push("# Add cmux-pty binary");
    lines.push("COPY cmux-pty /usr/local/bin/cmux-pty");
    lines.push("RUN chmod +x /usr/local/bin/cmux-pty");
    localFiles.push({ local: ptyServerBinaryPath, remote: "cmux-pty" });
  }

  // If boot script is provided, add it
  if (bootScript) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daytona-build-"));
    const bootScriptPath = path.join(tempDir, "boot.sh");
    fs.writeFileSync(bootScriptPath, bootScript, { mode: 0o755 });

    lines.push("");
    lines.push("# Add boot script");
    lines.push("COPY boot.sh /etc/cmux/boot.sh");
    lines.push("RUN chmod +x /etc/cmux/boot.sh");
    localFiles.push({ local: bootScriptPath, remote: "boot.sh" });
  }

  // Switch to daytona user and set entrypoint
  lines.push("");
  lines.push("# Switch to daytona user and set entrypoint");
  lines.push("USER daytona");
  lines.push('ENTRYPOINT ["sleep", "infinity"]');

  return { dockerfile: lines.join("\n"), localFiles };
}

/**
 * Daytona snapshot builder.
 *
 * Uses the Daytona SDK's Image builder and snapshot.create() API
 * to build and register snapshots.
 */
export class DaytonaBuilder implements SnapshotBuilder {
  readonly provider = "daytona" as const;
  private client: Daytona;

  constructor() {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) {
      throw new Error("DAYTONA_API_KEY environment variable not set");
    }
    this.client = new Daytona({
      apiKey,
      target: process.env.DAYTONA_TARGET || "us",
    });
  }

  async build(ctx: BuildContext): Promise<SnapshotBuildResult> {
    ctx.log(`Building Daytona snapshot: ${ctx.name}`);

    // Generate Dockerfile from build commands
    let dockerfile = generateDockerfile(ctx.commands);

    // Add Daytona-specific finalization
    const { dockerfile: finalDockerfile, localFiles } = finalizeDockerfile(
      dockerfile,
      ctx.bootScript,
      ctx.acpServerBinaryPath,
      ctx.ptyServerBinaryPath
    );

    ctx.log("Generated Dockerfile:");
    for (const line of finalDockerfile.split("\n").slice(0, 20)) {
      ctx.log(`  ${line}`);
    }
    ctx.log("  ... (truncated)");

    // Write Dockerfile to temp directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "daytona-snapshot-"));
    const dockerfilePath = path.join(tempDir, "Dockerfile");
    fs.writeFileSync(dockerfilePath, finalDockerfile);
    ctx.log(`Wrote Dockerfile to: ${dockerfilePath}`);

    // Copy local files to temp directory (for COPY instructions)
    for (const file of localFiles) {
      const destPath = path.join(tempDir, file.remote);
      fs.copyFileSync(file.local, destPath);
      ctx.log(`Copied ${file.local} -> ${destPath}`);
    }

    // Create Image from Dockerfile
    const image = Image.fromDockerfile(dockerfilePath);

    // Delete existing snapshot if it exists
    try {
      const existing = await this.client.snapshot.get(ctx.name);
      if (existing) {
        ctx.log(`Deleting existing snapshot: ${ctx.name} (id: ${existing.id}, state: ${existing.state})`);
        if (existing.id) {
          try {
            await this.client.snapshot.delete(existing.id);
            // Wait for deletion to propagate
            ctx.log("Waiting for deletion to complete...");
            await new Promise((resolve) => setTimeout(resolve, 10000));
            ctx.log("Existing snapshot deleted");
          } catch (deleteError) {
            ctx.log(`Delete failed: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`);
            throw deleteError;
          }
        } else {
          ctx.log("Snapshot has no ID (possibly failed build), waiting for cleanup...");
          // Wait and retry - Daytona may auto-clean failed builds
          await new Promise((resolve) => setTimeout(resolve, 30000));
        }
      }
    } catch (err) {
      // Only ignore "not found" errors
      const errStr = err instanceof Error ? err.message : String(err);
      if (!errStr.includes("not found") && !errStr.includes("404")) {
        throw err;
      }
      ctx.log("No existing snapshot to delete");
    }

    ctx.log("Creating snapshot from Dockerfile...");

    // Create the snapshot using Daytona's snapshot service
    const snapshot = await this.client.snapshot.create(
      {
        name: ctx.name,
        image,
        resources: {
          cpu: 4,
          memory: 8,  // 8 GiB (Daytona max)
          disk: 10,   // 10 GiB (Daytona max)
        },
      },
      {
        onLogs: (chunk) => ctx.log(`[daytona] ${chunk.trim()}`),
        timeout: 1800, // 30 minute timeout for build
      }
    );

    ctx.log(`Snapshot created: ${snapshot.name} (ID: ${snapshot.id})`);

    return {
      snapshotId: snapshot.name,
      strategy: "dockerfile",
      provider: "daytona",
      dockerfile: finalDockerfile,
    };
  }
}
