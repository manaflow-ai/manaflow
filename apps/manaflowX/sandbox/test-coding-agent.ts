/**
 * Test script to run the delegateToCodingAgent tool with a real task.
 * This uses the REAL codepath that AI SDK would call.
 *
 * Usage: bun sandbox/test-coding-agent.ts
 *
 * Note: VM cleanup is disabled in coding-agent.ts for debugging.
 */

import { delegateToCodingAgentTool } from "../workflows/tools/coding-agent";
import type { CoreMessage } from "ai";

async function main() {
  console.log("=== Testing delegateToCodingAgent ===\n");

  const task = "what's this repo about: https://github.com/manaflow-ai/cmux";
  const agent = "general" as const;

  console.log(`Task: ${task}`);
  console.log(`Agent: ${agent}`);
  console.log("\nStarting...\n");

  try {
    // Call the tool's execute function directly
    const execute = delegateToCodingAgentTool.execute;
    if (!execute) {
      throw new Error("Tool execute function is undefined");
    }

    const result = await execute(
      { task, agent },
      {
        // Minimal options object that AI SDK would pass
        toolCallId: `test_${Date.now()}`,
        messages: [] as CoreMessage[],
        abortSignal: new AbortController().signal,
      }
    );

    // Handle potential async iterable result
    if (result && typeof result === "object" && Symbol.asyncIterator in result) {
      throw new Error("Unexpected async iterable result");
    }

    console.log("\n=== Result ===");
    console.log(JSON.stringify(result, null, 2));

    if ("success" in result && result.success) {
      console.log("\n✅ Task completed successfully");
    } else if ("error" in result) {
      console.log("\n❌ Task failed:", result.error);
    }

    // Print the VM ID for inspection
    console.log("\n=== VM Info ===");
    console.log("Check the logs above for the VM instance ID (morphvm_xxx)");
    console.log("The VM is NOT cleaned up - you can inspect it with:");
    console.log("  uvx --env-file .env morphcloud instance exec <VM_ID> 'cat /root/.xagi/config.json'");
    console.log("  uvx --env-file .env morphcloud instance exec <VM_ID> 'cat /root/.local/share/opencode/log/*.log'");
  } catch (error) {
    console.error("\n❌ Error:", error);
  }
}

main();
