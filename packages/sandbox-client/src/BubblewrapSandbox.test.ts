import type { Id } from "@cmux/convex/dataModel";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BubblewrapSandbox } from "./BubblewrapSandbox.js";
import { SandboxdClient } from "./sandboxd-client.js";

const SANDBOXD_PORT = 46831;
const SANDBOXD_URL = `http://localhost:${SANDBOXD_PORT}`;
const CONTAINER_NAME = "cmux-sandboxd-test";
const SANDBOXD_IMAGE = "ghcr.io/manaflow-ai/cmux-sandbox:latest";

// Bubblewrap requires Linux namespaces, so these tests only run on Linux
const IS_LINUX = platform() === "linux";

async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["info"]);
    proc.on("exit", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

async function isSandboxdRunning(): Promise<boolean> {
  try {
    const client = new SandboxdClient(SANDBOXD_URL);
    await client.health();
    return true;
  } catch {
    return false;
  }
}

async function startSandboxdContainer(): Promise<void> {
  // Remove any existing container first
  await new Promise<void>((resolve) => {
    const cleanup = spawn("docker", ["rm", "-f", CONTAINER_NAME]);
    cleanup.on("exit", () => resolve());
    cleanup.on("error", () => resolve());
  });

  // Start the sandboxd container
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("docker", [
      "run",
      "-d",
      "--privileged",
      "-p",
      `${SANDBOXD_PORT}:${SANDBOXD_PORT}`,
      "-v",
      "/sys/fs/cgroup:/sys/fs/cgroup:rw",
      "--tmpfs",
      "/run:mode=755",
      "--tmpfs",
      "/run/lock:mode=755",
      "--name",
      CONTAINER_NAME,
      SANDBOXD_IMAGE,
      "cmux-sandboxd",
      "--port",
      String(SANDBOXD_PORT),
    ]);

    let stderr = "";
    proc.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Failed to start sandboxd: ${stderr}`));
      }
    });
    proc.on("error", (err) => reject(err));
  });

  // Wait for sandboxd to be healthy
  const client = new SandboxdClient(SANDBOXD_URL);
  for (let i = 0; i < 30; i++) {
    try {
      await client.health();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Sandboxd did not become healthy");
}

async function stopSandboxdContainer(): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn("docker", ["rm", "-f", CONTAINER_NAME]);
    proc.on("exit", () => resolve());
    proc.on("error", () => resolve());
  });
}

describe("BubblewrapSandbox e2e", () => {
  let sandboxdWasRunning = false;
  let weStartedSandboxd = false;
  let canRunTests = false;

  beforeAll(async () => {
    // Skip if Docker tests are disabled or not on Linux
    if (process.env.CMUX_SKIP_DOCKER_TESTS === "1") {
      console.log("Skipping BubblewrapSandbox e2e: CMUX_SKIP_DOCKER_TESTS=1");
      return;
    }

    if (!IS_LINUX) {
      console.log(
        "Skipping BubblewrapSandbox e2e: bubblewrap requires Linux namespaces"
      );
      return;
    }

    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      console.log("Skipping BubblewrapSandbox e2e: Docker not available");
      return;
    }

    sandboxdWasRunning = await isSandboxdRunning();
    if (!sandboxdWasRunning) {
      try {
        await startSandboxdContainer();
        weStartedSandboxd = true;
      } catch (err) {
        console.error("Failed to start sandboxd container:", err);
        return;
      }
    }

    canRunTests = true;
  }, 60000);

  afterAll(async () => {
    // Only stop if we started it
    if (weStartedSandboxd) {
      await stopSandboxdContainer();
    }
  });

  it(
    "creates sandbox, runs exec, and cleans up",
    async () => {
      if (!canRunTests) {
        return;
      }

      const taskRunId = `test-${Date.now()}` as Id<"taskRuns">;
      const taskId = "task-test-id" as Id<"tasks">;

      const sandbox = new BubblewrapSandbox({
        sandboxdUrl: SANDBOXD_URL,
        taskRunId,
        taskId,
        instanceId: 1,
        workspacePath: "/tmp",
        teamSlugOrId: "test",
      });

      try {
        // Start sandbox
        const info = await sandbox.start();
        expect(info.provider).toBe("bubblewrap");
        expect(sandbox.isConnected()).toBe(true);

        // Run a simple command
        const result = await sandbox.exec({
          command: "echo",
          args: ["hello", "world"],
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("hello world");

        // Run command with working directory
        const pwdResult = await sandbox.exec({
          command: "pwd",
          args: [],
          cwd: "/workspace",
        });
        expect(pwdResult.exitCode).toBe(0);
        expect(pwdResult.stdout.trim()).toBe("/workspace");
      } finally {
        // Clean up
        await sandbox.stop();
        expect(sandbox.isConnected()).toBe(false);
      }
    },
    60000
  );

  it(
    "handles command failure gracefully",
    async () => {
      if (!canRunTests) {
        return;
      }

      const taskRunId = `test-fail-${Date.now()}` as Id<"taskRuns">;
      const taskId = "task-test-id" as Id<"tasks">;

      const sandbox = new BubblewrapSandbox({
        sandboxdUrl: SANDBOXD_URL,
        taskRunId,
        taskId,
        instanceId: 2,
        workspacePath: "/tmp",
        teamSlugOrId: "test",
      });

      try {
        await sandbox.start();

        // Run a command that will fail
        const result = await sandbox.exec({
          command: "false",
          args: [],
        });
        expect(result.exitCode).not.toBe(0);
      } finally {
        await sandbox.stop();
      }
    },
    60000
  );

  it(
    "can list and manage multiple sandboxes",
    async () => {
      if (!canRunTests) {
        return;
      }

      const client = new SandboxdClient(SANDBOXD_URL);

      // List sandboxes before
      const beforeList = await client.listSandboxes();
      const countBefore = beforeList.length;

      // Create a sandbox
      const sandbox = await client.createSandbox({
        name: "test-list-sandbox",
        workspace: "/tmp",
      });
      expect(sandbox.id).toBeDefined();
      expect(sandbox.status).toBe("Running");

      // List sandboxes after
      const afterList = await client.listSandboxes();
      expect(afterList.length).toBe(countBefore + 1);

      // Get specific sandbox
      const fetched = await client.getSandbox(sandbox.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.name).toBe("test-list-sandbox");

      // Delete sandbox
      const deleted = await client.deleteSandbox(sandbox.id);
      expect(deleted).not.toBeNull();

      // Verify deleted
      const afterDelete = await client.getSandbox(sandbox.id);
      expect(afterDelete).toBeNull();
    },
    60000
  );
});
