/**
 * Blaxel sandbox provider implementation.
 *
 * Uses Blaxel SDK to spawn and manage sandboxes.
 * https://blaxel.ai/
 *
 * Note: Blaxel sandboxes are container-based with preview URLs.
 * They support snapshots when snapshotEnabled=true at creation time.
 */

import { Effect } from "effect";
import { TracingLive } from "../../convex/effect/tracing";
import type {
  SandboxInstance,
  SandboxProvider,
  SandboxSpawnOptions,
  SandboxStatusInfo,
} from "./types";

type SpanAttributes = Record<string, boolean | number | string | undefined>;

const sanitizeAttributes = (
  attributes: SpanAttributes
): Record<string, boolean | number | string> => {
  const sanitized: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

const traceBlaxel = async <T>(
  name: string,
  attributes: SpanAttributes,
  task: () => Promise<T>
): Promise<T> => {
  return Effect.runPromise(
    Effect.tryPromise({
      try: task,
      catch: (error) => {
        console.error(`[blaxel] ${name} failed`, error);
        return error instanceof Error ? error : new Error(`blaxel.${name} failed`);
      },
    }).pipe(
      Effect.withSpan(`blaxel.${name}`, { attributes: sanitizeAttributes(attributes) }),
      Effect.provide(TracingLive)
    )
  );
};

/**
 * Blaxel API response types
 */
interface BlaxelSandboxMetadata {
  name: string;
  displayName?: string;
  labels?: Record<string, string>;
}

interface BlaxelSandboxSpec {
  runtime?: {
    image?: string;
  };
  region?: string;
}

interface BlaxelSandboxStatus {
  status?: "PROVISIONING" | "RUNNING" | "TERMINATED" | "FAILED";
  message?: string;
}

interface BlaxelSandbox {
  metadata?: BlaxelSandboxMetadata;
  spec?: BlaxelSandboxSpec;
  status?: BlaxelSandboxStatus;
}

export class BlaxelSandboxProvider implements SandboxProvider {
  readonly name = "blaxel" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly workspace: string;

  constructor(apiKey: string, options?: { workspace?: string; baseUrl?: string }) {
    if (!apiKey) {
      throw new Error("BLAXEL_API_KEY is required");
    }
    this.apiKey = apiKey;
    this.workspace = options?.workspace || process.env.BL_WORKSPACE || "default";
    this.baseUrl = options?.baseUrl || "https://api.blaxel.ai";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Blaxel API error (${response.status}): ${text}`);
    }

    // Some endpoints return empty body
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async spawn(options: SandboxSpawnOptions): Promise<SandboxInstance> {
    return traceBlaxel(
      "spawn",
      {
        snapshotId: options.snapshotId ?? "base",
        ttlSeconds: options.ttlSeconds,
        teamId: options.teamId,
      },
      async () => {
        // Generate unique sandbox name
        const sandboxName = `cmux-acp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Create sandbox using Blaxel API
        const sandbox = await this.request<BlaxelSandbox>(
          "POST",
          `/v1/workspaces/${this.workspace}/sandboxes`,
          {
            metadata: {
              name: sandboxName,
              labels: {
                app: "cmux-acp",
                teamId: options.teamId,
                ...Object.fromEntries(
                  Object.entries(options.metadata).map(([k, v]) => [k, String(v)])
                ),
              },
            },
            spec: {
              image: options.snapshotId || "blaxel/base-image:latest",
              memory: 8192,
              ttl: `${options.ttlSeconds}s`,
              snapshotEnabled: true,
              ports: [
                { name: "acp", target: 39384, protocol: "HTTP" },
              ],
              envs: [
                { name: "DEBIAN_FRONTEND", value: "noninteractive" },
              ],
            },
          }
        );

        const instanceId = sandbox.metadata?.name || sandboxName;

        // Blaxel creates a preview URL for exposed ports
        // The URL format typically follows: https://{port}-{sandbox-name}.{region}.blaxel.ai
        // But we need to wait for it to be provisioned, so we'll construct a placeholder
        // The actual URL will be retrieved via getStatus once running
        const sandboxUrl = undefined; // Will be set when sandbox is ready

        return {
          instanceId,
          provider: "blaxel",
          sandboxUrl,
        };
      }
    );
  }

  async stop(instanceId: string): Promise<void> {
    return traceBlaxel(
      "stop",
      { instanceId },
      async () => {
        await this.request(
          "DELETE",
          `/v1/workspaces/${this.workspace}/sandboxes/${instanceId}`
        );
      }
    );
  }

  async pause(_instanceId: string): Promise<void> {
    // Blaxel doesn't have a native pause - we could potentially stop and rely on snapshots
    console.warn("[blaxel] pause not natively supported, sandbox will remain running");
    // No-op for now - sandbox continues running with TTL
  }

  async resume(instanceId: string): Promise<void> {
    // Blaxel doesn't have a native resume from paused state
    console.warn("[blaxel] resume not supported, use getStatus to check if running");
    // Just verify the sandbox is still available
    const status = await this.getStatus(instanceId);
    if (status.status === "stopped") {
      throw new Error(`Cannot resume Blaxel sandbox ${instanceId} - sandbox is stopped`);
    }
  }

  async getStatus(instanceId: string): Promise<SandboxStatusInfo> {
    return traceBlaxel(
      "getStatus",
      { instanceId },
      async () => {
        try {
          const sandbox = await this.request<BlaxelSandbox>(
            "GET",
            `/v1/workspaces/${this.workspace}/sandboxes/${instanceId}`
          );

          const blaxelStatus = sandbox.status?.status;

          // Map Blaxel status to our status
          let status: SandboxStatusInfo["status"];
          switch (blaxelStatus) {
            case "PROVISIONING":
              status = "starting";
              break;
            case "RUNNING":
              status = "running";
              break;
            case "TERMINATED":
              status = "stopped";
              break;
            case "FAILED":
              status = "error";
              break;
            default:
              status = "stopped";
          }

          // Construct the sandbox URL for ACP server port
          // Blaxel preview URLs are typically: https://{port}-{sandbox-name}.preview.blaxel.ai
          const sandboxUrl = status === "running"
            ? `https://39384-${instanceId}.preview.blaxel.ai`
            : undefined;

          return {
            status,
            sandboxUrl,
            error: blaxelStatus === "FAILED" ? sandbox.status?.message : undefined,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes("404")) {
            return { status: "stopped" };
          }
          throw error;
        }
      }
    );
  }
}
