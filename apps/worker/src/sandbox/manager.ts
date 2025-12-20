/**
 * Sandbox Manager - manages bubblewrap sandboxes with REST API
 *
 * Similar to sandboxd but runs inside Docker container.
 * Each sandbox gets a unique IP from the 10.201.0.0/16 subnet.
 */

import { spawn, ChildProcess } from "node:child_process";
import { readFile, writeFile, readdir, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type {
  SandboxSummary,
  SandboxNetwork,
  SandboxStatus,
  CreateSandboxRequest,
  ExecRequest,
  ExecResponse,
} from "./types";

const IP_POOL_DIR = "/var/lib/cmux-bwrap/ip-pool";
const SANDBOX_REGISTRY = "/var/lib/cmux-bwrap/sandbox-registry.json";
const IP_BASE = "10.201";

interface SandboxEntry {
  id: string;
  index: number;
  name: string;
  createdAt: string;
  workspace: string;
  blockNum: number;
  pid: number;
  network: SandboxNetwork;
  correlationId?: string;
}

// In-memory registry, persisted to disk
let sandboxes: Map<string, SandboxEntry> = new Map();
let nextIndex = 0;

/**
 * Calculate IPs from block number.
 * Block N: host=10.201.X.Y+1, sandbox=10.201.X.Y+2 where X.Y = N*4
 */
function getIpsFromBlock(blockNum: number): { hostIp: string; sandboxIp: string } {
  const offset = blockNum * 4;
  const thirdOctet = Math.floor(offset / 256);
  const fourthOctet = offset % 256;
  return {
    hostIp: `${IP_BASE}.${thirdOctet}.${fourthOctet + 1}`,
    sandboxIp: `${IP_BASE}.${thirdOctet}.${fourthOctet + 2}`,
  };
}

/**
 * Load sandbox registry from disk
 */
async function loadRegistry(): Promise<void> {
  try {
    if (existsSync(SANDBOX_REGISTRY)) {
      const data = await readFile(SANDBOX_REGISTRY, "utf-8");
      const entries: SandboxEntry[] = JSON.parse(data);
      sandboxes = new Map(entries.map((e) => [e.id, e]));
      nextIndex = Math.max(0, ...entries.map((e) => e.index)) + 1;
    }
  } catch (err) {
    console.error("[SandboxManager] Failed to load registry:", err);
  }
}

/**
 * Save sandbox registry to disk
 */
async function saveRegistry(): Promise<void> {
  try {
    await mkdir("/var/lib/cmux-bwrap", { recursive: true });
    const entries = Array.from(sandboxes.values());
    await writeFile(SANDBOX_REGISTRY, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error("[SandboxManager] Failed to save registry:", err);
  }
}

/**
 * Find next available IP block
 */
async function allocateBlock(sandboxName: string): Promise<number> {
  await mkdir(IP_POOL_DIR, { recursive: true });

  let blockNum = 0;
  while (existsSync(`${IP_POOL_DIR}/block_${blockNum}`)) {
    blockNum++;
    if (blockNum > 16000) {
      throw new Error("IP pool exhausted");
    }
  }

  await writeFile(`${IP_POOL_DIR}/block_${blockNum}`, sandboxName);
  return blockNum;
}

/**
 * Release IP block
 */
async function releaseBlock(blockNum: number): Promise<void> {
  try {
    await unlink(`${IP_POOL_DIR}/block_${blockNum}`);
  } catch {
    // Ignore if already released
  }
}

/**
 * Check if a sandbox process is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get sandbox status based on process state
 */
function getSandboxStatus(entry: SandboxEntry): SandboxStatus {
  if (!entry.pid) return "unknown";
  return isProcessRunning(entry.pid) ? "running" : "exited";
}

/**
 * Create a new sandbox
 */
export async function createSandbox(request: CreateSandboxRequest): Promise<SandboxSummary> {
  await loadRegistry();

  const id = randomUUID();
  const index = nextIndex++;
  const name = request.name || `sandbox-${index}`;
  const workspace = request.workspace || "/workspace";

  // Allocate IP block
  const blockNum = await allocateBlock(name);
  const { hostIp, sandboxIp } = getIpsFromBlock(blockNum);

  const network: SandboxNetwork = {
    hostInterface: `vethh${blockNum}`,
    sandboxInterface: `vethn${blockNum}`,
    hostIp,
    sandboxIp,
    cidr: 30,
  };

  // Build command
  const command = request.command || ["/bin/bash"];
  const args = [
    "--workspace",
    workspace,
    "--name",
    name,
    "--",
    ...command,
  ];

  // Spawn sandbox process
  const child = spawn("cmux-bwrap-sandbox", args, {
    env: {
      ...process.env,
      CMUX_USE_BWRAP: "1",
      ...(request.env?.reduce(
        (acc, { key, value }) => ({ ...acc, [key]: value }),
        {} as Record<string, string>
      ) || {}),
    },
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const entry: SandboxEntry = {
    id,
    index,
    name,
    createdAt: new Date().toISOString(),
    workspace,
    blockNum,
    pid: child.pid || 0,
    network,
    correlationId: request.tabId,
  };

  sandboxes.set(id, entry);
  await saveRegistry();

  return toSummary(entry);
}

/**
 * List all sandboxes
 */
export async function listSandboxes(): Promise<SandboxSummary[]> {
  await loadRegistry();
  return Array.from(sandboxes.values()).map(toSummary);
}

/**
 * Get a sandbox by ID or index
 */
export async function getSandbox(idOrIndex: string): Promise<SandboxSummary | null> {
  await loadRegistry();

  // Try by ID first
  let entry = sandboxes.get(idOrIndex);

  // Try by index
  if (!entry) {
    const index = parseInt(idOrIndex, 10);
    if (!isNaN(index)) {
      entry = Array.from(sandboxes.values()).find((e) => e.index === index);
    }
  }

  // Try by name
  if (!entry) {
    entry = Array.from(sandboxes.values()).find((e) => e.name === idOrIndex);
  }

  return entry ? toSummary(entry) : null;
}

/**
 * Get sandbox IP by index (used by proxy)
 */
export async function getSandboxIpByIndex(index: number): Promise<string | null> {
  await loadRegistry();
  const entry = Array.from(sandboxes.values()).find((e) => e.index === index);
  return entry?.network.sandboxIp || null;
}

/**
 * Delete a sandbox
 */
export async function deleteSandbox(idOrIndex: string): Promise<SandboxSummary | null> {
  await loadRegistry();

  const summary = await getSandbox(idOrIndex);
  if (!summary) return null;

  const entry = sandboxes.get(summary.id);
  if (!entry) return null;

  // Kill the process if running
  if (entry.pid && isProcessRunning(entry.pid)) {
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }
  }

  // Release IP block
  await releaseBlock(entry.blockNum);

  // Remove from registry
  sandboxes.delete(summary.id);
  await saveRegistry();

  return summary;
}

/**
 * Execute a command in a sandbox
 */
export async function execInSandbox(
  idOrIndex: string,
  request: ExecRequest
): Promise<ExecResponse> {
  const summary = await getSandbox(idOrIndex);
  if (!summary) {
    throw new Error(`Sandbox not found: ${idOrIndex}`);
  }

  const entry = sandboxes.get(summary.id);
  if (!entry || !entry.pid) {
    throw new Error(`Sandbox has no PID: ${idOrIndex}`);
  }

  return new Promise((resolve, reject) => {
    const args = [
      "--target",
      entry.pid.toString(),
      "--mount",
      "--uts",
      "--ipc",
      "--net",
      "--pid",
      "--",
      ...request.command,
    ];

    const child = spawn("nsenter", args, {
      cwd: request.workdir || entry.workspace,
      env: {
        ...process.env,
        ...(request.env?.reduce(
          (acc, { key, value }) => ({ ...acc, [key]: value }),
          {} as Record<string, string>
        ) || {}),
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code || 0,
        stdout,
        stderr,
      });
    });

    child.on("error", reject);
  });
}

/**
 * Clean up stale sandboxes (processes that have exited)
 */
export async function cleanupStaleSandboxes(): Promise<void> {
  await loadRegistry();

  const stale: string[] = [];
  for (const [id, entry] of sandboxes) {
    if (!isProcessRunning(entry.pid)) {
      await releaseBlock(entry.blockNum);
      stale.push(id);
    }
  }

  for (const id of stale) {
    sandboxes.delete(id);
  }

  if (stale.length > 0) {
    await saveRegistry();
    console.log(`[SandboxManager] Cleaned up ${stale.length} stale sandboxes`);
  }
}

function toSummary(entry: SandboxEntry): SandboxSummary {
  return {
    id: entry.id,
    index: entry.index,
    name: entry.name,
    createdAt: entry.createdAt,
    workspace: entry.workspace,
    status: getSandboxStatus(entry),
    network: entry.network,
    pid: entry.pid,
    correlationId: entry.correlationId,
  };
}

// Initialize on module load
loadRegistry().catch(console.error);
