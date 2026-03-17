#!/usr/bin/env bun
/**
 * Quick Morph uptime/health check script
 * Tests if we can start a sandbox from the current snapshots in morph-snapshots.json
 *
 * Usage: bun scripts/morph-uptime-check.ts
 */
import { MorphCloudClient } from "morphcloud";
import morphSnapshots from "../packages/shared/src/morph-snapshots.json";

interface SnapshotVersion {
  version: number;
  snapshotId: string;
  capturedAt: string;
}

interface Preset {
  presetId: string;
  label: string;
  cpu: string;
  memory: string;
  disk: string;
  versions: SnapshotVersion[];
  description: string;
}

function getLatestSnapshot(preset: Preset): SnapshotVersion {
  const sorted = [...preset.versions].sort((a, b) => b.version - a.version);
  const latest = sorted[0];
  if (!latest) {
    throw new Error(`No versions found for preset ${preset.presetId}`);
  }
  return latest;
}

async function testSnapshot(
  client: MorphCloudClient,
  preset: Preset,
  snapshot: SnapshotVersion
): Promise<{ success: boolean; error?: string; timings: Record<string, number> }> {
  let instance: Awaited<ReturnType<typeof client.instances.start>> | null = null;
  const timings: Record<string, number> = {};

  try {
    // Step 1: Start instance
    const step1Start = Date.now();
    instance = await client.instances.start({
      snapshotId: snapshot.snapshotId,
      ttlSeconds: 60, // 1 minute TTL
      ttlAction: "stop",
      metadata: { app: "uptime-check", preset: preset.presetId },
    });
    timings["start"] = Date.now() - step1Start;

    // Step 2: Wait for ready
    const step2Start = Date.now();
    await instance.waitUntilReady();
    // Give networking a moment to settle
    await new Promise((resolve) => setTimeout(resolve, 2000));
    timings["ready"] = Date.now() - step2Start;

    // Step 3: Run health check command (with retries)
    const step3Start = Date.now();
    const maxRetries = 5;
    const retryDelayMs = 3000;
    let lastError: Error | null = null;
    let result: Awaited<ReturnType<typeof instance.exec>> | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const execTimeout = 30_000; // 30 seconds per attempt
        result = await Promise.race([
          instance.exec("echo 'OK' && uname -a"),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Exec timed out after ${execTimeout / 1000}s`)), execTimeout)
          ),
        ]);
        if (result.exit_code === 0) {
          break; // Success
        }
        lastError = new Error(`Exit code ${result.exit_code}: ${result.stderr}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          console.log(`    Retry ${attempt}/${maxRetries} after error: ${lastError.message.split('\n')[0]}`);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }
    }
    timings["exec"] = Date.now() - step3Start;

    if (!result || result.exit_code !== 0) {
      throw lastError ?? new Error("Health check failed after all retries");
    }

    // Step 4: Stop instance
    const step4Start = Date.now();
    await instance.stop();
    timings["stop"] = Date.now() - step4Start;

    return { success: true, timings };
  } catch (error) {
    // Try to clean up
    if (instance) {
      try {
        await instance.stop();
      } catch (cleanupError) {
        console.error(`      Cleanup failed for ${preset.presetId}:`, cleanupError);
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timings,
    };
  }
}

async function main() {
  const startTime = Date.now();
  const client = new MorphCloudClient();

  console.log("=== Morph Uptime Check ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Schema version: ${morphSnapshots.schemaVersion}`);
  console.log(`Last updated: ${morphSnapshots.updatedAt}\n`);

  const results: Array<{
    preset: string;
    snapshotId: string;
    version: number;
    success: boolean;
    error?: string;
    timings: Record<string, number>;
  }> = [];

  // Test only the main presets (4vcpu and 8vcpu - those actively used)
  const presetsToTest = morphSnapshots.presets.filter(
    (p) => p.presetId === "4vcpu_16gb_48gb" || p.presetId === "8vcpu_32gb_48gb"
  );

  for (const preset of presetsToTest) {
    const latest = getLatestSnapshot(preset as Preset);
    console.log(`Testing ${preset.presetId} (v${latest.version}): ${latest.snapshotId}`);
    console.log(`  Captured: ${latest.capturedAt}`);

    const result = await testSnapshot(client, preset as Preset, latest);

    if (result.success) {
      const total = Object.values(result.timings).reduce((a, b) => a + b, 0);
      console.log(`  ✓ OK (${total}ms total)`);
      console.log(`    Start: ${result.timings["start"]}ms, Ready: ${result.timings["ready"]}ms, Exec: ${result.timings["exec"]}ms, Stop: ${result.timings["stop"]}ms`);
    } else {
      console.log(`  ✗ FAILED: ${result.error}`);
    }
    console.log();

    results.push({
      preset: preset.presetId,
      snapshotId: latest.snapshotId,
      version: latest.version,
      ...result,
    });
  }

  const totalTime = Date.now() - startTime;
  const allPassed = results.every((r) => r.success);

  console.log("=== SUMMARY ===");
  console.log(`Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
  console.log(`Presets tested: ${results.length}`);
  console.log(`Passed: ${results.filter((r) => r.success).length}`);
  console.log(`Failed: ${results.filter((r) => !r.success).length}`);

  if (!allPassed) {
    console.log("\nFailed presets:");
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  - ${r.preset} (${r.snapshotId}): ${r.error}`);
    }
  }

  console.log(`\nStatus: ${allPassed ? "ALL OK" : "SOME FAILED"}`);
  process.exit(allPassed ? 0 : 1);
}

main();
