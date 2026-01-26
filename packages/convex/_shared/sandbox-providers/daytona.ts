/**
 * Daytona sandbox provider implementation.
 *
 * Uses Daytona SDK to spawn and manage sandboxes.
 * https://daytona.io/
 *
 * Note: Daytona sandboxes are container-based, not full VMs.
 * Some features like RAM snapshots are not available.
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

const traceDaytona = async <T>(
  name: string,
  attributes: SpanAttributes,
  task: () => Promise<T>
): Promise<T> => {
  return Effect.runPromise(
    Effect.tryPromise({
      try: task,
      catch: (error) => {
        console.error(`[daytona] ${name} failed`, error);
        return error instanceof Error ? error : new Error(`daytona.${name} failed`);
      },
    }).pipe(
      Effect.withSpan(`daytona.${name}`, { attributes: sanitizeAttributes(attributes) }),
      Effect.provide(TracingLive)
    )
  );
};

/**
 * Daytona API response types
 */
interface DaytonaSandboxResponse {
  id: string;
  name: string;
  state: "started" | "stopped" | "error" | "starting" | "stopping" | "archived" | "pending" | "pending_build" | "build_failed" | "destroyed";
  errorReason?: string;
  target: string;
}

interface DaytonaPreviewLinkResponse {
  url: string;
  token: string;
}

export class DaytonaSandboxProvider implements SandboxProvider {
  readonly name = "daytona" as const;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly target: string;

  constructor(apiKey: string, options?: { apiUrl?: string; target?: string }) {
    if (!apiKey) {
      throw new Error("DAYTONA_API_KEY is required");
    }
    this.apiKey = apiKey;
    this.apiUrl = options?.apiUrl ?? "https://app.daytona.io/api";
    this.target = options?.target ?? "us";
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "X-Daytona-Source": "cmux-convex",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Daytona API error (${response.status}): ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async spawn(options: SandboxSpawnOptions): Promise<SandboxInstance> {
    return traceDaytona(
      "spawn",
      {
        snapshotId: options.snapshotId ?? "none",
        ttlSeconds: options.ttlSeconds,
        teamId: options.teamId,
      },
      async () => {
        // Create sandbox from snapshot or default image
        const createPayload: Record<string, unknown> = {
          target: this.target,
          autoStopInterval: Math.ceil(options.ttlSeconds / 60), // Convert to minutes
          autoDeleteInterval: -1, // Disable auto-delete
          labels: {
            app: "cmux-acp",
            teamId: options.teamId,
            ...options.metadata,
          },
          env: {
            DEBIAN_FRONTEND: "noninteractive",
          },
        };

        if (options.snapshotId) {
          createPayload.snapshot = options.snapshotId;
        }

        const sandbox = await this.request<DaytonaSandboxResponse>(
          "POST",
          "/sandboxes",
          createPayload
        );

        // Wait for sandbox to be ready
        let status = sandbox.state;
        let attempts = 0;
        const maxAttempts = 60; // 5 minutes with 5s intervals

        while (status !== "started" && attempts < maxAttempts) {
          if (status === "error" || status === "build_failed" || status === "destroyed") {
            throw new Error(`Sandbox failed to start: ${sandbox.errorReason || status}`);
          }

          await new Promise((resolve) => setTimeout(resolve, 5000));
          const updated = await this.request<DaytonaSandboxResponse>(
            "GET",
            `/sandboxes/${sandbox.id}`
          );
          status = updated.state;
          attempts++;
        }

        if (status !== "started") {
          throw new Error(`Sandbox did not start within timeout (status: ${status})`);
        }

        // Get preview URL for the ACP server port
        const previewLink = await this.request<DaytonaPreviewLinkResponse>(
          "GET",
          `/sandboxes/${sandbox.id}/ports/39384/preview`
        );

        return {
          instanceId: sandbox.id,
          provider: "daytona",
          sandboxUrl: previewLink.url,
        };
      }
    );
  }

  async stop(instanceId: string): Promise<void> {
    return traceDaytona(
      "stop",
      { instanceId },
      async () => {
        await this.request("DELETE", `/sandboxes/${instanceId}`);
      }
    );
  }

  async pause(instanceId: string): Promise<void> {
    return traceDaytona(
      "pause",
      { instanceId },
      async () => {
        // Daytona uses "stop" instead of pause
        await this.request("POST", `/sandboxes/${instanceId}/stop`);
      }
    );
  }

  async resume(instanceId: string): Promise<void> {
    return traceDaytona(
      "resume",
      { instanceId },
      async () => {
        await this.request("POST", `/sandboxes/${instanceId}/start`);
      }
    );
  }

  async getStatus(instanceId: string): Promise<SandboxStatusInfo> {
    return traceDaytona(
      "getStatus",
      { instanceId },
      async () => {
        try {
          const sandbox = await this.request<DaytonaSandboxResponse>(
            "GET",
            `/sandboxes/${instanceId}`
          );

          // Map Daytona status to our status
          const statusMap: Record<string, SandboxStatusInfo["status"]> = {
            started: "running",
            starting: "starting",
            pending: "starting",
            pending_build: "starting",
            stopped: "stopped",
            stopping: "stopping",
            archived: "stopped",
            error: "error",
            build_failed: "error",
            destroyed: "stopped",
          };

          let sandboxUrl: string | undefined;
          if (sandbox.state === "started") {
            try {
              const previewLink = await this.request<DaytonaPreviewLinkResponse>(
                "GET",
                `/sandboxes/${sandbox.id}/ports/39384/preview`
              );
              sandboxUrl = previewLink.url;
            } catch {
              // Preview link not available yet
            }
          }

          return {
            status: statusMap[sandbox.state] ?? "error",
            sandboxUrl,
            error: sandbox.errorReason,
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
