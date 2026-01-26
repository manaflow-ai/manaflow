#!/usr/bin/env bun
/**
 * Provider Verification Script
 *
 * Spawns sandboxes from each provider, verifies health endpoints work,
 * and measures startup times.
 *
 * Usage:
 *   bun run scripts/snapshot/verify-providers.ts
 *   bun run scripts/snapshot/verify-providers.ts --provider morph
 *   bun run scripts/snapshot/verify-providers.ts --runs 3
 */

import { parseArgs } from "node:util";
import { Daytona } from "@daytonaio/sdk";
import { Sandbox as E2BSandbox } from "e2b";
import { SandboxInstance } from "@blaxel/core";
import { MorphCloudClient } from "morphcloud";
import { loadManifest, printHeader, type ProviderName } from "./utils";

interface VerificationResult {
  provider: ProviderName;
  success: boolean;
  url: string;
  healthStatus: "ok" | "failed" | "timeout";
  startupMs: number;
  error?: string;
}

interface AggregatedResult {
  provider: ProviderName;
  runs: number;
  successCount: number;
  avgStartupMs: number;
  minStartupMs: number;
  maxStartupMs: number;
  urls: string[];
  errors: string[];
}

/**
 * Fetch with timeout.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Wait for health endpoint and return time taken.
 */
async function waitForHealth(
  url: string,
  maxWaitMs: number = 60000
): Promise<{ ok: boolean; timeMs: number; response?: string }> {
  const healthUrl = `${url}/health`;
  const start = performance.now();
  const checkIntervalMs = 1000;

  while (performance.now() - start < maxWaitMs) {
    try {
      const response = await fetchWithTimeout(healthUrl, 5000);
      const body = await response.text();
      if (response.ok && body.includes('"status":"ok"')) {
        return { ok: true, timeMs: performance.now() - start, response: body };
      }
    } catch {
      // Keep trying
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }

  return { ok: false, timeMs: performance.now() - start };
}

/**
 * Verify Morph provider.
 */
async function verifyMorph(snapshotId: string): Promise<VerificationResult> {
  const startTime = performance.now();
  let instanceId: string | null = null;

  try {
    const client = new MorphCloudClient({ apiKey: process.env.MORPH_API_KEY! });

    console.log(`  [morph] Starting instance from snapshot: ${snapshotId}`);
    const instance = await client.instances.start({
      snapshotId,
      ttlSeconds: 300,
      ttlAction: "stop",
    });
    instanceId = instance.id;
    await instance.waitUntilReady();

    const spawnTime = performance.now() - startTime;
    console.log(`  [morph] Instance ready in ${(spawnTime / 1000).toFixed(2)}s: ${instanceId}`);

    // Check if service is already exposed from snapshot
    let url: string | undefined;

    // First refresh to get current state
    await instance.refresh();
    const existingService = instance.networking.httpServices?.find(
      (s: { name: string; port: number; url: string }) => s.name === "acp" || s.port === 39384
    );

    if (existingService?.url) {
      url = existingService.url;
      console.log(`  [morph] Found existing HTTP service: ${url}`);
    } else {
      // Service not exposed, try to expose it
      try {
        const service = await instance.exposeHttpService("acp", 39384);
        url = service.url;
        console.log(`  [morph] Exposed new HTTP service: ${url}`);
      } catch (exposeError) {
        const errorMsg = exposeError instanceof Error ? exposeError.message : JSON.stringify(exposeError);
        throw new Error(`Failed to expose HTTP service: ${errorMsg}`);
      }
    }

    console.log(`  [morph] URL: ${url}`);

    // Wait for health
    const health = await waitForHealth(url);
    const totalTime = performance.now() - startTime;

    // Cleanup
    await client.instances.stop({ instanceId });
    console.log(`  [morph] Cleaned up instance`);

    return {
      provider: "morph",
      success: health.ok,
      url,
      healthStatus: health.ok ? "ok" : "timeout",
      startupMs: totalTime,
    };
  } catch (error) {
    // Cleanup on error
    if (instanceId) {
      try {
        const client = new MorphCloudClient({ apiKey: process.env.MORPH_API_KEY! });
        await client.instances.stop({ instanceId });
      } catch {
        // Ignore cleanup errors
      }
    }
    const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      provider: "morph",
      success: false,
      url: "",
      healthStatus: "failed",
      startupMs: performance.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Verify Daytona provider.
 */
async function verifyDaytona(): Promise<VerificationResult> {
  const startTime = performance.now();
  let sandbox: Awaited<ReturnType<Daytona["create"]>> | null = null;

  try {
    const client = new Daytona({
      apiKey: process.env.DAYTONA_API_KEY!,
      target: process.env.DAYTONA_TARGET || "us",
    });

    console.log(`  [daytona] Creating sandbox...`);
    sandbox = await client.create(
      {
        autoStopInterval: 5,
        autoDeleteInterval: 10,
      },
      { timeout: 120 }
    );

    const spawnTime = performance.now() - startTime;
    console.log(`  [daytona] Sandbox ready in ${(spawnTime / 1000).toFixed(2)}s: ${sandbox.id}`);

    // Start a simple HTTP server using nc (netcat) - same approach as E2E tests
    await sandbox.process.executeCommand(
      'nohup sh -c \'while true; do echo -e "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n{\\"status\\":\\"ok\\"}" | nc -l -p 8080 -q 1; done\' > /dev/null 2>&1 &'
    );

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get preview URL
    const preview = await sandbox.getPreviewLink(8080);
    const url = preview.url;
    console.log(`  [daytona] URL: ${url}`);

    // Wait for health
    const health = await waitForHealth(url, 30000);
    const totalTime = performance.now() - startTime;

    // Cleanup
    await client.delete(sandbox, 60);
    console.log(`  [daytona] Cleaned up sandbox`);

    return {
      provider: "daytona",
      success: health.ok,
      url,
      healthStatus: health.ok ? "ok" : "timeout",
      startupMs: totalTime,
    };
  } catch (error) {
    // Cleanup on error
    if (sandbox) {
      try {
        const client = new Daytona({
          apiKey: process.env.DAYTONA_API_KEY!,
          target: process.env.DAYTONA_TARGET || "us",
        });
        await client.delete(sandbox, 60);
      } catch {
        // Ignore
      }
    }
    const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      provider: "daytona",
      success: false,
      url: "",
      healthStatus: "failed",
      startupMs: performance.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Verify E2B provider.
 */
async function verifyE2B(): Promise<VerificationResult> {
  const startTime = performance.now();
  let sandbox: E2BSandbox | null = null;

  try {
    console.log(`  [e2b] Creating sandbox...`);
    sandbox = await E2BSandbox.create("base", {
      timeoutMs: 120_000,
    });

    const spawnTime = performance.now() - startTime;
    console.log(`  [e2b] Sandbox ready in ${(spawnTime / 1000).toFixed(2)}s: ${sandbox.sandboxId}`);

    // Start a simple HTTP server using a shell loop
    await sandbox.commands.run(
      'nohup sh -c \'while true; do echo -e "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n{\\"status\\":\\"ok\\"}" | nc -l -p 8080 -q 1; done\' > /dev/null 2>&1 &',
      { background: true }
    );

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get host URL
    const host = sandbox.getHost(8080);
    const url = `https://${host}`;
    console.log(`  [e2b] URL: ${url}`);

    // Wait for health
    const health = await waitForHealth(url, 30000);
    const totalTime = performance.now() - startTime;

    // Cleanup
    await sandbox.kill();
    console.log(`  [e2b] Cleaned up sandbox`);

    return {
      provider: "e2b",
      success: health.ok,
      url,
      healthStatus: health.ok ? "ok" : "timeout",
      startupMs: totalTime,
    };
  } catch (error) {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch {
        // Ignore
      }
    }
    const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      provider: "e2b",
      success: false,
      url: "",
      healthStatus: "failed",
      startupMs: performance.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Verify Blaxel provider.
 */
async function verifyBlaxel(): Promise<VerificationResult> {
  const startTime = performance.now();
  let sandboxName: string | null = null;

  try {
    // Set API key for SDK
    process.env.BL_API_KEY = process.env.BLAXEL_API_KEY || process.env.BL_API_KEY;

    console.log(`  [blaxel] Creating sandbox...`);
    const name = `verify-${Date.now()}`;
    const sandbox = await SandboxInstance.create({
      name,
      image: "blaxel/base-image:latest",
      memory: 4096,
      ttl: "10m",
    });
    sandboxName = sandbox.metadata?.name || name;

    const spawnTime = performance.now() - startTime;
    console.log(`  [blaxel] Sandbox ready in ${(spawnTime / 1000).toFixed(2)}s: ${sandboxName}`);

    // Blaxel base image only exposes port 8080 by default, so use that
    // Start a simple HTTP server using a shell loop
    await sandbox.process.exec({
      command: 'nohup sh -c \'while true; do echo -e "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n{\\"status\\":\\"ok\\"}" | nc -l -p 8080 -q 1; done\' > /dev/null 2>&1 &',
      waitForCompletion: false,
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Create preview on port 8080
    const preview = await sandbox.previews.create({
      metadata: { name: "health" },
      spec: { port: 8080, public: true },
    });
    const url = preview.spec?.url || "";
    console.log(`  [blaxel] URL: ${url}`);

    // Wait for health
    const health = await waitForHealth(url, 30000);
    const totalTime = performance.now() - startTime;

    // Cleanup
    await SandboxInstance.delete(sandboxName);
    console.log(`  [blaxel] Cleaned up sandbox`);

    return {
      provider: "blaxel",
      success: health.ok,
      url,
      healthStatus: health.ok ? "ok" : "timeout",
      startupMs: totalTime,
    };
  } catch (error) {
    if (sandboxName) {
      try {
        await SandboxInstance.delete(sandboxName);
      } catch {
        // Ignore
      }
    }
    const errorMsg = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      provider: "blaxel",
      success: false,
      url: "",
      healthStatus: "failed",
      startupMs: performance.now() - startTime,
      error: errorMsg,
    };
  }
}

/**
 * Run verification for a provider.
 */
async function verifyProvider(provider: ProviderName): Promise<VerificationResult> {
  const manifest = loadManifest();
  const snapshotId = manifest.providers[provider]?.presets?.standard?.snapshotId;

  switch (provider) {
    case "morph":
      if (!snapshotId) {
        return {
          provider,
          success: false,
          url: "",
          healthStatus: "failed",
          startupMs: 0,
          error: "No snapshot found in manifest",
        };
      }
      return verifyMorph(snapshotId);
    case "daytona":
      return verifyDaytona();
    case "e2b":
      return verifyE2B();
    case "blaxel":
      return verifyBlaxel();
    case "freestyle":
      return {
        provider,
        success: false,
        url: "",
        healthStatus: "failed",
        startupMs: 0,
        error: "Freestyle not configured (no API key or snapshot)",
      };
    default:
      return {
        provider,
        success: false,
        url: "",
        healthStatus: "failed",
        startupMs: 0,
        error: `Unknown provider: ${provider}`,
      };
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      provider: { type: "string", short: "p" },
      runs: { type: "string", short: "r" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
Provider Verification Script

Usage:
  bun run scripts/snapshot/verify-providers.ts [options]

Options:
  --provider, -p <name>   Provider to verify: morph, daytona, e2b, blaxel, or all
  --runs, -r <count>      Number of verification runs per provider (default: 1)
  --help, -h              Show this help message
`);
    process.exit(0);
  }

  const runs = parseInt(values.runs ?? "1", 10);

  // Determine providers
  const providerArg = values.provider?.toLowerCase();
  let providers: ProviderName[];

  if (providerArg === "all" || !providerArg) {
    providers = [];
    if (process.env.MORPH_API_KEY) providers.push("morph");
    if (process.env.DAYTONA_API_KEY) providers.push("daytona");
    if (process.env.E2B_API_KEY) providers.push("e2b");
    if (process.env.BLAXEL_API_KEY || process.env.BL_API_KEY) providers.push("blaxel");
  } else if (["morph", "daytona", "e2b", "blaxel"].includes(providerArg)) {
    providers = [providerArg as ProviderName];
  } else {
    console.error(`Invalid provider: ${providerArg}`);
    process.exit(1);
  }

  if (providers.length === 0) {
    console.error("No providers available (check API keys)");
    process.exit(1);
  }

  printHeader("Provider Verification");
  console.log(`Providers: ${providers.join(", ")}`);
  console.log(`Runs per provider: ${runs}`);
  console.log("");

  // Run verifications
  const aggregated: AggregatedResult[] = [];

  for (const provider of providers) {
    console.log(`\n=== ${provider.toUpperCase()} ===`);
    const results: VerificationResult[] = [];

    for (let i = 0; i < runs; i++) {
      console.log(`\nRun ${i + 1}/${runs}:`);
      const result = await verifyProvider(provider);
      results.push(result);

      if (result.success) {
        console.log(`  ✓ Health check passed in ${(result.startupMs / 1000).toFixed(2)}s`);
      } else {
        console.log(`  ✗ Health check failed: ${result.error || result.healthStatus}`);
      }
    }

    // Aggregate results
    const successful = results.filter((r) => r.success);
    const times = successful.map((r) => r.startupMs);

    aggregated.push({
      provider,
      runs: results.length,
      successCount: successful.length,
      avgStartupMs: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
      minStartupMs: times.length > 0 ? Math.min(...times) : 0,
      maxStartupMs: times.length > 0 ? Math.max(...times) : 0,
      urls: successful.map((r) => r.url),
      errors: results.filter((r) => !r.success).map((r) => r.error || r.healthStatus),
    });
  }

  // Print summary
  printHeader("Verification Summary");

  console.log("| Provider   | Success | Avg (s) | Min (s) | Max (s) |");
  console.log("|------------|---------|---------|---------|---------|");

  for (const r of aggregated) {
    const successRate = `${r.successCount}/${r.runs}`;
    console.log(
      `| ${r.provider.padEnd(10)} | ${successRate.padEnd(7)} | ${(r.avgStartupMs / 1000).toFixed(2).padStart(7)} | ${(r.minStartupMs / 1000).toFixed(2).padStart(7)} | ${(r.maxStartupMs / 1000).toFixed(2).padStart(7)} |`
    );
  }

  console.log("");
  console.log("Sample URLs:");
  for (const r of aggregated) {
    if (r.urls.length > 0) {
      console.log(`  ${r.provider}: ${r.urls[0]}`);
    } else {
      console.log(`  ${r.provider}: (no successful runs)`);
    }
  }

  if (aggregated.some((r) => r.errors.length > 0)) {
    console.log("");
    console.log("Errors:");
    for (const r of aggregated) {
      for (const error of r.errors) {
        console.log(`  ${r.provider}: ${error}`);
      }
    }
  }

  // Exit with error if any provider failed all runs
  const allFailed = aggregated.filter((r) => r.successCount === 0);
  if (allFailed.length > 0) {
    console.log("");
    console.error(`ERROR: ${allFailed.map((r) => r.provider).join(", ")} failed all verification runs`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
