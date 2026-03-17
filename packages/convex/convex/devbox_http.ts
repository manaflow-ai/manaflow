import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import type { FunctionReference } from "convex/server";

const MORPH_API_BASE_URL = "https://cloud.morph.so/api";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

// Security: Validate instance ID format to prevent injection attacks
// IDs should be cr_ or cmux_ followed by 8+ alphanumeric characters
const INSTANCE_ID_REGEX = /^(cr|cmux)_[a-zA-Z0-9]{8,}$/;

function isValidInstanceId(id: string): boolean {
  return INSTANCE_ID_REGEX.test(id);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Verify content type is JSON
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
 * Handles both array format (new) and object format (legacy).
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
  }

  // Legacy object format: { "39378": "https://...", ... }
  return {
    vscodeUrl: httpServices["39378"],
    workerUrl: httpServices["39377"],
    vncUrl: httpServices["39380"],
  };
}

// Type-safe references to devboxInstances functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devboxApi = (api as any).devboxInstances as {
  create: FunctionReference<"mutation", "public">;
  list: FunctionReference<"query", "public">;
  getById: FunctionReference<"query", "public">;
  updateStatus: FunctionReference<"mutation", "public">;
  recordAccess: FunctionReference<"mutation", "public">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devboxInternalApi = (internal as any).devboxInstances as {
  getInfo: FunctionReference<"query", "internal">;
};

/**
 * Get the provider instance ID for a devbox ID
 */
async function getProviderInstanceId(
  ctx: ActionCtx,
  devboxId: string
): Promise<string | null> {
  const info = await ctx.runQuery(devboxInternalApi.getInfo, {
    devboxId,
  }) as { providerInstanceId: string } | null;
  return info?.providerInstanceId ?? null;
}

// ============================================================================
// POST /api/v1/devbox/instances - Create a new instance
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
    // Start a new Morph instance
    const morphResponse = await morphFetch("/instance", {
      method: "POST",
      body: JSON.stringify({
        snapshot_id: body.snapshotId,
        ttl_seconds: body.ttlSeconds ?? 60 * 60, // 1 hour default
        ttl_action: "pause",
        metadata: {
          app: "cmux-devbox",
          userId: identity!.subject,
          ...(body.metadata || {}),
        },
      }),
    });

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[devbox.create] Morph API error:", {
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
    };

    const httpServices = morphData.networking?.http_services ?? [];
    const { vscodeUrl, workerUrl, vncUrl } =
      extractNetworkingUrls(httpServices);

    // Helper to clean up orphaned Morph VM on failure
    const cleanupMorphInstance = async (reason: string) => {
      console.warn(`[devbox.create] Cleaning up orphaned Morph VM ${morphData.id}: ${reason}`);
      try {
        const deleteResponse = await morphFetch(`/instance/${morphData.id}`, {
          method: "DELETE",
        });
        if (deleteResponse.ok) {
          console.log(`[devbox.create] Successfully deleted orphaned VM ${morphData.id}`);
        } else {
          console.error(`[devbox.create] Failed to delete orphaned VM ${morphData.id}: ${deleteResponse.status}`);
        }
      } catch (cleanupError) {
        console.error(`[devbox.create] Error deleting orphaned VM ${morphData.id}:`, cleanupError);
      }
    };

    // Store the instance in Convex
    let result: { id: string; isExisting: boolean };
    try {
      result = await ctx.runMutation(devboxApi.create, {
        teamSlugOrId: body.teamSlugOrId,
        providerInstanceId: morphData.id,
        provider: "morph",
        name: body.name,
        snapshotId: body.snapshotId,
        metadata: body.metadata,
      }) as { id: string; isExisting: boolean };
    } catch (convexError) {
      // Convex mutation failed (e.g., invalid team) - clean up the Morph VM
      await cleanupMorphInstance(`Convex mutation failed: ${convexError instanceof Error ? convexError.message : "unknown error"}`);
      throw convexError; // Re-throw to be caught by outer catch
    }

    return jsonResponse({
      id: result.id,
      providerInstanceId: morphData.id,
      status: morphData.status,
      vscodeUrl,
      workerUrl,
      vncUrl,
    });
  } catch (error) {
    console.error("[devbox.create] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to create instance" },
      500
    );
  }
});

// ============================================================================
// GET /api/v1/devbox/instances - List instances
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
    const instances = await ctx.runQuery(devboxApi.list, {
      teamSlugOrId,
    });

    return jsonResponse({ instances });
  } catch (error) {
    console.error("[devbox.list] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to list instances" },
      500
    );
  }
});

// ============================================================================
// Handler logic for instance-specific routes (extracted for reuse)
// ============================================================================

async function handleGetInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Get instance from Convex by ID
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    }) as { id: string; status: string; name?: string } | null;

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    // Get provider instance ID from mapping
    const providerInstanceId = await getProviderInstanceId(ctx, id);
    if (!providerInstanceId) {
      return jsonResponse({ id, status: instance.status, name: instance.name });
    }

    // Get fresh status from Morph
    const morphResponse = await morphFetch(`/instance/${providerInstanceId}`);

    if (!morphResponse.ok) {
      // Instance may have been deleted
      if (morphResponse.status === 404) {
        await ctx.runMutation(devboxApi.updateStatus, {
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
    };

    // Map Morph status to our status
    const status =
      morphData.status === "running" || morphData.status === "ready"
        ? "running"
        : morphData.status === "paused"
          ? "paused"
          : morphData.status === "stopped"
            ? "stopped"
            : "unknown";

    // Update status in Convex if changed
    if (status !== instance.status) {
      await ctx.runMutation(devboxApi.updateStatus, {
        teamSlugOrId,
        id,
        status,
      });
    }

    const httpServices = morphData.networking?.http_services ?? [];
    const { vscodeUrl, workerUrl, vncUrl } =
      extractNetworkingUrls(httpServices);

    return jsonResponse({
      id,
      status,
      name: instance.name,
      vscodeUrl,
      workerUrl,
      vncUrl,
    });
  } catch (error) {
    console.error("[devbox.get] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to get instance" }, 500);
  }
}

async function handleExecCommand(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  command: string,
  timeout?: number
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(devboxApi.getById, {
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

    // Execute command via Morph API
    // Morph API expects command as an array and runs without a shell.
    // Wrap string commands in sh -c to preserve shell operators and quoting.
    const commandArray = ["sh", "-c", command];

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
      console.error("[devbox.exec] Morph API error:", {
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
    await ctx.runMutation(devboxApi.recordAccess, {
      teamSlugOrId,
      id,
    });

    return jsonResponse(result);
  } catch (error) {
    console.error("[devbox.exec] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to execute command" },
      500
    );
  }
}

async function handlePauseInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(devboxApi.getById, {
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
      console.error("[devbox.pause] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to pause instance" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(devboxApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "paused",
    });

    return jsonResponse({ paused: true });
  } catch (error) {
    console.error("[devbox.pause] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to pause instance" },
      500
    );
  }
}

async function handleResumeInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(devboxApi.getById, {
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
      console.error("[devbox.resume] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to resume instance" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(devboxApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "running",
    });

    return jsonResponse({ resumed: true });
  } catch (error) {
    console.error("[devbox.resume] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to resume instance" },
      500
    );
  }
}

async function handleStopInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(devboxApi.getById, {
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
      console.error("[devbox.stop] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to stop instance" },
        502
      );
    }

    // Update status in Convex
    await ctx.runMutation(devboxApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "stopped",
    });

    return jsonResponse({ stopped: true });
  } catch (error) {
    console.error("[devbox.stop] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to stop instance" }, 500);
  }
}

async function handleGetInstanceSsh(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    // Verify the user owns this instance
    const instance = await ctx.runQuery(devboxApi.getById, {
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
    const morphResponse = await morphFetch(
      `/instance/${providerInstanceId}/ssh/key`
    );

    if (!morphResponse.ok) {
      const errorText = await morphResponse.text();
      console.error("[devbox.ssh] Morph API error:", {
        status: morphResponse.status,
        body: errorText.slice(0, 500),
      });
      return jsonResponse(
        { code: 502, message: "Failed to get SSH credentials" },
        502
      );
    }

    const sshData = (await morphResponse.json()) as {
      private_key?: string;
      public_key?: string;
      password?: string;
      access_token?: string;
    };

    // Record access
    await ctx.runMutation(devboxApi.recordAccess, {
      teamSlugOrId,
      id,
    });

    return jsonResponse({
      id,
      sshCommand: sshData.access_token
        ? `ssh ${sshData.access_token}@ssh.cloud.morph.so`
        : undefined,
      accessToken: sshData.access_token,
    });
  } catch (error) {
    console.error("[devbox.ssh] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to get SSH credentials" },
      500
    );
  }
}

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
  const pathParts = path.split("/").filter(Boolean);
  // Path: /api/v1/devbox/instances/{id}/{action}
  // pathParts: ["api", "v1", "devbox", "instances", "{id}", "{action}"]
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
    command?: string;
    timeout?: number;
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
  // pathParts: ["api", "v1", "devbox", "instances", "{id}", "{action}?"]
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
