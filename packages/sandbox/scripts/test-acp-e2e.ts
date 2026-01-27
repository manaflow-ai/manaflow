#!/usr/bin/env bun
/**
 * E2E tests for ACP (Agent Client Protocol) sandbox.
 *
 * This tests the sandbox-side ACP implementation after Convex has spawned it.
 * The flow being tested:
 *   1. Convex spawns sandbox via `bunx convex run acp:spawnSandbox`
 *   2. This script tests the sandbox's REST API directly
 *
 * For full Convex->Sandbox->Callback flow, use the iOS app or
 * authenticated Convex client.
 *
 * Usage:
 *   cd packages/convex
 *   # Spawn sandbox first
 *   bunx convex run acp:spawnSandbox '{"teamId":"test"}'
 *   # Then test it
 *   cd ../sandbox
 *   bun run scripts/test-acp-e2e.ts --sandbox-url <url>
 *
 * Or spawn and test in one command:
 *   bun run scripts/test-acp-e2e.ts --spawn
 */

import { parseArgs } from "node:util";
import { spawn } from "node:child_process";

const PROVIDERS = ["claude", "codex"] as const;
type Provider = (typeof PROVIDERS)[number];

interface TestStep {
  step: string;
  success: boolean;
  error?: string;
  duration?: number;
}

interface TestResult {
  provider: Provider;
  success: boolean;
  steps: TestStep[];
}

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(msg: string, color: keyof typeof COLORS = "reset") {
  console.log(`${COLORS[color]}${msg}${COLORS.reset}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testPtyBackend(sandboxUrl: string): Promise<void> {
  log(`\n→ Testing PTY backend...`, "dim");
  const baseUrl = `${sandboxUrl}/api/pty`;

  const healthStart = Date.now();
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    log(`  ✓ pty health (${Date.now() - healthStart}ms)`, "green");
  } catch (error) {
    console.error("PTY health check failed", error);
    log(`  ✗ pty health: ${error}`, "red");
    throw error;
  }

  let sessionId: string | null = null;
  try {
    const createResponse = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "acp-e2e",
        cwd: "/tmp",
        cols: 80,
        rows: 24,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new Error(`${createResponse.status}: ${text}`);
    }

    const payload: unknown = await createResponse.json();
    const id =
      typeof payload === "object" && payload !== null
        ? Reflect.get(payload, "id")
        : null;
    if (typeof id !== "string") {
      throw new Error("Unexpected PTY create response");
    }
    sessionId = id;
    log("  ✓ pty session created", "green");
  } catch (error) {
    console.error("PTY session create failed", error);
    log(`  ✗ pty session create: ${error}`, "red");
    throw error;
  }

  try {
    const inputResponse = await fetch(`${baseUrl}/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "echo 'cmux-pty ok'\n" }),
      signal: AbortSignal.timeout(5000),
    });
    if (!inputResponse.ok) {
      const text = await inputResponse.text();
      throw new Error(`${inputResponse.status}: ${text}`);
    }

    let sawOutput = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(500);
      const captureResponse = await fetch(
        `${baseUrl}/sessions/${sessionId}/capture?processed=true`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!captureResponse.ok) {
        continue;
      }
      const capturePayload: unknown = await captureResponse.json();
      const content =
        typeof capturePayload === "object" && capturePayload !== null
          ? Reflect.get(capturePayload, "content")
          : null;
      if (typeof content === "string" && content.includes("cmux-pty ok")) {
        sawOutput = true;
        break;
      }
    }

    if (!sawOutput) {
      throw new Error("PTY output did not include expected marker");
    }
    log("  ✓ pty output captured", "green");
  } catch (error) {
    console.error("PTY input/capture failed", error);
    log(`  ✗ pty input/capture: ${error}`, "red");
    throw error;
  } finally {
    if (sessionId) {
      try {
        await fetch(`${baseUrl}/sessions/${sessionId}`, {
          method: "DELETE",
          signal: AbortSignal.timeout(5000),
        });
        log("  ✓ pty session deleted", "green");
      } catch (error) {
        console.error("PTY session delete failed", error);
        log(`  ✗ pty session delete: ${error}`, "yellow");
      }
    }
  }
}

/**
 * Run a Convex function using bunx convex run.
 */
async function runConvex(
  func: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "bunx",
      ["convex", "run", func, JSON.stringify(args)],
      {
        cwd: `${import.meta.dir}/../../convex`,
        stdio: ["inherit", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
      // Print logs for visibility
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (line.includes("[LOG]")) {
          log(`  ${line.trim()}`, "dim");
        }
      }
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Convex run failed: ${stderr || stdout}`));
        return;
      }

      try {
        const lines = stdout.trim().split("\n");
        const jsonLine = lines.find(
          (l) => l.startsWith("{") || l.startsWith("[")
        );
        if (jsonLine) {
          resolve(JSON.parse(jsonLine));
        } else {
          resolve({ raw: stdout.trim() });
        }
      } catch {
        resolve({ raw: stdout.trim() });
      }
    });

    proc.on("error", reject);
  });
}

/**
 * Spawn a sandbox via Convex and return its URL.
 */
async function spawnSandboxViaConvex(teamId: string): Promise<string> {
  log(`→ Spawning sandbox via Convex...`, "dim");

  const result = (await runConvex("acp:spawnSandbox", { teamId })) as {
    sandboxId: string;
  };

  // Query the sandbox to get URL
  const sandbox = (await runConvex("acpSandboxes:get", {
    sandboxId: result.sandboxId,
  })) as { sandboxUrl?: string; instanceId?: string };

  // The sandbox URL might be in the logs, extract from instanceId
  const instanceId = sandbox?.instanceId;
  if (instanceId) {
    return `https://acp-${instanceId}.http.cloud.morph.so`;
  }

  throw new Error("Could not determine sandbox URL");
}

/**
 * Check sandbox health endpoint.
 */
async function checkHealth(sandboxUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${sandboxUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await response.json()) as { status: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Wait for sandbox to be healthy.
 */
async function waitForHealth(
  sandboxUrl: string,
  maxWaitMs: number = 60000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkHealth(sandboxUrl)) {
      return true;
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Test a single provider.
 */
async function testProvider(
  sandboxUrl: string,
  provider: Provider
): Promise<TestResult> {
  const steps: TestStep[] = [];

  console.log(`\n${"─".repeat(50)}`);
  log(`Testing ${provider.toUpperCase()}`, "blue");
  console.log(`${"─".repeat(50)}\n`);

  // Generate unique IDs for this test
  const conversationId = `test-conv-${Date.now()}`;
  const sessionId = `test-session-${Date.now()}`;

  // Step 1: Initialize conversation
  log(`→ Initializing ${provider} conversation...`, "dim");
  const initStart = Date.now();

  try {
    const initResponse = await fetch(`${sandboxUrl}/api/acp/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        session_id: sessionId,
        provider_id: provider,
        cwd: "/tmp",
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!initResponse.ok) {
      const text = await initResponse.text();
      throw new Error(`${initResponse.status}: ${text}`);
    }

    steps.push({
      step: "init",
      success: true,
      duration: Date.now() - initStart,
    });
    log(`  ✓ init (${Date.now() - initStart}ms)`, "green");
    log(`    conversationId: ${conversationId}`, "dim");
  } catch (error) {
    steps.push({
      step: "init",
      success: false,
      error: String(error),
    });
    log(`  ✗ init: ${error}`, "red");
    return { provider, success: false, steps };
  }

  // Step 2: Send prompt
  log(`→ Sending prompt...`, "dim");
  const promptStart = Date.now();

  try {
    const promptResponse = await fetch(`${sandboxUrl}/api/acp/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        session_id: sessionId,
        content: [
          { type: "text", text: "What is 2+2? Reply with just the number." },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!promptResponse.ok) {
      const text = await promptResponse.text();
      throw new Error(`${promptResponse.status}: ${text}`);
    }

    const promptData = (await promptResponse.json()) as {
      accepted?: boolean;
      error?: string;
    };

    if (promptData.accepted) {
      steps.push({
        step: "prompt_accepted",
        success: true,
        duration: Date.now() - promptStart,
      });
      log(`  ✓ prompt_accepted (${Date.now() - promptStart}ms)`, "green");
      log(`    Response sent via callback (async)`, "dim");
    } else {
      steps.push({
        step: "prompt_accepted",
        success: false,
        error: promptData.error || "Prompt not accepted",
      });
      log(`  ✗ prompt_accepted: ${promptData.error}`, "red");
    }
  } catch (error) {
    steps.push({
      step: "prompt",
      success: false,
      error: String(error),
    });
    log(`  ✗ prompt: ${error}`, "red");
    return { provider, success: false, steps };
  }

  const allPassed = steps.every((s) => s.success);
  return { provider, success: allPassed, steps };
}

/**
 * Main test runner.
 */
async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "sandbox-url": { type: "string" },
      spawn: { type: "boolean", default: false },
      "team-id": { type: "string", default: `test-${Date.now()}` },
      provider: { type: "string", default: "both" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
ACP E2E Test Runner

Tests the ACP sandbox REST API after Convex spawns it.

Usage:
  bun run scripts/test-acp-e2e.ts [options]

Options:
  --sandbox-url <url>  Existing sandbox URL to test
  --spawn              Spawn new sandbox via Convex first
  --team-id <id>       Team ID for spawning (default: test-<timestamp>)
  --provider <name>    Provider: claude, codex, or both (default: both)
  --help, -h           Show this help

Examples:
  # Test existing sandbox
  bun run scripts/test-acp-e2e.ts --sandbox-url https://acp-morphvm-xxx.http.cloud.morph.so

  # Spawn and test
  bun run scripts/test-acp-e2e.ts --spawn --provider claude
`);
    process.exit(0);
  }

  console.log("\n" + "=".repeat(60));
  console.log("ACP E2E Test Suite");
  console.log("=".repeat(60));

  let sandboxUrl = values["sandbox-url"];

  // Spawn sandbox if requested
  if (values.spawn && !sandboxUrl) {
    try {
      sandboxUrl = await spawnSandboxViaConvex(values["team-id"]!);
      log(`\n✓ Sandbox spawned: ${sandboxUrl}`, "green");
    } catch (error) {
      log(`\n✗ Failed to spawn sandbox: ${error}`, "red");
      process.exit(1);
    }
  }

  if (!sandboxUrl) {
    log("\nError: --sandbox-url or --spawn required", "red");
    process.exit(1);
  }

  console.log(`\nSandbox: ${sandboxUrl}`);

  // Wait for health
  log(`\n→ Waiting for sandbox health...`, "dim");
  if (!(await waitForHealth(sandboxUrl))) {
    log(`✗ Sandbox health check failed`, "red");
    process.exit(1);
  }
  log(`✓ Sandbox healthy`, "green");
  await testPtyBackend(sandboxUrl);

  // Determine providers to test
  const providersToTest: Provider[] =
    values.provider === "both"
      ? [...PROVIDERS]
      : [values.provider as Provider];

  console.log(`Providers: ${providersToTest.join(", ")}`);

  // Run tests
  const results: TestResult[] = [];
  for (const provider of providersToTest) {
    const result = await testProvider(sandboxUrl, provider);
    results.push(result);
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60) + "\n");

  let totalPassed = 0;
  let totalFailed = 0;

  for (const result of results) {
    const icon = result.success ? "✓" : "✗";
    const color = result.success ? "green" : "red";
    const passed = result.steps.filter((s) => s.success).length;
    const failed = result.steps.filter((s) => !s.success).length;
    log(`${icon} ${result.provider}: ${passed} passed, ${failed} failed`, color);
    totalPassed += passed;
    totalFailed += failed;
  }

  console.log();
  log(
    `Total: ${totalPassed} passed, ${totalFailed} failed`,
    totalFailed > 0 ? "red" : "green"
  );

  console.log(`\nSandbox: ${sandboxUrl}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
