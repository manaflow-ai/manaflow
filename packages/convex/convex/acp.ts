import { v } from "convex/values";
import { SignJWT } from "jose";
import { Effect } from "effect";
import {
  getDefaultSnapshotId,
  type SandboxProvider as SnapshotSandboxProvider,
} from "@cmux/shared/convex-safe";
import { env } from "../_shared/convex-env";
import {
  getDefaultSandboxProvider,
  getSandboxProvider,
} from "../_shared/sandbox-providers";
import { getTeamId } from "../_shared/team";
import { buildSandboxErrorMessage } from "./acpErrors";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { withObservability } from "./effect/observability";
import { runTracedEffect } from "./effect/runtime";
import { getTraceContext, withTraceContext, type TraceContext } from "./effect/traceContext";
import { traced } from "./effect/traced";
import { TracingLive } from "./effect/tracing";
import { authMutation, authQuery } from "./users/utils";
import type {
  SandboxProvider as SandboxProviderInterface,
  SandboxStatus,
} from "../_shared/sandbox-providers";

type SandboxProviderResolver = {
  getDefault: () => SandboxProviderInterface;
  getByName: (name: SandboxProviderInterface["name"]) => SandboxProviderInterface;
};

const liveSandboxProviderResolver: SandboxProviderResolver = {
  getDefault: () => getDefaultSandboxProvider(),
  getByName: (name) => getSandboxProvider(name),
};

let sandboxProviderResolver = liveSandboxProviderResolver;

export function setSandboxProviderResolverForTests(
  resolver: SandboxProviderResolver,
): void {
  sandboxProviderResolver = resolver;
}

/**
 * Get the snapshot ID for a specific provider, falling back to default provider if not found.
 */
export function getSnapshotIdForProvider(
  providerName?: "morph" | "freestyle" | "daytona" | "e2b" | "blaxel"
): { snapshotId: string; providerName: "morph" | "freestyle" | "daytona" | "e2b" | "blaxel" } {
  if (providerName) {
    const snapshotId = getDefaultSnapshotId(providerName);
    if (snapshotId) {
      return { snapshotId, providerName };
    }
    // Fall back to default if provider has no snapshot configured
    console.warn(`[acp] No snapshot found for provider ${providerName}, falling back to default`);
  }
  const defaultProvider = sandboxProviderResolver.getDefault();
  const defaultSnapshotId = getDefaultSnapshotId(defaultProvider.name as SnapshotSandboxProvider) ?? "snap_default";
  return { snapshotId: defaultSnapshotId, providerName: defaultProvider.name as "morph" | "freestyle" | "daytona" | "e2b" | "blaxel" };
}

// Content block validator (simplified ACP ContentBlock)
const contentBlockValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("image"),
    v.literal("resource_link"),
  ),
  text: v.optional(v.string()),
  data: v.optional(v.string()), // base64 for images
  mimeType: v.optional(v.string()),
  uri: v.optional(v.string()),
  name: v.optional(v.string()),
});

function hasVisibleAssistantContent(
  content: Array<{
    type: string;
    text?: string | null;
  }>
): boolean {
  for (const block of content) {
    if (block.type === "text") {
      if (block.text?.trim()) {
        return true;
      }
      continue;
    }
    if (block.type === "image" || block.type === "resource_link") {
      return true;
    }
  }
  return false;
}

const providerIdValidator = v.union(
  v.literal("claude"),
  v.literal("codex"),
  v.literal("gemini"),
  v.literal("opencode"),
);
type ProviderId = "claude" | "codex" | "gemini" | "opencode";

type McpServerTransport = "stdio" | "http" | "sse";
type McpServerEnvVar = { name: string; value: string };
type McpServerHeader = { name: string; value: string };
type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: McpServerEnvVar[];
  url?: string;
  headers?: McpServerHeader[];
};

const DEFAULT_CLAUDE_MODEL_ID = "claude-opus-4-6";
const DEFAULT_CODEX_MODEL_ID = "gpt-5.2-codex";
const WARM_POOL_TEAM_ID = "__warm_pool__";
const WARM_SANDBOX_TTL_MS = 5 * 60 * 1000;
const MESSAGE_DELIVERY_MAX_ATTEMPTS = 6;
const MESSAGE_DELIVERY_RETRY_MS = 1500;

type NormalizedSandboxStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "error";

function resolveDefaultModelId(providerId: string): string | undefined {
  if (providerId === "claude") {
    return env.ACP_DEFAULT_CLAUDE_MODEL_ID ?? DEFAULT_CLAUDE_MODEL_ID;
  }
  if (providerId === "codex") {
    return env.ACP_DEFAULT_CODEX_MODEL_ID ?? DEFAULT_CODEX_MODEL_ID;
  }
  return undefined;
}

function normalizeSandboxStatus(
  status: SandboxStatus,
): NormalizedSandboxStatus {
  if (status === "stopping") {
    return "paused";
  }
  return status;
}

async function waitForSandboxRunning(
  provider: SandboxProviderInterface,
  instanceId: string,
  attempts: number,
  delayMs: number,
): Promise<SandboxStatus> {
  let lastStatus: SandboxStatus = "starting";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const info = await provider.getStatus(instanceId);
    lastStatus = info.status;
    if (normalizeSandboxStatus(lastStatus) === "running") {
      return lastStatus;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return lastStatus;
}

async function probeSandboxHealth(
  sandboxUrl: string,
  timeoutMs: number = 2000,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${sandboxUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch (error) {
    console.error("[acp] Sandbox health check failed:", error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForSandboxHealthy(
  sandboxUrl: string,
  attempts: number,
  delayMs: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probeSandboxHealth(sandboxUrl)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}


function ensureSandboxReadyEffect(
  ctx: AcpMutationCtx,
  sandbox: Doc<"acpSandboxes">,
): Effect.Effect<{
  status: NormalizedSandboxStatus;
  sandboxUrl: string | null;
}, Error> {
  return Effect.gen(function* () {
    const provider = sandboxProviderResolver.getByName(sandbox.provider);

    // Get status from provider
    const statusInfo = yield* traced(
      "acp.sandbox.get_status",
      { sandboxId: sandbox._id, instanceId: sandbox.instanceId },
      () => provider.getStatus(sandbox.instanceId),
    ).pipe(
      Effect.catchAll((error) => {
        console.error("[acp] Failed to fetch sandbox status:", error);
        return Effect.succeed(null);
      }),
    );

    if (!statusInfo) {
      return {
        status: sandbox.status,
        sandboxUrl: sandbox.sandboxUrl ?? null,
      };
    }

    let normalizedStatus = normalizeSandboxStatus(statusInfo.status);
    const sandboxUrl = sandbox.sandboxUrl ?? statusInfo.sandboxUrl ?? null;

    // Resume if paused
    if (normalizedStatus === "paused" && provider.resume) {
      yield* traced(
        "acp.sandbox.resume",
        { sandboxId: sandbox._id, instanceId: sandbox.instanceId },
        () => provider.resume?.(sandbox.instanceId) ?? Promise.resolve(),
      ).pipe(
        Effect.tap(() => {
          normalizedStatus = "starting";
          return Effect.void;
        }),
        Effect.catchAll((error) => {
          console.error("[acp] Failed to resume sandbox:", error);
          return Effect.void;
        }),
      );
    }

    // Wait for running
    if (normalizedStatus === "starting") {
      const status = yield* traced(
        "acp.sandbox.wait_running",
        { sandboxId: sandbox._id, instanceId: sandbox.instanceId },
        () => waitForSandboxRunning(provider, sandbox.instanceId, 3, 1000),
      );
      normalizedStatus = normalizeSandboxStatus(status);
    }

    // Wait for healthy
    let returnStatus: NormalizedSandboxStatus = normalizedStatus;
    if (normalizedStatus === "running" && sandboxUrl) {
      const healthy = yield* traced(
        "acp.sandbox.wait_healthy",
        { sandboxId: sandbox._id, instanceId: sandbox.instanceId },
        () => waitForSandboxHealthy(sandboxUrl, 2, 750),
      );
      if (!healthy) {
        returnStatus = "starting";
      }
    }

    // Update status in DB if needed
    const shouldUpdateStatus =
      sandbox.status !== normalizedStatus ||
      (!sandbox.sandboxUrl && sandboxUrl) ||
      (normalizedStatus === "error" && !sandbox.lastError);

    if (shouldUpdateStatus) {
      const providerFallback = `provider ${provider.name} reported error status for ${sandbox.instanceId}`;
      const errorMessage =
        statusInfo.error ?? sandbox.lastError ?? providerFallback;

      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.updateStatus, {
          sandboxId: sandbox._id,
          status: normalizedStatus,
          ...(sandbox.sandboxUrl ? {} : sandboxUrl ? { sandboxUrl } : {}),
          ...(normalizedStatus === "error" ? { errorMessage } : {}),
        }),
      );

      // Log error to acpRawEvents for debugging history
      if (normalizedStatus === "error") {
        yield* Effect.tryPromise(() =>
          ctx.runMutation(internal.acpRawEvents.appendErrorBySandbox, {
            sandboxId: sandbox._id,
            teamId: sandbox.teamId,
            errorMessage,
            context: "ensureSandboxReady",
          }),
        );
      }
    }

    // Configure stream secret if needed
    if (returnStatus === "running" && sandboxUrl && !sandbox.streamSecret) {
      yield* traced(
        "acp.sandbox.configure_stream",
        { sandboxId: sandbox._id, instanceId: sandbox.instanceId },
        () => ensureStreamSecretConfigured(ctx, sandbox, sandboxUrl),
      ).pipe(
        Effect.catchAll((error) => {
          console.error("[acp] Failed to configure stream secret:", error);
          return Effect.void;
        }),
      );
    }

    return {
      status: returnStatus,
      sandboxUrl: returnStatus === "running" ? sandboxUrl : null,
    };
  }).pipe(withObservability("acp.ensureSandboxReady", { sandboxId: sandbox._id }));
}

/**
 * Generate a SHA-256 hash of a string (for callback JWT verification).
 */
async function sha256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function recordSandboxError(
  ctx: AcpMutationCtx,
  sandboxId: Id<"acpSandboxes">,
  error: unknown,
  fallback: string,
  options?: {
    teamId?: string;
    conversationId?: Id<"conversations">;
    context?: string;
  },
): Promise<void> {
  const message = buildSandboxErrorMessage(error, fallback);
  try {
    await ctx.runMutation(internal.acpSandboxes.setLastError, {
      sandboxId,
      errorMessage: message,
    });

    // Log to acpRawEvents for debugging history
    if (options?.teamId && options?.conversationId) {
      await ctx.runMutation(internal.acpRawEvents.appendError, {
        conversationId: options.conversationId,
        sandboxId,
        teamId: options.teamId,
        errorMessage: message,
        context: options.context,
      });
    } else if (options?.teamId) {
      await ctx.runMutation(internal.acpRawEvents.appendErrorBySandbox, {
        sandboxId,
        teamId: options.teamId,
        errorMessage: message,
        context: options.context,
      });
    }
  } catch (recordError) {
    console.error("[acp] Failed to record sandbox error:", recordError);
  }
}

async function replaceSandboxForConversation(
  ctx: AcpSandboxSwapCtx,
  conversation: Doc<"conversations">,
  userId: string | null,
  teamId: string,
): Promise<Id<"acpSandboxes"> | null> {
  const previousSandboxId = conversation.acpSandboxId;

  // Look up user's preferred sandbox provider from workspace settings
  let userProviderName: "morph" | "freestyle" | "daytona" | "e2b" | "blaxel" | undefined;
  if (userId) {
    const workspaceSettings = await ctx.runQuery(
      internal.workspaceSettings.getByTeamAndUserInternal,
      { teamId, userId }
    );
    userProviderName = workspaceSettings?.acpSandboxProvider;
  }

  // Get the snapshot ID for the user's preferred provider (or default)
  const { snapshotId, providerName } = getSnapshotIdForProvider(userProviderName);

  let claimedWarmSandbox: Doc<"acpSandboxes"> | null = null;

  if (userId) {
    claimedWarmSandbox = await ctx.runMutation(
      internal.acpSandboxes.claimWarmSandbox,
      {
        userId,
        teamId,
        snapshotId, // Now uses the correct provider's snapshot ID
      },
    );
  }

  let sandboxId = claimedWarmSandbox?._id;

  if (!sandboxId) {
    const result = await ctx.runAction(internal.acp.spawnSandbox, {
      teamId,
      providerName, // Use the resolved provider name
    });
    sandboxId = result.sandboxId;
  }

  if (!sandboxId) {
    return null;
  }

  await ctx.runMutation(internal.acp.updateConversationSandbox, {
    conversationId: conversation._id,
    acpSandboxId: sandboxId,
  });

  await ctx.runMutation(internal.acpSandboxes.incrementConversationCount, {
    sandboxId,
  });

  if (previousSandboxId && previousSandboxId !== sandboxId) {
    try {
      await ctx.runMutation(internal.acpSandboxes.decrementConversationCount, {
        sandboxId: previousSandboxId,
      });
    } catch (error) {
      console.error("[acp] Failed to decrement previous sandbox count", error);
    }
  }

  if (claimedWarmSandbox) {
    try {
      await reconfigureSandboxForTeam(ctx, claimedWarmSandbox, teamId);
    } catch (error) {
      console.error("[acp] Failed to reconfigure warm sandbox:", error);
    }
  }

  if (previousSandboxId && previousSandboxId !== sandboxId) {
    const previousSandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: previousSandboxId,
    });
    if (previousSandbox?.status === "error") {
      await ctx.scheduler.runAfter(0, internal.acp.stopSandboxInternal, {
        sandboxId: previousSandboxId,
      });
    }
  }

  return sandboxId;
}

/**
 * Generate a sandbox callback JWT.
 * This JWT is used by sandboxes to authenticate callbacks to Convex.
 */
async function generateSandboxJwt(
  sandboxId: Id<"acpSandboxes">,
  teamId: string,
): Promise<{ jwt: string; hash: string }> {
  const secret = env.ACP_CALLBACK_SECRET ?? env.CMUX_TASK_RUN_JWT_SECRET;
  if (!secret) {
    throw new Error("ACP_CALLBACK_SECRET not configured");
  }

  const jwt = await new SignJWT({
    sandboxId,
    teamId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h") // Sandboxes get longer-lived tokens
    .sign(new TextEncoder().encode(secret));

  const hash = await sha256Hash(jwt);
  return { jwt, hash };
}

function bytesToHex(buffer: Uint8Array): string {
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function generateStreamSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function ensureStreamSecretConfigured(
  ctx: AcpMutationCtx,
  sandbox: Doc<"acpSandboxes">,
  sandboxUrl: string,
): Promise<void> {
  if (sandbox.streamSecret) {
    return;
  }

  const { jwt: callbackJwt, hash: callbackJwtHash } = await generateSandboxJwt(
    sandbox._id,
    sandbox.teamId,
  );
  const streamSecret = generateStreamSecret();

  await Effect.runPromise(configureSandboxEffect(sandboxUrl, {
    callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
    sandboxJwt: callbackJwt,
    sandboxId: sandbox._id,
    apiProxyUrl: env.CONVEX_SITE_URL,
    streamSecret,
    otelEnabled: isOtelEnabled(),
  }).pipe(Effect.provide(TracingLive)));

  await ctx.runMutation(internal.acp.updateSandboxJwtHash, {
    sandboxId: sandbox._id,
    callbackJwtHash,
  });
  await ctx.runMutation(internal.acpSandboxes.updateStreamSecret, {
    sandboxId: sandbox._id,
    streamSecret,
  });
}

async function reconfigureSandboxForTeam(
  ctx: AcpMutationCtx,
  sandbox: Doc<"acpSandboxes">,
  teamId: string,
): Promise<void> {
  if (!sandbox.sandboxUrl) {
    return;
  }

  const { jwt: callbackJwt, hash: callbackJwtHash } = await generateSandboxJwt(
    sandbox._id,
    teamId,
  );
  const streamSecret = generateStreamSecret();

  await Effect.runPromise(configureSandboxEffect(sandbox.sandboxUrl, {
    callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
    sandboxJwt: callbackJwt,
    sandboxId: sandbox._id,
    apiProxyUrl: env.CONVEX_SITE_URL,
    streamSecret,
    otelEnabled: isOtelEnabled(),
  }).pipe(Effect.provide(TracingLive)));

  await ctx.runMutation(internal.acp.updateSandboxJwtHash, {
    sandboxId: sandbox._id,
    callbackJwtHash,
  });
  await ctx.runMutation(internal.acpSandboxes.updateStreamSecret, {
    sandboxId: sandbox._id,
    streamSecret,
  });

  await ctx.runMutation(internal.acpSandboxes.clearWarmReservation, {
    sandboxId: sandbox._id,
  });
}

async function maybeReconfigureWarmSandbox(
  ctx: AcpMutationCtx,
  sandbox: Doc<"acpSandboxes">,
  teamId: string,
): Promise<void> {
  if (!sandbox.warmReservedTeamId) {
    return;
  }
  await reconfigureSandboxForTeam(ctx, sandbox, teamId);
}

async function scheduleMessageDelivery(
  ctx: AcpInternalActionCtx,
  conversationId: Id<"conversations">,
  messageId: Id<"conversationMessages">,
  attempt: number,
  traceContext?: TraceContext | null,
): Promise<void> {
  if (attempt >= MESSAGE_DELIVERY_MAX_ATTEMPTS) {
    const conversation = await ctx.runQuery(
      internal.acp.getConversationInternal,
      {
        conversationId,
      },
    );
    const message = await ctx.runQuery(
      internal.conversationMessages.getByIdInternal,
      { messageId },
    );

    if (conversation && message && !message.deliverySwapAttempted) {
      await ctx.runMutation(
        internal.conversationMessages.markDeliverySwapAttempted,
        {
          messageId,
          attempted: true,
        },
      );

      const replacement = await replaceSandboxForConversation(
        ctx,
        conversation,
        conversation.userId ?? null,
        conversation.teamId,
      );

      if (replacement) {
        await ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
          conversationId,
          messageId,
          attempt: 0,
          traceContext: traceContext ?? undefined,
        });
        return;
      }
    }

    console.error("[acp] Message delivery attempts exhausted", {
      conversationId,
      messageId,
      attempt,
    });
    await ctx.runMutation(internal.conversationMessages.updateDeliveryStatus, {
      messageId,
      status: "error",
      error: "Delivery failed after multiple attempts",
    });
    return;
  }

  const delay = MESSAGE_DELIVERY_RETRY_MS * (attempt + 1);
  await ctx.scheduler.runAfter(delay, internal.acp.deliverMessageInternal, {
    conversationId,
    messageId,
    attempt: attempt + 1,
    traceContext: traceContext ?? undefined,
  });
}

function acpEffect<T>(
  name: string,
  attributes: Record<string, string | number | boolean | undefined>,
  task: () => Promise<T>,
): Effect.Effect<T, Error> {
  return traced(`acp.${name}`, attributes, task);
}

type AcpActionCtx = Pick<
  ActionCtx,
  "auth" | "runQuery" | "runMutation" | "runAction" | "scheduler"
>;
type AcpActionCtxNoScheduler = Pick<
  ActionCtx,
  "auth" | "runQuery" | "runMutation" | "runAction"
>;
type AcpActionCtxNoAction = Pick<ActionCtx, "auth" | "runQuery" | "runMutation">;
type AcpInternalActionCtx = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "runAction" | "scheduler"
>;
type AcpMutationCtx = Pick<ActionCtx, "runMutation">;
type AcpWarmSandboxCtx = Pick<ActionCtx, "runQuery" | "runMutation" | "scheduler">;
type AcpSandboxAdminCtx = Pick<ActionCtx, "runQuery" | "runMutation">;
type AcpSandboxSwapCtx = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "runAction" | "scheduler"
>;

/**
 * Prewarm a sandbox for a user intent signal.
 */
type PrewarmSandboxArgs = {
  teamSlugOrId: string;
};

export const prewarmSandboxEffect = (
  ctx: AcpActionCtx,
  args: PrewarmSandboxArgs,
): Effect.Effect<{ sandboxId: Id<"acpSandboxes"> }, Error> =>
  acpEffect("prewarmSandbox", { teamSlugOrId: args.teamSlugOrId }, async () => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const teamId = await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: args.teamSlugOrId,
      userId: identity.subject,
    });

    // Look up user's preferred sandbox provider from workspace settings
    const workspaceSettings = await ctx.runQuery(
      internal.workspaceSettings.getByTeamAndUserInternal,
      { teamId, userId: identity.subject },
    );
    const userProviderName = workspaceSettings?.acpSandboxProvider;
    const { snapshotId } = getSnapshotIdForProvider(userProviderName);

    const reserved = await ctx.runMutation(
      internal.acpSandboxes.reserveWarmSandbox,
      {
        userId: identity.subject,
        teamId,
        extendMs: WARM_SANDBOX_TTL_MS,
        snapshotId,
      },
    );

    if (reserved) {
      await ctx.scheduler.runAfter(
        WARM_SANDBOX_TTL_MS,
        internal.acp.expireWarmSandbox,
        { sandboxId: reserved._id },
      );
      return { sandboxId: reserved._id };
    }

    const warm = await ctx.runAction(internal.acp.spawnWarmSandbox, {
      reservedUserId: identity.subject,
      reservedTeamId: teamId,
    });

    return { sandboxId: warm.sandboxId };
  });

export const prewarmSandbox = action({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> =>
    runTracedEffect(prewarmSandboxEffect(ctx, args), TracingLive),
});

/**
 * Start a new conversation.
 * This is the main entry point for iOS clients.
 *
 * Flow:
 * 1. Find or create a sandbox for the team
 * 2. Create conversation record linked to sandbox
 * 3. Initialize conversation on sandbox (POST /api/acp/init)
 * 4. Return conversationId and status
 */
type StartConversationArgs = {
  teamSlugOrId: string;
  providerId: ProviderId;
  cwd: string;
  sandboxId?: Id<"acpSandboxes">;
  clientConversationId?: string;
};

export const startConversationEffect = (
  ctx: AcpActionCtxNoScheduler,
  args: StartConversationArgs,
): Effect.Effect<
  {
    conversationId: Id<"conversations">;
    sandboxId: Id<"acpSandboxes">;
    status: "starting" | "ready";
  },
  Error
> =>
  Effect.gen(function* () {
    const identity = yield* Effect.tryPromise(() => ctx.auth.getUserIdentity());
    if (!identity) {
      return yield* Effect.fail(new Error("Not authenticated"));
    }

    const teamId = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.resolveTeamId, {
        teamSlugOrId: args.teamSlugOrId,
        userId: identity.subject,
      }),
    );

    if (args.clientConversationId) {
      const clientConversationId = args.clientConversationId;
      const existing = yield* Effect.tryPromise(() =>
        ctx.runQuery(internal.acp.getConversationByClientConversationId, {
          teamId,
          clientConversationId,
        }),
      );
      if (existing) {
        if (!existing.acpSandboxId) {
          return yield* Effect.fail(new Error("Conversation missing sandbox"));
        }
        const existingSandboxId = existing.acpSandboxId;
        const sandbox = yield* Effect.tryPromise(() =>
          ctx.runQuery(internal.acpSandboxes.getById, { sandboxId: existingSandboxId }),
        );
        const status: "starting" | "ready" = sandbox?.status === "running" ? "ready" : "starting";
        return {
          conversationId: existing._id,
          sandboxId: existingSandboxId,
          status,
        };
      }
    }

    // Look up user's preferred sandbox provider from workspace settings
    const workspaceSettings = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId,
        userId: identity.subject,
      }),
    );
    const userProviderName = workspaceSettings?.acpSandboxProvider;
    const mcpServers = workspaceSettings?.mcpServers;

    // Get the snapshot ID for the user's preferred provider (or default)
    const { snapshotId, providerName } = getSnapshotIdForProvider(userProviderName);

    let sandboxId = args.sandboxId;
    let status: "starting" | "ready" = "starting";
    let claimedWarmSandbox: Doc<"acpSandboxes"> | null = null;

    if (sandboxId) {
      claimedWarmSandbox = yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.claimWarmSandbox, {
          userId: identity.subject,
          teamId,
          sandboxId,
          snapshotId,
        }),
      );
      sandboxId = claimedWarmSandbox?._id;
    }

    if (!sandboxId) {
      claimedWarmSandbox = yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.claimWarmSandbox, {
          userId: identity.subject,
          teamId,
          snapshotId,
        }),
      );
      sandboxId = claimedWarmSandbox?._id;
    }

    if (!sandboxId) {
      const result = yield* Effect.tryPromise(() =>
        ctx.runAction(internal.acp.spawnSandbox, { teamId, providerName }),
      );
      sandboxId = result.sandboxId;
    } else {
      status = claimedWarmSandbox?.status === "running" ? "ready" : "starting";
    }

    if (!sandboxId) {
      return yield* Effect.fail(new Error("Failed to allocate sandbox"));
    }

    const sandboxIdReady = sandboxId;

    const sessionId = `acp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const conversationId = yield* Effect.tryPromise(() =>
      ctx.runMutation(internal.acp.createConversationInternal, {
        teamId,
        userId: identity.subject,
        sessionId,
        providerId: args.providerId,
        cwd: args.cwd,
        acpSandboxId: sandboxIdReady,
        clientConversationId: args.clientConversationId,
      }),
    );

    yield* Effect.tryPromise(() =>
      ctx.runMutation(internal.acpSandboxes.incrementConversationCount, {
        sandboxId: sandboxIdReady,
      }),
    );

    if (claimedWarmSandbox) {
      yield* Effect.tryPromise(() =>
        reconfigureSandboxForTeam(ctx, claimedWarmSandbox, teamId),
      ).pipe(
        Effect.catchAll((error) => {
          console.error("[acp] Failed to reconfigure warm sandbox:", error);
          return Effect.void;
        }),
      );
    }

    if (status === "ready") {
      const sandbox = yield* Effect.tryPromise(() =>
        ctx.runQuery(internal.acpSandboxes.getById, { sandboxId: sandboxIdReady }),
      );
      if (sandbox) {
        const readiness = yield* ensureSandboxReadyEffect(ctx, sandbox);
        if (readiness.sandboxUrl && readiness.status === "running") {
          const sandboxUrlReady = readiness.sandboxUrl;
          yield* Effect.gen(function* () {
            yield* Effect.tryPromise(() =>
              recordOutboundEvent(ctx, {
                conversationId,
                sandboxId: sandboxIdReady,
                teamId,
                raw: JSON.stringify({
                  conversation_id: conversationId,
                  session_id: sessionId,
                  provider_id: args.providerId,
                  cwd: args.cwd,
                }),
                eventType: "init",
              }),
            );
            const conversationJwt = yield* getConversationJwtEffect(ctx, conversationId);
            yield* initConversationOnSandboxEffect(
              sandboxUrlReady,
              conversationId,
              sessionId,
              args.providerId,
              args.cwd,
              conversationJwt,
              mcpServers,
              "auto_allow_always",
            );
	            yield* Effect.tryPromise(() =>
	              ensureConversationModel(
	                ctx,
	                sandboxUrlReady,
	                conversationId,
	                sandboxIdReady,
	                teamId,
	                args.providerId,
	                resolveDefaultModelId(args.providerId),
	              ),
	            );
            yield* Effect.tryPromise(() =>
              ctx.runMutation(internal.acp.markConversationInitialized, {
                conversationId,
              }),
            );
          }).pipe(
            Effect.catchAll((error) => {
              console.error("[acp] Failed to init conversation on sandbox:", error);
              return Effect.void;
            }),
          );
        }
      }
    }

    return { conversationId, sandboxId: sandboxIdReady, status };
  }).pipe(
    withObservability("acp.startConversation", {
      teamSlugOrId: args.teamSlugOrId,
      providerId: args.providerId,
    }),
  );

export const startConversation = action({
  args: {
    teamSlugOrId: v.string(),
    providerId: providerIdValidator,
    cwd: v.string(),
    sandboxId: v.optional(v.id("acpSandboxes")), // Reuse existing sandbox
    clientConversationId: v.optional(v.string()),
  },
  handler: (ctx, args): Promise<{
    conversationId: Id<"conversations">;
    sandboxId: Id<"acpSandboxes">;
    status: "starting" | "ready";
  }> => runTracedEffect(startConversationEffect(ctx, args), TracingLive),
});

/**
 * Create (if needed) a conversation, persist a user message, and queue delivery.
 * This mutation is used for optimistic UI updates on the client.
 */
export const sendMessageOptimistic = authMutation({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.optional(v.id("conversations")),
    providerId: v.optional(providerIdValidator),
    cwd: v.optional(v.string()),
    content: v.array(contentBlockValidator),
    clientMessageId: v.optional(v.string()),
    clientConversationId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversationId: Id<"conversations">;
    messageId: Id<"conversationMessages">;
    status: "sent" | "queued" | "error";
    error?: string;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    let conversation: Doc<"conversations"> | null = null;
    let conversationId = args.conversationId ?? null;

    if (conversationId) {
      conversation = await ctx.db.get(conversationId);
      if (!conversation || conversation.teamId !== teamId) {
        throw new Error("Conversation not found");
      }
    }

    if (!conversation && args.clientConversationId) {
      conversation = await ctx.runQuery(
        internal.acp.getConversationByClientConversationId,
        {
          teamId,
          clientConversationId: args.clientConversationId,
        },
      );
      if (conversation) {
        conversationId = conversation._id;
      }
    }

    if (!conversation) {
      if (!args.providerId || !args.cwd) {
        throw new Error("providerId and cwd are required to start a conversation");
      }

      // Look up user's preferred sandbox provider from workspace settings
      const workspaceSettings = await ctx.runQuery(
        internal.workspaceSettings.getByTeamAndUserInternal,
        { teamId, userId: identity.subject },
      );
      const userProviderName = workspaceSettings?.acpSandboxProvider;
      const { snapshotId } = getSnapshotIdForProvider(userProviderName);

      const claimed = await ctx.runMutation(
        internal.acpSandboxes.claimWarmSandbox,
        {
          userId: identity.subject,
          teamId,
          snapshotId,
        },
      );
      const sandboxId = claimed?._id;
      const sessionId = `acp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      conversationId = await ctx.runMutation(
        internal.acp.createConversationInternal,
        {
          teamId,
          userId: identity.subject,
          sessionId,
          providerId: args.providerId,
          cwd: args.cwd,
          acpSandboxId: sandboxId,
          clientConversationId: args.clientConversationId,
          initializedOnSandbox: false,
        },
      );

      if (sandboxId) {
        await ctx.runMutation(internal.acpSandboxes.incrementConversationCount, {
          sandboxId,
        });
      }
    }

    if (!conversationId) {
      throw new Error("Conversation not found");
    }

    let existing: Doc<"conversationMessages"> | null = null;
    if (args.clientMessageId) {
      existing = await ctx.runQuery(
        internal.conversationMessages.getByConversationClientMessageId,
        {
          conversationId,
          clientMessageId: args.clientMessageId,
        },
      );
    }

    let messageId: Id<"conversationMessages">;
    let created = false;
    if (existing && existing.role === "user") {
      messageId = existing._id;
    } else {
      messageId = await ctx.runMutation(internal.acp.createMessageInternal, {
        conversationId,
        role: "user",
        content: args.content,
        clientMessageId: args.clientMessageId,
      });
      created = true;
      await ctx.runMutation(internal.acp.updateConversationActivity, {
        conversationId,
      });

      const textContent = args.content
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join(" ");
      if (textContent) {
        await ctx.runMutation(internal.conversationTitle.maybeScheduleTitle, {
          conversationId,
          messageText: textContent,
        });
      }
    }

    const shouldScheduleDelivery =
      !existing || existing.deliveryStatus !== "sent";
    if (shouldScheduleDelivery) {
      await ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
        conversationId,
        messageId,
        attempt: 0,
      });
    }

    if (existing && !created) {
      const status =
        existing.deliveryStatus === "error"
          ? "error"
          : existing.deliveryStatus === "sent"
            ? "sent"
            : "queued";
      return {
        conversationId,
        messageId,
        status,
        error:
          status === "error" ? existing.deliveryError ?? undefined : undefined,
      };
    }

    return { conversationId, messageId, status: "queued" };
  },
});

/**
 * Send a message in a conversation.
 * Persists user message and forwards to sandbox.
 */
type SendMessageArgs = {
  conversationId: Id<"conversations">;
  content: Array<{
    type: "text" | "image" | "resource_link";
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
    name?: string;
  }>;
  clientMessageId?: string;
};

export const sendMessageEffect = (
  ctx: AcpActionCtx,
  args: SendMessageArgs,
): Effect.Effect<
  {
    messageId: Id<"conversationMessages">;
    status: "sent" | "queued" | "error";
    error?: string;
  },
  Error
> =>
  Effect.gen(function* () {
    const identity = yield* Effect.tryPromise(() => ctx.auth.getUserIdentity());
    if (!identity) {
      return yield* Effect.fail(new Error("Not authenticated"));
    }

    const conversation = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.getConversationInternal, {
        conversationId: args.conversationId,
      }),
    );

    if (!conversation) {
      return yield* Effect.fail(new Error("Conversation not found"));
    }

    const teamId = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.resolveTeamId, {
        teamSlugOrId: conversation.teamId,
        userId: identity.subject,
      }),
    );
    const workspaceSettings = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId,
        userId: identity.subject,
      }),
    );
    const mcpServers = workspaceSettings?.mcpServers;

    if (args.clientMessageId) {
      const clientMessageId = args.clientMessageId;
      const existing = yield* Effect.tryPromise(() =>
        ctx.runQuery(internal.conversationMessages.getByConversationClientMessageId, {
          conversationId: args.conversationId,
          clientMessageId,
        }),
      );
      if (existing && existing.role === "user") {
        const status: "sent" | "queued" | "error" =
          existing.deliveryStatus === "queued"
            ? "queued"
            : existing.deliveryStatus === "error"
              ? "error"
              : "sent";
        return {
          messageId: existing._id,
          status,
          error: status === "error" ? (existing.deliveryError ?? undefined) : undefined,
        };
      }
    }

    const messageId = yield* Effect.tryPromise(() =>
      ctx.runMutation(internal.acp.createMessageInternal, {
        conversationId: args.conversationId,
        role: "user",
        content: args.content,
        clientMessageId: args.clientMessageId,
      }),
    );

    // Capture trace context for propagation to scheduled actions
    const traceContext = yield* getTraceContext;

    yield* Effect.tryPromise(() =>
      ctx.runMutation(internal.acp.updateConversationActivity, {
        conversationId: args.conversationId,
      }),
    );

    const textContent = args.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join(" ");
    if (textContent) {
      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.conversationTitle.maybeScheduleTitle, {
          conversationId: args.conversationId,
          messageText: textContent,
        }),
      );
    }

    if (!conversation.acpSandboxId) {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, messageId, 0, traceContext),
      );
      return { messageId, status: "queued" as const, error: "Waiting for sandbox" };
    }

    const sandboxId = conversation.acpSandboxId;
    const sandbox = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acpSandboxes.getById, { sandboxId }),
    );

    if (!sandbox) {
      console.warn("[acp] Sandbox not ready for conversation", {
        conversationId: args.conversationId,
        sandboxStatus: "missing",
      });
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, messageId, 0, traceContext),
      );
      return { messageId, status: "queued" as const, error: "Waiting for sandbox" };
    }

    if (sandbox.status === "error") {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, messageId, 0, traceContext),
      );
      return { messageId, status: "queued" as const, error: "Waiting for sandbox" };
    }

    const readiness = yield* ensureSandboxReadyEffect(ctx, sandbox);
    if (readiness.status === "error") {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, messageId, 0, traceContext),
      );
      return { messageId, status: "queued" as const, error: "Waiting for sandbox" };
    }

    if (!readiness.sandboxUrl || readiness.status !== "running") {
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, messageId, 0, traceContext),
      );
      return { messageId, status: "queued" as const, error: "Waiting for sandbox" };
    }

    const sandboxUrlReady = readiness.sandboxUrl;

    const sendResult = yield* Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId),
      );

      if (!conversation.initializedOnSandbox) {
        yield* Effect.tryPromise(() =>
          recordOutboundEvent(ctx, {
            conversationId: args.conversationId,
            sandboxId,
            teamId: conversation.teamId,
            raw: JSON.stringify({
              conversation_id: args.conversationId,
              session_id: conversation.sessionId,
              provider_id: conversation.providerId,
              cwd: conversation.cwd,
            }),
            eventType: "init",
          }),
        );
        const conversationJwt = yield* getConversationJwtEffect(
          ctx,
          args.conversationId,
        );
        yield* initConversationOnSandboxEffect(
          sandboxUrlReady,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversationJwt,
          mcpServers,
          conversation.permissionMode ?? "auto_allow_always",
        );
	        yield* Effect.tryPromise(() =>
	          ensureConversationModel(
	            ctx,
	            sandboxUrlReady,
	            args.conversationId,
	            sandboxId,
	            conversation.teamId,
	            conversation.providerId,
	            conversation.modelId ?? resolveDefaultModelId(conversation.providerId),
	          ),
	        );
        yield* Effect.tryPromise(() =>
          ctx.runMutation(internal.acp.markConversationInitialized, {
            conversationId: args.conversationId,
          }),
        );
      } else {
	        yield* Effect.tryPromise(() =>
	          ensureConversationModel(
	            ctx,
	            sandboxUrlReady,
	            args.conversationId,
	            sandboxId,
	            conversation.teamId,
	            conversation.providerId,
	            conversation.modelId ?? resolveDefaultModelId(conversation.providerId),
	          ),
	        );
      }

      yield* Effect.tryPromise(() =>
        recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId,
          teamId: conversation.teamId,
          raw: JSON.stringify({
            conversation_id: args.conversationId,
            session_id: conversation.sessionId,
            content: args.content,
          }),
          eventType: "prompt",
        }),
      );
      yield* sendPromptToSandboxEffect(
        sandboxUrlReady,
        args.conversationId,
        conversation.sessionId,
        args.content,
      );

      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.recordActivity, { sandboxId }),
      );
      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.conversationMessages.updateDeliveryStatus, {
          messageId,
          status: "sent",
        }),
      );

      return { messageId, status: "sent" as const };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          console.error("[acp] Failed to send prompt to sandbox:", error);
          yield* Effect.tryPromise(() =>
            recordSandboxError(ctx, sandboxId, error, "Failed to reach sandbox", {
              teamId,
              conversationId: conversation._id,
              context: "sendMessage",
            }),
          );
          yield* Effect.tryPromise(() =>
            ctx.runMutation(internal.conversationMessages.updateDeliveryStatus, {
              messageId,
              status: "error",
              error: "Failed to reach sandbox",
            }),
          );
          return { messageId, status: "error" as const, error: "Failed to reach sandbox" };
        }),
      ),
    );

    return sendResult;
  }).pipe(withObservability("acp.sendMessage", { conversationId: args.conversationId }));

export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.array(contentBlockValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: (ctx, args): Promise<{
    messageId: Id<"conversationMessages">;
    status: "sent" | "queued" | "error";
    error?: string;
  }> => runTracedEffect(sendMessageEffect(ctx, args), TracingLive),
});

/**
 * Retry delivery of an existing user message to the sandbox without duplicating it.
 */
type RetryMessageArgs = {
  conversationId: Id<"conversations">;
  messageId: Id<"conversationMessages">;
};

export const retryMessageEffect = (
  ctx: AcpActionCtx,
  args: RetryMessageArgs,
): Effect.Effect<{ status: "sent" | "queued" | "error"; error?: string }, Error> =>
  Effect.gen(function* () {
    const identity = yield* Effect.tryPromise(() => ctx.auth.getUserIdentity());
    if (!identity) {
      return yield* Effect.fail(new Error("Not authenticated"));
    }

    const conversation = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.getConversationInternal, {
        conversationId: args.conversationId,
      }),
    );

    if (!conversation) {
      return yield* Effect.fail(new Error("Conversation not found"));
    }

    const teamId = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.resolveTeamId, {
        teamSlugOrId: conversation.teamId,
        userId: identity.subject,
      }),
    );

    const message = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.conversationMessages.getByIdInternal, {
        messageId: args.messageId,
      }),
    );

    if (!message || message.conversationId !== args.conversationId) {
      return yield* Effect.fail(new Error("Message not found"));
    }

    if (message.role !== "user") {
      return yield* Effect.fail(new Error("Only user messages can be retried"));
    }

    // Capture trace context for propagation to scheduled actions
    const traceContext = yield* getTraceContext;

    if (!conversation.acpSandboxId) {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, 0, traceContext),
      );
      return { status: "queued" as const, error: "Waiting for sandbox" };
    }

    const sandboxId = conversation.acpSandboxId;
    const sandbox = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acpSandboxes.getById, { sandboxId }),
    );

    if (!sandbox) {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, 0, traceContext),
      );
      return { status: "queued" as const, error: "Waiting for sandbox" };
    }

    const readiness = yield* ensureSandboxReadyEffect(ctx, sandbox);
    if (readiness.status === "error" || sandbox.status === "error") {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, identity.subject, teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, 0, traceContext),
      );
      return { status: "queued" as const, error: "Waiting for sandbox" };
    }

    if (!readiness.sandboxUrl || readiness.status !== "running") {
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, 0, traceContext),
      );
      return { status: "queued" as const, error: "Waiting for sandbox" };
    }

    const sandboxUrlReady = readiness.sandboxUrl;
    const workspaceSettings = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId,
        userId: identity.subject,
      }),
    );
    const mcpServers = workspaceSettings?.mcpServers;

    const retryResult = yield* Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId),
      );

      if (!conversation.initializedOnSandbox) {
        yield* Effect.tryPromise(() =>
          recordOutboundEvent(ctx, {
            conversationId: args.conversationId,
            sandboxId,
            teamId: conversation.teamId,
            raw: JSON.stringify({
              conversation_id: args.conversationId,
              session_id: conversation.sessionId,
              provider_id: conversation.providerId,
              cwd: conversation.cwd,
            }),
            eventType: "init",
          }),
        );
        const conversationJwt = yield* getConversationJwtEffect(
          ctx,
          args.conversationId,
        );
        yield* initConversationOnSandboxEffect(
          sandboxUrlReady,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversationJwt,
          mcpServers,
          conversation.permissionMode ?? "auto_allow_always",
        );
	        yield* Effect.tryPromise(() =>
	          ensureConversationModel(
	            ctx,
	            sandboxUrlReady,
	            args.conversationId,
	            sandboxId,
	            conversation.teamId,
	            conversation.providerId,
	            conversation.modelId ?? resolveDefaultModelId(conversation.providerId),
	          ),
	        );
        yield* Effect.tryPromise(() =>
          ctx.runMutation(internal.acp.markConversationInitialized, {
            conversationId: args.conversationId,
          }),
        );
      } else {
	        yield* Effect.tryPromise(() =>
	          ensureConversationModel(
	            ctx,
	            sandboxUrlReady,
	            args.conversationId,
	            sandboxId,
	            conversation.teamId,
	            conversation.providerId,
	            conversation.modelId ?? resolveDefaultModelId(conversation.providerId),
	          ),
	        );
      }

      yield* Effect.tryPromise(() =>
        recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId,
          teamId: conversation.teamId,
          raw: JSON.stringify({
            conversation_id: args.conversationId,
            session_id: conversation.sessionId,
            content: message.content,
          }),
          eventType: "prompt",
        }),
      );
      yield* sendPromptToSandboxEffect(
        sandboxUrlReady,
        args.conversationId,
        conversation.sessionId,
        message.content,
      );

      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.recordActivity, { sandboxId }),
      );
      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.conversationMessages.updateDeliveryStatus, {
          messageId: args.messageId,
          status: "sent",
        }),
      );

      return { status: "sent" as const };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          console.error("[acp] Failed to retry message:", error);
          yield* Effect.tryPromise(() =>
            recordSandboxError(ctx, sandboxId, error, "Retry failed", {
              teamId,
              conversationId: conversation._id,
              context: "retryMessage",
            }),
          );
          yield* Effect.tryPromise(() =>
            ctx.runMutation(internal.conversationMessages.updateDeliveryStatus, {
              messageId: args.messageId,
              status: "error",
              error: "Retry failed",
            }),
          );
          return { status: "error" as const, error: "Retry failed" };
        }),
      ),
    );

    return retryResult;
  }).pipe(
    withObservability("acp.retryMessage", {
      conversationId: args.conversationId,
      messageId: args.messageId,
    }),
  );

export const retryMessage = action({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
  },
  handler: (ctx, args): Promise<{
    status: "sent" | "queued" | "error";
    error?: string;
  }> => runTracedEffect(retryMessageEffect(ctx, args), TracingLive),
});

/**
 * Send a raw JSON-RPC response to the sandbox.
 */
type SendRpcArgs = {
  conversationId: Id<"conversations">;
  payload: string;
};

export const sendRpcEffect = (
  ctx: AcpActionCtxNoAction,
  args: SendRpcArgs,
): Effect.Effect<{ status: "sent" | "error"; error?: string }, Error> =>
  Effect.gen(function* () {
    const identity = yield* Effect.tryPromise(() => ctx.auth.getUserIdentity());
    if (!identity) {
      return yield* Effect.fail(new Error("Not authenticated"));
    }

    const conversation = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.getConversationInternal, {
        conversationId: args.conversationId,
      }),
    );

    if (!conversation) {
      return yield* Effect.fail(new Error("Conversation not found"));
    }

    yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.resolveTeamId, {
        teamSlugOrId: conversation.teamId,
        userId: identity.subject,
      }),
    );
    const workspaceSettings = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId: conversation.teamId,
        userId: identity.subject,
      }),
    );
    const mcpServers = workspaceSettings?.mcpServers;

    if (!conversation.acpSandboxId) {
      return { status: "error" as const, error: "Sandbox not ready" };
    }

    const sandboxId = conversation.acpSandboxId;
    const sandbox = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acpSandboxes.getById, { sandboxId }),
    );

    if (!sandbox) {
      return { status: "error" as const, error: "Sandbox not ready" };
    }

    const readiness = yield* ensureSandboxReadyEffect(ctx, sandbox);
    if (!readiness.sandboxUrl || readiness.status !== "running") {
      return {
        status: "error" as const,
        error: readiness.status === "starting" ? "Sandbox starting" : "Sandbox not ready",
      };
    }

    const sandboxUrlReady = readiness.sandboxUrl;

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(args.payload);
    } catch (error) {
      console.error("[acp] Invalid RPC payload JSON:", error);
      return { status: "error" as const, error: "Invalid RPC payload" };
    }

    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      return { status: "error" as const, error: "RPC payload must be an object" };
    }

    const rpcResult = yield* Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId),
      );

      if (!conversation.initializedOnSandbox) {
        yield* Effect.tryPromise(() =>
          recordOutboundEvent(ctx, {
            conversationId: args.conversationId,
            sandboxId,
            teamId: conversation.teamId,
            raw: JSON.stringify({
              conversation_id: args.conversationId,
              session_id: conversation.sessionId,
              provider_id: conversation.providerId,
              cwd: conversation.cwd,
            }),
            eventType: "init",
          }),
        );
        const conversationJwt = yield* getConversationJwtEffect(
          ctx,
          args.conversationId,
        );
        yield* initConversationOnSandboxEffect(
          sandboxUrlReady,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversationJwt,
          mcpServers,
          conversation.permissionMode ?? "auto_allow_always",
        );
        yield* Effect.tryPromise(() =>
          ctx.runMutation(internal.acp.markConversationInitialized, {
            conversationId: args.conversationId,
          }),
        );
      }

      yield* Effect.tryPromise(() =>
        recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId,
          teamId: conversation.teamId,
          raw: JSON.stringify(parsedPayload),
          eventType: "rpc",
        }),
      );
      yield* sendRpcToSandboxEffect(sandboxUrlReady, args.conversationId, parsedPayload);

      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.recordActivity, { sandboxId }),
      );

      return { status: "sent" as const };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          console.error("[acp] Failed to send RPC:", error);
          yield* Effect.tryPromise(() =>
            recordSandboxError(ctx, sandboxId, error, "Failed to send RPC", {
              teamId: conversation.teamId,
              conversationId: conversation._id,
              context: "sendRpc",
            }),
          );
          return { status: "error" as const, error: "Failed to send RPC" };
        }),
      ),
    );

    return rpcResult;
  }).pipe(withObservability("acp.sendRpc", { conversationId: args.conversationId }));

export const sendRpc = action({
  args: {
    conversationId: v.id("conversations"),
    payload: v.string(),
  },
  handler: (ctx, args): Promise<{ status: "sent" | "error"; error?: string }> =>
    runTracedEffect(sendRpcEffect(ctx, args), TracingLive),
});

/**
 * Cancel an active conversation.
 */
export const cancelConversation = authMutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Verify team access
    await getTeamId(ctx, conversation.teamId);

    await ctx.db.patch(args.conversationId, {
      status: "cancelled",
      stopReason: "cancelled",
      updatedAt: Date.now(),
    });

    // Decrement sandbox conversation count
    if (conversation.acpSandboxId) {
      await ctx.scheduler.runAfter(
        0,
        internal.acpSandboxes.decrementConversationCount,
        { sandboxId: conversation.acpSandboxId },
      );
    }

    return { success: true };
  },
});

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Resolve team ID and verify user membership.
 */
export const resolveTeamId = internalQuery({
  args: {
    teamSlugOrId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Try to find team by slug first
    let team = await ctx.db
      .query("teams")
      .withIndex("by_slug", (q) => q.eq("slug", args.teamSlugOrId))
      .first();

    // If not found by slug, try by teamId
    if (!team) {
      team = await ctx.db
        .query("teams")
        .withIndex("by_teamId", (q) => q.eq("teamId", args.teamSlugOrId))
        .first();
    }

    if (!team) {
      throw new Error("Team not found");
    }

    // Verify user is a member
    const membership = await ctx.db
      .query("teamMemberships")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", team.teamId).eq("userId", args.userId),
      )
      .first();

    if (!membership) {
      throw new Error("Not a member of this team");
    }

    return team.teamId;
  },
});

/**
 * Create conversation record (internal).
 */
export const createConversationInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.optional(v.string()),
    sessionId: v.string(),
    providerId: providerIdValidator,
    cwd: v.string(),
    acpSandboxId: v.optional(v.id("acpSandboxes")),
    clientConversationId: v.optional(v.string()),
    initializedOnSandbox: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      teamId: args.teamId,
      userId: args.userId,
      sessionId: args.sessionId,
      clientConversationId: args.clientConversationId,
      providerId: args.providerId,
      modelId: resolveDefaultModelId(args.providerId),
      cwd: args.cwd,
      permissionMode: "auto_allow_always",
      status: "active",
      acpSandboxId: args.acpSandboxId,
      initializedOnSandbox: args.initializedOnSandbox ?? false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Mark conversation as initialized on sandbox.
 */
export const markConversationInitialized = internalMutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      initializedOnSandbox: true,
    });
  },
});

/**
 * Update conversation to point to a new sandbox.
 */
export const updateConversationSandbox = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    acpSandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      acpSandboxId: args.acpSandboxId,
      initializedOnSandbox: false,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get conversation (internal).
 */
export const getConversationInternal = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

export const getConversationByClientConversationId = internalQuery({
  args: {
    teamId: v.string(),
    clientConversationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_team_client_conversation_id", (q) =>
        q.eq("teamId", args.teamId).eq(
          "clientConversationId",
          args.clientConversationId,
        ),
      )
      .first();
  },
});

/**
 * Get messages for a conversation (internal).
 */
export const getMessagesInternal = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
  },
});

/**
 * Create message (internal).
 */
export const createMessageInternal = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.array(contentBlockValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("conversationMessages", {
      conversationId: args.conversationId,
      role: args.role,
      clientMessageId: args.clientMessageId,
      deliveryStatus: args.role === "user" ? "queued" : undefined,
      deliverySwapAttempted: args.role === "user" ? false : undefined,
      content: args.content.map((block) => ({
        type: block.type,
        text: block.text,
        data: block.data,
        mimeType: block.mimeType,
        uri: block.uri,
        name: block.name,
      })),
      createdAt: now,
    });

    if (
      args.role === "assistant" &&
      hasVisibleAssistantContent(args.content)
    ) {
      await ctx.db.patch(args.conversationId, {
        lastAssistantVisibleAt: now,
      });
    }

    return messageId;
  },
});

/**
 * Update conversation activity timestamp.
 */
export const updateConversationActivity = internalMutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.conversationId, {
      lastMessageAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Spawn a new sandbox for ACP using the configured provider.
 */
type SpawnSandboxArgs = {
  teamId: string;
  /** Optional provider name from user settings. Falls back to default if not specified or invalid. */
  providerName?: "morph" | "freestyle" | "daytona" | "e2b" | "blaxel";
};

export const spawnSandboxEffect = (
  ctx: AcpMutationCtx,
  args: SpawnSandboxArgs,
): Effect.Effect<{ sandboxId: Id<"acpSandboxes"> }, Error> =>
  acpEffect("spawnSandbox", { teamId: args.teamId, providerName: args.providerName }, async () => {
    // Use specified provider if provided, otherwise fall back to default
    const provider = args.providerName
      ? sandboxProviderResolver.getByName(args.providerName)
      : sandboxProviderResolver.getDefault();
    const snapshotId =
      getDefaultSnapshotId(provider.name as SnapshotSandboxProvider) ??
      "snap_default";
    const streamSecret = generateStreamSecret();

    const sandboxId = await ctx.runMutation(internal.acpSandboxes.create, {
      teamId: args.teamId,
      provider: provider.name,
      instanceId: "pending",
      snapshotId,
      callbackJwtHash: "pending",
      streamSecret,
    });

    const [jwtResult, instance] = await Promise.all([
      generateSandboxJwt(sandboxId, args.teamId),
      provider.spawn({
        teamId: args.teamId,
        snapshotId,
        ttlSeconds: 3600,
        ttlAction: "pause",
        metadata: {
          sandboxId,
        },
      }),
    ]);

    const { jwt: callbackJwt, hash: callbackJwtHash } = jwtResult;

    await Promise.all([
      ctx.runMutation(internal.acp.updateSandboxJwtHash, {
        sandboxId,
        callbackJwtHash,
      }),
      ctx.runMutation(internal.acp.updateSandboxInstanceId, {
        sandboxId,
        instanceId: instance.instanceId,
        sandboxUrl: instance.sandboxUrl,
      }),
    ]);

    if (instance.sandboxUrl) {
      await Effect.runPromise(configureSandboxEffect(instance.sandboxUrl, {
        callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
        sandboxJwt: callbackJwt,
        sandboxId,
        apiProxyUrl: env.CONVEX_SITE_URL,
        streamSecret,
        otelEnabled: isOtelEnabled(),
      }).pipe(Effect.provide(TracingLive)));
    }

    return { sandboxId };
  });

export const spawnSandbox = internalAction({
  args: {
    teamId: v.string(),
    providerName: v.optional(
      v.union(
        v.literal("morph"),
        v.literal("freestyle"),
        v.literal("daytona"),
        v.literal("e2b"),
        v.literal("blaxel")
      )
    ),
  },
  handler: (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> =>
    runTracedEffect(spawnSandboxEffect(ctx, args), TracingLive),
});

/**
 * Spawn a sandbox for Rivet chat integration.
 * Returns the sandbox URL that can be passed to the Rivet actor.
 * Uses the user's configured sandbox provider from workspace settings.
 */
export const spawnRivetSandbox = action({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args): Promise<{ sandboxId: string; sandboxUrl: string }> => {
    // Look up user's preferred sandbox provider
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get workspace settings for provider preference
    const workspaceSettings = await ctx.runQuery(
      internal.workspaceSettings.getByTeamAndUserInternal,
      { teamId: args.teamId, userId: identity.subject },
    );
    const providerName = workspaceSettings?.acpSandboxProvider;

    // Spawn the sandbox
    const result = await ctx.runAction(internal.acp.spawnSandbox, {
      teamId: args.teamId,
      providerName,
    });

    // Get the sandbox details
    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: result.sandboxId,
    });

    if (!sandbox?.sandboxUrl) {
      throw new Error("Sandbox URL not available");
    }

    return {
      sandboxId: result.sandboxId,
      sandboxUrl: sandbox.sandboxUrl,
    };
  },
});

/**
 * Spawn a warm sandbox reserved for a user intent signal.
 */
type SpawnWarmSandboxArgs = {
  reservedUserId: string;
  reservedTeamId: string;
};

export const spawnWarmSandboxEffect = (
  ctx: AcpWarmSandboxCtx,
  args: SpawnWarmSandboxArgs,
): Effect.Effect<{ sandboxId: Id<"acpSandboxes"> }, Error> =>
  acpEffect(
    "spawnWarmSandbox",
    { reservedUserId: args.reservedUserId, reservedTeamId: args.reservedTeamId },
    async () => {
      // Look up user's preferred sandbox provider from workspace settings
      const workspaceSettings = await ctx.runQuery(
        internal.workspaceSettings.getByTeamAndUserInternal,
        { teamId: args.reservedTeamId, userId: args.reservedUserId },
      );
      const userProviderName = workspaceSettings?.acpSandboxProvider;
      const { snapshotId, providerName } = getSnapshotIdForProvider(userProviderName);
      const provider = sandboxProviderResolver.getByName(providerName);
      const streamSecret = generateStreamSecret();

      const now = Date.now();
      const sandboxId = await ctx.runMutation(internal.acpSandboxes.create, {
        teamId: WARM_POOL_TEAM_ID,
        provider: provider.name,
        instanceId: "pending",
        snapshotId,
        callbackJwtHash: "pending",
        streamSecret,
        poolState: "reserved",
        warmExpiresAt: now + WARM_SANDBOX_TTL_MS,
        warmReservedUserId: args.reservedUserId,
        warmReservedTeamId: args.reservedTeamId,
        warmReservedAt: now,
      });

      const [jwtResult, instance] = await Promise.all([
        generateSandboxJwt(sandboxId, WARM_POOL_TEAM_ID),
        provider.spawn({
          teamId: WARM_POOL_TEAM_ID,
          snapshotId,
          ttlSeconds: 3600,
          ttlAction: "pause",
          metadata: {
            sandboxId,
          },
        }),
      ]);

      const { jwt: callbackJwt, hash: callbackJwtHash } = jwtResult;

      await Promise.all([
        ctx.runMutation(internal.acp.updateSandboxJwtHash, {
          sandboxId,
          callbackJwtHash,
        }),
        ctx.runMutation(internal.acp.updateSandboxInstanceId, {
          sandboxId,
          instanceId: instance.instanceId,
          sandboxUrl: instance.sandboxUrl,
        }),
      ]);

      if (instance.sandboxUrl) {
        await Effect.runPromise(
          configureSandboxEffect(instance.sandboxUrl, {
            callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
            sandboxJwt: callbackJwt,
            sandboxId,
            apiProxyUrl: env.CONVEX_SITE_URL,
            streamSecret,
            otelEnabled: isOtelEnabled(),
          }).pipe(Effect.provide(TracingLive))
        );
      }

      await ctx.scheduler.runAfter(
        WARM_SANDBOX_TTL_MS,
        internal.acp.expireWarmSandbox,
        { sandboxId },
      );

      return { sandboxId };
    },
  );

export const spawnWarmSandbox = internalAction({
  args: {
    reservedUserId: v.string(),
    reservedTeamId: v.string(),
  },
  handler: (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> =>
    runTracedEffect(spawnWarmSandboxEffect(ctx, args), TracingLive),
});

/**
 * Deliver a queued message once the sandbox is ready.
 */
type DeliverMessageArgs = {
  conversationId: Id<"conversations">;
  messageId: Id<"conversationMessages">;
  attempt: number;
  traceContext?: TraceContext | null;
};

export const deliverMessageInternalEffect = (
  ctx: AcpInternalActionCtx,
  args: DeliverMessageArgs,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const conversation = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acp.getConversationInternal, {
        conversationId: args.conversationId,
      }),
    );

    if (!conversation) {
      return;
    }

    const message = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.conversationMessages.getByIdInternal, {
        messageId: args.messageId,
      }),
    );

    if (!message || message.conversationId !== args.conversationId) {
      return;
    }

    if (message.role !== "user") {
      return;
    }

    let sandboxId = conversation.acpSandboxId ?? null;
    if (!sandboxId) {
      const replacement = yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(
          ctx,
          conversation,
          conversation.userId ?? null,
          conversation.teamId,
        ),
      );
      sandboxId = replacement ?? null;
    }

    if (!sandboxId) {
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, args.attempt, args.traceContext),
      );
      return;
    }

    const sandbox = yield* Effect.tryPromise(() =>
      ctx.runQuery(internal.acpSandboxes.getById, { sandboxId }),
    );

    if (!sandbox) {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, conversation.userId ?? null, conversation.teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, args.attempt, args.traceContext),
      );
      return;
    }

    const readiness = yield* ensureSandboxReadyEffect(ctx, sandbox);
    if (readiness.status === "error" || sandbox.status === "error") {
      yield* Effect.tryPromise(() =>
        replaceSandboxForConversation(ctx, conversation, conversation.userId ?? null, conversation.teamId),
      );
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, args.attempt, args.traceContext),
      );
      return;
    }

    if (!readiness.sandboxUrl || readiness.status !== "running") {
      yield* Effect.tryPromise(() =>
        scheduleMessageDelivery(ctx, args.conversationId, args.messageId, args.attempt, args.traceContext),
      );
      return;
    }

    // Capture non-null values for use in nested generators
    const sandboxUrlReady = readiness.sandboxUrl;
    const sandboxIdReady = sandboxId as Id<"acpSandboxes">; // Already checked sandboxId is not null above
    let workspaceSettings = null;
    const conversationUserId = conversation.userId;
    if (conversationUserId) {
      workspaceSettings = yield* Effect.tryPromise(() =>
        ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
          teamId: conversation.teamId,
          userId: conversationUserId,
        }),
      );
    }
    const mcpServers = workspaceSettings?.mcpServers;

    const deliveryEffect = Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId),
      );

      if (!conversation.initializedOnSandbox) {
        yield* Effect.tryPromise(() =>
          recordOutboundEvent(ctx, {
            conversationId: args.conversationId,
            sandboxId: sandboxIdReady,
            teamId: conversation.teamId,
            raw: JSON.stringify({
              conversation_id: args.conversationId,
              session_id: conversation.sessionId,
              provider_id: conversation.providerId,
              cwd: conversation.cwd,
            }),
            eventType: "init",
          }),
        );
        const conversationJwt = yield* getConversationJwtEffect(
          ctx,
          args.conversationId,
        );
        yield* initConversationOnSandboxEffect(
          sandboxUrlReady,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversationJwt,
          mcpServers,
          conversation.permissionMode ?? "auto_allow_always",
        );
	        yield* Effect.tryPromise(() =>
	          ensureConversationModel(
	            ctx,
	            sandboxUrlReady,
	            args.conversationId,
	            sandboxIdReady,
	            conversation.teamId,
	            conversation.providerId,
	            conversation.modelId ?? resolveDefaultModelId(conversation.providerId),
	          ),
	        );
        yield* Effect.tryPromise(() =>
          ctx.runMutation(internal.acp.markConversationInitialized, {
            conversationId: args.conversationId,
          }),
        );
      } else {
	        yield* Effect.tryPromise(() =>
	          ensureConversationModel(
	            ctx,
	            sandboxUrlReady,
	            args.conversationId,
	            sandboxIdReady,
	            conversation.teamId,
	            conversation.providerId,
	            conversation.modelId ?? resolveDefaultModelId(conversation.providerId),
	          ),
	        );
      }

      yield* Effect.tryPromise(() =>
        recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId: sandboxIdReady,
          teamId: conversation.teamId,
          raw: JSON.stringify({
            conversation_id: args.conversationId,
            session_id: conversation.sessionId,
            content: message.content,
          }),
          eventType: "prompt",
        }),
      );
      yield* sendPromptToSandboxEffect(
        sandboxUrlReady,
        args.conversationId,
        conversation.sessionId,
        message.content,
      );

      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.acpSandboxes.recordActivity, { sandboxId: sandboxIdReady }),
      );

      yield* Effect.tryPromise(() =>
        ctx.runMutation(internal.conversationMessages.updateDeliveryStatus, {
          messageId: args.messageId,
          status: "sent",
        }),
      );
    });

    yield* deliveryEffect.pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          console.error("[acp] Failed to deliver queued message:", error);
          yield* Effect.tryPromise(() =>
            recordSandboxError(ctx, sandboxIdReady, error, "Failed to deliver queued message", {
              teamId: conversation.teamId,
              conversationId: conversation._id,
              context: "deliverQueuedMessage",
            }),
          );
          yield* Effect.tryPromise(() =>
            scheduleMessageDelivery(ctx, args.conversationId, args.messageId, args.attempt, args.traceContext),
          );
        }),
      ),
    );
  }).pipe(
    withTraceContext(args.traceContext),
    withObservability("acp.deliverMessageInternal", {
      conversationId: args.conversationId,
      messageId: args.messageId,
      attempt: args.attempt,
    }),
  );

export const deliverMessageInternal = internalAction({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
    attempt: v.number(),
    traceContext: v.optional(
      v.object({
        traceId: v.string(),
        spanId: v.string(),
        traceFlags: v.optional(v.number()),
      }),
    ),
  },
  handler: (ctx, args) => runTracedEffect(deliverMessageInternalEffect(ctx, args), TracingLive),
});

/**
 * Stop a warm sandbox if it expires without being claimed.
 */
type ExpireWarmSandboxArgs = {
  sandboxId: Id<"acpSandboxes">;
};

export const expireWarmSandboxEffect = (
  ctx: AcpSandboxAdminCtx,
  args: ExpireWarmSandboxArgs,
): Effect.Effect<void, Error> =>
  acpEffect("expireWarmSandbox", { sandboxId: args.sandboxId }, async () => {
    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: args.sandboxId,
    });
    if (!sandbox) {
      return;
    }

    if (sandbox.poolState !== "available" && sandbox.poolState !== "reserved") {
      return;
    }

    const expiresAt = sandbox.warmExpiresAt;
    if (!expiresAt || expiresAt > Date.now()) {
      return;
    }

    const provider = sandboxProviderResolver.getByName(sandbox.provider);
    try {
      await provider.stop(sandbox.instanceId);
    } catch (error) {
      console.error("[acp] Failed to stop expired warm sandbox:", error);
      return;
    }

    await ctx.runMutation(internal.acpSandboxes.markStopped, {
      sandboxId: sandbox._id,
    });
  });

export const expireWarmSandbox = internalAction({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: (ctx, args) => runTracedEffect(expireWarmSandboxEffect(ctx, args), TracingLive),
});

/**
 * Stop a sandbox instance (best-effort).
 */
type StopSandboxArgs = {
  sandboxId: Id<"acpSandboxes">;
};

export const stopSandboxInternalEffect = (
  ctx: AcpSandboxAdminCtx,
  args: StopSandboxArgs,
): Effect.Effect<void, Error> =>
  acpEffect("stopSandboxInternal", { sandboxId: args.sandboxId }, async () => {
    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: args.sandboxId,
    });
    if (!sandbox) {
      return;
    }

    const provider = sandboxProviderResolver.getByName(sandbox.provider);
    try {
      await provider.stop(sandbox.instanceId);
      await ctx.runMutation(internal.acpSandboxes.updateStatus, {
        sandboxId: sandbox._id,
        status: "stopped",
      });
    } catch (error) {
      console.error("[acp] Failed to stop sandbox:", error);
    }
  });

export const stopSandboxInternal = internalAction({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: (ctx, args) => runTracedEffect(stopSandboxInternalEffect(ctx, args), TracingLive),
});

/**
 * Update sandbox JWT hash.
 */
export const updateSandboxJwtHash = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    callbackJwtHash: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      callbackJwtHash: args.callbackJwtHash,
    });
  },
});

/**
 * Update sandbox instance ID and URL.
 */
export const updateSandboxInstanceId = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    instanceId: v.string(),
    sandboxUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      instanceId: args.instanceId,
      ...(args.sandboxUrl && {
        sandboxUrl: args.sandboxUrl,
        status: "running",
      }),
    });
  },
});

// ============================================================================
// HTTP helpers for sandbox communication
// ============================================================================

/**
 * Configure a sandbox with callback settings.
 * Called immediately after spawn because Morph uses memory snapshots,
 * so env vars passed at spawn time aren't available to running processes.
 */

/**
 * Check if OTel is enabled (Axiom backend is configured).
 * When enabled, the sandbox will send telemetry to the Convex OTel proxy,
 * which validates the sandbox JWT and forwards to Axiom.
 */
function isOtelEnabled(): boolean {
  return !!(env.AXIOM_DOMAIN && env.AXIOM_TOKEN && env.AXIOM_TRACES_DATASET);
}

function configureSandboxEffect(
  sandboxUrl: string,
  config: {
    callbackUrl: string;
    sandboxJwt: string;
    sandboxId: string;
    apiProxyUrl?: string;
    streamSecret: string;
    otelEnabled?: boolean;
  },
): Effect.Effect<void, Error> {
  return traced(
    "acp.sandbox.configure",
    { sandboxId: config.sandboxId, sandboxUrl },
    async () => {
      console.log(`[acp] Configuring sandbox at ${sandboxUrl}`);

      // OTel endpoint base URL - the SDK appends /v1/traces, /v1/metrics, /v1/logs
      const otelEndpoint = config.otelEnabled
        ? `${env.CONVEX_SITE_URL}/api/otel`
        : undefined;

      const response = await fetch(`${sandboxUrl}/api/acp/configure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          callback_url: config.callbackUrl,
          sandbox_jwt: config.sandboxJwt,
          sandbox_id: config.sandboxId,
          api_proxy_url: config.apiProxyUrl,
          stream_secret: config.streamSecret,
          otel_endpoint: otelEndpoint,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Sandbox configure failed: ${response.status} - ${text}`);
      }

      console.log(`[acp] Sandbox configured successfully`);
    },
  );
}

function getConversationJwtEffect(
  ctx: Pick<ActionCtx, "runMutation">,
  conversationId: Id<"conversations">
): Effect.Effect<string, Error> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () =>
        ctx.runMutation(internal.conversations.generateJwt, {
          conversationId,
        }),
      catch: (error) =>
        error instanceof Error
          ? error
          : new Error("Failed to generate conversation JWT"),
    });
    return result.jwt;
  });
}

/**
 * Initialize a conversation on a sandbox.
 * Automatically captures and forwards trace context to link Convex → Claude Code traces.
 */
function initConversationOnSandboxEffect(
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  sessionId: string,
  providerId: string,
  cwd: string,
  conversationJwt: string,
  mcpServers?: McpServerConfig[],
  permissionMode?: string,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    // Capture trace context to pass to sandbox for trace linking
    const traceCtx = yield* getTraceContext;

    yield* traced(
      "acp.sandbox.init_conversation",
      { conversationId, providerId, sandboxUrl },
      async () => {
        const response = await fetch(`${sandboxUrl}/api/acp/init`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversation_id: conversationId,
            session_id: sessionId,
            provider_id: providerId,
            cwd,
            permission_mode: permissionMode,
            conversation_jwt: conversationJwt,
            mcp_servers: mcpServers,
            // Pass trace context for linking Convex traces to Claude Code traces
            trace_context: traceCtx ?? undefined,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Sandbox init failed: ${response.status} - ${text}`);
        }
      },
    );
  });
}

/**
 * Send a prompt to a sandbox.
 * Automatically captures and forwards trace context to link Convex → Claude Code traces.
 */
function sendPromptToSandboxEffect(
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  sessionId: string,
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
    name?: string;
  }>,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    // Capture trace context to pass to sandbox for trace linking
    const traceCtx = yield* getTraceContext;

    yield* traced(
      "acp.sandbox.prompt",
      { conversationId, sandboxUrl },
      async () => {
        const response = await fetch(`${sandboxUrl}/api/acp/prompt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversation_id: conversationId,
            session_id: sessionId,
            content,
            // Pass trace context for linking Convex traces to Claude Code traces
            trace_context: traceCtx ?? undefined,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Sandbox prompt failed: ${response.status} - ${text}`);
        }
      },
    );
  });
}

/**
 * Persist an outbound ACP payload for debugging.
 */
async function recordOutboundEvent(
  ctx: AcpMutationCtx,
  args: {
    conversationId: Id<"conversations">;
    sandboxId: Id<"acpSandboxes">;
    teamId: string;
    raw: string;
    eventType?: string;
  },
): Promise<void> {
  try {
    await ctx.runMutation(internal.acpRawEvents.appendOutboundEvent, {
      conversationId: args.conversationId,
      sandboxId: args.sandboxId,
      teamId: args.teamId,
      raw: args.raw,
      eventType: args.eventType,
    });
  } catch (error) {
    console.error("[acp] Failed to record outbound event:", error);
  }
}

/**
 * Ensure a conversation is using the desired model.
 */
async function ensureConversationModel(
  ctx: AcpMutationCtx,
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  sandboxId: Id<"acpSandboxes">,
  teamId: string,
  providerId: string,
  modelId: string | undefined,
): Promise<void> {
  // Only Claude Code currently supports session/set_model reliably.
  // Codex sets its model via startup config flags, and some providers may reject this RPC.
  if (providerId !== "claude") {
    return;
  }
  if (!modelId) {
    return;
  }

  const payload = {
    jsonrpc: "2.0",
    id: `cmux-set-model-${conversationId}-${Date.now()}`,
    method: "session/set_model",
    params: {
      modelId,
    },
  };

  await recordOutboundEvent(ctx, {
    conversationId,
    sandboxId,
    teamId,
    raw: JSON.stringify(payload),
    eventType: "set_model",
  });

  try {
    await Effect.runPromise(sendRpcToSandboxEffect(sandboxUrl, conversationId, payload).pipe(Effect.provide(TracingLive)));
  } catch (error) {
    console.error("[acp] Failed to set session model:", error);
  }
}

/**
 * Send a raw JSON-RPC payload to a sandbox.
 */
function sendRpcToSandboxEffect(
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  payload: unknown,
): Effect.Effect<void, Error> {
  return traced(
    "acp.sandbox.rpc",
    { conversationId, sandboxUrl },
    async () => {
      const response = await fetch(`${sandboxUrl}/api/acp/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          payload,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Sandbox RPC failed: ${response.status} - ${text}`);
      }
    },
  );
}

// ============================================================================
// Query APIs for iOS subscriptions
// ============================================================================

/**
 * Get streaming info for a conversation (sandbox URL + short-lived stream token).
 */
export const getStreamInfo = authQuery({
  args: {
    teamSlugOrId: v.string(),
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation || conversation.teamId !== teamId) {
      return { sandboxUrl: null, token: null, status: "offline" };
    }

    if (!conversation.acpSandboxId) {
      return { sandboxUrl: null, token: null, status: "offline" };
    }

    const sandbox = await ctx.db.get(conversation.acpSandboxId);
    if (!sandbox || !sandbox.sandboxUrl || !sandbox.streamSecret) {
      return { sandboxUrl: null, token: null, status: "offline" };
    }

    const status = normalizeSandboxStatus(sandbox.status);
    if (status !== "running") {
      return { sandboxUrl: sandbox.sandboxUrl, token: null, status };
    }

    const token = await new SignJWT({
      conversationId: args.conversationId,
      sandboxId: sandbox._id,
      teamId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(sandbox.streamSecret));

    return { sandboxUrl: sandbox.sandboxUrl, token, status };
  },
});

/**
 * Get conversation details.
 */
export const getConversation = authQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return null;
    }

    // Verify team access
    try {
      await getTeamId(ctx, conversation.teamId);
    } catch {
      return null;
    }

    return conversation;
  },
});

/**
 * List messages for a conversation (paginated).
 */
export const listMessages = authQuery({
  args: {
    conversationId: v.id("conversations"),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Verify team access
    await getTeamId(ctx, conversation.teamId);

    const limit = args.limit ?? 50;

    const result = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: limit });

    return {
      messages: result.page,
      nextCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

/**
 * Subscribe to new messages (for real-time streaming).
 */
export const subscribeNewMessages = authQuery({
  args: {
    conversationId: v.id("conversations"),
    afterTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return [];
    }

    // Verify team access
    try {
      await getTeamId(ctx, conversation.teamId);
    } catch {
      return [];
    }

    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .filter((q) => q.gt(q.field("createdAt"), args.afterTimestamp))
      .order("asc")
      .collect();
  },
});

/**
 * Get all messages for a conversation (non-paginated).
 * Useful for E2E testing and simpler clients.
 */
export const getMessages = authQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return [];
    }

    // Verify team access
    try {
      await getTeamId(ctx, conversation.teamId);
    } catch {
      return [];
    }

    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
  },
});
