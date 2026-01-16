#!/usr/bin/env bun

import "dotenv/config";

import process from "node:process";
import { MorphCloudClient, InstanceStatus } from "morphcloud";

const DRY_RUN = !process.argv.includes("--execute");
const MAX_AGE_DAYS = parseInt(process.argv.find(arg => arg.startsWith("--days="))?.split("=")[1] ?? "14", 10);

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

  const cutoffMs = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const cutoffSeconds = Math.floor(cutoffMs / 1000);

  console.log(`Fetching Morph instances...`);
  console.log(`Looking for instances older than ${MAX_AGE_DAYS} days (created before ${new Date(cutoffMs).toISOString()})\n`);

  const morphClient = new MorphCloudClient();
  const allInstances = await morphClient.instances.list();

  // Find instances older than the cutoff
  const oldInstances = allInstances.filter((instance) => instance.created < cutoffSeconds);

  // Categorize by status
  const activeOld = oldInstances.filter(
    (instance) =>
      instance.status === InstanceStatus.READY ||
      instance.status === InstanceStatus.PENDING
  );

  const pausedOld = oldInstances.filter(
    (instance) => instance.status === InstanceStatus.PAUSED
  );

  console.log(`Found ${oldInstances.length} instances older than ${MAX_AGE_DAYS} days:`);
  console.log(`  - ${activeOld.length} active (ready/pending)`);
  console.log(`  - ${pausedOld.length} paused`);

  // Target all non-stopped instances
  const instancesToStop = [...activeOld, ...pausedOld];

  if (instancesToStop.length === 0) {
    console.log("\nNo instances to stop.");
    return;
  }

  // Sort by creation time, oldest first
  const sortedInstances = [...instancesToStop].sort((a, b) => a.created - b.created);

  console.log("\n" + "=".repeat(100));
  console.log(`INSTANCES TO STOP (${sortedInstances.length}):`);
  console.log("=".repeat(100));

  for (const instance of sortedInstances) {
    const createdRel = formatRelativeTime(instance.created);
    const status = instance.status;
    const snapshotId = instance.refs?.snapshotId ?? "unknown";
    const vcpus = instance.spec?.vcpus ?? "?";
    const memoryMb = instance.spec?.memory ?? 0;
    const memoryGb = memoryMb ? `${(memoryMb / 1024).toFixed(0)}GB` : "?";
    const diskMb = instance.spec?.diskSize ?? 0;
    const diskGb = diskMb ? `${(diskMb / 1024).toFixed(0)}GB` : "?";

    console.log(
      `${instance.id} | ${status.padEnd(6)} | ${vcpus}vcpu/${memoryGb}/${diskGb} | snapshot=${snapshotId} | created=${createdRel}`
    );
  }

  // Show status summary
  console.log("\nStatus summary:");
  console.log(`  Active: ${activeOld.length}`);
  console.log(`  Paused: ${pausedOld.length}`);

  console.log("\n" + "=".repeat(100));

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN MODE - No instances were stopped.");
    console.log(`\nTo actually stop these ${sortedInstances.length} instances, run:`);
    console.log(`  bun scripts/morph-stop-old-instances.ts --execute --days=${MAX_AGE_DAYS}`);
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
