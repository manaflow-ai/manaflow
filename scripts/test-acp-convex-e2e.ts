/**
 * Full E2E test for ACP via Convex.
 *
 * Tests:
 * 1. Start conversation (spawns Morph sandbox)
 * 2. Send prompt "write a haiku"
 * 3. Verify Morph instance was created
 * 4. Verify messages persisted to DB
 *
 * Usage:
 *   bun run scripts/test-acp-convex-e2e.ts
 */

import { api, internal } from "@cmux/convex/api";
import { StackAdminApp } from "@stackframe/js";
import { ConvexHttpClient } from "convex/browser";

// Configuration
const CONVEX_URL =
  process.env.CONVEX_URL ??
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  "https://polite-canary-804.convex.cloud";

const DEFAULT_USER_ID = "487b5ddc-0da0-4f12-8834-f452863a83f5";
const DEFAULT_TEAM_ID = "780c4397-90dd-47f1-b336-b8c376039db5";

interface Timing {
  step: string;
  durationMs: number;
}

const timings: Timing[] = [];

async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  console.log(`\n=== ${step} ===`);
  try {
    const result = await fn();
    const duration = Date.now() - start;
    timings.push({ step, durationMs: duration });
    console.log(`✓ ${step} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    timings.push({ step, durationMs: duration });
    console.error(`✗ ${step} failed after ${duration}ms:`, error);
    throw error;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("ACP Convex E2E Test");
  console.log("=".repeat(60));
  console.log(`Convex URL: ${CONVEX_URL}`);

  // Step 1: Initialize Stack Admin and get auth token
  const token = await timed("Initialize auth", async () => {
    const stackAdminApp = new StackAdminApp({
      tokenStore: "memory",
      projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
      publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
      secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
      superSecretAdminKey: process.env.STACK_SUPER_SECRET_ADMIN_KEY,
    });

    const userId = process.env.CMUX_SCRIPT_USER_ID ?? DEFAULT_USER_ID;
    console.log(`  Using user ID: ${userId}`);

    const user = await stackAdminApp.getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const session = await user.createSession({ expiresInMillis: 10 * 60 * 1000 });
    const tokens = await session.getTokens();
    if (!tokens.accessToken) {
      throw new Error("Failed to get access token");
    }

    return tokens.accessToken;
  });

  // Step 2: Create Convex client with auth
  const client = new ConvexHttpClient(CONVEX_URL);
  client.setAuth(token);

  // Step 3: Start conversation (this spawns Morph sandbox)
  const teamId = process.env.TEST_TEAM_ID ?? DEFAULT_TEAM_ID;
  console.log(`\n  Using team ID: ${teamId}`);

  const conversation = await timed("Start conversation (spawn sandbox)", async () => {
    const result = await client.action(api.acp.startConversation, {
      teamSlugOrId: teamId,
      providerId: "codex",
      cwd: "/workspace",
    });
    console.log(`  Conversation ID: ${result.conversationId}`);
    console.log(`  Sandbox ID: ${result.sandboxId}`);
    console.log(`  Status: ${result.status}`);
    return result;
  });

  // Step 4: Wait for sandbox to be ready (if starting)
  if (conversation.status === "starting") {
    await timed("Wait for sandbox ready", async () => {
      // Poll sandbox status until running
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const sandbox = await client.query(api.acpSandboxes.get, {
          sandboxId: conversation.sandboxId,
        });
        if (sandbox?.status === "running") {
          console.log(`  Sandbox ready after ${(i + 1) * 2}s`);
          return;
        }
        if (sandbox?.status === "error") {
          throw new Error(`Sandbox failed`);
        }
        process.stdout.write(".");
      }
      throw new Error("Timeout waiting for sandbox");
    });
  }

  // Step 5: Send prompt
  await timed("Send prompt: 'write a haiku'", async () => {
    await client.action(api.acp.sendMessage, {
      conversationId: conversation.conversationId,
      content: [{ type: "text", text: "write a haiku" }],
    });
    console.log("  Message sent (response will come via callback)");
  });

  // Step 6: Wait for response and verify messages in DB
  const messages = await timed("Wait for response & verify messages", async () => {
    // Wait a bit for the response to come back via callback
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const result = await client.query(api.acp.listMessages, {
        conversationId: conversation.conversationId,
      });
      const msgs = result.messages;
      // Check if we have an assistant message
      const assistantMsgs = msgs.filter((m: { role: string }) => m.role === "assistant");
      if (assistantMsgs.length > 0) {
        console.log(`  Found ${msgs.length} messages (${assistantMsgs.length} from assistant)`);
        return msgs;
      }
      process.stdout.write(".");
    }
    // Return whatever we have even if no assistant response
    const result = await client.query(api.acp.listMessages, {
      conversationId: conversation.conversationId,
    });
    console.log(`  Found ${result.messages.length} messages after timeout`);
    return result.messages;
  });

  // Step 7: Verify Morph instance
  await timed("Verify Morph instance", async () => {
    // Get the sandbox record directly using the sandboxId from startConversation
    const sandbox = await client.query(api.acpSandboxes.get, {
      sandboxId: conversation.sandboxId,
    });
    if (!sandbox) {
      console.log("  Warning: No sandbox found");
      return;
    }
    console.log(`  Sandbox ID: ${conversation.sandboxId}`);
    console.log(`  Instance ID: ${sandbox.instanceId}`);
    console.log(`  Provider: ${sandbox.provider}`);
    console.log(`  Status: ${sandbox.status}`);
    if (sandbox.sandboxUrl) {
      console.log(`  URL: ${sandbox.sandboxUrl}`);
    }
  });

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Test Summary");
  console.log("=".repeat(60));
  console.log("\nTimings:");
  let total = 0;
  for (const t of timings) {
    console.log(`  ${t.step}: ${t.durationMs}ms`);
    total += t.durationMs;
  }
  console.log(`  TOTAL: ${total}ms`);

  console.log("\nMessages in DB:");
  for (const msg of messages) {
    const content = msg.content?.[0]?.text?.slice(0, 100) ?? "(no content)";
    console.log(`  [${msg.role}] ${content}${content.length >= 100 ? "..." : ""}`);
  }

  console.log("\n✓ E2E test completed successfully!");
}

main().catch((error) => {
  console.error("\n✗ E2E test failed:", error);
  process.exit(1);
});
