#!/usr/bin/env bun
/**
 * Unified ACP Sandbox Snapshot Script
 *
 * Creates snapshots for Morph and/or Freestyle providers using
 * a DAG-based provisioning system for parallel task execution.
 *
 * Usage:
 *   bun run scripts/snapshot/snapshot.ts                    # Both providers
 *   bun run scripts/snapshot/snapshot.ts --provider morph   # Morph only
 *   bun run scripts/snapshot/snapshot.ts --provider freestyle # Freestyle only
 *   bun run scripts/snapshot/snapshot.ts --preset standard  # Specific preset
 *   bun run scripts/snapshot/snapshot.ts --base-snapshot snap_xxx
 *
 * Environment:
 *   MORPH_API_KEY      - Required for Morph provider
 *   FREESTYLE_API_KEY  - Required for Freestyle provider
 */

import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  updateSnapshotId,
  printHeader,
  printSummary,
  type ProviderName,
  type SnapshotStrategy,
} from "./utils";
import {
  getProvider,
  createProvisionedSnapshot,
  type VmHandle,
} from "./providers";
import { runTaskGraph, formatDependencyGraph } from "./dag";
import {
  createProvisioningRegistry,
  createProvisioningContext,
} from "./tasks";
import {
  getProvisioningCommands,
  generateBootScript,
} from "./build-commands";
import {
  PROVIDER_CAPABILITIES,
  getBuilder,
  isDockerfileProvider,
} from "./builders";

async function fetchWithTimeout(
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyPublicHttpAccess(url: string): Promise<void> {
  const healthUrl = `${url}/health`;
  const maxAttempts = 10;
  const delayMs = 3000;
  let lastError: string | null = null;

  console.log(`Verifying public access: ${healthUrl}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(healthUrl, 8000);
      const body = await response.text();
      if (response.ok && body.includes('"status":"ok"')) {
        console.log("✓ Public health endpoint accessible from host");
        return;
      }
      lastError = `HTTP ${response.status}: ${body.slice(0, 200)}`;
      console.warn(
        `Public health check attempt ${attempt}/${maxAttempts} failed: ${lastError}`
      );
    } catch (error) {
      console.error(
        `Public health check attempt ${attempt}/${maxAttempts} error:`,
        error
      );
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `Public HTTP access verification failed for ${healthUrl}: ${lastError ?? "unknown error"}`
  );
}

/**
 * Get the source directory path for cmux-acp-server.
 */
function getSourceDir(): string {
  return path.resolve(import.meta.dirname, "../..");
}

/**
 * Get the workspace root (repo root) for shared crates.
 */
function getWorkspaceRoot(): string {
  return path.resolve(import.meta.dirname, "../../../..");
}

function isLinuxAmd64Binary(binaryPath: string): boolean {
  try {
    const output = execFileSync("file", ["-b", binaryPath], {
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    return output.includes("ELF") && output.includes("x86-64");
  } catch (error) {
    console.error(`Failed to inspect binary ${binaryPath}`, error);
    return false;
  }
}

/**
 * Build the cmux-acp-server binary for linux-x86_64.
 * Uses Docker for cross-compilation to ensure proper linking.
 * Returns the path to the built binary.
 */
function buildAcpServerBinary(): string {
  const sourceDir = getSourceDir();
  // Building natively in Docker on x86_64 platform, so no cross-compilation target needed
  const binaryPath = path.join(sourceDir, "target", "release", "cmux-acp-server");

  // Check if binary already exists and is recent (within 1 hour)
  if (fs.existsSync(binaryPath)) {
    const stats = fs.statSync(binaryPath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < 60 * 60 * 1000) {
      if (isLinuxAmd64Binary(binaryPath)) {
        console.log(
          `Using existing binary: ${binaryPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${Math.round(ageMs / 1000 / 60)}min old)`
        );
        return binaryPath;
      }
      console.warn(
        `Existing binary at ${binaryPath} is not linux/amd64; rebuilding.`
      );
    }
  }

  console.log("Building cmux-acp-server for linux-x86_64 using Docker...");

  // Build using Docker with Rust image on x86_64 platform
  // Uses QEMU emulation on ARM Macs
  const dockerCmd = [
    "docker run --rm",
    "--platform linux/amd64",
    `-v "${sourceDir}:/workspace"`,
    "-w /workspace",
    "rust:1-bookworm",
    `bash -c "cargo build --release --bin cmux-acp-server"`,
  ].join(" ");

  console.log("Running Docker build...");
  execSync(dockerCmd, { stdio: "inherit" });

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found at ${binaryPath} after build`);
  }

  const stats = fs.statSync(binaryPath);
  console.log(`Binary built: ${binaryPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

  return binaryPath;
}

/**
 * Build the cmux-pty binary for linux-x86_64.
 * Uses Docker for cross-compilation to ensure proper linking.
 * Returns the path to the built binary.
 */
function buildPtyServerBinary(): string {
  const workspaceRoot = getWorkspaceRoot();
  const binaryPath = path.join(
    workspaceRoot,
    "crates",
    "cmux-pty",
    "target",
    "release",
    "cmux-pty"
  );

  if (fs.existsSync(binaryPath)) {
    const stats = fs.statSync(binaryPath);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < 60 * 60 * 1000) {
      if (isLinuxAmd64Binary(binaryPath)) {
        console.log(
          `Using existing binary: ${binaryPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${Math.round(ageMs / 1000 / 60)}min old)`
        );
        return binaryPath;
      }
      console.warn(
        `Existing binary at ${binaryPath} is not linux/amd64; rebuilding.`
      );
    }
  }

  console.log("Building cmux-pty for linux-x86_64 using Docker...");

  const dockerCmd = [
    "docker run --rm",
    "--platform linux/amd64",
    `-v "${workspaceRoot}:/workspace"`,
    "-w /workspace",
    "rust:1-bookworm",
    `bash -c "cargo build --release --manifest-path crates/cmux-pty/Cargo.toml"`,
  ].join(" ");

  console.log("Running Docker build...");
  execSync(dockerCmd, { stdio: "inherit" });

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Binary not found at ${binaryPath} after build`);
  }

  const stats = fs.statSync(binaryPath);
  console.log(
    `Binary built: ${binaryPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
  );

  return binaryPath;
}

/**
 * Upload the source code to the VM.
 * Uses SDK file sync when available (respects .gitignore to exclude target/, node_modules/, .git/).
 * Falls back to SSH file upload, then base64 chunked upload.
 */
async function uploadSourceCode(vm: VmHandle): Promise<void> {
  console.log("Uploading source code to VM...");

  const sourceDir = getSourceDir();
  let shouldUseTarball = false;

  if (vm.syncFiles) {
    // Use provider's native file sync (Morph uses rsync with respectGitignore)
    const syncPromise = vm.syncFiles(sourceDir, "/tmp/cmux-build/sandbox");
    const timeoutMs = 120_000;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const syncResult = await Promise.race([syncPromise, timeoutPromise]);
    if (syncResult === "timeout") {
      console.warn(
        `SDK file sync timed out after ${timeoutMs / 1000}s; falling back to tarball upload.`
      );
      shouldUseTarball = true;
    } else {
      console.log("Source code synced via SDK");
      // Verify extraction
      await vm.exec("ls -la /tmp/cmux-build/sandbox/");
      console.log("Source code ready at /tmp/cmux-build/sandbox");
      return;
    }
  } else {
    shouldUseTarball = true;
  }

  if (shouldUseTarball) {
    // Create tarball locally (excludes build artifacts)
    const tarballPath = "/tmp/cmux-sandbox-src.tar.gz";

    console.log("Creating source tarball...");
    execSync(
      `tar -czf ${tarballPath} ` +
        `--exclude='target' ` +
        `--exclude='node_modules' ` +
        `--exclude='.git' ` +
        `--exclude='*.log' ` +
        `-C "${path.dirname(sourceDir)}" sandbox`,
      { stdio: "pipe" }
    );

    const tarball = fs.readFileSync(tarballPath);
    console.log(`Tarball size: ${(tarball.length / 1024 / 1024).toFixed(2)} MB`);

    if (vm.uploadFile) {
      // Use SSH file upload (Morph, Freestyle)
      console.log("Uploading tarball via SSH...");
      await vm.uploadFile(tarballPath, "/tmp/cmux-sandbox-src.tar.gz");
      console.log("Tarball uploaded via SSH");
    } else {
      // Fallback: upload via base64 encoding in chunks
      const base64 = tarball.toString("base64");
      const CHUNK_SIZE = 50000; // ~50KB per chunk
      const chunks = Math.ceil(base64.length / CHUNK_SIZE);

      console.log(`Uploading in ${chunks} chunks...`);

      // First chunk creates the file
      await vm.exec(`echo -n '${base64.slice(0, CHUNK_SIZE)}' > /tmp/cmux-sandbox-src.tar.gz.b64`);

      // Subsequent chunks append
      for (let i = 1; i < chunks; i++) {
        const chunk = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await vm.exec(`echo -n '${chunk}' >> /tmp/cmux-sandbox-src.tar.gz.b64`);
      }

      await vm.exec(`
        set -e
        base64 -d /tmp/cmux-sandbox-src.tar.gz.b64 > /tmp/cmux-sandbox-src.tar.gz
        rm /tmp/cmux-sandbox-src.tar.gz.b64
      `);
      console.log("Tarball uploaded via base64");
    }

    // Extract tarball on VM
    await vm.exec(`
      set -e
      mkdir -p /tmp/cmux-build
      tar -xzf /tmp/cmux-sandbox-src.tar.gz -C /tmp/cmux-build
      rm /tmp/cmux-sandbox-src.tar.gz
    `);

    fs.unlinkSync(tarballPath);
    console.log("Source code uploaded and extracted");
  }

  // Verify extraction
  await vm.exec("ls -la /tmp/cmux-build/sandbox/");
  console.log("Source code ready at /tmp/cmux-build/sandbox");
}

const PRESETS = ["standard"] as const;
type Preset = (typeof PRESETS)[number];

interface RunResult {
  provider: string;
  preset: string;
  snapshotId: string;
}

async function main() {
  // Parse arguments
  const { values } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      preset: { type: "string", short: "s" },
      "base-snapshot": { type: "string", short: "b" },
      verbose: { type: "boolean", short: "v" },
      "show-graph": { type: "boolean", short: "g" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
ACP Sandbox Snapshot Script

Usage:
  bun run scripts/snapshot/snapshot.ts [options]

Options:
  --provider, -p <name>     Provider to use: morph, freestyle, daytona, e2b, blaxel, all, or both (default: all)
  --preset, -s <name>       Preset to create: standard (default: standard)
  --base-snapshot, -b <id>  Base snapshot ID to start from
  --verbose, -v             Show verbose output (default: quiet, logs on failure only)
  --show-graph, -g          Show task dependency graph and exit
  --help, -h                Show this help message

Examples:
  bun run scripts/snapshot/snapshot.ts
  bun run scripts/snapshot/snapshot.ts --provider e2b
  bun run scripts/snapshot/snapshot.ts --provider daytona
  bun run scripts/snapshot/snapshot.ts --provider blaxel
  bun run scripts/snapshot/snapshot.ts --provider freestyle
  bun run scripts/snapshot/snapshot.ts --provider morph --preset standard
  bun run scripts/snapshot/snapshot.ts --base-snapshot snap_xxx
  bun run scripts/snapshot/snapshot.ts --show-graph
  bun run scripts/snapshot/snapshot.ts --verbose

Environment Variables:
  MORPH_API_KEY       Required for Morph provider
  FREESTYLE_API_KEY   Required for Freestyle provider
  DAYTONA_API_KEY     Required for Daytona provider
  DAYTONA_TARGET      Target region for Daytona (default: us)
  E2B_API_KEY         Required for E2B provider
  BLAXEL_API_KEY      Required for Blaxel provider (or BL_API_KEY)
`);
    process.exit(0);
  }

  const verbose = values.verbose ?? false;

  // Create the task registry
  const registry = createProvisioningRegistry();

  // Show graph and exit if requested
  if (values["show-graph"]) {
    printHeader("Task Dependency Graph");
    console.log(formatDependencyGraph(registry));
    console.log(`\nTotal tasks: ${registry.taskNames.length}`);
    process.exit(0);
  }

  // Validate task graph
  registry.validate();

  // Determine providers to run
  const providerArg = values.provider?.toLowerCase();
  let providers: ProviderName[];

  if (providerArg === "all" || !providerArg) {
    providers = ["morph", "freestyle", "daytona", "e2b", "blaxel"];
  } else if (providerArg === "both") {
    // Legacy: "both" means morph + freestyle (not daytona/e2b/blaxel)
    providers = ["morph", "freestyle"];
  } else if (providerArg === "morph" || providerArg === "freestyle" || providerArg === "daytona" || providerArg === "e2b" || providerArg === "blaxel") {
    providers = [providerArg];
  } else {
    console.error(`Invalid provider: ${providerArg}`);
    console.error("Valid providers: morph, freestyle, daytona, e2b, blaxel, all, both");
    process.exit(1);
  }

  // Determine preset
  const preset = (values.preset?.toLowerCase() ?? "standard") as Preset;
  if (!PRESETS.includes(preset)) {
    console.error(`Invalid preset: ${preset}`);
    console.error(`Valid presets: ${PRESETS.join(", ")}`);
    process.exit(1);
  }

  // Check API keys
  const availableProviders: ProviderName[] = [];
  for (const p of providers) {
    if (p === "morph" && !process.env.MORPH_API_KEY) {
      console.warn(`Warning: MORPH_API_KEY not set, skipping Morph provider`);
      continue;
    }
    if (p === "freestyle" && !process.env.FREESTYLE_API_KEY) {
      console.warn(`Warning: FREESTYLE_API_KEY not set, skipping Freestyle provider`);
      continue;
    }
    if (p === "daytona" && !process.env.DAYTONA_API_KEY) {
      console.warn(`Warning: DAYTONA_API_KEY not set, skipping Daytona provider`);
      continue;
    }
    if (p === "e2b" && !process.env.E2B_API_KEY) {
      console.warn(`Warning: E2B_API_KEY not set, skipping E2B provider`);
      continue;
    }
    if (p === "blaxel" && !process.env.BLAXEL_API_KEY && !process.env.BL_API_KEY) {
      console.warn(`Warning: BLAXEL_API_KEY not set, skipping Blaxel provider`);
      continue;
    }
    availableProviders.push(p);
  }

  if (availableProviders.length === 0) {
    console.error("Error: No providers available. Set MORPH_API_KEY, FREESTYLE_API_KEY, DAYTONA_API_KEY, E2B_API_KEY, or BLAXEL_API_KEY.");
    process.exit(1);
  }

  // Print configuration
  printHeader("ACP Sandbox Snapshot");
  console.log(`Providers: ${availableProviders.join(", ")}`);
  console.log(`Preset: ${preset}`);

  // Show strategy breakdown
  const runtimeProviders = availableProviders.filter((p) => !isDockerfileProvider(p));
  const dockerfileProviders = availableProviders.filter((p) => isDockerfileProvider(p));

  if (runtimeProviders.length > 0) {
    console.log(`Runtime strategy (RAM capture): ${runtimeProviders.join(", ")}`);
    console.log(`  Tasks: ${registry.taskNames.length}`);
  }
  if (dockerfileProviders.length > 0) {
    console.log(`Dockerfile strategy (image build): ${dockerfileProviders.join(", ")}`);
    console.log(`  Commands: ${getProvisioningCommands().length}`);
  }

  if (values["base-snapshot"]) {
    console.log(`Base snapshot: ${values["base-snapshot"]}`);
  }

  // Run snapshots
  const results: RunResult[] = [];

  for (const providerName of availableProviders) {
    try {
      const capabilities = PROVIDER_CAPABILITIES[providerName];
      let snapshotId: string;
      let strategy: SnapshotStrategy;

      if (isDockerfileProvider(providerName)) {
        // =====================================================================
        // Dockerfile Strategy (Daytona/E2B/Blaxel)
        // Build Docker images from provisioning commands
        // =====================================================================
        printHeader(`Building ${providerName} snapshot (dockerfile strategy)`);

        // Build the cmux-acp-server + cmux-pty binaries for linux-x86_64
        const acpServerBinaryPath = buildAcpServerBinary();
        const ptyServerBinaryPath = buildPtyServerBinary();

        const builder = await getBuilder(providerName);
        const commands = getProvisioningCommands();
        const bootScript = generateBootScript();

        // Use timestamp-based name to avoid conflicts with failed builds
        // Once working, we can switch to fixed names with proper deletion
        const timestamp = Date.now();
        const snapshotName = `cmux-acp-${preset}-${timestamp}`;

        const result = await builder.build({
          commands,
          name: snapshotName,
          bootScript,
          acpServerBinaryPath,
          ptyServerBinaryPath,
          log: (message) => {
            if (verbose) {
              console.log(message);
            }
          },
        });

        snapshotId = result.snapshotId;
        strategy = "dockerfile";

        console.log(`\nSnapshot built: ${snapshotId}`);
        if (result.dockerfile) {
          console.log(`Dockerfile: ${result.dockerfile.split("\n").length} lines`);
        }
      } else {
        // =====================================================================
        // Runtime Strategy (Morph/Freestyle)
        // Provision VM and capture RAM snapshot
        // =====================================================================
        const provider = getProvider(providerName);

        const result = await createProvisionedSnapshot(
          provider,
          preset,
          values["base-snapshot"],
          async (vm) => {
            const ptyServerBinaryPath = buildPtyServerBinary();
            // Upload source code for building cmux-acp-server
            await uploadSourceCode(vm);
            if (ptyServerBinaryPath && vm.uploadFile) {
              console.log("Uploading cmux-pty binary to VM...");
              await vm.uploadFile(
                ptyServerBinaryPath,
                "/tmp/cmux-build/sandbox/cmux-pty"
              );
              await vm.exec("chmod +x /tmp/cmux-build/sandbox/cmux-pty");
            } else {
              console.warn(
                "Warning: VM does not support file upload for cmux-pty; will attempt build from source."
              );
            }

            // Create provisioning context and run task graph
            const ctx = createProvisioningContext(vm, { verbose });
            printHeader(`Running provisioning tasks (${registry.taskNames.length} tasks)`);

            const taskResult = await runTaskGraph(registry, ctx);

            if (!taskResult.success) {
              console.error("\nProvisioning failed!");
              console.error(`Failed tasks: ${taskResult.failedTasks.join(", ")}`);
              throw new Error(`Provisioning failed: ${taskResult.failedTasks.join(", ")}`);
            }

            console.log(`\nProvisioning completed in ${(taskResult.totalDurationMs / 1000).toFixed(2)}s`);

            const publicUrl = ctx.outputs.get("acpPublicUrl");
            if (!publicUrl) {
              throw new Error("Public URL not captured during provisioning");
            }
            await verifyPublicHttpAccess(publicUrl);
          }
        );

        snapshotId = result.snapshotId;
        strategy = "runtime";
      }

      // Update manifest with strategy info
      updateSnapshotId(providerName, preset, snapshotId, preset, strategy);

      results.push({
        provider: providerName,
        preset,
        snapshotId,
      });
    } catch (error) {
      console.error(`\nFailed to create snapshot for ${providerName}:`, error);
    }
  }

  // Print summary
  printSummary(results);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
