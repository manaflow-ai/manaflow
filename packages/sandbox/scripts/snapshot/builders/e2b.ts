/**
 * E2B snapshot builder using the Template builder SDK.
 *
 * E2B templates are built using their declarative Template builder API.
 * The Template.build() method handles all the heavy lifting.
 */

import { Template } from "e2b";
import * as fs from "node:fs";
import type { BuildCommand } from "../build-commands";
import type { BuildContext, SnapshotBuilder, SnapshotBuildResult } from "./index";

interface TemplateOptions {
  commands: BuildCommand[];
  bootScript?: string;
  acpServerBinaryPath?: string;
  ptyServerBinaryPath?: string;
}

/**
 * Convert BuildCommands to an E2B Template builder.
 */
function commandsToTemplate(opts: TemplateOptions): ReturnType<typeof Template> {
  const { commands, bootScript, acpServerBinaryPath, ptyServerBinaryPath } = opts;
  let template = Template().fromDebianImage("bookworm");

  // Track environment variables
  const envVars: Record<string, string> = {};

  for (const cmd of commands) {
    switch (cmd.type) {
      case "run":
        // Run provisioning commands as root to avoid sudo dependency.
        const cmdStr = cmd.args.join(" && ");
        template = template.runCmd(cmdStr, { user: "root" });
        break;

      case "copy":
        // copy(src, dest)
        template = template.copy(cmd.args[0], cmd.args[1], {
          forceUpload: true,
          user: "root",
        });
        break;

      case "env":
        // Collect env vars to set together
        envVars[cmd.args[0]] = cmd.args[1];
        break;

      case "workdir":
        template = template.setWorkdir(cmd.args[0]);
        break;
    }
  }

  // TEMPORARILY DISABLED FOR TESTING - investigating root cause
  // envVars["CMUX_SKIP_PREWARM"] = "1";

  // Set all environment variables
  if (Object.keys(envVars).length > 0) {
    template = template.setEnvs(envVars);
  }

  // Add cmux-acp-server binary if provided
  // Note: E2B's copy() has issues with binary file extraction (exit status 2)
  // Workaround: compress with gzip first, copy, then decompress
  if (acpServerBinaryPath) {
    const zlib = require("node:zlib");
    const os = require("node:os");
    const path = require("node:path");

    // Compress the binary to reduce size and potentially fix extraction issues
    const binaryData = fs.readFileSync(acpServerBinaryPath);
    const compressedData = zlib.gzipSync(binaryData);

    // Write compressed binary to temp file
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2b-build-"));
    const compressedPath = path.join(tempDir, "cmux-acp-server.gz");
    fs.writeFileSync(compressedPath, compressedData);

    // Copy compressed file and decompress
    template = template.copy(compressedPath, "/tmp/cmux-acp-server.gz", {
      forceUpload: true,
      user: "root",
    });
    template = template.runCmd(
      "gunzip -c /tmp/cmux-acp-server.gz > /usr/local/bin/cmux-acp-server && chmod +x /usr/local/bin/cmux-acp-server && rm /tmp/cmux-acp-server.gz",
      { user: "root" }
    );
  }

  if (ptyServerBinaryPath) {
    const zlib = require("node:zlib");
    const os = require("node:os");
    const path = require("node:path");

    const binaryData = fs.readFileSync(ptyServerBinaryPath);
    const compressedData = zlib.gzipSync(binaryData);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2b-build-"));
    const compressedPath = path.join(tempDir, "cmux-pty.gz");
    fs.writeFileSync(compressedPath, compressedData);

    template = template.copy(compressedPath, "/tmp/cmux-pty.gz", {
      forceUpload: true,
      user: "root",
    });
    template = template.runCmd(
      "gunzip -c /tmp/cmux-pty.gz > /usr/local/bin/cmux-pty && chmod +x /usr/local/bin/cmux-pty && rm /tmp/cmux-pty.gz",
      { user: "root" }
    );
  }

  // If boot script is provided, we need to write it and set as start command
  if (bootScript) {
    const os = require("node:os");
    const path = require("node:path");

    // Write boot script to temp file and use copy() for reliable transfer
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2b-boot-"));
    const bootScriptPath = path.join(tempDir, "boot.sh");
    fs.writeFileSync(bootScriptPath, bootScript, { mode: 0o755 });

    template = template.runCmd("mkdir -p /etc/cmux", { user: "root" });
    template = template.copy(bootScriptPath, "/etc/cmux/boot.sh", {
      forceUpload: true,
      user: "root",
    });
    template = template.runCmd("chmod +x /etc/cmux/boot.sh", { user: "root" });

    // Set the start command to run the boot script
    // The second argument is the ready check command
    // Use /ready instead of /health to wait for prewarm completion
    // This ensures agent thread pools are warmed up for fast session creation
    template = template.setStartCmd(
      "/etc/cmux/boot.sh",
      "/usr/bin/curl -sf http://localhost:39384/ready"
    );
  }

  return template;
}

/**
 * E2B snapshot builder.
 *
 * Uses the E2B SDK's Template builder and Template.build() API
 * to build templates programmatically without needing the CLI.
 */
export class E2BBuilder implements SnapshotBuilder {
  readonly provider = "e2b" as const;

  constructor() {
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      throw new Error("E2B_API_KEY environment variable not set");
    }
    // E2B SDK uses E2B_API_KEY env var automatically
  }

  async build(ctx: BuildContext): Promise<SnapshotBuildResult> {
    ctx.log(`Building E2B template: ${ctx.name}`);

    // Convert build commands to E2B Template
    const template = commandsToTemplate({
      commands: ctx.commands,
      bootScript: ctx.bootScript,
      acpServerBinaryPath: ctx.acpServerBinaryPath,
      ptyServerBinaryPath: ctx.ptyServerBinaryPath,
    });

    ctx.log("Building template...");

    // Build the template
    const result = await Template.build(template, {
      alias: ctx.name,
      cpuCount: 4,
      memoryMB: 8192, // 8 GiB
      // Use the default build logger for progress output
      onBuildLogs: (log) => {
        if (log.message) {
          ctx.log(`[e2b] ${log.message.trim()}`);
        }
      },
    });

    ctx.log(`Template built: ${result.templateId} (alias: ${ctx.name})`);

    // Get the Dockerfile content for reference
    const dockerfile = Template.toDockerfile(template);

    return {
      snapshotId: result.templateId,
      strategy: "dockerfile",
      provider: "e2b",
      dockerfile,
    };
  }
}
