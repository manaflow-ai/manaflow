/**
 * E2B sandbox provider implementation.
 *
 * Uses E2B REST API directly (not SDK) for Convex compatibility.
 * The SDK requires Node.js APIs which aren't available in Convex runtime.
 * https://e2b.dev/docs/api
 *
 * Note: E2B sandboxes are lightweight VMs (~150ms startup).
 * They support custom templates but not runtime RAM snapshots.
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

const traceE2B = async <T>(
  name: string,
  attributes: SpanAttributes,
  task: () => Promise<T>
): Promise<T> => {
  return Effect.runPromise(
    Effect.tryPromise({
      try: task,
      catch: (error) => {
        console.error(`[e2b] ${name} failed`, error);
        return error instanceof Error ? error : new Error(`e2b.${name} failed`);
      },
    }).pipe(
      Effect.withSpan(`e2b.${name}`, { attributes: sanitizeAttributes(attributes) }),
      Effect.provide(TracingLive)
    )
  );
};

/**
 * E2B API response types.
 * Field names match E2B API exactly (uppercase ID suffix).
 */
interface E2BSandboxResponse {
  sandboxID: string;
  templateID: string;
  alias?: string;
  clientID: string;
  startedAt?: string;
  endAt?: string;
  metadata?: Record<string, string>;
}

const ACP_PORT = 39384;

export class E2BSandboxProvider implements SandboxProvider {
  readonly name = "e2b" as const;
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.e2b.dev";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("E2B_API_KEY is required");
    }
    this.apiKey = apiKey;
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
        "X-API-Key": this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`E2B API error (${response.status}): ${text}`);
    }

    // Some endpoints return empty body
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  /**
   * Get the sandbox URL for a given sandbox ID.
   * Format: https://{port}-{sandboxID}.e2b.app
   */
  private getSandboxUrl(sandboxID: string): string {
    return `https://${ACP_PORT}-${sandboxID}.e2b.app`;
  }

  async spawn(options: SandboxSpawnOptions): Promise<SandboxInstance> {
    return traceE2B(
      "spawn",
      {
        snapshotId: options.snapshotId ?? "base",
        ttlSeconds: options.ttlSeconds,
        teamId: options.teamId,
      },
      async () => {
        const templateId = options.snapshotId || "base";

        const sandbox = await this.request<E2BSandboxResponse>(
          "POST",
          "/sandboxes",
          {
            templateID: templateId,
            timeout: options.ttlSeconds, // E2B API expects seconds
            metadata: {
              app: "cmux-acp",
              teamId: options.teamId,
              ...Object.fromEntries(
                Object.entries(options.metadata).map(([k, v]) => [k, String(v)])
              ),
            },
          }
        );

        return {
          instanceId: sandbox.sandboxID,
          provider: "e2b",
          sandboxUrl: this.getSandboxUrl(sandbox.sandboxID),
        };
      }
    );
  }

  async stop(instanceId: string): Promise<void> {
    return traceE2B(
      "stop",
      { instanceId },
      async () => {
        await this.request("DELETE", `/sandboxes/${instanceId}`);
      }
    );
  }

  async pause(instanceId: string): Promise<void> {
    // E2B doesn't support pause - just extend timeout or kill
    console.warn("[e2b] pause not supported, use stop instead");
    await this.stop(instanceId);
  }

  async resume(instanceId: string): Promise<void> {
    // E2B doesn't support resume - sandboxes are ephemeral
    console.warn("[e2b] resume not supported, sandbox must be recreated");
    throw new Error(`Cannot resume E2B sandbox ${instanceId} - sandboxes are ephemeral`);
  }

  async getStatus(instanceId: string): Promise<SandboxStatusInfo> {
    return traceE2B(
      "getStatus",
      { instanceId },
      async () => {
        try {
          const sandbox = await this.request<E2BSandboxResponse>(
            "GET",
            `/sandboxes/${instanceId}`
          );

          return {
            status: "running",
            sandboxUrl: this.getSandboxUrl(sandbox.sandboxID),
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
