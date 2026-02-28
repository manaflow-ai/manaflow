/**
 * Manaflow devbox CLI HTTP API - Convex httpActions that proxy Morph Cloud operations.
 *
 * All endpoints require Stack Auth authentication and inject the MORPH_API_KEY server-side.
 * Instance data is tracked in devboxInstances table, with provider info in devboxInfo.
 */
import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import type { DevboxProvider } from "@cmux/shared/provider-types";
import type { FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";

type SandboxProvider = DevboxProvider;

// Provider action APIs - cast from internal to access provider-specific actions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const e2bActionsApi = (internal as any).e2b_actions as {
  getInstance: FunctionReference<"action", "internal">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modalActionsApi = (internal as any).modal_actions as {
  getInstance: FunctionReference<"action", "internal">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pveLxcActionsApi = (internal as any).pve_lxc_actions as {
  getInstance: FunctionReference<"action", "internal">;
};

function getActionsApiForProvider(provider: SandboxProvider) {
  switch (provider) {
    case "modal":
      return modalActionsApi;
    case "pve-lxc":
      return pveLxcActionsApi;
    default:
      return e2bActionsApi;
  }
}

async function getProviderInfo(
  ctx: ActionCtx,
  devboxId: string
): Promise<{ provider: SandboxProvider; providerInstanceId: string } | null> {
  const info = (await ctx.runQuery(internal.devboxInstances.getInfo, {
    devboxId,
  })) as { provider: string; providerInstanceId: string } | null;
  if (!info) return null;
  return {
    provider: info.provider as SandboxProvider,
    providerInstanceId: info.providerInstanceId,
  };
}

const MORPH_API_BASE_URL = "https://cloud.morph.so/api";

// Default snapshot ID for manaflow devbox CLI instances
const DEFAULT_CMUX_SNAPSHOT_ID = "snapshot_b74x626y";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

// Security: Validate instance ID format to prevent injection attacks
// IDs should be manaflow_, cmux_, or cr_ followed by 8+ alphanumeric characters
// - manaflow_/cmux_: Morph provider instances
// - cr_: PVE-LXC provider instances (cloudrouter)
const INSTANCE_ID_REGEX = /^(?:manaflow|cmux|cr)_[a-zA-Z0-9]{8,}$/;

function isValidInstanceId(id: string): boolean {
  return INSTANCE_ID_REGEX.test(id);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Verify content type is JSON for non-GET requests
 */
function verifyContentType(req: Request): Response | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (
    req.method !== "GET" &&
    req.method !== "DELETE" &&
    !contentType.toLowerCase().includes("application/json")
  ) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }
  return null;
}

/**
 * Get authenticated user identity from Convex auth.
 */
async function getAuthenticatedUser(
  ctx: ActionCtx
): Promise<{
  identity: { subject: string; name?: string; email?: string } | null;
  error: Response | null;
}> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return {
      identity: null,
      error: jsonResponse({ code: 401, message: "Unauthorized" }, 401),
    };
  }
  return { identity, error: null };
}

/**
 * Make an authenticated request to the Morph API.
 */
async function morphFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY not configured");
  }

  const url = `${MORPH_API_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });
}

/**
 * Extract networking URLs from Morph instance data.
 */
function extractNetworkingUrls(
  httpServices: Array<{ port: number; url: string; name?: string }> | Record<string, string>
) {
  // Handle both array format (new) and object format (legacy)
  if (Array.isArray(httpServices)) {
    const vscodeService = httpServices.find((s) => s.port === 39378 || s.name === "vscode");
    const workerService = httpServices.find((s) => s.port === 39377 || s.name === "worker");
    const vncService = httpServices.find((s) => s.port === 39380 || s.name === "vnc");

    return {
      vscodeUrl: vscodeService?.url,
      workerUrl: workerService?.url,
      vncUrl: vncService?.url,
    };
  } else {
    // Legacy object format: { "39378": "url", "vscode": "url" }
    return {
      vscodeUrl: httpServices["39378"] ?? httpServices["vscode"],
      workerUrl: httpServices["39377"] ?? httpServices["worker"],
      vncUrl: httpServices["39380"] ?? httpServices["vnc"],
    };
  }
}

function buildDbaProxyUrls(workerUrl?: string) {
  if (!workerUrl) {
    return { vscodeUrl: undefined, vncUrl: undefined };
  }

  const base = workerUrl.replace(/\/+$/, "");
  return {
    vscodeUrl: `${base}/code/?folder=/home/cmux/workspace`,
    vncUrl: `${base}/vnc/vnc.html?path=vnc/websockify&resize=scale&quality=9&compression=0`,
  };
}

/**
 * Record activity for a Morph instance (creates entry in morphInstanceActivity table)
 */
async function recordMorphActivity(
  ctx: ActionCtx,
  providerInstanceId: string,
  action: "resume" | "pause" | "stop"
): Promise<void> {
  try {
    if (action === "resume") {
      await ctx.runMutation(internal.morphInstances.recordResumeInternal, {
        instanceId: providerInstanceId,
      });
    } else if (action === "pause") {
      await ctx.runMutation(internal.morphInstances.recordPauseInternal, {
        instanceId: providerInstanceId,
      });
    } else if (action === "stop") {
      await ctx.runMutation(internal.morphInstances.recordStopInternal, {
        instanceId: providerInstanceId,
      });
    }
  } catch (error) {
    // Log but don't fail the main operation if activity recording fails
    console.error("[cmux] Failed to record morph activity:", error);
  }
}

/**
 * Get the provider instance ID for a devbox ID
 */
async function getProviderInstanceId(
  ctx: ActionCtx,
  devboxId: string
): Promise<string | null> {
  const info = await ctx.runQuery(internal.devboxInstances.getInfo, {
    devboxId,
  }) as { providerInstanceId: string } | null;
  return info?.providerInstanceId ?? null;
}

// ============================================================================
// POST /api/v1/cmux/instances - Start a new instance from snapshot
// ============================================================================
export const createInstance = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  let body: {
    teamSlugOrId: string;
    snapshotId?: string;
    name?: string;
    ttlSeconds?: number;
    vcpus?: number;
    memory?: number;
    diskSize?: number;
    metadata?: Record<string, string>;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  const apiKey = env.MORPH_API_KEY;
  if (!apiKey) {
    return jsonResponse(
      { code: 503, message: "Morph API not configured" },
      503
    );
  }

  try {
    const snapshotId = body.snapshotId ?? DEFAULT_CMUX_SNAPSHOT_ID;
    const startTime = Date.now();
    const timings: Record<string, number> = {};

    // Start a new Morph instance via boot endpoint
    console.log("[cmux.create] Starting boot...");
    const bootStart = Date.now();
    const morphResponse = await morphFetch(`/snapshot/${snapshotId}/boot`, {
      method: "POST",
      body: JSON.stringify({
        ttl_seconds: body.ttlSeconds ?? 60 * 60, // 1 hour default
        ttl_action: "pause",
        vcpus: body.vcpus ?? 2,
        memory: body.memory ?? 4096, // 4GB default
        disk_size: body.diskSize ?? 8192, // 8GB default
        metadata: {
          app: "cmux-devbox",
          userId: identity!.subject,
          // Validate metadata: only allow string key-value pairs, filter out non-strings
          ...(body.metadata
            ? Object.fromEntries(
                Object.entries(body.metadata).filter(
                  ([, v]) => typeof v === "string"
                )
              )
            : {}),
        },
      }),
    });
    timings.boot = Date.now() - bootStart;
    console.log(`[cmux.create] Boot completed in ${timings.boot}ms`);

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.create] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to create instance" },
        502
      );
    }

    const morphData = (await morphResponse.json()) as {
      id: string;
      status: string;
      networking?: {
        http_services?: Array<{ port: number; url: string; name?: string }> | Record<string, string>;
      };
      spec?: {
        vcpus?: number;
        memory?: number;
        disk_size?: number;
      };
    };

    // Expose HTTP services (worker only) for the new instance
    const exposedServices: { workerUrl?: string } = {};
    const servicesToExpose = [{ name: "worker", port: 39377 }];

    console.log("[cmux.create] Exposing HTTP services...");
    const exposeStart = Date.now();
    for (const service of servicesToExpose) {
      try {
        const exposeResponse = await morphFetch(
          `/instance/${morphData.id}/http`,
          {
            method: "POST",
            body: JSON.stringify({ name: service.name, port: service.port }),
          }
        );
        if (exposeResponse.ok) {
          const exposeData = (await exposeResponse.json()) as { url?: string };
          if (service.name === "worker") exposedServices.workerUrl = exposeData.url;
        }
      } catch (e) {
        console.error(`[cmux.create] Failed to expose ${service.name}:`, e);
      }
    }
    timings.exposeHttp = Date.now() - exposeStart;
    console.log(`[cmux.create] Expose HTTP completed in ${timings.exposeHttp}ms`);

    // Fall back to any services that were already in the boot response
    const httpServices = morphData.networking?.http_services ?? [];
    const bootUrls = extractNetworkingUrls(httpServices);
    const workerUrl = exposedServices.workerUrl ?? bootUrls.workerUrl;
    const proxyUrls = buildDbaProxyUrls(workerUrl);

    // Helper to clean up orphaned Morph VM on failure
    // This prevents resource leaks when subsequent operations fail after VM creation
    const cleanupMorphInstance = async (reason: string) => {
      console.warn(`[cmux.create] Cleaning up orphaned Morph VM ${morphData.id}: ${reason}`);
      try {
        const deleteResponse = await morphFetch(`/instance/${morphData.id}`, {
          method: "DELETE",
        });
        if (deleteResponse.ok) {
          console.log(`[cmux.create] Successfully deleted orphaned VM ${morphData.id}`);
        } else {
          console.error(`[cmux.create] Failed to delete orphaned VM ${morphData.id}: ${deleteResponse.status}`);
        }
      } catch (cleanupError) {
        console.error(`[cmux.create] Error deleting orphaned VM ${morphData.id}:`, cleanupError);
      }
    };

    // Inject auth config for worker daemon (JWT validation)
    // This writes the owner ID and Stack Auth project ID to the VM
    const stackProjectId = env.NEXT_PUBLIC_STACK_PROJECT_ID;
    if (stackProjectId) {
      try {
        console.log("[cmux.create] Injecting auth config...");
        const authStart = Date.now();

        // Helper to run exec commands and check results
        const runExec = async (command: string[], description: string): Promise<void> => {
          const response = await morphFetch(`/instance/${morphData.id}/exec`, {
            method: "POST",
            body: JSON.stringify({ command, timeout: 10 }),
          });
          if (!response.ok) {
            const errorText = await response.text().catch(() => "unknown error");
            throw new Error(`${description} failed (${response.status}): ${errorText}`);
          }
        };

        // Fix /home/cmux ownership (may be root:root in snapshot) and create config dir
        const chownStart = Date.now();
        await runExec(["chown", "cmux:cmux", "/home/cmux"], "chown");
        timings.chown = Date.now() - chownStart;
        console.log(`[cmux.create] chown completed in ${timings.chown}ms`);

        // Create directory
        const mkdirStart = Date.now();
        await runExec(["mkdir", "-p", "/var/run/cmux"], "mkdir");
        timings.mkdir = Date.now() - mkdirStart;
        console.log(`[cmux.create] mkdir completed in ${timings.mkdir}ms`);

        // Write owner ID - Morph exec wraps commands in shell, so pass args directly
        const ownerId = identity!.subject;
        const ownerIdStart = Date.now();
        await runExec(["echo", ownerId, ">", "/var/run/cmux/owner-id"], "write owner-id");
        timings.writeOwnerId = Date.now() - ownerIdStart;
        console.log(`[cmux.create] write owner-id completed in ${timings.writeOwnerId}ms`);

        // Write Stack Auth project ID
        const projectIdStart = Date.now();
        await runExec(["echo", stackProjectId, ">", "/var/run/cmux/stack-project-id"], "write project-id");
        timings.writeProjectId = Date.now() - projectIdStart;
        console.log(`[cmux.create] write project-id completed in ${timings.writeProjectId}ms`);

        // Restart cmux-worker to pick up the new config
        const restartStart = Date.now();
        await runExec(["systemctl", "restart", "--no-block", "cmux-worker"], "restart cmux-worker");
        timings.restartWorker = Date.now() - restartStart;
        console.log(`[cmux.create] restart cmux-worker completed in ${timings.restartWorker}ms`);

        timings.authTotal = Date.now() - authStart;
        console.log(`[cmux.create] Auth config total: ${timings.authTotal}ms`);
      } catch (e) {
        console.error("[cmux.create] Failed to inject auth config:", e);
        // Clean up the orphaned VM before returning error
        await cleanupMorphInstance(`Auth config injection failed: ${e instanceof Error ? e.message : "unknown error"}`);
        return jsonResponse(
          { code: 500, message: `Failed to configure worker auth: ${e instanceof Error ? e.message : "unknown error"}` },
          500
        );
      }
    } else {
      console.warn("[cmux.create] NEXT_PUBLIC_STACK_PROJECT_ID not set, worker auth will be disabled");
    }

    // Store the instance in Convex with provider mapping (no URL caching)
    console.log("[cmux.create] Storing in Convex...");
    const convexStart = Date.now();
    let result: { id: string; isExisting: boolean };
    try {
      result = await ctx.runMutation(api.devboxInstances.create, {
        teamSlugOrId: body.teamSlugOrId,
        providerInstanceId: morphData.id,
        provider: "morph",
        name: body.name,
        snapshotId,
        metadata: body.metadata,
        source: "cli",
      }) as { id: string; isExisting: boolean };
    } catch (convexError) {
      // Convex mutation failed (e.g., invalid team) - clean up the Morph VM
      await cleanupMorphInstance(`Convex mutation failed: ${convexError instanceof Error ? convexError.message : "unknown error"}`);
      throw convexError; // Re-throw to be caught by outer catch
    }
    timings.convexStore = Date.now() - convexStart;
    console.log(`[cmux.create] Convex store completed in ${timings.convexStore}ms`);

    timings.total = Date.now() - startTime;
    console.log(`[cmux.create] TOTAL: ${timings.total}ms | Breakdown:`, timings);

    // Return URLs from Morph response (not cached in DB)
    return jsonResponse({
      id: result.id,
      status: morphData.status,
      snapshotId,
      vscodeUrl: proxyUrls.vscodeUrl,
      workerUrl,
      vncUrl: proxyUrls.vncUrl,
      spec: morphData.spec,
    });
  } catch (error) {
    console.error("[cmux.create] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to create instance" },
      500
    );
  }
});

// ============================================================================
// GET /api/v1/cmux/instances - List instances
// ============================================================================
export const listInstances = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  try {
    const rawInstances = await ctx.runQuery(api.devboxInstances.list, {
      teamSlugOrId,
    }) as Array<{
      devboxId: string;
      status: string;
      name?: string;
      createdAt: number;
      updatedAt: number;
    }>;

    // Return basic instance info with id field (URLs are fetched via GET /instances/{id})
    const instances = rawInstances.map((inst) => ({
      id: inst.devboxId,
      status: inst.status,
      name: inst.name,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    }));

    return jsonResponse({ instances });
  } catch (error) {
    console.error("[cmux.list] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to list instances" },
      500
    );
  }
});

// ============================================================================
// GET /api/v1/cmux/instances/{id} - Get instance details
// ============================================================================
async function handleGetInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Get instance from Convex by ID
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    }) as { id: string; status: string; name?: string } | null;

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider info from devboxInfo table
    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse({ id, status: instance.status, name: instance.name });
    }

    const { provider, providerInstanceId } = providerInfo;

    // For Morph provider, use direct Morph API
    if (provider === "morph" || provider === "e2b") {
      return handleGetInstanceMorph(ctx, id, providerInstanceId, instance, teamSlugOrId);
    }

    // For other providers (pve-lxc, modal), use the provider actions API
    const actionsApi = getActionsApiForProvider(provider);
    const providerResult = (await ctx.runAction(actionsApi.getInstance, {
      instanceId: providerInstanceId,
    })) as {
      instanceId: string;
      status: string;
      vscodeUrl?: string | null;
      workerUrl?: string | null;
      vncUrl?: string | null;
    };

    const status = providerResult.status as "running" | "stopped" | "paused";

    // Update status in Convex if changed
    if (status !== instance.status) {
      await ctx.runMutation(api.devboxInstances.updateStatus, {
        teamSlugOrId,
        id,
        status,
      });
    }

    return jsonResponse({
      id,
      status,
      name: instance.name,
      vscodeUrl: providerResult.vscodeUrl ?? undefined,
      workerUrl: providerResult.workerUrl ?? undefined,
      vncUrl: providerResult.vncUrl ?? undefined,
    });
  } catch (error) {
    console.error("[cmux.get] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to get instance" }, 500);
  }
}

// Helper for Morph/E2B provider (legacy direct API call)
async function handleGetInstanceMorph(
  ctx: ActionCtx,
  id: string,
  providerInstanceId: string,
  instance: { id: string; status: string; name?: string },
  teamSlugOrId: string
): Promise<Response> {
  // Get fresh status and URLs from Morph
  const morphResponse = await morphFetch(`/instance/${providerInstanceId}`);

  if (!morphResponse.ok) {
    // Instance may have been deleted
    if (morphResponse.status === 404) {
      await ctx.runMutation(api.devboxInstances.updateStatus, {
        teamSlugOrId,
        id,
        status: "stopped",
      });
      return jsonResponse({
        id,
        status: "stopped",
        name: instance.name,
      });
    }
    // Return basic data on other errors
    return jsonResponse({ id, status: instance.status, name: instance.name });
  }

  const morphData = (await morphResponse.json()) as {
    id: string;
    status: string;
    networking?: {
      http_services?: Array<{ port: number; url: string; name?: string }> | Record<string, string>;
    };
    spec?: {
      vcpus?: number;
      memory?: number;
      disk_size?: number;
    };
  };

  // Get URLs directly from Morph (not cached)
  const httpServices = morphData.networking?.http_services ?? [];
  const { workerUrl } = extractNetworkingUrls(httpServices);
  const proxyUrls = buildDbaProxyUrls(workerUrl);

  return jsonResponse({
    id,
    status: morphData.status,
    name: instance.name,
    vscodeUrl: proxyUrls.vscodeUrl,
    workerUrl,
    vncUrl: proxyUrls.vncUrl,
    spec: morphData.spec,
  });
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/exec - Execute command
// ============================================================================
async function handleExecCommand(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  command: string | string[],
  timeout?: number
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Morph API expects command as an array and runs it directly without a shell.
    // To preserve shell operators (&&, |, >) and quoted arguments, wrap string
    // commands in sh -c. Array commands are passed directly for precise control.
    const commandArray = Array.isArray(command)
      ? command
      : ["sh", "-c", command];

    // Execute command via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/exec`,
      {
        method: "POST",
        body: JSON.stringify({
          command: commandArray,
          timeout: timeout ?? 30,
        }),
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.exec] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to execute command" },
        502
      );
    }

    const result = await morphResponse.json();

    // Record access
    await ctx.runMutation(api.devboxInstances.recordAccess, {
      teamSlugOrId,
      id,
    });

    return jsonResponse(result);
  } catch (error) {
    console.error("[cmux.exec] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to execute command" },
      500
    );
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/pause - Pause instance
// ============================================================================
async function handlePauseInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Pause via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/pause`,
      {
        method: "POST",
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.pause] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to pause instance" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(api.devboxInstances.updateStatus, {
      teamSlugOrId,
      id,
      status: "paused",
    });

    // Record activity in morphInstanceActivity table
    await recordMorphActivity(ctx, providerInstanceId, "pause");

    return jsonResponse({ paused: true });
  } catch (error) {
    console.error("[cmux.pause] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to pause instance" },
      500
    );
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/resume - Resume instance
// ============================================================================
async function handleResumeInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Resume via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/resume`,
      {
        method: "POST",
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.resume] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to resume instance" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(api.devboxInstances.updateStatus, {
      teamSlugOrId,
      id,
      status: "running",
    });

    // Record activity in morphInstanceActivity table
    await recordMorphActivity(ctx, providerInstanceId, "resume");

    return jsonResponse({ resumed: true });
  } catch (error) {
    console.error("[cmux.resume] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to resume instance" },
      500
    );
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/stop - Stop instance
// ============================================================================
async function handleStopInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Stop via Morph API (DELETE)
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}`,
      {
        method: "DELETE",
      }
    );

    if (!morphResponse.ok && morphResponse.status !== 404) {
      const errorText = await morphResponse.text();
      console.error("[cmux.stop] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to stop instance" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(api.devboxInstances.updateStatus, {
      teamSlugOrId,
      id,
      status: "stopped",
    });

    // Record activity in morphInstanceActivity table
    await recordMorphActivity(ctx, providerInstanceId, "stop");

    return jsonResponse({ stopped: true });
  } catch (error) {
    console.error("[cmux.stop] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to stop instance" }, 500);
  }
}

// ============================================================================
// GET /api/v1/cmux/instances/{id}/ssh - Get SSH credentials
// ============================================================================
async function handleGetInstanceSsh(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Get SSH credentials from Morph API
    const primaryResponse = await morphFetch(
      `/instance/${providerInstanceId}/ssh/key`
    );
    let morphResponse = primaryResponse;

    if (!primaryResponse.ok) {
      const fallbackResponse = await morphFetch(
        `/instance/${providerInstanceId}/ssh_key`
      );
      if (fallbackResponse.ok) {
        morphResponse = fallbackResponse;
      } else {
        const primaryText = await primaryResponse.text();
        const fallbackText = await fallbackResponse.text();
        console.error("[cmux.ssh] Morph API error:", {
          primaryStatus: primaryResponse.status,
          primaryBody: primaryText.slice(0, 500),
          fallbackStatus: fallbackResponse.status,
          fallbackBody: fallbackText.slice(0, 500),
        });
        return jsonResponse(
          { code: 502, message: "Failed to get SSH credentials" },
          502
        );
      }
    }

    const sshData = (await morphResponse.json()) as {
      private_key?: string;
      key?: string;
      public_key?: string;
      password?: string;
      access_token?: string;
    };

    // Record access
    await ctx.runMutation(api.devboxInstances.recordAccess, {
      teamSlugOrId,
      id,
    });

    return jsonResponse({
      id,
      privateKey: sshData.private_key ?? sshData.key,
      publicKey: sshData.public_key,
      accessToken: sshData.access_token,
      sshCommand: sshData.access_token
        ? `ssh ${sshData.access_token}@ssh.cloud.morph.so`
        : undefined,
    });
  } catch (error) {
    console.error("[cmux.ssh] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to get SSH credentials" },
      500
    );
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/ttl - Update TTL
// ============================================================================
async function handleUpdateTtl(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  ttlSeconds: number
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Update TTL via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/ttl`,
      {
        method: "POST",
        body: JSON.stringify({ ttl_seconds: ttlSeconds }),
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.ttl] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to update TTL" },
        502
      );
    }

    return jsonResponse({ updated: true, ttlSeconds });
  } catch (error) {
    console.error("[cmux.ttl] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to update TTL" }, 500);
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/reboot - Reboot instance
// ============================================================================
async function handleRebootInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Reboot via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/reboot`,
      {
        method: "POST",
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.reboot] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to reboot instance" },
        502
      );
    }

    return jsonResponse({ rebooted: true });
  } catch (error) {
    console.error("[cmux.reboot] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to reboot instance" }, 500);
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/snapshot - Create snapshot
// ============================================================================
async function handleSnapshotInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  digest?: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Create snapshot via Morph API
    const body: Record<string, string> = {};
    if (digest) {
      body.digest = digest;
    }

    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/snapshot`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.snapshot] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to create snapshot" },
        502
      );
    }

    const result = await morphResponse.json();
    return jsonResponse(result);
  } catch (error) {
    console.error("[cmux.snapshot] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to create snapshot" }, 500);
  }
}

// ============================================================================
// POST /api/v1/cmux/instances/{id}/http - Expose HTTP service
// ============================================================================
async function handleExposeHttpService(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  serviceName: string,
  port: number
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Expose HTTP service via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/http`,
      {
        method: "POST",
        body: JSON.stringify({ name: serviceName, port }),
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.http.expose] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to expose HTTP service" },
        502
      );
    }

    const result = await morphResponse.json();
    return jsonResponse(result);
  } catch (error) {
    console.error("[cmux.http.expose] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to expose HTTP service" }, 500);
  }
}

// ============================================================================
// DELETE /api/v1/cmux/instances/{id}/http/{serviceName} - Hide HTTP service
// ============================================================================
async function handleHideHttpService(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  serviceName: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(api.devboxInstances.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ code: 404, message: "Provider mapping not found" }, 404);
    }

    // Hide HTTP service via Morph API
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/http/${serviceName}`,
      {
        method: "DELETE",
      }
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.http.hide] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to hide HTTP service" },
        502
      );
    }

    return jsonResponse({ hidden: true });
  } catch (error) {
    console.error("[cmux.http.hide] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to hide HTTP service" }, 500);
  }
}

// ============================================================================
// GET /api/v1/cmux/snapshots - List snapshots
// ============================================================================
export const listSnapshots = httpAction(async (ctx) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  try {
    const morphResponse = await morphFetch("/snapshot");

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[cmux.snapshots.list] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to list snapshots" },
        502
      );
    }

    const result = await morphResponse.json();
    return jsonResponse({ snapshots: result });
  } catch (error) {
    console.error("[cmux.snapshots.list] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to list snapshots" }, 500);
  }
});

// ============================================================================
// GET /api/v1/cmux/snapshots/{id} - Get snapshot details
// ============================================================================
export const getSnapshot = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const snapshotId = pathParts[pathParts.length - 1];

  if (!snapshotId) {
    return jsonResponse({ code: 400, message: "Snapshot ID is required" }, 400);
  }

  try {
    const morphResponse = await morphFetch(`/snapshot/${snapshotId}`);

    if (!morphResponse.ok) {
      if (morphResponse.status === 404) {
        return jsonResponse({ code: 404, message: "Snapshot not found" }, 404);
      }
      const errorText = await morphResponse.text();
      console.error("[cmux.snapshots.get] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to get snapshot" },
        502
      );
    }

    const result = await morphResponse.json();
    return jsonResponse(result);
  } catch (error) {
    console.error("[cmux.snapshots.get] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to get snapshot" }, 500);
  }
});

// ============================================================================
// GET /api/v1/cmux/config - Get CLI configuration (snapshot ID, etc.)
// ============================================================================
export const getConfig = httpAction(async (ctx) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  return jsonResponse({
    defaultSnapshotId: DEFAULT_CMUX_SNAPSHOT_ID,
  });
});

// ============================================================================
// GET /api/v1/cmux/me - Get current user profile including team
// ============================================================================
export const getMe = httpAction(async (ctx) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  try {
    const userId = identity!.subject;

    // Look up user in users table by their Stack Auth subject (userId)
    const user = await ctx.runQuery(internal.users.getByUserIdInternal, {
      userId,
    });

    // Get user's team memberships to find a valid team
    const memberships = await ctx.runQuery(internal.teams.getMembershipsByUserIdInternal, {
      userId,
    });

    let teamId: string | null = null;
    let teamSlug: string | null = null;
    let teamDisplayName: string | null = null;

    // First, check if user's selectedTeamId is valid (they have membership)
    if (user?.selectedTeamId) {
      const hasMembership = memberships.some(m => m.teamId === user.selectedTeamId);
      if (hasMembership) {
        const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
          teamId: user.selectedTeamId,
        });
        if (team) {
          teamId = user.selectedTeamId;
          teamSlug = team.slug ?? team.uuid;
          teamDisplayName = team.displayName ?? team.name ?? null;
        }
      }
    }

    // Fall back to first team membership if selectedTeamId is invalid
    if (!teamId && memberships.length > 0) {
      const firstMembership = memberships[0];
      const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
        teamId: firstMembership.teamId,
      });
      if (team) {
        teamId = firstMembership.teamId;
        teamSlug = team.slug ?? team.uuid;
        teamDisplayName = team.displayName ?? team.name ?? null;
      } else {
        // Team doesn't exist in teams table, use raw teamId as slug
        teamId = firstMembership.teamId;
        teamSlug = firstMembership.teamId;
      }
    }

    return jsonResponse({
      userId,
      email: user?.primaryEmail ?? identity!.email,
      name: user?.displayName ?? identity!.name,
      teamId,
      teamSlug,
      teamDisplayName,
    });
  } catch (err) {
    console.error("[cmux.me] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to get user profile" },
      500
    );
  }
});

// ============================================================================
// GET /api/v1/cmux/me/teams - List all teams the user is a member of
// ============================================================================
export const listMyTeams = httpAction(async (ctx) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  try {
    const userId = identity!.subject;

    // Get user's selected team
    const user = await ctx.runQuery(internal.users.getByUserIdInternal, {
      userId,
    });

    // Get all team memberships
    const memberships = await ctx.runQuery(internal.teams.getMembershipsByUserIdInternal, {
      userId,
    });

    // Fetch team details for each membership
    const teams = await Promise.all(
      memberships.map(async (m) => {
        const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
          teamId: m.teamId,
        });
        return {
          teamId: m.teamId,
          slug: team?.slug ?? m.teamId,
          displayName: team?.displayName ?? team?.name ?? null,
          role: m.role,
          selected: m.teamId === user?.selectedTeamId,
        };
      })
    );

    return jsonResponse({
      teams,
      selectedTeamId: user?.selectedTeamId ?? null,
    });
  } catch (err) {
    console.error("[cmux.listMyTeams] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to list teams" },
      500
    );
  }
});

// ============================================================================
// POST /api/v1/cmux/me/team - Switch current user's selected team
// ============================================================================
export const switchTeam = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  try {
    const userId = identity!.subject;
    const body = await req.json() as { teamSlugOrId: string };

    if (!body.teamSlugOrId) {
      return jsonResponse(
        { code: 400, message: "teamSlugOrId is required" },
        400
      );
    }

    // Resolve team slug/id to canonical teamId
    const team = await ctx.runQuery(internal.teams.getBySlugOrIdInternal, {
      slugOrId: body.teamSlugOrId,
    });

    if (!team) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${body.teamSlugOrId}` },
        404
      );
    }

    // Check user has membership in this team
    const memberships = await ctx.runQuery(internal.teams.getMembershipsByUserIdInternal, {
      userId,
    });

    const hasMembership = memberships.some(m => m.teamId === team.teamId);
    if (!hasMembership) {
      return jsonResponse(
        { code: 403, message: `You are not a member of team: ${body.teamSlugOrId}` },
        403
      );
    }

    // Update user's selected team in Convex
    await ctx.runMutation(internal.users.updateSelectedTeamInternal, {
      userId,
      selectedTeamId: team.teamId,
      selectedTeamDisplayName: team.displayName ?? team.name ?? undefined,
      selectedTeamProfileImageUrl: team.profileImageUrl ?? undefined,
    });

    return jsonResponse({
      success: true,
      teamId: team.teamId,
      teamSlug: team.slug ?? team.teamId,
      teamDisplayName: team.displayName ?? team.name ?? null,
    });
  } catch (err) {
    console.error("[cmux.switchTeam] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to switch team" },
      500
    );
  }
});

// ============================================================================
// Route handler for instance-specific POST actions
// ============================================================================
export const instanceActionRouter = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;

  // Parse path to get id and action
  // Path formats:
  // /api/v1/cmux/instances/{id}/{action}
  // /api/v1/cmux/instances/{id}/http/{serviceName}
  const pathParts = path.split("/").filter(Boolean);
  // pathParts: ["api", "v1", "cmux", "instances", "{id}", "{action}", ...]

  const id = pathParts[4]; // instances/{id}
  const action = pathParts[5]; // {action}

  // Security: Validate instance ID format
  if (!id || !isValidInstanceId(id)) {
    return jsonResponse(
      { code: 400, message: "Invalid instance ID format" },
      400
    );
  }

  let body: {
    teamSlugOrId: string;
    command?: string | string[];
    timeout?: number;
    ttlSeconds?: number;
    digest?: string;
    serviceName?: string;
    port?: number;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  // Route based on the action
  switch (action) {
    case "exec":
      if (!body.command) {
        return jsonResponse({ code: 400, message: "command is required" }, 400);
      }
      return handleExecCommand(
        ctx,
        id,
        body.teamSlugOrId,
        body.command,
        body.timeout
      );

    case "pause":
      return handlePauseInstance(ctx, id, body.teamSlugOrId);

    case "resume":
      return handleResumeInstance(ctx, id, body.teamSlugOrId);

    case "stop":
      return handleStopInstance(ctx, id, body.teamSlugOrId);

    case "ttl":
      if (!body.ttlSeconds) {
        return jsonResponse({ code: 400, message: "ttlSeconds is required" }, 400);
      }
      return handleUpdateTtl(
        ctx,
        id,
        body.teamSlugOrId,
        body.ttlSeconds
      );

    case "reboot":
      return handleRebootInstance(ctx, id, body.teamSlugOrId);

    case "snapshot":
      return handleSnapshotInstance(
        ctx,
        id,
        body.teamSlugOrId,
        body.digest
      );

    case "http":
      if (!body.serviceName || !body.port) {
        return jsonResponse(
          { code: 400, message: "serviceName and port are required" },
          400
        );
      }
      return handleExposeHttpService(
        ctx,
        id,
        body.teamSlugOrId,
        body.serviceName,
        body.port
      );

    default:
      return jsonResponse({ code: 404, message: "Not found" }, 404);
  }
});

// ============================================================================
// Route handler for instance-specific GET actions
// ============================================================================
export const instanceGetRouter = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  // Parse path to get id and action
  const pathParts = path.split("/").filter(Boolean);
  // pathParts: ["api", "v1", "cmux", "instances", "{id}", "{action}?"]

  const id = pathParts[4];
  const action = pathParts[5]; // May be undefined for GET /instances/{id}

  // Security: Validate instance ID format
  if (!id || !isValidInstanceId(id)) {
    return jsonResponse(
      { code: 400, message: "Invalid instance ID format" },
      400
    );
  }

  // Route based on the action suffix
  if (action === "ssh") {
    return handleGetInstanceSsh(ctx, id, teamSlugOrId);
  }

  // Default: get instance details
  return handleGetInstance(ctx, id, teamSlugOrId);
});

// ============================================================================
// Route handler for instance-specific DELETE actions
// ============================================================================
export const instanceDeleteRouter = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  // Parse path: /api/v1/cmux/instances/{id}/http/{serviceName}
  const pathParts = path.split("/").filter(Boolean);
  const id = pathParts[4];
  const action = pathParts[5];

  // Security: Validate instance ID format
  if (!id || !isValidInstanceId(id)) {
    return jsonResponse(
      { code: 400, message: "Invalid instance ID format" },
      400
    );
  }

  if (action === "http") {
    const serviceName = pathParts[6];
    if (!serviceName) {
      return jsonResponse(
        { code: 400, message: "serviceName is required" },
        400
      );
    }
    return handleHideHttpService(ctx, id, teamSlugOrId, serviceName);
  }

  return jsonResponse({ code: 404, message: "Not found" }, 404);
});

// ============================================================================
// TASK ENDPOINTS - CLI/Web App sync for task management
// ============================================================================

/**
 * Resolve team ID from slug or ID (for internal use in httpActions).
 */
async function resolveTeamIdForHttp(
  ctx: ActionCtx,
  slugOrId: string
): Promise<string | null> {
  const team = await ctx.runQuery(internal.teams.getBySlugOrIdInternal, {
    slugOrId,
  }) as { teamId: string } | null;
  return team?.teamId ?? null;
}

// ============================================================================
// POST /api/v1/cmux/storage/upload-url - Generate a one-time upload URL
// ============================================================================
export const createStorageUploadUrl = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  let body: { teamSlugOrId: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  try {
    const uploadUrl = await ctx.runMutation(api.storage.generateUploadUrl, {
      teamSlugOrId: body.teamSlugOrId,
    });
    return jsonResponse({ uploadUrl });
  } catch (err) {
    console.error("[cmux.storage.upload-url] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to create upload URL" },
      500
    );
  }
});

// ============================================================================
// GET /api/v1/cmux/tasks - List tasks
// ============================================================================
export const listTasks = httpAction(async (ctx, req) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");
  const archived = url.searchParams.get("archived") === "true";
  const limitParam = url.searchParams.get("limit");
  // Validate limit: must be positive integer, capped at 100 to prevent resource exhaustion
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;
  const limit = parsedLimit !== undefined && !isNaN(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 100)
    : undefined;

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  try {
    const userId = identity!.subject;
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    // Get tasks
    const tasks = await ctx.runQuery(internal.tasks.listInternal, {
      teamId,
      userId,
      archived,
      limit,
    });

    // For each task, get the selected run info to show status
    const tasksWithRuns = await Promise.all(
      tasks.map(async (task) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let selectedRun: any = null;

        if (task.selectedTaskRunId) {
          selectedRun = await ctx.runQuery(internal.taskRuns.getById, {
            id: task.selectedTaskRunId as Id<"taskRuns">,
          });
        }

        // If no selected run, get the first run for this task
        if (!selectedRun) {
          const runs = await ctx.runQuery(internal.taskRuns.listByTaskAndTeamInternal, {
            taskId: task._id as Id<"tasks">,
            teamId,
            userId,
          });
          selectedRun = runs[0] ?? null;
        }

        // Extract vscode URL from vscode object or networking array
        let vscodeUrl: string | undefined;
        if (selectedRun?.vscode?.workspaceUrl) {
          vscodeUrl = selectedRun.vscode.workspaceUrl;
        } else if (selectedRun?.networking) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const vscodeSvc = selectedRun.networking.find((n: any) => n.port === 39378);
          vscodeUrl = vscodeSvc?.url;
        }

        return {
          id: task._id,
          prompt: task.text,
          repository: task.projectFullName,
          baseBranch: task.baseBranch,
          status: selectedRun?.status ?? "pending",
          agent: selectedRun?.agentName,
          vscodeUrl,
          isCompleted: task.isCompleted,
          isArchived: task.isArchived,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          taskRunId: selectedRun?._id,
          exitCode: selectedRun?.exitCode,
        };
      })
    );

    return jsonResponse({ tasks: tasksWithRuns });
  } catch (err) {
    console.error("[cmux.tasks.list] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to list tasks" },
      500
    );
  }
});

// ============================================================================
// POST /api/v1/cmux/tasks - Create task with prompt
// ============================================================================
export const createTask = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  let body: {
    teamSlugOrId: string;
    prompt: string;
    repository?: string;
    baseBranch?: string;
    agents?: string[];
    prTitle?: string;
    environmentId?: string;
    isCloudWorkspace?: boolean;
    images?: Array<{
      storageId: string;
      fileName?: string;
      altText: string;
    }>;
  };

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  // Prompt is required unless isCloudWorkspace is true (allows interactive TUI session)
  if (!body.prompt && !body.isCloudWorkspace) {
    return jsonResponse(
      { code: 400, message: "prompt is required (or use isCloudWorkspace for interactive session)" },
      400
    );
  }

  try {
    const userId = identity!.subject;
    const teamId = await resolveTeamIdForHttp(ctx, body.teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${body.teamSlugOrId}` },
        404
      );
    }

    // Validate environmentId and get environment name if provided
    let environmentId: Id<"environments"> | undefined;
    let environmentName: string | undefined;
    if (body.environmentId) {
      try {
        environmentId = body.environmentId as Id<"environments">;
        // Verify environment exists and belongs to this team
        const environment = await ctx.runQuery(api.environments.get, {
          teamSlugOrId: body.teamSlugOrId,
          id: environmentId,
        });
        if (!environment) {
          return jsonResponse(
            { code: 404, message: `Environment not found: ${body.environmentId}` },
            404
          );
        }
        environmentName = environment.name;
      } catch (err) {
        return jsonResponse(
          { code: 400, message: `Invalid environment ID: ${body.environmentId}` },
          400
        );
      }
    }

    // For cloud workspaces with empty prompt, use environment name as task text
    const taskText = body.prompt || (body.isCloudWorkspace && environmentName ? environmentName : "");

    // Create task
    const taskResult = await ctx.runMutation(api.tasks.create, {
      teamSlugOrId: body.teamSlugOrId,
      text: taskText,
      projectFullName: body.repository,
      baseBranch: body.baseBranch ?? "main",
      isCloudWorkspace: body.isCloudWorkspace,
      images: body.images as
        | Array<{
            storageId: Id<"_storage">;
            fileName?: string;
            altText: string;
          }>
        | undefined,
    });

    // Save PR title when provided (helps auto-PR later)
    if (body.prTitle && body.prTitle.trim().length > 0) {
      await ctx.runMutation(api.tasks.setPullRequestTitle, {
        teamSlugOrId: body.teamSlugOrId,
        id: taskResult.taskId,
        pullRequestTitle: body.prTitle,
      });
    }

    // Create task runs for each agent (with JWTs for sandbox auth)
    const taskRuns: Array<{ taskRunId: string; jwt: string; agentName: string }> = [];
    if (body.agents && body.agents.length > 0) {
      for (const agentName of body.agents) {
        const runResult = await ctx.runMutation(internal.taskRuns.createInternal, {
          teamId,
          userId,
          taskId: taskResult.taskId,
          prompt: body.prompt,
          agentName,
          environmentId,
        }) as { taskRunId: Id<"taskRuns">; jwt: string };

        taskRuns.push({
          taskRunId: runResult.taskRunId,
          jwt: runResult.jwt,
          agentName,
        });
      }
    }

    return jsonResponse({
      taskId: taskResult.taskId,
      taskRuns,
      status: "pending",
    });
  } catch (err) {
    console.error("[cmux.tasks.create] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to create task" },
      500
    );
  }
});

// ============================================================================
// GET /api/v1/cmux/tasks/{id} - Get task details
// ============================================================================
async function handleGetTask(
  ctx: ActionCtx,
  taskId: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    // Get task
    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: taskId as Id<"tasks">,
    });

    if (!task || task.teamId !== teamId || task.userId !== userId) {
      return jsonResponse({ code: 404, message: "Task not found" }, 404);
    }

    // Get all runs for this task
    const runs = await ctx.runQuery(internal.taskRuns.listByTaskAndTeamInternal, {
      taskId: task._id,
      teamId,
      userId,
    });

    // Format runs
    const taskRuns = runs.map(run => {
      // Extract vscode URL
      let vscodeUrl: string | undefined;
      if (run.vscode?.workspaceUrl) {
        vscodeUrl = run.vscode.workspaceUrl;
      } else if (run.networking) {
        const vscodeSvc = run.networking.find(n => n.port === 39378);
        vscodeUrl = vscodeSvc?.url;
      }

      return {
        id: run._id,
        agent: run.agentName,
        status: run.status,
        vscodeUrl,
        pullRequestUrl: run.pullRequestUrl,
        createdAt: run.createdAt,
        completedAt: run.completedAt,
        exitCode: run.exitCode,
      };
    });

    return jsonResponse({
      id: task._id,
      prompt: task.text,
      repository: task.projectFullName,
      baseBranch: task.baseBranch,
      isCompleted: task.isCompleted,
      isArchived: task.isArchived,
      pinned: task.pinned ?? false,
      mergeStatus: task.mergeStatus ?? "none",
      pullRequestTitle: task.pullRequestTitle,
      crownEvaluationStatus: task.crownEvaluationStatus,
      crownEvaluationError: task.crownEvaluationError,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      taskRuns,
      images: task.images,
    });
  } catch (err) {
    console.error("[cmux.tasks.get] Error:", err);
    return jsonResponse({ code: 500, message: "Failed to get task" }, 500);
  }
}

// ============================================================================
// POST /api/v1/cmux/tasks/{id}/pin - Toggle pinned state
// ============================================================================
async function handleTogglePinTask(
  ctx: ActionCtx,
  taskId: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: taskId as Id<"tasks">,
    });

    if (!task || task.teamId !== teamId || task.userId !== userId) {
      return jsonResponse({ code: 404, message: "Task not found" }, 404);
    }

    const currentlyPinned = task.pinned === true;
    if (currentlyPinned) {
      await ctx.runMutation(api.tasks.unpin, {
        teamSlugOrId,
        id: taskId as Id<"tasks">,
      });
    } else {
      await ctx.runMutation(api.tasks.pin, {
        teamSlugOrId,
        id: taskId as Id<"tasks">,
      });
    }

    return jsonResponse({ pinned: !currentlyPinned });
  } catch (err) {
    console.error("[cmux.tasks.pin] Error:", err);
    return jsonResponse({ code: 500, message: "Failed to toggle pin" }, 500);
  }
}

// ============================================================================
// POST /api/v1/cmux/tasks/{id}/archive - Archive task
// ============================================================================
async function handleArchiveTask(
  ctx: ActionCtx,
  taskId: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: taskId as Id<"tasks">,
    });
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      return jsonResponse({ code: 404, message: "Task not found" }, 404);
    }

    await ctx.runMutation(api.tasks.archive, {
      teamSlugOrId,
      id: taskId as Id<"tasks">,
    });

    return jsonResponse({ archived: true });
  } catch (err) {
    console.error("[cmux.tasks.archive] Error:", err);
    return jsonResponse({ code: 500, message: "Failed to archive task" }, 500);
  }
}

// ============================================================================
// POST /api/v1/cmux/tasks/{id}/unarchive - Unarchive task
// ============================================================================
async function handleUnarchiveTask(
  ctx: ActionCtx,
  taskId: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: taskId as Id<"tasks">,
    });
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      return jsonResponse({ code: 404, message: "Task not found" }, 404);
    }

    await ctx.runMutation(api.tasks.unarchive, {
      teamSlugOrId,
      id: taskId as Id<"tasks">,
    });

    return jsonResponse({ archived: false });
  } catch (err) {
    console.error("[cmux.tasks.unarchive] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to unarchive task" },
      500
    );
  }
}

// ============================================================================
// POST /api/v1/cmux/tasks/{id}/stop - Stop/archive task
// ============================================================================
async function handleStopTask(
  ctx: ActionCtx,
  taskId: string,
  teamSlugOrId: string,
  userId: string
): Promise<Response> {
  try {
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    // Archive the task
    await ctx.runMutation(internal.tasks.archiveInternal, {
      taskId: taskId as Id<"tasks">,
      teamId,
      userId,
    });

    return jsonResponse({ stopped: true });
  } catch (err) {
    console.error("[cmux.tasks.stop] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to stop task";
    if (message.includes("not found") || message.includes("unauthorized")) {
      return jsonResponse({ code: 404, message: "Task not found" }, 404);
    }
    return jsonResponse({ code: 500, message }, 500);
  }
}

// ============================================================================
// Route handler for task GET requests
// ============================================================================
export const taskGetRouter = httpAction(async (ctx, req) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  // Parse path: /api/v1/cmux/tasks/{id}
  const pathParts = path.split("/").filter(Boolean);
  // pathParts: ["api", "v1", "cmux", "tasks", "{id}"]
  const taskId = pathParts[4];

  if (!taskId) {
    return jsonResponse({ code: 400, message: "Task ID is required" }, 400);
  }

  return handleGetTask(ctx, taskId, teamSlugOrId, identity!.subject);
});

// ============================================================================
// Route handler for task POST actions
// ============================================================================
export const taskActionRouter = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const path = url.pathname;

  // Parse path: /api/v1/cmux/tasks/{id}/{action}
  const pathParts = path.split("/").filter(Boolean);
  const taskId = pathParts[4];
  const action = pathParts[5];

  if (!taskId) {
    return jsonResponse({ code: 400, message: "Task ID is required" }, 400);
  }

  let body: { teamSlugOrId: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  if (!body.teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  const userId = identity!.subject;

  switch (action) {
    case "stop":
      return handleStopTask(ctx, taskId, body.teamSlugOrId, userId);
    case "pin":
      return handleTogglePinTask(ctx, taskId, body.teamSlugOrId, userId);
    case "archive":
      return handleArchiveTask(ctx, taskId, body.teamSlugOrId, userId);
    case "unarchive":
      return handleUnarchiveTask(ctx, taskId, body.teamSlugOrId, userId);
    default:
      return jsonResponse({ code: 404, message: "Not found" }, 404);
  }
});

// ============================================================================
// GET /api/v1/cmux/task-runs/{taskRunId}/memory - Get memory for a task run
// ============================================================================
export const getTaskRunMemory = httpAction(async (ctx, req) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");
  const memoryType = url.searchParams.get("type") as
    | "knowledge"
    | "daily"
    | "tasks"
    | "mailbox"
    | null;

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  // Parse path: /api/v1/cmux/task-runs/{taskRunId}/memory
  const pathParts = url.pathname.split("/").filter(Boolean);
  // pathParts: ["api", "v1", "cmux", "task-runs", "{taskRunId}", "memory"]
  const taskRunId = pathParts[4];

  if (!taskRunId) {
    return jsonResponse({ code: 400, message: "Task run ID is required" }, 400);
  }

  // Validate taskRunId format - Convex IDs are alphanumeric without underscores
  const isValidConvexIdFormat = /^[a-z][a-z0-9]*$/i.test(taskRunId);
  if (!isValidConvexIdFormat) {
    return jsonResponse({ code: 404, message: "Task run not found" }, 404);
  }

  try {
    const userId = identity!.subject;
    const teamId = await resolveTeamIdForHttp(ctx, teamSlugOrId);

    if (!teamId) {
      return jsonResponse(
        { code: 404, message: `Team not found: ${teamSlugOrId}` },
        404
      );
    }

    // Verify the task run belongs to this user/team
    const taskRun = await ctx.runQuery(internal.taskRuns.getById, {
      id: taskRunId as Id<"taskRuns">,
    });

    if (!taskRun || taskRun.teamId !== teamId || taskRun.userId !== userId) {
      return jsonResponse({ code: 404, message: "Task run not found" }, 404);
    }

    // Query memory snapshots for this task run
    const snapshots = await ctx.runQuery(api.agentMemoryQueries.getByTaskRun, {
      teamSlugOrId,
      taskRunId: taskRunId as Id<"taskRuns">,
    });

    // Filter by type if specified
    let filteredSnapshots = snapshots;
    if (memoryType) {
      filteredSnapshots = snapshots.filter(
        (s: { memoryType: string }) => s.memoryType === memoryType
      );
    }

    // Format response
    const memory = filteredSnapshots.map(
      (s: {
        _id: string;
        memoryType: string;
        content: string;
        fileName?: string;
        date?: string;
        truncated?: boolean;
        agentName?: string;
        createdAt?: number;
      }) => ({
        id: s._id,
        memoryType: s.memoryType,
        content: s.content,
        fileName: s.fileName,
        date: s.date,
        truncated: s.truncated ?? false,
        agentName: s.agentName,
        createdAt: s.createdAt,
      })
    );

    return jsonResponse({ memory });
  } catch (err) {
    console.error("[cmux.taskRunMemory] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to get task run memory" },
      500
    );
  }
});
