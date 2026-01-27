/**
 * Blaxel snapshot builder using the bl CLI.
 *
 * Blaxel requires a template directory with:
 * - Dockerfile
 * - blaxel.toml (config: memory, ports, env vars)
 * - entrypoint.sh (boot script)
 *
 * The builder generates these files and runs `bl deploy`.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { commandsToDockerfile, type BuildCommand } from "../build-commands";
import type { BuildContext, SnapshotBuilder, SnapshotBuildResult } from "./index";

/**
 * Generate blaxel.toml configuration file content.
 */
function generateBlaxelToml(name: string): string {
  return `# Blaxel sandbox configuration for ${name}
[sandbox]
memory = 8192

[[sandbox.ports]]
name = "acp"
target = 39384
protocol = "HTTP"

[sandbox.env]
DEBIAN_FRONTEND = "noninteractive"
`;
}

/**
 * Generate Makefile for local testing.
 */
function generateMakefile(name: string): string {
  return `# Makefile for ${name}
.PHONY: build run

build:
\tdocker build -t ${name} .

run:
\tdocker run -p 39384:39384 ${name}
`;
}

/**
 * Execute a shell command and return stdout.
 */
function exec(
  command: string,
  options: ExecSyncOptions = {}
): string {
  return execSync(command, {
    encoding: "utf-8",
    ...options,
  });
}

/**
 * Check if bl CLI is installed.
 */
function checkBlCli(): void {
  try {
    exec("bl version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "Blaxel CLI (bl) not found. Install it from https://docs.blaxel.ai/cli"
    );
  }
}

/**
 * Blaxel snapshot builder.
 *
 * Generates Dockerfile, blaxel.toml, and entrypoint.sh files,
 * then runs `bl deploy` to create the sandbox image.
 */
export class BlaxelBuilder implements SnapshotBuilder {
  readonly provider = "blaxel" as const;

  constructor() {
    const apiKey = process.env.BLAXEL_API_KEY || process.env.BL_API_KEY;
    if (!apiKey) {
      throw new Error("BLAXEL_API_KEY or BL_API_KEY environment variable not set");
    }
    // Ensure BL_API_KEY is set for the CLI
    process.env.BL_API_KEY = apiKey;

    // Verify bl CLI is available
    checkBlCli();
  }

  async build(ctx: BuildContext): Promise<SnapshotBuildResult> {
    ctx.log(`Building Blaxel image: ${ctx.name}`);

    // Create temporary directory for template files
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "blaxel-build-"));

    try {
      // Copy cmux binaries to temp dir if provided
      const localFiles: Array<{ local: string; dest: string }> = [];
      if (ctx.acpServerBinaryPath) {
        const binaryDest = path.join(tempDir, "cmux-acp-server");
        fs.copyFileSync(ctx.acpServerBinaryPath, binaryDest);
        localFiles.push({ local: "cmux-acp-server", dest: "/usr/local/bin/cmux-acp-server" });
        ctx.log("Copied cmux-acp-server binary to build context");
      }
      if (ctx.ptyServerBinaryPath) {
        const binaryDest = path.join(tempDir, "cmux-pty");
        fs.copyFileSync(ctx.ptyServerBinaryPath, binaryDest);
        localFiles.push({ local: "cmux-pty", dest: "/usr/local/bin/cmux-pty" });
        ctx.log("Copied cmux-pty binary to build context");
      }

      // Generate Dockerfile with Blaxel-specific preamble
      const preamble = [
        "# Blaxel sandbox API (required for Blaxel sandboxes)",
        "COPY --from=ghcr.io/blaxel-ai/sandbox:latest /sandbox-api /usr/local/bin/sandbox-api",
      ];

      // Add COPY instructions for local files
      for (const file of localFiles) {
        preamble.push(`COPY ${file.local} ${file.dest}`);
        preamble.push(`RUN chmod +x ${file.dest}`);
      }

      const dockerfile = commandsToDockerfile(ctx.commands, {
        baseImage: "debian:bookworm",
        preamble,
        entrypoint: ["/etc/cmux/boot.sh"],
      });

      // Write Dockerfile
      const dockerfilePath = path.join(tempDir, "Dockerfile");
      fs.writeFileSync(dockerfilePath, dockerfile);
      ctx.log(`Generated Dockerfile (${dockerfile.split("\n").length} lines)`);

      // Write blaxel.toml
      const tomlPath = path.join(tempDir, "blaxel.toml");
      fs.writeFileSync(tomlPath, generateBlaxelToml(ctx.name));
      ctx.log("Generated blaxel.toml");

      // Write entrypoint.sh (boot script)
      if (ctx.bootScript) {
        const entrypointPath = path.join(tempDir, "entrypoint.sh");
        fs.writeFileSync(entrypointPath, ctx.bootScript, { mode: 0o755 });
        ctx.log("Generated entrypoint.sh");

        // Update Dockerfile to COPY the entrypoint
        const updatedDockerfile = dockerfile.replace(
          'ENTRYPOINT ["/etc/cmux/boot.sh"]',
          'COPY entrypoint.sh /etc/cmux/boot.sh\n' +
            'RUN chmod +x /etc/cmux/boot.sh\n' +
            'ENTRYPOINT ["/etc/cmux/boot.sh"]'
        );
        fs.writeFileSync(dockerfilePath, updatedDockerfile);
      }

      // Write Makefile for local testing
      const makefilePath = path.join(tempDir, "Makefile");
      fs.writeFileSync(makefilePath, generateMakefile(ctx.name));

      ctx.log(`Running bl deploy in ${tempDir}...`);

      // Run bl deploy
      const deployOutput = exec(`bl deploy --name ${ctx.name}`, {
        cwd: tempDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      ctx.log(`[blaxel] ${deployOutput.trim()}`);

      // Parse the image ID from deploy output
      // Expected format: "Deployed image: <image-id>" or similar
      const imageIdMatch = deployOutput.match(
        /(?:Deployed|Created|Image).*?:\s*(\S+)/i
      );
      const imageId = imageIdMatch ? imageIdMatch[1] : ctx.name;

      ctx.log(`Image deployed: ${imageId}`);

      return {
        snapshotId: imageId,
        strategy: "dockerfile",
        provider: "blaxel",
        dockerfile,
      };
    } finally {
      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
