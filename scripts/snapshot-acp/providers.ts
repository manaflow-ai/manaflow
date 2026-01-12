/**
 * Provider adapters for snapshot creation.
 *
 * Each provider implements a common interface for VM management and snapshotting.
 */

import { freestyle } from "freestyle-sandboxes";
import { PROVISIONING_COMMANDS, printHeader } from "./utils";

/**
 * Common interface for snapshot providers.
 */
export interface SnapshotProvider {
  name: string;
  createVm(baseSnapshotId?: string): Promise<{ vmId: string }>;
  execCommand(vmId: string, command: string): Promise<string>;
  createSnapshot(vmId: string): Promise<{ snapshotId: string }>;
  deleteVm(vmId: string): Promise<void>;
}

// =============================================================================
// Freestyle Provider
// =============================================================================

export class FreestyleProvider implements SnapshotProvider {
  name = "freestyle";
  private vmInstances: Map<string, Awaited<ReturnType<typeof freestyle.vms.create>>["vm"]> = new Map();

  async createVm(baseSnapshotId?: string): Promise<{ vmId: string }> {
    const options: Parameters<typeof freestyle.vms.create>[0] = {
      idleTimeoutSeconds: 7200, // 2 hours for provisioning
      persistence: { type: "ephemeral" as const },
      ...(baseSnapshotId ? { snapshotId: baseSnapshotId } : {}),
    };

    const { vm, vmId } = await freestyle.vms.create(options);
    this.vmInstances.set(vmId, vm);
    return { vmId };
  }

  async execCommand(vmId: string, command: string): Promise<string> {
    const vm = this.vmInstances.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);

    try {
      const result = await vm.exec(command);
      return result ?? "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }

  async createSnapshot(vmId: string): Promise<{ snapshotId: string }> {
    const vm = this.vmInstances.get(vmId);
    if (!vm) throw new Error(`VM ${vmId} not found`);

    const { snapshotId } = await vm.snapshot();
    return { snapshotId };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      await freestyle.vms.delete({ vmId });
    } catch (error) {
      console.error(`Failed to delete VM ${vmId}:`, error);
    }
    this.vmInstances.delete(vmId);
  }
}

// =============================================================================
// Morph Provider
// =============================================================================

const MORPH_API_BASE = "https://cloud.morph.so/api";

interface MorphStartResponse {
  id: string;
  status?: string;
}

export class MorphProvider implements SnapshotProvider {
  name = "morph";
  private apiKey: string;

  constructor() {
    const apiKey = process.env.MORPH_API_KEY;
    if (!apiKey) {
      throw new Error("MORPH_API_KEY environment variable not set");
    }
    this.apiKey = apiKey;
  }

  async createVm(baseSnapshotId?: string): Promise<{ vmId: string }> {
    const response = await fetch(`${MORPH_API_BASE}/instance/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        snapshot_id: baseSnapshotId,
        ttl_seconds: 7200, // 2 hours
        ttl_action: "stop",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create Morph VM: ${response.status} - ${text}`);
    }

    const data = (await response.json()) as MorphStartResponse;
    return { vmId: data.id };
  }

  async execCommand(vmId: string, command: string): Promise<string> {
    // Morph uses SSH or exec API
    const response = await fetch(`${MORPH_API_BASE}/instance/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        id: vmId,
        command,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return `Error: ${response.status} - ${text}`;
    }

    const data = await response.json() as { stdout?: string; stderr?: string };
    return data.stdout ?? data.stderr ?? "";
  }

  async createSnapshot(vmId: string): Promise<{ snapshotId: string }> {
    const response = await fetch(`${MORPH_API_BASE}/instance/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        id: vmId,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to create snapshot: ${response.status} - ${text}`);
    }

    const data = await response.json() as { id?: string; snapshot_id?: string };
    const snapshotId = data.snapshot_id ?? data.id;
    if (!snapshotId) {
      throw new Error("No snapshot ID returned from Morph API");
    }
    return { snapshotId };
  }

  async deleteVm(vmId: string): Promise<void> {
    try {
      await fetch(`${MORPH_API_BASE}/instance/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ id: vmId }),
      });
    } catch (error) {
      console.error(`Failed to stop VM ${vmId}:`, error);
    }
  }
}

// =============================================================================
// Provider Factory
// =============================================================================

export function getProvider(name: string): SnapshotProvider {
  switch (name) {
    case "freestyle":
      return new FreestyleProvider();
    case "morph":
      return new MorphProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

// =============================================================================
// Shared Provisioning Logic
// =============================================================================

export async function provisionVm(
  provider: SnapshotProvider,
  vmId: string
): Promise<void> {
  printHeader(`Provisioning VM: ${vmId}`);

  for (const cmd of PROVISIONING_COMMANDS) {
    console.log(`> ${cmd.slice(0, 70)}${cmd.length > 70 ? "..." : ""}`);
    const result = await provider.execCommand(vmId, cmd);
    if (result) {
      // Only show first few lines of output
      const lines = result.split("\n").slice(0, 5);
      for (const line of lines) {
        console.log(`  ${line}`);
      }
      if (result.split("\n").length > 5) {
        console.log("  ...");
      }
    }
  }
}

export async function createProvisionedSnapshot(
  provider: SnapshotProvider,
  preset: string,
  baseSnapshotId?: string
): Promise<{ snapshotId: string }> {
  printHeader(`Creating ${provider.name} snapshot for preset: ${preset}`);

  // 1. Create VM
  console.log("Creating VM...");
  const { vmId } = await provider.createVm(baseSnapshotId);
  console.log(`Created VM: ${vmId}`);

  try {
    // 2. Wait a bit for VM to be ready
    console.log("Waiting for VM to be ready...");
    await new Promise((resolve) => setTimeout(resolve, 10000));

    // 3. Run provisioning commands
    await provisionVm(provider, vmId);

    // 4. Create snapshot
    console.log("\nCreating snapshot...");
    const { snapshotId } = await provider.createSnapshot(vmId);
    console.log(`Snapshot created: ${snapshotId}`);

    return { snapshotId };
  } finally {
    // 5. Clean up
    console.log("Cleaning up VM...");
    await provider.deleteVm(vmId);
  }
}
