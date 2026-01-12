#!/usr/bin/env bun
/**
 * Unified ACP Sandbox Snapshot Script
 *
 * Creates snapshots for Morph and/or Freestyle providers.
 * Snapshots are saved to packages/shared/src/sandbox-snapshots.json
 *
 * Usage:
 *   bun run scripts/snapshot-acp/index.ts                    # Both providers
 *   bun run scripts/snapshot-acp/index.ts --provider morph   # Morph only
 *   bun run scripts/snapshot-acp/index.ts --provider freestyle # Freestyle only
 *   bun run scripts/snapshot-acp/index.ts --preset standard  # Specific preset
 *   bun run scripts/snapshot-acp/index.ts --base-snapshot snap_xxx
 *
 * Environment:
 *   MORPH_API_KEY      - Required for Morph provider
 *   FREESTYLE_API_KEY  - Required for Freestyle provider
 */

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
} from "./providers";

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
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
ACP Sandbox Snapshot Script

Usage:
  bun run scripts/snapshot-acp/index.ts [options]

Options:
  --provider, -p <name>     Provider to use: morph, freestyle, or both (default: both)
  --preset, -s <name>       Preset to create: standard (default: standard)
  --base-snapshot, -b <id>  Base snapshot ID to start from
  --help, -h                Show this help message

Examples:
  bun run scripts/snapshot-acp/index.ts
  bun run scripts/snapshot-acp/index.ts --provider freestyle
  bun run scripts/snapshot-acp/index.ts --provider morph --preset standard
  bun run scripts/snapshot-acp/index.ts --base-snapshot snap_xxx

Environment Variables:
  MORPH_API_KEY       Required for Morph provider
  FREESTYLE_API_KEY   Required for Freestyle provider
`);
    process.exit(0);
  }

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
        values["base-snapshot"]
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
