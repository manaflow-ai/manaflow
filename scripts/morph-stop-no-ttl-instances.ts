#!/usr/bin/env bun

import "dotenv/config";

import process from "node:process";
import { MorphCloudClient, InstanceStatus } from "morphcloud";

const DRY_RUN = !process.argv.includes("--execute");
const INCLUDE_PAUSED = process.argv.includes("--include-paused");

// Known snapshot IDs from morph-snapshots.json
const KNOWN_SNAPSHOTS: Record<string, { preset: string; version: number }> = {
  snapshot_f1qfq204: { preset: "6vcpu_24gb_48gb", version: 1 },
  snapshot_2s1vpc1x: { preset: "6vcpu_24gb_48gb", version: 2 },
  snapshot_p8c2is5y: { preset: "6vcpu_24gb_48gb", version: 3 },
  snapshot_ip3ziorm: { preset: "6vcpu_24gb_48gb", version: 4 },
  snapshot_36q6ly8o: { preset: "6vcpu_24gb_48gb", version: 5 },
  snapshot_x6k3uoe1: { preset: "6vcpu_24gb_48gb", version: 6 },
  snapshot_rm13m5gn: { preset: "6vcpu_24gb_48gb", version: 7 },
  snapshot_81pisgoq: { preset: "6vcpu_24gb_48gb", version: 8 },
  snapshot_i8lkfcbd: { preset: "6vcpu_24gb_48gb", version: 9 },
  snapshot_ir8cm10x: { preset: "6vcpu_24gb_48gb", version: 10 },
  snapshot_fksv49c4: { preset: "6vcpu_24gb_48gb", version: 11 },
  snapshot_7oriz0qz: { preset: "6vcpu_24gb_48gb", version: 12 },
  snapshot_35qul1z6: { preset: "6vcpu_24gb_48gb", version: 13 },
  snapshot_j0hq7uu9: { preset: "6vcpu_24gb_48gb", version: 14 },
  snapshot_2djobhi4: { preset: "6vcpu_24gb_48gb", version: 15 },
  snapshot_xej6x1dm: { preset: "6vcpu_24gb_48gb", version: 16 },
  snapshot_ghm6uygf: { preset: "6vcpu_24gb_48gb", version: 17 },
  snapshot_4vgf5whr: { preset: "6vcpu_24gb_48gb", version: 18 },
  snapshot_7bhlpv1h: { preset: "6vcpu_24gb_48gb", version: 19 },
  snapshot_e6iw3gz7: { preset: "6vcpu_24gb_48gb", version: 20 },
  snapshot_c0rwb7ha: { preset: "6vcpu_24gb_48gb", version: 21 },
};

function formatRelativeTime(timestampSeconds: number): string {
  const diffMs = Date.now() - timestampSeconds * 1000;
  const diffSeconds = Math.max(Math.floor(diffMs / 1000), 0);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

async function main(): Promise<void> {
  const key = process.env.MORPH_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing required environment variable: MORPH_API_KEY");
  }

  console.log("Fetching Morph instances...");
  const morphClient = new MorphCloudClient();
  const allInstances = await morphClient.instances.list();

  // Find instances without ttlSeconds set (null or undefined)
  const noTtlInstances = allInstances.filter((instance) => {
    const ttlSeconds = instance.ttl?.ttlSeconds;
    return ttlSeconds === null || ttlSeconds === undefined;
  });

  // Categorize instances by status
  const activeNoTtl = noTtlInstances.filter(
    (instance) =>
      instance.status === InstanceStatus.READY ||
      instance.status === InstanceStatus.PENDING
  );

  const pausedNoTtl = noTtlInstances.filter(
    (instance) => instance.status === InstanceStatus.PAUSED
  );

  console.log(`\nFound ${noTtlInstances.length} instances without ttlSeconds:`);
  console.log(`  - ${activeNoTtl.length} active (ready/pending)`);
  console.log(`  - ${pausedNoTtl.length} paused`);

  // Determine which instances to stop
  const instancesToStop = INCLUDE_PAUSED
    ? [...activeNoTtl, ...pausedNoTtl]
    : activeNoTtl;

  if (instancesToStop.length === 0) {
    console.log("\nNo instances to stop.");
    if (!INCLUDE_PAUSED && pausedNoTtl.length > 0) {
      console.log(`\nTo also stop the ${pausedNoTtl.length} paused instances, add --include-paused`);
    }
    return;
  }

  // Sort by creation time, oldest first
  const sortedInstances = [...instancesToStop].sort((a, b) => a.created - b.created);

  console.log("\n" + "=".repeat(100));
  console.log("INSTANCES TO STOP:");
  console.log("=".repeat(100));

  for (const instance of sortedInstances) {
    const createdIso = new Date(instance.created * 1000).toISOString();
    const createdRel = formatRelativeTime(instance.created);
    const ttlAction = instance.ttl?.ttlAction ?? "none";
    const snapshotId = instance.refs?.snapshotId ?? "unknown";
    const vcpus = instance.spec?.vcpus ?? "?";
    const memoryMb = instance.spec?.memory ?? 0;
    const memoryGb = memoryMb ? `${(memoryMb / 1024).toFixed(0)}GB` : "?";
    const diskMb = instance.spec?.diskSize ?? 0;
    const diskGb = diskMb ? `${(diskMb / 1024).toFixed(0)}GB` : "?";

    const knownSnapshot = KNOWN_SNAPSHOTS[snapshotId];
    const snapshotLabel = knownSnapshot
      ? `${snapshotId} (v${knownSnapshot.version})`
      : snapshotId;

    const status = instance.status;
    console.log(
      `${instance.id} | ${status.padEnd(6)} | ${vcpus}vcpu/${memoryGb}/${diskGb} | snapshot=${snapshotLabel} | ttlAction=${ttlAction} | created=${createdRel}`
    );
  }

  // Show snapshot summary
  const snapshotCounts = new Map<string, number>();
  for (const instance of sortedInstances) {
    const snapshotId = instance.refs?.snapshotId ?? "unknown";
    snapshotCounts.set(snapshotId, (snapshotCounts.get(snapshotId) ?? 0) + 1);
  }

  console.log("\nSnapshot summary:");
  const sortedSnapshots = [...snapshotCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [snapshotId, count] of sortedSnapshots) {
    const known = KNOWN_SNAPSHOTS[snapshotId];
    const label = known ? `v${known.version} (${known.preset})` : "UNKNOWN";
    console.log(`  ${snapshotId}: ${count} instances - ${label}`);
  }

  console.log("\n" + "=".repeat(100));

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN MODE - No instances were stopped.");
    console.log(`\nTo actually stop these ${sortedInstances.length} instances, run:`);
    const executeCmd = INCLUDE_PAUSED
      ? "  bun scripts/morph-stop-no-ttl-instances.ts --execute --include-paused"
      : "  bun scripts/morph-stop-no-ttl-instances.ts --execute";
    console.log(executeCmd);
    console.log("\nOr stop individually with:");
    for (const instance of sortedInstances.slice(0, 5)) {
      console.log(`  uvx morphcloud instance stop ${instance.id}`);
    }
    if (sortedInstances.length > 5) {
      console.log(`  ... and ${sortedInstances.length - 5} more`);
    }
  } else {
    console.log(`\n🛑 STOPPING ${sortedInstances.length} instances...`);

    let stopped = 0;
    let failed = 0;

    for (const instance of sortedInstances) {
      try {
        await instance.stop();
        stopped++;
        console.log(`  ✓ Stopped ${instance.id}`);
      } catch (error) {
        failed++;
        console.error(`  ✗ Failed to stop ${instance.id}:`, error instanceof Error ? error.message : error);
      }
    }

    console.log(`\nDone. Stopped: ${stopped}, Failed: ${failed}`);
  }
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exitCode = 1;
});
