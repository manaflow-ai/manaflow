#!/usr/bin/env bun
/**
 * E2E test for ACP flow via Convex.
 *
 * Tests:
 * 1. Spawn sandbox via Convex internal action
 * 2. Create conversation
 * 3. Send message
 * 4. Verify messages are persisted in Convex
 *
 * Uses `bunx convex run` to call internal functions.
 */

import { execSync, spawnSync } from "node:child_process";
import type { Id } from "../packages/convex/convex/_generated/dataModel";

const TEST_TEAM_ID = "test-e2e-team";
const CONVEX_DIR = "./packages/convex";

interface TestResult {
  step: string;
  status: "pass" | "fail" | "skip";
  details?: string;
  data?: unknown;
}

const results: TestResult[] = [];

function log(step: string, status: "pass" | "fail" | "skip", details?: string, data?: unknown) {
  const emoji = status === "pass" ? "✅" : status === "fail" ? "❌" : "⏭️";
  console.log(`${emoji} ${step}${details ? `: ${details}` : ""}`);
  if (data) {
    console.log("   Data:", JSON.stringify(data, null, 2).split("\n").join("\n   "));
  }
  results.push({ step, status, details, data });
}

function convexRun(functionName: string, args: Record<string, unknown>): unknown {
  const argsJson = JSON.stringify(args);
  const result = spawnSync("bunx", ["convex", "run", functionName, argsJson], {
    cwd: CONVEX_DIR,
    encoding: "utf-8",
    timeout: 120000,
  });

  if (result.error) {
    throw new Error(`convex run error: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`convex run failed: ${result.stderr || result.stdout}`);
  }

  // Parse the JSON output (convex run outputs JSON)
  const output = result.stdout.trim();
  if (!output) {
    return null;
  }

  try {
    return JSON.parse(output);
  } catch {
    // Some outputs aren't JSON
    return output;
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("\n========================================");
  console.log("ACP E2E Test Suite");
  console.log("========================================\n");

  let sandboxId: Id<"acpSandboxes"> | undefined;
  let conversationId: Id<"conversations"> | undefined;
  let sandboxUrl: string | undefined;

  // Step 1: Spawn sandbox via internal action
  console.log("\n--- Step 1: Spawn Sandbox ---");
  try {
    const result = convexRun("acp:spawnSandbox", { teamId: TEST_TEAM_ID }) as {
      sandboxId: Id<"acpSandboxes">;
    };
    sandboxId = result.sandboxId;
    log("Spawn sandbox", "pass", `Created sandbox ${sandboxId}`, result);
  } catch (error) {
    log("Spawn sandbox", "fail", String(error));
    return results;
  }

  // Step 2: Wait for sandbox to be ready
  console.log("\n--- Step 2: Wait for Sandbox Ready ---");
  try {
    const maxWait = 60000;
    const pollInterval = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const sandbox = convexRun("acpSandboxes:getById", { sandboxId }) as {
        status: string;
        sandboxUrl?: string;
        instanceId?: string;
      } | null;

      if (sandbox?.status === "running" && sandbox.sandboxUrl) {
        sandboxUrl = sandbox.sandboxUrl;
        log("Sandbox ready", "pass", `URL: ${sandboxUrl}`, {
          status: sandbox.status,
          instanceId: sandbox.instanceId,
        });
        break;
      }

      console.log(`   Waiting... (status: ${sandbox?.status ?? "unknown"})`);
      await sleep(pollInterval);
    }

    if (!sandboxUrl) {
      log("Sandbox ready", "fail", "Timeout waiting for sandbox to be ready");
      return results;
    }
  } catch (error) {
    log("Sandbox ready", "fail", String(error));
    return results;
  }

  // Step 3: Create conversation via internal mutation
  console.log("\n--- Step 3: Create Conversation ---");
  try {
    const sessionId = `e2e-test-${Date.now()}`;
    conversationId = convexRun("acp:createConversationInternal", {
      teamId: TEST_TEAM_ID,
      userId: "e2e-test-user",
      sessionId,
      providerId: "codex",
      cwd: "/workspace",
      acpSandboxId: sandboxId,
      initializedOnSandbox: false,
    }) as Id<"conversations">;
    log("Create conversation", "pass", `Created ${conversationId}`, { sessionId });
  } catch (error) {
    log("Create conversation", "fail", String(error));
    return results;
  }

  // Step 4: Initialize conversation on sandbox
  console.log("\n--- Step 4: Initialize on Sandbox ---");
  try {
    const conversation = convexRun("acp:getConversationInternal", {
      conversationId,
    }) as { sessionId: string } | null;

    if (!conversation) {
      log("Init on sandbox", "fail", "Conversation not found");
      return results;
    }

    const initUrl = `${sandboxUrl}/api/acp/init`;
    console.log(`   POST ${initUrl}`);

    const initResponse = await fetch(initUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        session_id: conversation.sessionId,
        provider_id: "codex",
        cwd: "/workspace",
      }),
    });

    const initData = await initResponse.json();
    if (initResponse.ok && initData.success) {
      log("Init on sandbox", "pass", "Conversation initialized", initData);
    } else {
      log("Init on sandbox", "fail", `HTTP ${initResponse.status}`, initData);
      return results;
    }
  } catch (error) {
    log("Init on sandbox", "fail", String(error));
    return results;
  }

  // Step 5: Send a prompt
  console.log("\n--- Step 5: Send Prompt ---");
  try {
    const conversation = convexRun("acp:getConversationInternal", {
      conversationId,
    }) as { sessionId: string } | null;

    if (!conversation) {
      log("Send prompt", "fail", "Conversation not found");
      return results;
    }

    const promptUrl = `${sandboxUrl}/api/acp/prompt`;
    console.log(`   POST ${promptUrl}`);

    const promptResponse = await fetch(promptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        session_id: conversation.sessionId,
        content: [
          {
            type: "text",
            text: "Say 'E2E test successful'. Respond with just that phrase.",
          },
        ],
      }),
    });

    const promptData = await promptResponse.json();
    if (promptResponse.ok && promptData.accepted) {
      log("Send prompt", "pass", "Prompt accepted", promptData);
    } else {
      log("Send prompt", "fail", `HTTP ${promptResponse.status}`, promptData);
      return results;
    }
  } catch (error) {
    log("Send prompt", "fail", String(error));
    return results;
  }

  // Step 6: Wait for response and check messages in Convex
  console.log("\n--- Step 6: Verify Messages Persisted ---");
  try {
    const maxWait = 60000;
    const pollInterval = 3000;
    const startTime = Date.now();
    let foundAssistantMessage = false;

    while (Date.now() - startTime < maxWait) {
      // Query messages via internal query
      const messages = convexRun("acp:getMessagesInternal", {
        conversationId,
      }) as Array<{
        role: string;
        content: Array<{ type: string; text?: string }>;
        reasoning?: string;
      }> | null;

      console.log(`   Found ${messages?.length ?? 0} messages`);

      if (messages && messages.length > 0) {
        for (const msg of messages) {
          console.log(`   - ${msg.role}: ${JSON.stringify(msg.content).slice(0, 100)}...`);
          if (msg.reasoning) {
            console.log(`     reasoning: ${msg.reasoning.slice(0, 100)}...`);
          }
        }

        // Check for assistant message with content
        const assistantMsg = messages.find((m) => m.role === "assistant");
        if (assistantMsg && assistantMsg.content.length > 0) {
          foundAssistantMessage = true;
          log("Messages persisted", "pass", "Found assistant response", {
            messageCount: messages.length,
            assistantContent: assistantMsg.content,
            reasoning: assistantMsg.reasoning?.slice(0, 200),
          });
          break;
        }
      }

      await sleep(pollInterval);
    }

    if (!foundAssistantMessage) {
      log("Messages persisted", "fail", "No assistant message found in Convex after timeout");
    }
  } catch (error) {
    log("Messages persisted", "fail", String(error));
  }

  // Cleanup
  console.log("\n--- Cleanup ---");
  try {
    if (sandboxId) {
      const sandbox = convexRun("acpSandboxes:getById", { sandboxId }) as {
        instanceId?: string;
      } | null;
      if (sandbox?.instanceId && sandbox.instanceId !== "pending") {
        console.log(`   Sandbox instance: ${sandbox.instanceId}`);
        // TODO: Add stopSandbox mutation if needed
      }
      log("Cleanup", "pass", "Test completed");
    }
  } catch (error) {
    log("Cleanup", "skip", String(error));
  }

  return results;
}

async function main() {
  const results = await runTests();

  console.log("\n========================================");
  console.log("Test Summary");
  console.log("========================================");

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏭️ Skipped: ${skipped}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter((r) => r.status === "fail")) {
      console.log(`  - ${r.step}: ${r.details}`);
    }
    process.exit(1);
  }

  console.log("\n✅ All tests passed!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
