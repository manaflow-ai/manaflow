#!/usr/bin/env bun
/**
 * Freestyle CLI - Spawn VMs from snapshots
 *
 * Usage:
 *   bun run freestyle fork [--snapshot <id>] [--timeout <seconds>]
 *   bun run freestyle list
 */

import { createFreestyleClient, createVm } from "@cmux/freestyle-openapi-client";
import {
  FREESTYLE_SNAPSHOT_PRESETS,
  DEFAULT_FREESTYLE_SNAPSHOT_ID,
  DEFAULT_FREESTYLE_PRESET,
} from "@cmux/shared/vm-snapshots";

const FREESTYLE_API_KEY = process.env.FREESTYLE_API_KEY;

if (!FREESTYLE_API_KEY) {
  console.error("FREESTYLE_API_KEY is required");
  process.exit(1);
}

const client = createFreestyleClient({
  headers: {
    Authorization: `Bearer ${FREESTYLE_API_KEY}`,
  },
});

async function listSnapshots() {
  console.log("Freestyle Snapshots:\n");
  for (const preset of FREESTYLE_SNAPSHOT_PRESETS) {
    console.log(`${preset.label} (${preset.presetId}):`);
    for (const version of preset.versions) {
      const isLatest = version.snapshotId === preset.id;
      console.log(`  v${version.version}: ${version.snapshotId} (${version.capturedAt})${isLatest ? " [latest]" : ""}`);
    }
    console.log();
  }
}

async function createFromSnapshot(snapshotId: string, timeoutSeconds?: number) {
  console.log(`Creating VM from snapshot: ${snapshotId}`);

  const result = await createVm({
    client,
    body: {
      snapshotId,
      idleTimeoutSeconds: timeoutSeconds ?? 300, // 5 minutes default
      waitForReadySignal: true,
      readySignalTimeoutSeconds: 120,
    },
  });

  if (result.error) {
    console.error("Create VM failed:", result.error);
    process.exit(1);
  }

  const vm = result.data;
  if (!vm) {
    console.error("No data in response");
    process.exit(1);
  }

  console.log("\nVM created successfully!");
  console.log(`  ID: ${vm.id}`);
  console.log(`  Domains: ${vm.domains.join(", ")}`);
  if (vm.consoleUrl) {
    console.log(`  Console: ${vm.consoleUrl}`);
  }

  return vm;
}

// CLI
const command = process.argv[2];

switch (command) {
  case "fork": {
    const snapshotArg = process.argv.indexOf("--snapshot");
    const timeoutArg = process.argv.indexOf("--timeout");

    let snapshotId: string;
    if (snapshotArg !== -1 && process.argv[snapshotArg + 1]) {
      snapshotId = process.argv[snapshotArg + 1];
    } else {
      snapshotId = DEFAULT_FREESTYLE_SNAPSHOT_ID;
      const latestVersion = DEFAULT_FREESTYLE_PRESET?.latestVersion;
      console.log(`Using latest snapshot: v${latestVersion?.version} (${snapshotId})`);
    }

    let timeout: number | undefined;
    if (timeoutArg !== -1 && process.argv[timeoutArg + 1]) {
      timeout = parseInt(process.argv[timeoutArg + 1], 10);
    }

    await createFromSnapshot(snapshotId, timeout);
    break;
  }

  case "list-snapshots":
  case "list":
    await listSnapshots();
    break;

  default:
    console.log(`Freestyle CLI

Usage:
  bun run freestyle fork [--snapshot <id>] [--timeout <seconds>]
  bun run freestyle list

Commands:
  fork   Fork a new VM from a snapshot (default: latest)
  list   List available freestyle snapshots

Options:
  --snapshot <id>    Snapshot ID to fork from (default: ${DEFAULT_FREESTYLE_SNAPSHOT_ID})
  --timeout <sec>    Idle timeout in seconds (default: 300)

Environment:
  FREESTYLE_API_KEY  Required. Your Freestyle API key.
`);
    break;
}
