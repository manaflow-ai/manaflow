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

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import {
  updateSnapshotId,
  printHeader,
  printSummary,
  type ProviderName,
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

/**
 * Get the source directory path for cmux-acp-server.
 */
function getSourceDir(): string {
  return path.resolve(import.meta.dirname, "../..");
}

/**
 * Upload the source code to the VM.
 * Uses SDK file sync when available (respects .gitignore to exclude target/, node_modules/, .git/).
 * Falls back to SSH file upload, then base64 chunked upload.
 */
async function uploadSourceCode(vm: VmHandle): Promise<void> {
  console.log("Uploading source code to VM...");

  const sourceDir = getSourceDir();

  if (vm.syncFiles) {
    // Use provider's native file sync (Morph uses rsync with respectGitignore)
    await vm.syncFiles(sourceDir, "/tmp/cmux-build/sandbox");
    console.log("Source code synced via SDK");
  } else {
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
  --provider, -p <name>     Provider to use: morph, freestyle, or both (default: both)
  --preset, -s <name>       Preset to create: standard (default: standard)
  --base-snapshot, -b <id>  Base snapshot ID to start from
  --verbose, -v             Show verbose output (default: quiet, logs on failure only)
  --show-graph, -g          Show task dependency graph and exit
  --help, -h                Show this help message

Examples:
  bun run scripts/snapshot/snapshot.ts
  bun run scripts/snapshot/snapshot.ts --provider freestyle
  bun run scripts/snapshot/snapshot.ts --provider morph --preset standard
  bun run scripts/snapshot/snapshot.ts --base-snapshot snap_xxx
  bun run scripts/snapshot/snapshot.ts --show-graph
  bun run scripts/snapshot/snapshot.ts --verbose

Environment Variables:
  MORPH_API_KEY       Required for Morph provider
  FREESTYLE_API_KEY   Required for Freestyle provider
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

  if (providerArg === "both" || !providerArg) {
    providers = ["morph", "freestyle"];
  } else if (providerArg === "morph" || providerArg === "freestyle") {
    providers = [providerArg];
  } else {
    console.error(`Invalid provider: ${providerArg}`);
    console.error("Valid providers: morph, freestyle, both");
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
    availableProviders.push(p);
  }

  if (availableProviders.length === 0) {
    console.error("Error: No providers available. Set MORPH_API_KEY or FREESTYLE_API_KEY.");
    process.exit(1);
  }

  // Print configuration
  printHeader("ACP Sandbox Snapshot");
  console.log(`Providers: ${availableProviders.join(", ")}`);
  console.log(`Preset: ${preset}`);
  console.log(`Tasks: ${registry.taskNames.length}`);
  if (values["base-snapshot"]) {
    console.log(`Base snapshot: ${values["base-snapshot"]}`);
  }

  // Run snapshots
  const results: RunResult[] = [];

  for (const providerName of availableProviders) {
    try {
      const provider = getProvider(providerName);

      const { snapshotId } = await createProvisionedSnapshot(
        provider,
        preset,
        values["base-snapshot"],
        async (vm) => {
          // Upload source code for building cmux-acp-server
          await uploadSourceCode(vm);

          // Create provisioning context and run task graph
          const ctx = createProvisioningContext(vm, { verbose });
          printHeader(`Running provisioning tasks (${registry.taskNames.length} tasks)`);

          const result = await runTaskGraph(registry, ctx);

          if (!result.success) {
            console.error("\nProvisioning failed!");
            console.error(`Failed tasks: ${result.failedTasks.join(", ")}`);
            throw new Error(`Provisioning failed: ${result.failedTasks.join(", ")}`);
          }

          console.log(`\nProvisioning completed in ${(result.totalDurationMs / 1000).toFixed(2)}s`);
        }
      );

      // Update manifest
      updateSnapshotId(providerName, preset, snapshotId, preset);

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
