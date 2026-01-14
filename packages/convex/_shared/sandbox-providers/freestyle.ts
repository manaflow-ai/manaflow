/**
 * Freestyle sandbox provider implementation.
 *
 * Uses Freestyle API to spawn and manage sandboxes.
 * https://freestyle.sh
 *
 * API Reference:
 * - POST /v1/vms - Create VM
 * - GET /v1/vms/{vmId} - Get VM status
 * - POST /v1/vms/{vmId}/suspend - Suspend VM
 * - POST /v1/vms/{vmId}/start - Resume/start VM
 * - DELETE /v1/vms/{vmId} - Delete VM
 * - POST /v1/vms/{vmId}/snapshot - Create snapshot
 */

import type {
  SandboxInstance,
  SandboxProvider,
  SandboxSpawnOptions,
  SandboxStatusInfo,
} from "./types";

interface FreestyleCreateResponse {
  vmId: string;
  domains?: string[];
  consoleUrl?: string;
}

interface FreestyleVmStatus {
  vmId: string;
  status: "running" | "suspended" | "stopped" | "starting" | "error";
  domains?: string[];
}

export class FreestyleSandboxProvider implements SandboxProvider {
  readonly name = "freestyle" as const;
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.freestyle.sh";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("FREESTYLE_API_KEY is required");
    }
    this.apiKey = apiKey;
  }

  async spawn(options: SandboxSpawnOptions): Promise<SandboxInstance> {
    // Use POST /v1/vms
    const response = await fetch(`${this.baseUrl}/v1/vms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        // Use snapshotId for base image
        snapshotId: options.snapshotId,
        // Idle timeout in seconds (similar to Morph's TTL)
        idleTimeoutSeconds: options.ttlSeconds,
        // cmux-acp-server runs via systemd and is configured via /api/acp/configure
        // endpoint after spawn (since env vars don't work with memory snapshots)
        systemd: {
          services: [
            {
              name: "cmux-acp",
              mode: "service",
              exec: ["/usr/local/bin/cmux-acp-server"],
              wantedBy: ["multi-user.target"],
              restartPolicy: {
                policy: "on-failure",
                restartSec: 5,
              },
            },
          ],
        },
        // Persistence type - ephemeral means VM is deleted on idle timeout
        persistence: {
          type: options.ttlAction === "pause" ? "sticky" : "ephemeral",
        },
        // Metadata for tracking
        additionalFiles: {
          "/etc/cmux/metadata.json": {
            content: JSON.stringify({
              app: "cmux-acp",
              teamId: options.teamId,
              ...options.metadata,
            }),
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("[freestyle] Failed to spawn VM:", text);
      throw new Error(`Failed to spawn Freestyle VM: ${response.status}`);
    }

    const data = (await response.json()) as FreestyleCreateResponse;

    return {
      instanceId: data.vmId,
      provider: "freestyle",
      // Freestyle VMs are accessible at <vmId>.vm.freestyle.sh
      sandboxUrl: `https://${data.vmId}.vm.freestyle.sh`,
    };
  }

  async stop(instanceId: string): Promise<void> {
    // Use DELETE /v1/vms/{vmId}
    const response = await fetch(
      `${this.baseUrl}/v1/vms/${instanceId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      console.error("[freestyle] Failed to stop VM:", text);
      throw new Error(`Failed to stop Freestyle VM: ${response.status}`);
    }
  }

  async pause(instanceId: string): Promise<void> {
    // Use POST /v1/vms/{vmId}/suspend
    const response = await fetch(
      `${this.baseUrl}/v1/vms/${instanceId}/suspend`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("[freestyle] Failed to suspend VM:", text);
      throw new Error(`Failed to suspend Freestyle VM: ${response.status}`);
    }
  }

  async resume(instanceId: string): Promise<void> {
    // Use POST /v1/vms/{vmId}/start to resume a suspended VM
    const response = await fetch(
      `${this.baseUrl}/v1/vms/${instanceId}/start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("[freestyle] Failed to resume VM:", text);
      throw new Error(`Failed to resume Freestyle VM: ${response.status}`);
    }
  }

  async getStatus(instanceId: string): Promise<SandboxStatusInfo> {
    // Use GET /v1/vms/{vmId}
    const response = await fetch(
      `${this.baseUrl}/v1/vms/${instanceId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { status: "stopped" };
      }
      const text = await response.text();
      console.error("[freestyle] Failed to get VM status:", text);
      throw new Error(`Failed to get Freestyle VM status: ${response.status}`);
    }

    const data = (await response.json()) as FreestyleVmStatus;

    // Map Freestyle status to our unified status
    const statusMap: Record<string, SandboxStatusInfo["status"]> = {
      running: "running",
      starting: "starting",
      suspended: "paused",
      stopped: "stopped",
      error: "error",
    };

    return {
      status: statusMap[data.status] ?? "error",
      sandboxUrl: `https://${instanceId}.vm.freestyle.sh`,
    };
  }
}
