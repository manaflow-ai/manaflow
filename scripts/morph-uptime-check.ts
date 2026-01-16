#!/usr/bin/env bun
/**
 * Quick Morph uptime/health check script
 * Tests if we can start a sandbox and run a command
 *
 * Usage: bun scripts/morph-uptime-check.ts
 */
import { MorphCloudClient } from "morphcloud";

const DEFAULT_SNAPSHOT = "snapshot_vb7uqz8o";

async function main() {
  const startTime = Date.now();
  let instance: Awaited<ReturnType<typeof client.instances.start>> | null = null;

  console.log("=== Morph Uptime Check ===\n");

  const client = new MorphCloudClient();

  try {
    // Step 1: Start instance
    console.log(`[1/4] Starting instance from ${DEFAULT_SNAPSHOT}...`);
    const step1Start = Date.now();
    instance = await client.instances.start({
      snapshotId: DEFAULT_SNAPSHOT,
      ttlSeconds: 60, // 1 minute TTL
      ttlAction: "stop",
      metadata: { app: "uptime-check" },
    });
    console.log(`      Instance ID: ${instance.id}`);
    console.log(`      Took: ${Date.now() - step1Start}ms`);

    // Step 2: Wait for ready
    console.log("\n[2/4] Waiting for instance to be ready...");
    const step2Start = Date.now();
    await instance.waitUntilReady();
    console.log(`      Took: ${Date.now() - step2Start}ms`);

    // Step 3: Run health check command (with 2 minute timeout)
    console.log("\n[3/4] Running health check command...");
    const step3Start = Date.now();
    const execTimeout = 120_000; // 2 minutes
    const result = await Promise.race([
      instance.exec("echo 'OK' && uname -a"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Exec timed out after ${execTimeout / 1000}s`)), execTimeout)
      ),
    ]);
    console.log(`      Output: ${result.stdout.trim()}`);
    console.log(`      Exit code: ${result.exit_code}`);
    console.log(`      Took: ${Date.now() - step3Start}ms`);

    // Step 4: Stop instance
    console.log("\n[4/4] Stopping instance...");
    const step4Start = Date.now();
    await instance.stop();
    console.log(`      Took: ${Date.now() - step4Start}ms`);

    const totalTime = Date.now() - startTime;
    console.log("\n=== RESULTS ===");
    console.log(`Status: OK`);
    console.log(`Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    process.exit(0);
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error("\n=== FAILED ===");
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Time before failure: ${totalTime}ms`);
    console.error(`Timestamp: ${new Date().toISOString()}`);

    // Try to clean up
    if (instance) {
      try {
        console.log("\nAttempting cleanup...");
        await instance.stop();
        console.log("Cleanup successful");
      } catch (cleanupError) {
        console.error("Cleanup failed:", cleanupError);
      }
    }

    process.exit(1);
  }
}

main();
