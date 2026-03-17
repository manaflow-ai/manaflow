#!/usr/bin/env bun
/**
 * Test script for E2B integration.
 * Run with: cd packages/convex && bun run scripts/test-e2b.ts
 */

import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || "https://famous-camel-162.convex.cloud";

async function main() {
  console.log("Testing E2B integration...\n");
  console.log("Convex URL:", CONVEX_URL);

  const client = new ConvexHttpClient(CONVEX_URL);

  // Test 1: List E2B templates (via internal action)
  console.log("\n1. Testing E2B startInstance action...");
  try {
    // Note: This will only work if E2B_API_KEY is set in Convex env
    const result = await client.action(internal.e2b_actions.startInstance, {
      templateId: "base",
      ttlSeconds: 300, // 5 minutes for testing
      metadata: { test: "true" },
    });
    console.log("✅ E2B instance started:", result);

    // Test 2: Get instance status
    if (result.instanceId) {
      console.log("\n2. Testing getInstance action...");
      const status = await client.action(internal.e2b_actions.getInstance, {
        instanceId: result.instanceId,
      });
      console.log("✅ Instance status:", status);

      // Test 3: Execute a command
      console.log("\n3. Testing execCommand action...");
      const execResult = await client.action(internal.e2b_actions.execCommand, {
        instanceId: result.instanceId,
        command: "echo 'Hello from E2B!'",
      });
      console.log("✅ Command result:", execResult);

      // Test 4: Stop the instance
      console.log("\n4. Stopping test instance...");
      const stopResult = await client.action(internal.e2b_actions.stopInstance, {
        instanceId: result.instanceId,
      });
      console.log("✅ Instance stopped:", stopResult);
    }

    console.log("\n✅ All E2B tests passed!");
  } catch (error) {
    console.error("❌ E2B test failed:", error);
    process.exit(1);
  }
}

main();
