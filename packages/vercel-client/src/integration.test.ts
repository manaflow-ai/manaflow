import { describe, expect, it } from "vitest";
import { VercelClient } from "./index";

/**
 * Integration tests for VercelClient against a live Vercel Sandbox.
 *
 * These tests require real credentials. Set the following env vars to run:
 *   VERCEL_ACCESS_TOKEN
 *   VERCEL_TEAM_ID
 *   VERCEL_PROJECT_ID
 *
 * Run with: VERCEL_ACCESS_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... npx vitest run src/integration.test.ts
 */

const hasCredentials =
  process.env.VERCEL_ACCESS_TOKEN &&
  process.env.VERCEL_TEAM_ID &&
  process.env.VERCEL_PROJECT_ID;

const describeIfCredentials = hasCredentials ? describe : describe.skip;

function createClient() {
  return new VercelClient({
    token: process.env.VERCEL_ACCESS_TOKEN,
    teamId: process.env.VERCEL_TEAM_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
  });
}

describeIfCredentials("VercelClient integration", () => {
  it("creates a sandbox, runs a command, and stops it", async () => {
    const client = createClient();

    // Start a sandbox
    const instance = await client.instances.start({
      runtime: "node24",
      timeout: 60_000,
    });

    expect(instance.id).toBeTruthy();
    expect(typeof instance.id).toBe("string");

    // Run a command
    const result = await instance.exec("echo hello");
    expect(result.exit_code).toBe(0);
    expect(result.stdout.trim()).toBe("hello");

    // Check status — may be "pending" or "running" right after creation
    const status = instance.getStatus();
    expect(["pending", "running"]).toContain(status);

    // Stop
    await instance.stop();
    expect(instance.status).toBe("stopped");
  }, 30_000);

  it("runs node --version and gets output", async () => {
    const client = createClient();

    const instance = await client.instances.start({
      runtime: "node24",
      timeout: 60_000,
    });

    try {
      const result = await instance.exec("node --version");
      expect(result.exit_code).toBe(0);
      expect(result.stdout.trim()).toMatch(/^v2[0-9]\./);
    } finally {
      await instance.stop();
    }
  }, 30_000);

  it("handles non-zero exit codes gracefully", async () => {
    const client = createClient();

    const instance = await client.instances.start({
      runtime: "node24",
      timeout: 60_000,
    });

    try {
      const result = await instance.exec("exit 42");
      expect(result.exit_code).toBe(42);
    } finally {
      await instance.stop();
    }
  }, 30_000);

  it("can write and read files", async () => {
    const client = createClient();

    const instance = await client.instances.start({
      runtime: "node24",
      timeout: 60_000,
    });

    try {
      await instance.writeFiles([
        { path: "test.txt", content: Buffer.from("hello from vercel") },
      ]);

      const buf = await instance.readFile("test.txt");
      expect(buf).not.toBeNull();
      expect(buf!.toString()).toBe("hello from vercel");
    } finally {
      await instance.stop();
    }
  }, 30_000);

  it("can reconnect to an existing sandbox", async () => {
    const client = createClient();

    const instance = await client.instances.start({
      runtime: "node24",
      timeout: 120_000,
    });

    try {
      // Verify the sandbox is working before reconnecting
      const warmup = await instance.exec("echo warmup");
      expect(warmup.exit_code).toBe(0);

      const sandboxId = instance.id;

      // Reconnect via Sandbox.get()
      const reconnected = await client.instances.get({ instanceId: sandboxId });
      expect(reconnected.id).toBe(sandboxId);

      const result = await reconnected.exec("echo reconnected");
      expect(result.exit_code).toBe(0);
      expect(result.stdout.trim()).toBe("reconnected");
    } finally {
      await instance.stop();
    }
  }, 45_000);

  it("can list sandboxes", async () => {
    const client = createClient();
    const list = await client.instances.list();
    expect(Array.isArray(list)).toBe(true);
  }, 15_000);
});
