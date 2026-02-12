/**
 * v2/devbox HTTP API - Multi-provider devbox management (E2B + Modal).
 *
 * This API supports E2B and Modal as backend providers.
 * Provider is selected via "provider" field in request body (defaults to "e2b").
 * All endpoints require Stack Auth authentication.
 * Instance data is tracked in devboxInstances table, with provider info in devboxInfo.
 */
import { httpAction, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { FunctionReference } from "convex/server";
import {
  DEFAULT_E2B_TEMPLATE_ID,
  E2B_TEMPLATE_PRESETS,
} from "@cmux/shared/e2b-templates";
import {
  DEFAULT_MODAL_TEMPLATE_ID,
  MODAL_TEMPLATE_PRESETS,
  isModalGpuGated,
} from "@cmux/shared/modal-templates";

type SandboxProvider = "e2b" | "modal";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

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

// Type-safe references to devboxInstances functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devboxApi = (api as any).devboxInstances as {
  create: FunctionReference<"mutation", "public">;
  list: FunctionReference<"query", "public">;
  getById: FunctionReference<"query", "public">;
  updateStatus: FunctionReference<"mutation", "public">;
  recordAccess: FunctionReference<"mutation", "public">;
  remove: FunctionReference<"mutation", "public">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const devboxInternalApi = (internal as any).devboxInstances as {
  getInfo: FunctionReference<"query", "internal">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const e2bActionsApi = (internal as any).e2b_actions as {
  startInstance: FunctionReference<"action", "internal">;
  getInstance: FunctionReference<"action", "internal">;
  execCommand: FunctionReference<"action", "internal">;
  extendTimeout: FunctionReference<"action", "internal">;
  stopInstance: FunctionReference<"action", "internal">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modalActionsApi = (internal as any).modal_actions as {
  startInstance: FunctionReference<"action", "internal">;
  getInstance: FunctionReference<"action", "internal">;
  execCommand: FunctionReference<"action", "internal">;
  stopInstance: FunctionReference<"action", "internal">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const e2bInstancesApi = (internal as any).e2bInstances as {
  recordResumeInternal: FunctionReference<"mutation", "internal">;
  recordPauseInternal: FunctionReference<"mutation", "internal">;
  recordStopInternal: FunctionReference<"mutation", "internal">;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const modalInstancesApi = (internal as any).modalInstances as {
  recordResumeInternal: FunctionReference<"mutation", "internal">;
  recordPauseInternal: FunctionReference<"mutation", "internal">;
  recordStopInternal: FunctionReference<"mutation", "internal">;
};

/**
 * Record activity for a provider instance
 */
async function recordProviderActivity(
  ctx: ActionCtx,
  provider: SandboxProvider,
  providerInstanceId: string,
  action: "resume" | "pause" | "stop"
): Promise<void> {
  try {
    const activityApi =
      provider === "modal" ? modalInstancesApi : e2bInstancesApi;
    if (action === "resume") {
      await ctx.runMutation(activityApi.recordResumeInternal, {
        instanceId: providerInstanceId,
      });
    } else if (action === "pause") {
      await ctx.runMutation(activityApi.recordPauseInternal, {
        instanceId: providerInstanceId,
      });
    } else if (action === "stop") {
      await ctx.runMutation(activityApi.recordStopInternal, {
        instanceId: providerInstanceId,
      });
    }
  } catch (error) {
    console.error("[devbox_v2] Failed to record activity:", error);
  }
}

/**
 * Get the provider info for a devbox ID
 */
async function getProviderInfo(
  ctx: ActionCtx,
  devboxId: string
): Promise<{ provider: SandboxProvider; providerInstanceId: string } | null> {
  const info = (await ctx.runQuery(devboxInternalApi.getInfo, {
    devboxId,
  })) as { provider: string; providerInstanceId: string } | null;
  if (!info) return null;
  return {
    provider: info.provider as SandboxProvider,
    providerInstanceId: info.providerInstanceId,
  };
}

// ============================================================================
// POST /api/v2/devbox/instances - Start a new instance (E2B or Modal)
// ============================================================================
export const createInstance = httpAction(async (ctx, req) => {
  const contentTypeError = verifyContentType(req);
  if (contentTypeError) return contentTypeError;

  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  let body: {
    teamSlugOrId: string;
    provider?: SandboxProvider;
    templateId?: string;
    name?: string;
    ttlSeconds?: number;
    metadata?: Record<string, string>;
    envs?: Record<string, string>;
    // Modal-specific options
    gpu?: string;
    cpu?: number;
    memoryMiB?: number;
    image?: string;
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

  const provider: SandboxProvider = body.provider ?? "e2b";

  try {
    if (provider === "modal") {
      // Gate expensive GPUs
      if (body.gpu && isModalGpuGated(body.gpu)) {
        return jsonResponse(
          {
            code: 403,
            message: `GPU type "${body.gpu}" requires approval. Please contact the Manaflow team at founders@manaflow.com for inquiry.`,
          },
          403,
        );
      }

      const templateId = body.templateId ?? DEFAULT_MODAL_TEMPLATE_ID;

      const result = (await ctx.runAction(modalActionsApi.startInstance, {
        templateId,
        gpu: body.gpu,
        cpu: body.cpu,
        memoryMiB: body.memoryMiB,
        ttlSeconds: body.ttlSeconds ?? 600,
        metadata: {
          app: "cmux-devbox-v2",
          userId: identity!.subject,
          ...(body.metadata || {}),
        },
        envs: body.envs,
        image: body.image,
      })) as {
        instanceId: string;
        status: string;
        gpu?: string | null;
        authToken?: string;
        jupyterUrl?: string;
        vscodeUrl?: string;
        workerUrl?: string;
        vncUrl?: string;
      };

      const instanceResult = (await ctx.runMutation(devboxApi.create, {
        teamSlugOrId: body.teamSlugOrId,
        providerInstanceId: result.instanceId,
        provider: "modal",
        name: body.name,
        templateId,
        vscodeUrl: result.vscodeUrl,
        workerUrl: result.workerUrl,
        metadata: {
          ...(body.metadata || {}),
          ...(result.gpu ? { gpu: result.gpu } : {}),
        },
        source: "cli",
      })) as { id: string; isExisting: boolean };

      return jsonResponse({
        id: instanceResult.id,
        provider: "modal",
        status: result.status,
        templateId,
        gpu: result.gpu ?? undefined,
        jupyterUrl: result.jupyterUrl,
        vscodeUrl: result.vscodeUrl,
        workerUrl: result.workerUrl,
        vncUrl: result.vncUrl,
      });
    }

    // Default: E2B provider
    const templateId = body.templateId ?? DEFAULT_E2B_TEMPLATE_ID;

    const result = (await ctx.runAction(e2bActionsApi.startInstance, {
      templateId,
      ttlSeconds: body.ttlSeconds ?? 600,
      metadata: {
        app: "cmux-devbox-v2",
        userId: identity!.subject,
        ...(body.metadata || {}),
      },
      envs: body.envs,
    })) as {
      instanceId: string;
      status: string;
      vscodeUrl?: string;
      workerUrl?: string;
      vncUrl?: string;
    };

    const instanceResult = (await ctx.runMutation(devboxApi.create, {
      teamSlugOrId: body.teamSlugOrId,
      providerInstanceId: result.instanceId,
      provider: "e2b",
      name: body.name,
      templateId,
      vscodeUrl: result.vscodeUrl,
      workerUrl: result.workerUrl,
      metadata: body.metadata,
      source: "cli",
    })) as { id: string; isExisting: boolean };

    return jsonResponse({
      id: instanceResult.id,
      provider: "e2b",
      status: result.status,
      templateId,
      vscodeUrl: result.vscodeUrl,
      workerUrl: result.workerUrl,
      vncUrl: result.vncUrl,
    });
  } catch (error) {
    console.error("[devbox_v2.create] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create instance";
    return jsonResponse(
      { code: 500, message: errorMessage },
      500
    );
  }
});

// ============================================================================
// GET /api/v2/devbox/instances - List instances
// ============================================================================
export const listInstances = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const teamSlugOrId = url.searchParams.get("teamSlugOrId");
  const providerFilter = url.searchParams.get("provider") as
    | SandboxProvider
    | null;

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId query parameter is required" },
      400
    );
  }

  try {
    const rawInstances = (await ctx.runQuery(devboxApi.list, {
      teamSlugOrId,
      provider: providerFilter ?? undefined,
    })) as Array<{
      devboxId: string;
      status: string;
      name?: string;
      createdAt: number;
      updatedAt: number;
    }>;

    const instances = rawInstances.map((inst) => ({
      id: inst.devboxId,
      status: inst.status,
      name: inst.name,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    }));

    return jsonResponse({ instances });
  } catch (error) {
    console.error("[devbox_v2.list] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to list instances" },
      500
    );
  }
});

// ============================================================================
// GET /api/v2/devbox/instances/{id} - Get instance details
// ============================================================================
async function handleGetInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = (await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    })) as { id: string; status: string; name?: string } | null;

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse({
        id,
        provider: "unknown",
        status: instance.status,
        name: instance.name,
      });
    }

    const { provider, providerInstanceId } = providerInfo;
    const actionsApi =
      provider === "modal" ? modalActionsApi : e2bActionsApi;

    const providerResult = (await ctx.runAction(actionsApi.getInstance, {
      instanceId: providerInstanceId,
    })) as {
      instanceId: string;
      status: string;
      jupyterUrl?: string | null;
      vscodeUrl?: string | null;
      workerUrl?: string | null;
      vncUrl?: string | null;
    };

    const status = providerResult.status as "running" | "stopped";

    if (status !== instance.status) {
      await ctx.runMutation(devboxApi.updateStatus, {
        teamSlugOrId,
        id,
        status,
      });
    }

    return jsonResponse({
      id,
      provider,
      status,
      name: instance.name,
      jupyterUrl: providerResult.jupyterUrl ?? undefined,
      vscodeUrl: providerResult.vscodeUrl ?? undefined,
      workerUrl: providerResult.workerUrl ?? undefined,
      vncUrl: providerResult.vncUrl ?? undefined,
    });
  } catch (error) {
    console.error("[devbox_v2.get] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to get instance" }, 500);
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/exec - Execute command
// ============================================================================
async function handleExecCommand(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  command: string | string[]
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;
    const actionsApi =
      provider === "modal" ? modalActionsApi : e2bActionsApi;

    const commandStr = Array.isArray(command) ? command.join(" ") : command;
    const result = await ctx.runAction(actionsApi.execCommand, {
      instanceId: providerInstanceId,
      command: commandStr,
    });

    await ctx.runMutation(devboxApi.recordAccess, { teamSlugOrId, id });
    return jsonResponse(result);
  } catch (error) {
    console.error("[devbox_v2.exec] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to execute command" },
      500
    );
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/pause - Pause instance
// ============================================================================
async function handlePauseInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;

    // Neither E2B nor Modal has native pause
    if (provider === "e2b") {
      await ctx.runAction(e2bActionsApi.extendTimeout, {
        instanceId: providerInstanceId,
        timeoutMs: 60 * 60 * 1000,
      });
    }

    await ctx.runMutation(devboxApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "paused",
    });

    await recordProviderActivity(ctx, provider, providerInstanceId, "pause");

    return jsonResponse({
      paused: true,
      provider,
      note:
        provider === "modal"
          ? "Modal status updated (no true pause)"
          : "E2B timeout extended (no true pause)",
    });
  } catch (error) {
    console.error("[devbox_v2.pause] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to pause instance" },
      500
    );
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/resume - Resume instance
// ============================================================================
async function handleResumeInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;

    await ctx.runMutation(devboxApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "running",
    });

    await recordProviderActivity(ctx, provider, providerInstanceId, "resume");

    return jsonResponse({
      resumed: true,
      provider,
      note: `${provider} status updated (already running)`,
    });
  } catch (error) {
    console.error("[devbox_v2.resume] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to resume instance" },
      500
    );
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/stop - Stop instance
// ============================================================================
async function handleStopInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;
    const actionsApi =
      provider === "modal" ? modalActionsApi : e2bActionsApi;

    await ctx.runAction(actionsApi.stopInstance, {
      instanceId: providerInstanceId,
    });

    await ctx.runMutation(devboxApi.updateStatus, {
      teamSlugOrId,
      id,
      status: "stopped",
    });

    await recordProviderActivity(ctx, provider, providerInstanceId, "stop");

    return jsonResponse({ stopped: true, provider });
  } catch (error) {
    console.error("[devbox_v2.stop] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to stop instance" }, 500);
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/delete - Delete instance (stop + remove)
// ============================================================================
async function handleDeleteInstance(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;
    const actionsApi =
      provider === "modal" ? modalActionsApi : e2bActionsApi;

    // Terminate the sandbox at the provider level
    try {
      await ctx.runAction(actionsApi.stopInstance, {
        instanceId: providerInstanceId,
      });
    } catch (error) {
      // If the provider instance is already gone, continue with cleanup
      console.error("[devbox_v2.delete] Provider stop failed (may already be gone):", error);
    }

    await recordProviderActivity(ctx, provider, providerInstanceId, "stop");

    // Remove the devbox instance and info records
    await ctx.runMutation(devboxApi.remove, {
      teamSlugOrId,
      id,
    });

    return jsonResponse({ deleted: true, provider });
  } catch (error) {
    console.error("[devbox_v2.delete] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to delete instance" },
      500
    );
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/env - Push environment variables
// ============================================================================
async function handlePushEnv(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  envVarsContent: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }
    const { providerInstanceId } = providerInfo;

    // Get the worker URL from the E2B instance
    const e2bResult = (await ctx.runAction(e2bActionsApi.getInstance, {
      instanceId: providerInstanceId,
    })) as {
      instanceId: string;
      status: string;
      workerUrl?: string | null;
    };

    if (!e2bResult.workerUrl) {
      return jsonResponse(
        { code: 503, message: "Worker not available on sandbox" },
        503
      );
    }

    // Get the worker auth token
    const tokenResult = (await ctx.runAction(e2bActionsApi.execCommand, {
      instanceId: providerInstanceId,
      command: "cat /home/user/.worker-auth-token 2>/dev/null || echo ''",
    })) as { stdout?: string; stderr?: string; exit_code?: number };

    const workerToken = tokenResult.stdout?.trim() || "";
    if (!workerToken) {
      return jsonResponse(
        { code: 503, message: "Worker auth token not yet available" },
        503
      );
    }

    // POST to worker /env endpoint with base64-encoded content.
    // This uses the same code path as the CLI (worker handles file writing,
    // permissions, .bashrc/.profile sourcing, and envctl integration).
    const encoded = btoa(envVarsContent);
    const workerResp = await fetch(`${e2bResult.workerUrl}/env`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerToken}`,
      },
      body: JSON.stringify({ content: encoded, encoding: "base64" }),
    });

    if (!workerResp.ok) {
      const errBody = await workerResp.text();
      console.error(
        `[devbox_v2.env] Worker /env failed: status=${workerResp.status} body=${errBody.slice(0, 200)}`
      );
      return jsonResponse(
        { code: 500, message: "Failed to apply environment variables" },
        500
      );
    }

    return jsonResponse({ applied: true, provider: "e2b" });
  } catch (error) {
    console.error("[devbox_v2.env] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to apply environment variables" },
      500
    );
  }
}

// ============================================================================
// POST /api/v2/devbox/instances/{id}/ttl - Update TTL
// ============================================================================
async function handleUpdateTtl(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string,
  ttlSeconds: number
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;

    if (provider === "e2b") {
      await ctx.runAction(e2bActionsApi.extendTimeout, {
        instanceId: providerInstanceId,
        timeoutMs: ttlSeconds * 1000,
      });
    }
    // Modal sandbox timeout is set at creation; TTL extension is a no-op

    return jsonResponse({ updated: true, ttlSeconds, provider });
  } catch (error) {
    console.error("[devbox_v2.ttl] Error:", error);
    return jsonResponse({ code: 500, message: "Failed to update TTL" }, 500);
  }
}

// ============================================================================
// GET /api/v2/devbox/config - Get configuration
// ============================================================================
export const getConfig = httpAction(async (ctx) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  return jsonResponse({
    providers: ["e2b", "modal"],
    defaultProvider: "e2b",
    e2b: {
      defaultTemplateId: DEFAULT_E2B_TEMPLATE_ID,
    },
    modal: {
      defaultTemplateId: DEFAULT_MODAL_TEMPLATE_ID,
      gpuOptions: ["T4", "L4", "A10G", "L40S", "A100", "A100-80GB", "H100", "H200", "B200"],
    },
  });
});

// ============================================================================
// GET /api/v2/devbox/me - Get current user profile
// ============================================================================
export const getMe = httpAction(async (ctx) => {
  const { identity, error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  try {
    const userId = identity!.subject;

    const user = await ctx.runQuery(internal.users.getByUserIdInternal, {
      userId,
    });

    const memberships = await ctx.runQuery(
      internal.teams.getMembershipsByUserIdInternal,
      {
        userId,
      }
    );

    let teamId: string | null = null;
    let teamSlug: string | null = null;
    let teamDisplayName: string | null = null;

    if (user?.selectedTeamId) {
      const hasMembership = memberships.some(
        (m) => m.teamId === user.selectedTeamId
      );
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
    console.error("[devbox_v2.me] Error:", err);
    return jsonResponse(
      { code: 500, message: "Failed to get user profile" },
      500
    );
  }
});

// ============================================================================
// POST /api/v2/devbox/instances/{id}/token - Get auth token
// ============================================================================
async function handleGetAuthToken(
  ctx: ActionCtx,
  id: string,
  teamSlugOrId: string
): Promise<Response> {
  try {
    const instance = await ctx.runQuery(devboxApi.getById, {
      teamSlugOrId,
      id,
    });

    if (!instance) {
      return jsonResponse({ code: 404, message: "Instance not found" }, 404);
    }

    const providerInfo = await getProviderInfo(ctx, id);
    if (!providerInfo) {
      return jsonResponse(
        { code: 404, message: "Provider mapping not found" },
        404
      );
    }

    const { provider, providerInstanceId } = providerInfo;
    const actionsApi =
      provider === "modal" ? modalActionsApi : e2bActionsApi;

    const result = (await ctx.runAction(actionsApi.execCommand, {
      instanceId: providerInstanceId,
      command: "cat /home/user/.worker-auth-token 2>/dev/null || echo ''",
    })) as { stdout?: string; stderr?: string; exit_code?: number };

    const token = result.stdout?.trim() || "";
    if (!token) {
      return jsonResponse(
        { code: 503, message: "Auth token not yet available" },
        503
      );
    }

    return jsonResponse({ token });
  } catch (error) {
    console.error("[devbox_v2.token] Error:", error);
    return jsonResponse(
      { code: 500, message: "Failed to get auth token" },
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
  const id = pathParts[4]; // instances/{id}
  const action = pathParts[5]; // {action}

  let body: {
    teamSlugOrId: string;
    command?: string | string[];
    timeout?: number;
    ttlSeconds?: number;
    envVarsContent?: string;
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

  switch (action) {
    case "exec":
      if (!body.command) {
        return jsonResponse({ code: 400, message: "command is required" }, 400);
      }
      return handleExecCommand(ctx, id, body.teamSlugOrId, body.command);

    case "pause":
      return handlePauseInstance(ctx, id, body.teamSlugOrId);

    case "resume":
      return handleResumeInstance(ctx, id, body.teamSlugOrId);

    case "stop":
      return handleStopInstance(ctx, id, body.teamSlugOrId);

    case "ttl":
      if (!body.ttlSeconds) {
        return jsonResponse(
          { code: 400, message: "ttlSeconds is required" },
          400
        );
      }
      return handleUpdateTtl(ctx, id, body.teamSlugOrId, body.ttlSeconds);

    case "token":
      return handleGetAuthToken(ctx, id, body.teamSlugOrId);

    case "delete":
      return handleDeleteInstance(ctx, id, body.teamSlugOrId);

    case "extend":
      return handleUpdateTtl(
        ctx,
        id,
        body.teamSlugOrId,
        body.ttlSeconds ?? 3600
      );

    case "env":
      if (!body.envVarsContent) {
        return jsonResponse(
          { code: 400, message: "envVarsContent is required" },
          400
        );
      }
      return handlePushEnv(ctx, id, body.teamSlugOrId, body.envVarsContent);

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

  const pathParts = path.split("/").filter(Boolean);
  const id = pathParts[4];

  return handleGetInstance(ctx, id, teamSlugOrId);
});

// ============================================================================
// GET /api/v2/devbox/templates - List available templates (all providers)
// ============================================================================
export const listTemplates = httpAction(async (ctx, req) => {
  const { error } = await getAuthenticatedUser(ctx);
  if (error) return error;

  const url = new URL(req.url);
  const providerFilter = url.searchParams.get("provider") as
    | SandboxProvider
    | null;

  const e2bTemplates =
    !providerFilter || providerFilter === "e2b"
      ? E2B_TEMPLATE_PRESETS.map((preset) => ({
          provider: "e2b" as const,
          presetId: preset.id,
          templateId: preset.templateId,
          name: preset.label,
          description: preset.description,
          cpu: preset.cpu,
          memory: preset.memory,
          disk: preset.disk,
          supportsDocker: preset.templateId.includes("docker"),
        }))
      : [];

  const modalTemplates =
    !providerFilter || providerFilter === "modal"
      ? MODAL_TEMPLATE_PRESETS.map((preset) => ({
          provider: "modal" as const,
          templateId: preset.templateId,
          name: preset.label,
          description: preset.description,
          cpu: preset.cpu,
          memory: preset.memory,
          disk: preset.disk,
          gpu: preset.gpu,
          image: preset.image,
          gated: preset.gpu ? isModalGpuGated(preset.gpu) : false,
        }))
      : [];

  return jsonResponse({
    templates: [...e2bTemplates, ...modalTemplates],
  });
});
