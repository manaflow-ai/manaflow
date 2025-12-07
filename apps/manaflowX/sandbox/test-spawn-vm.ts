/**
 * Test script to spawn a coding VM for debugging.
 * The VM will NOT be cleaned up automatically so you can poke around.
 *
 * Usage: bun sandbox/test-spawn-vm.ts
 */

import { MorphCloudClient } from "morphcloud";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load VM snapshot configuration
function loadVmSnapshots() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const snapshotsPath = join(__dirname, "vm-snapshots.json");
  return JSON.parse(readFileSync(snapshotsPath, "utf-8"));
}

// Get the latest snapshot ID
function getLatestSnapshotId(): string {
  const snapshotsData = loadVmSnapshots();
  const preset = snapshotsData.presets[0];
  const latestVersion = preset.versions[preset.versions.length - 1];
  console.log(`Using snapshot version ${latestVersion.version}: ${latestVersion.snapshotId}`);
  return latestVersion.snapshotId;
}

async function main() {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY environment variable is required");
  }

  const client = new MorphCloudClient({ apiKey });
  const snapshotId = getLatestSnapshotId();

  console.log(`\n🚀 Starting VM from snapshot: ${snapshotId}`);
  const instance = await client.instances.start({ snapshotId });

  console.log(`\n✅ Instance created!`);
  console.log(`   ID: ${instance.id}`);
  console.log(`   Status: ${instance.status}`);

  console.log(`\n⏳ Waiting for instance to be ready...`);
  await instance.waitUntilReady(60);

  console.log(`\n📡 HTTP Services:`);
  for (const svc of instance.networking.httpServices) {
    console.log(`   ${svc.name}: ${svc.url}`);
  }

  const opencodeService = instance.networking.httpServices.find(
    (s) => s.name === "port-4096"
  );

  console.log(`\n🔗 OpenCode URL: ${opencodeService?.url || "NOT FOUND"}`);

  console.log(`\n📋 To connect via SSH or exec:`);
  console.log(`   uvx --env-file .env morphcloud instance exec ${instance.id} "bash"`);
  console.log(`   uvx --env-file .env morphcloud instance ssh ${instance.id}`);

  console.log(`\n📋 To check plugin and config:`);
  console.log(`   uvx --env-file .env morphcloud instance exec ${instance.id} "cat /root/workspace/.opencode/plugin/convex-sync.ts"`);
  console.log(`   uvx --env-file .env morphcloud instance exec ${instance.id} "cat /root/workspace/opencode.json"`);
  console.log(`   uvx --env-file .env morphcloud instance exec ${instance.id} "ls -la /root/.xagi/"`);

  console.log(`\n📋 To stop the VM when done:`);
  console.log(`   uvx --env-file .env morphcloud instance stop ${instance.id}`);

  console.log(`\n⚠️  VM will NOT be automatically cleaned up!`);
}

main().catch(console.error);
