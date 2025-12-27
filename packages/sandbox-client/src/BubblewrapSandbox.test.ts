import type { Id } from "@cmux/convex/dataModel";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BubblewrapSandbox } from "./BubblewrapSandbox.js";
import { SandboxdClient } from "./sandboxd-client.js";

const SANDBOXD_PORT = 46832; // Use different port to avoid conflicts with dev server
const SANDBOXD_URL = `http://localhost:${SANDBOXD_PORT}`;
const CONTAINER_NAME = "cmux-sandboxd-test";
const SANDBOXD_IMAGE = "ghcr.io/manaflow-ai/cmux-sandbox:latest";

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

  // Start the sandboxd container with dockerd
  // On macOS, systemd doesn't work so we use a custom entrypoint script
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("docker", [
      "run",
      "-d",
      "--privileged",
      "-p",
      `${SANDBOXD_PORT}:${SANDBOXD_PORT}`,
      "--name",
      CONTAINER_NAME,
      "--entrypoint",
      "/bin/bash",
      SANDBOXD_IMAGE,
      "-c",
      // Start dockerd in background, wait for socket, then start sandboxd
      `dockerd --iptables=false &
       for i in $(seq 1 30); do
         if [ -S /var/run/docker.sock ]; then break; fi
         sleep 1
       done
       exec cmux-sandboxd --port ${SANDBOXD_PORT}`,
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

  // Wait for sandboxd to be healthy (takes longer since dockerd needs to start first)
  const client = new SandboxdClient(SANDBOXD_URL);
  for (let i = 0; i < 60; i++) {
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
    // Skip if Docker tests are disabled
    if (process.env.CMUX_SKIP_DOCKER_TESTS === "1") {
      console.log("Skipping BubblewrapSandbox e2e: CMUX_SKIP_DOCKER_TESTS=1");
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
        console.log("Starting sandboxd container...");
        await startSandboxdContainer();
        weStartedSandboxd = true;
        console.log("Sandboxd container started successfully");
      } catch (err) {
        console.error("Failed to start sandboxd container:", err);
        return;
      }
    } else {
      console.log("Sandboxd already running");
    }

    canRunTests = true;
  }, 120000);

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

        // Run a simple command (use /tmp as cwd since workspace may not exist)
        const result = await sandbox.exec({
          command: "echo",
          args: ["hello", "world"],
          cwd: "/tmp",
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe("hello world");

        // Run another command to verify multiple execs work
        const lsResult = await sandbox.exec({
          command: "ls",
          args: ["-la", "/"],
          cwd: "/tmp",
        });
        expect(lsResult.exitCode).toBe(0);
        expect(lsResult.stdout).toContain("tmp");
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
          cwd: "/tmp",
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
