import { v } from "convex/values";
import { SignJWT } from "jose";
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
import { authMutation, authQuery } from "./users/utils";
import type {
  SandboxProvider as SandboxProviderInterface,
  SandboxStatus,
  SandboxStatusInfo,
} from "../_shared/sandbox-providers";

function getCurrentSnapshotId(): string {
  const provider = getDefaultSandboxProvider();
  return (
    getDefaultSnapshotId(provider.name as SnapshotSandboxProvider) ??
    "snap_default"
  );
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

const DEFAULT_CLAUDE_MODEL_ID = "claude-opus-4-5-20251101";
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
    return DEFAULT_CLAUDE_MODEL_ID;
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

async function ensureSandboxReady(
  ctx: ActionCtx,
  sandbox: Doc<"acpSandboxes">,
): Promise<{
  status: NormalizedSandboxStatus;
  sandboxUrl: string | null;
}> {
  const provider = getSandboxProvider(sandbox.provider);
  let statusInfo: SandboxStatusInfo | null = null;

  try {
    statusInfo = await provider.getStatus(sandbox.instanceId);
  } catch (error) {
    console.error("[acp] Failed to fetch sandbox status:", error);
    return {
      status: sandbox.status,
      sandboxUrl: sandbox.sandboxUrl ?? null,
    };
  }

  let normalizedStatus = normalizeSandboxStatus(statusInfo.status);
  let sandboxUrl = sandbox.sandboxUrl ?? statusInfo.sandboxUrl ?? null;

  if (normalizedStatus === "paused" && provider.resume) {
    try {
      await provider.resume(sandbox.instanceId);
      normalizedStatus = "starting";
    } catch (error) {
      console.error("[acp] Failed to resume sandbox:", error);
    }
  }

  if (normalizedStatus === "starting") {
    const status = await waitForSandboxRunning(
      provider,
      sandbox.instanceId,
      3,
      1000,
    );
    normalizedStatus = normalizeSandboxStatus(status);
  }

  let returnStatus: NormalizedSandboxStatus = normalizedStatus;
  if (normalizedStatus === "running" && sandboxUrl) {
    const healthy = await waitForSandboxHealthy(sandboxUrl, 2, 750);
    if (!healthy) {
      returnStatus = "starting";
    }
  }

  const shouldUpdateStatus =
    sandbox.status !== normalizedStatus ||
    (!sandbox.sandboxUrl && sandboxUrl) ||
    (normalizedStatus === "error" && !sandbox.lastError);

  if (shouldUpdateStatus) {
    const providerFallback = `provider ${provider.name} reported error status for ${sandbox.instanceId}`;
    const errorMessage =
      statusInfo?.error ?? sandbox.lastError ?? providerFallback;

    await ctx.runMutation(internal.acpSandboxes.updateStatus, {
      sandboxId: sandbox._id,
      status: normalizedStatus,
      ...(sandbox.sandboxUrl ? {} : sandboxUrl ? { sandboxUrl } : {}),
      ...(normalizedStatus === "error" ? { errorMessage } : {}),
    });

    // Log error to acpRawEvents for debugging history
    if (normalizedStatus === "error") {
      await ctx.runMutation(internal.acpRawEvents.appendErrorBySandbox, {
        sandboxId: sandbox._id,
        teamId: sandbox.teamId,
        errorMessage,
        context: "ensureSandboxReady",
      });
    }
  }

  if (returnStatus === "running" && sandboxUrl && !sandbox.streamSecret) {
    try {
      await ensureStreamSecretConfigured(ctx, sandbox, sandboxUrl);
    } catch (error) {
      console.error("[acp] Failed to configure stream secret:", error);
    }
  }

  return {
    status: returnStatus,
    sandboxUrl: returnStatus === "running" ? sandboxUrl : null,
  };
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
  ctx: ActionCtx,
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
  ctx: ActionCtx,
  conversation: Doc<"conversations">,
  userId: string | null,
  teamId: string,
): Promise<Id<"acpSandboxes"> | null> {
  const previousSandboxId = conversation.acpSandboxId;

  let claimedWarmSandbox: Doc<"acpSandboxes"> | null = null;
  const snapshotId = getCurrentSnapshotId();

  if (userId) {
    claimedWarmSandbox = await ctx.runMutation(
      internal.acpSandboxes.claimWarmSandbox,
      {
        userId,
        teamId,
        snapshotId,
      },
    );
  }

  let sandboxId = claimedWarmSandbox?._id;

  if (!sandboxId) {
    const result = await ctx.runAction(internal.acp.spawnSandbox, {
      teamId,
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
  ctx: ActionCtx,
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

  await configureSandbox(sandboxUrl, {
    callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
    sandboxJwt: callbackJwt,
    sandboxId: sandbox._id,
    apiProxyUrl: env.CONVEX_SITE_URL,
    streamSecret,
  });

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
  ctx: ActionCtx,
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

  await configureSandbox(sandbox.sandboxUrl, {
    callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
    sandboxJwt: callbackJwt,
    sandboxId: sandbox._id,
    apiProxyUrl: env.CONVEX_SITE_URL,
    streamSecret,
  });

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
  ctx: ActionCtx,
  sandbox: Doc<"acpSandboxes">,
  teamId: string,
): Promise<void> {
  if (!sandbox.warmReservedTeamId) {
    return;
  }
  await reconfigureSandboxForTeam(ctx, sandbox, teamId);
}

async function scheduleMessageDelivery(
  ctx: ActionCtx,
  conversationId: Id<"conversations">,
  messageId: Id<"conversationMessages">,
  attempt: number,
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
  });
}

/**
 * Prewarm a sandbox for a user intent signal.
 */
export const prewarmSandbox = action({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const teamId = await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: args.teamSlugOrId,
      userId: identity.subject,
    });

    const snapshotId = getCurrentSnapshotId();

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
  },
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
export const startConversation = action({
  args: {
    teamSlugOrId: v.string(),
    providerId: providerIdValidator,
    cwd: v.string(),
    sandboxId: v.optional(v.id("acpSandboxes")), // Reuse existing sandbox
    clientConversationId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    conversationId: Id<"conversations">;
    sandboxId: Id<"acpSandboxes">;
    status: "starting" | "ready";
  }> => {
    // Verify auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Resolve team ID
    const teamId = await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: args.teamSlugOrId,
      userId: identity.subject,
    });

    if (args.clientConversationId) {
      const existing = await ctx.runQuery(
        internal.acp.getConversationByClientConversationId,
        {
          teamId,
          clientConversationId: args.clientConversationId,
        },
      );
      if (existing) {
        if (!existing.acpSandboxId) {
          throw new Error("Conversation missing sandbox");
        }
        const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
          sandboxId: existing.acpSandboxId,
        });
        const status = sandbox?.status === "running" ? "ready" : "starting";
        return {
          conversationId: existing._id,
          sandboxId: existing.acpSandboxId,
          status,
        };
      }
    }

    // Always use a new sandbox per conversation (warm pool eligible)
    let sandboxId = args.sandboxId;
    let status: "starting" | "ready" = "starting";
    let claimedWarmSandbox = null as Doc<"acpSandboxes"> | null;
    const snapshotId = getCurrentSnapshotId();

    if (sandboxId) {
      claimedWarmSandbox = await ctx.runMutation(
        internal.acpSandboxes.claimWarmSandbox,
        {
          userId: identity.subject,
          teamId,
          sandboxId,
          snapshotId,
        },
      );
      sandboxId = claimedWarmSandbox?._id;
    }

    if (!sandboxId) {
      claimedWarmSandbox = await ctx.runMutation(
        internal.acpSandboxes.claimWarmSandbox,
        {
          userId: identity.subject,
          teamId,
          snapshotId,
        },
      );
      sandboxId = claimedWarmSandbox?._id;
    }

    if (!sandboxId) {
      const result = await ctx.runAction(internal.acp.spawnSandbox, {
        teamId,
      });
      sandboxId = result.sandboxId;
    } else {
      status = claimedWarmSandbox?.status === "running" ? "ready" : "starting";
    }

    // Create conversation record
    const sessionId = `acp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const conversationId = await ctx.runMutation(
      internal.acp.createConversationInternal,
      {
        teamId,
        userId: identity.subject,
        sessionId,
        providerId: args.providerId,
        cwd: args.cwd,
        acpSandboxId: sandboxId,
        clientConversationId: args.clientConversationId,
      },
    );

    // Increment sandbox conversation count
    await ctx.runMutation(internal.acpSandboxes.incrementConversationCount, {
      sandboxId,
    });

    if (claimedWarmSandbox) {
      try {
        await reconfigureSandboxForTeam(ctx, claimedWarmSandbox, teamId);
      } catch (error) {
        console.error("[acp] Failed to reconfigure warm sandbox:", error);
      }
    }

    // If sandbox is ready, initialize conversation on it
    if (status === "ready") {
      const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
        sandboxId,
      });
      if (sandbox) {
        const readiness = await ensureSandboxReady(ctx, sandbox);
        if (readiness.sandboxUrl && readiness.status === "running") {
          try {
            await recordOutboundEvent(ctx, {
              conversationId,
              sandboxId,
              teamId,
              raw: JSON.stringify({
                conversation_id: conversationId,
                session_id: sessionId,
                provider_id: args.providerId,
                cwd: args.cwd,
              }),
              eventType: "init",
            });
            await initConversationOnSandbox(
              readiness.sandboxUrl,
              conversationId,
              sessionId,
              args.providerId,
              args.cwd,
              "auto_allow_always", // Default permission mode for all ACP conversations
            );
            await ensureConversationModel(
              ctx,
              readiness.sandboxUrl,
              conversationId,
              sandboxId,
              teamId,
              resolveDefaultModelId(args.providerId),
            );
            // Mark as initialized
            await ctx.runMutation(internal.acp.markConversationInitialized, {
              conversationId,
            });
          } catch (error) {
            console.error(
              "[acp] Failed to init conversation on sandbox:",
              error,
            );
            // Don't fail the whole operation, sandbox might not be ready yet
          }
        }
      }
    }

    return { conversationId, sandboxId, status };
  },
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

      const snapshotId = getCurrentSnapshotId();
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
export const sendMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.array(contentBlockValidator),
    clientMessageId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    messageId: Id<"conversationMessages">;
    status: "sent" | "queued" | "error";
    error?: string;
  }> => {
    // Verify auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get conversation and verify ownership
    const conversation = await ctx.runQuery(
      internal.acp.getConversationInternal,
      { conversationId: args.conversationId },
    );

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Verify user has access to this team
    const teamId = await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: conversation.teamId,
      userId: identity.subject,
    });

    if (args.clientMessageId) {
      const existing = await ctx.runQuery(
        internal.conversationMessages.getByConversationClientMessageId,
        {
          conversationId: args.conversationId,
          clientMessageId: args.clientMessageId,
        },
      );
      if (existing && existing.role === "user") {
        const status =
          existing.deliveryStatus === "queued"
            ? "queued"
            : existing.deliveryStatus === "error"
              ? "error"
              : "sent";
        return {
          messageId: existing._id,
          status,
          error:
            status === "error" ? existing.deliveryError ?? undefined : undefined,
        };
      }
    }

    // Persist user message
    const messageId = await ctx.runMutation(
      internal.acp.createMessageInternal,
      {
        conversationId: args.conversationId,
        role: "user",
        content: args.content,
        clientMessageId: args.clientMessageId,
      },
    );

    // Update conversation lastMessageAt
    await ctx.runMutation(internal.acp.updateConversationActivity, {
      conversationId: args.conversationId,
    });

    // Schedule title generation if this is the first message (non-blocking)
    const textContent = args.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join(" ");
    if (textContent) {
      await ctx.runMutation(internal.conversationTitle.maybeScheduleTitle, {
        conversationId: args.conversationId,
        messageText: textContent,
      });
    }

    if (!conversation.acpSandboxId) {
      await replaceSandboxForConversation(
        ctx,
        conversation,
        identity.subject,
        teamId,
      );
      await scheduleMessageDelivery(ctx, args.conversationId, messageId, 0);
      return { messageId, status: "queued", error: "Waiting for sandbox" };
    }

    // Get sandbox and forward message
    if (conversation.acpSandboxId) {
      const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
        sandboxId: conversation.acpSandboxId,
      });

      if (!sandbox) {
        console.warn("[acp] Sandbox not ready for conversation", {
          conversationId: args.conversationId,
          sandboxStatus: "missing",
        });
        await replaceSandboxForConversation(
          ctx,
          conversation,
          identity.subject,
          teamId,
        );
        await scheduleMessageDelivery(ctx, args.conversationId, messageId, 0);
        return { messageId, status: "queued", error: "Waiting for sandbox" };
      }

      if (sandbox.status === "error") {
        await replaceSandboxForConversation(
          ctx,
          conversation,
          identity.subject,
          teamId,
        );
        await scheduleMessageDelivery(ctx, args.conversationId, messageId, 0);
        return { messageId, status: "queued", error: "Waiting for sandbox" };
      }

      const readiness = await ensureSandboxReady(ctx, sandbox);
      if (readiness.status === "error") {
        await replaceSandboxForConversation(
          ctx,
          conversation,
          identity.subject,
          teamId,
        );
        await scheduleMessageDelivery(ctx, args.conversationId, messageId, 0);
        return { messageId, status: "queued", error: "Waiting for sandbox" };
      }

      if (!readiness.sandboxUrl || readiness.status !== "running") {
        await scheduleMessageDelivery(ctx, args.conversationId, messageId, 0);
        return { messageId, status: "queued", error: "Waiting for sandbox" };
      }
      try {
        await maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId);
        // Ensure conversation is initialized on sandbox before sending prompt.
        // This handles the case where sandbox was spawning during startConversation.
        if (!conversation.initializedOnSandbox) {
          await recordOutboundEvent(ctx, {
            conversationId: args.conversationId,
            sandboxId: conversation.acpSandboxId,
            teamId: conversation.teamId,
            raw: JSON.stringify({
              conversation_id: args.conversationId,
              session_id: conversation.sessionId,
              provider_id: conversation.providerId,
              cwd: conversation.cwd,
            }),
            eventType: "init",
          });
          await initConversationOnSandbox(
            readiness.sandboxUrl,
            args.conversationId,
            conversation.sessionId,
            conversation.providerId,
            conversation.cwd,
            conversation.permissionMode ?? "auto_allow_always",
          );
          await ensureConversationModel(
            ctx,
            readiness.sandboxUrl,
            args.conversationId,
            conversation.acpSandboxId,
            conversation.teamId,
            conversation.modelId ??
              resolveDefaultModelId(conversation.providerId),
          );
          // Mark as initialized
          await ctx.runMutation(internal.acp.markConversationInitialized, {
            conversationId: args.conversationId,
          });
        } else {
          await ensureConversationModel(
            ctx,
            readiness.sandboxUrl,
            args.conversationId,
            conversation.acpSandboxId,
            conversation.teamId,
            conversation.modelId ??
              resolveDefaultModelId(conversation.providerId),
          );
        }

        await recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId: conversation.acpSandboxId,
          teamId: conversation.teamId,
          raw: JSON.stringify({
            conversation_id: args.conversationId,
            session_id: conversation.sessionId,
            content: args.content,
          }),
          eventType: "prompt",
        });
        await sendPromptToSandbox(
          readiness.sandboxUrl,
          args.conversationId,
          conversation.sessionId,
          args.content,
        );

        // Record activity
        await ctx.runMutation(internal.acpSandboxes.recordActivity, {
          sandboxId: conversation.acpSandboxId,
        });
        await ctx.runMutation(
          internal.conversationMessages.updateDeliveryStatus,
          {
            messageId,
            status: "sent",
          },
        );
      } catch (error) {
        console.error("[acp] Failed to send prompt to sandbox:", error);
        await recordSandboxError(
          ctx,
          conversation.acpSandboxId,
          error,
          "Failed to reach sandbox",
          {
            teamId,
            conversationId: conversation._id,
            context: "sendMessage",
          },
        );
        await ctx.runMutation(
          internal.conversationMessages.updateDeliveryStatus,
          {
            messageId,
            status: "error",
            error: "Failed to reach sandbox",
          },
        );
        return {
          messageId,
          status: "error",
          error: "Failed to reach sandbox",
        };
      }
    }

    return { messageId, status: "sent" };
  },
});

/**
 * Retry delivery of an existing user message to the sandbox without duplicating it.
 */
export const retryMessage = action({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "sent" | "queued" | "error"; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const conversation = await ctx.runQuery(
      internal.acp.getConversationInternal,
      { conversationId: args.conversationId },
    );

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const teamId = await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: conversation.teamId,
      userId: identity.subject,
    });

    const message = await ctx.runQuery(
      internal.conversationMessages.getByIdInternal,
      { messageId: args.messageId },
    );

    if (!message || message.conversationId !== args.conversationId) {
      throw new Error("Message not found");
    }

    if (message.role !== "user") {
      throw new Error("Only user messages can be retried");
    }

    if (!conversation.acpSandboxId) {
      await replaceSandboxForConversation(
        ctx,
        conversation,
        identity.subject,
        teamId,
      );
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        0,
      );
      return { status: "queued", error: "Waiting for sandbox" };
    }

    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: conversation.acpSandboxId,
    });

    if (!sandbox) {
      await replaceSandboxForConversation(
        ctx,
        conversation,
        identity.subject,
        teamId,
      );
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        0,
      );
      return { status: "queued", error: "Waiting for sandbox" };
    }

    const readiness = await ensureSandboxReady(ctx, sandbox);
    if (readiness.status === "error" || sandbox.status === "error") {
      await replaceSandboxForConversation(
        ctx,
        conversation,
        identity.subject,
        teamId,
      );
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        0,
      );
      return { status: "queued", error: "Waiting for sandbox" };
    }

    if (!readiness.sandboxUrl || readiness.status !== "running") {
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        0,
      );
      return { status: "queued", error: "Waiting for sandbox" };
    }

    try {
      await maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId);
      if (!conversation.initializedOnSandbox) {
        await recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId: conversation.acpSandboxId,
          teamId: conversation.teamId,
          raw: JSON.stringify({
            conversation_id: args.conversationId,
            session_id: conversation.sessionId,
            provider_id: conversation.providerId,
            cwd: conversation.cwd,
          }),
          eventType: "init",
        });
        await initConversationOnSandbox(
          readiness.sandboxUrl,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversation.permissionMode ?? "auto_allow_always",
        );
        await ensureConversationModel(
          ctx,
          readiness.sandboxUrl,
          args.conversationId,
          conversation.acpSandboxId,
          conversation.teamId,
          conversation.modelId ??
            resolveDefaultModelId(conversation.providerId),
        );
        await ctx.runMutation(internal.acp.markConversationInitialized, {
          conversationId: args.conversationId,
        });
      } else {
        await ensureConversationModel(
          ctx,
          readiness.sandboxUrl,
          args.conversationId,
          conversation.acpSandboxId,
          conversation.teamId,
          conversation.modelId ??
            resolveDefaultModelId(conversation.providerId),
        );
      }

      await recordOutboundEvent(ctx, {
        conversationId: args.conversationId,
        sandboxId: conversation.acpSandboxId,
        teamId: conversation.teamId,
        raw: JSON.stringify({
          conversation_id: args.conversationId,
          session_id: conversation.sessionId,
          content: message.content,
        }),
        eventType: "prompt",
      });
      await sendPromptToSandbox(
        readiness.sandboxUrl,
        args.conversationId,
        conversation.sessionId,
        message.content,
      );

      await ctx.runMutation(internal.acpSandboxes.recordActivity, {
        sandboxId: conversation.acpSandboxId,
      });
      await ctx.runMutation(
        internal.conversationMessages.updateDeliveryStatus,
        {
          messageId: args.messageId,
          status: "sent",
        },
      );

      return { status: "sent" };
    } catch (error) {
      console.error("[acp] Failed to retry message:", error);
      await recordSandboxError(
        ctx,
        conversation.acpSandboxId,
        error,
        "Retry failed",
        {
          teamId,
          conversationId: conversation._id,
          context: "retryMessage",
        },
      );
      await ctx.runMutation(
        internal.conversationMessages.updateDeliveryStatus,
        {
          messageId: args.messageId,
          status: "error",
          error: "Retry failed",
        },
      );
      return { status: "error", error: "Retry failed" };
    }
  },
});

/**
 * Send a raw JSON-RPC response to the sandbox.
 */
export const sendRpc = action({
  args: {
    conversationId: v.id("conversations"),
    payload: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "sent" | "error"; error?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const conversation = await ctx.runQuery(
      internal.acp.getConversationInternal,
      { conversationId: args.conversationId },
    );

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: conversation.teamId,
      userId: identity.subject,
    });

    if (!conversation.acpSandboxId) {
      return { status: "error", error: "Sandbox not ready" };
    }

    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: conversation.acpSandboxId,
    });

    if (!sandbox) {
      return { status: "error", error: "Sandbox not ready" };
    }

    const readiness = await ensureSandboxReady(ctx, sandbox);
    if (!readiness.sandboxUrl || readiness.status !== "running") {
      return {
        status: "error",
        error:
          readiness.status === "starting"
            ? "Sandbox starting"
            : "Sandbox not ready",
      };
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(args.payload);
    } catch (error) {
      console.error("[acp] Invalid RPC payload JSON:", error);
      return { status: "error", error: "Invalid RPC payload" };
    }

    if (
      typeof parsedPayload !== "object" ||
      parsedPayload === null ||
      Array.isArray(parsedPayload)
    ) {
      return { status: "error", error: "RPC payload must be an object" };
    }

    try {
      await maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId);
      if (!conversation.initializedOnSandbox) {
        await recordOutboundEvent(ctx, {
          conversationId: args.conversationId,
          sandboxId: conversation.acpSandboxId,
          teamId: conversation.teamId,
          raw: JSON.stringify({
            conversation_id: args.conversationId,
            session_id: conversation.sessionId,
            provider_id: conversation.providerId,
            cwd: conversation.cwd,
          }),
          eventType: "init",
        });
        await initConversationOnSandbox(
          readiness.sandboxUrl,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversation.permissionMode ?? "auto_allow_always",
        );
        await ctx.runMutation(internal.acp.markConversationInitialized, {
          conversationId: args.conversationId,
        });
      }

      await recordOutboundEvent(ctx, {
        conversationId: args.conversationId,
        sandboxId: conversation.acpSandboxId,
        teamId: conversation.teamId,
        raw: JSON.stringify(parsedPayload),
        eventType: "rpc",
      });
      await sendRpcToSandbox(
        readiness.sandboxUrl,
        args.conversationId,
        parsedPayload,
      );

      await ctx.runMutation(internal.acpSandboxes.recordActivity, {
        sandboxId: conversation.acpSandboxId,
      });

      return { status: "sent" };
    } catch (error) {
      console.error("[acp] Failed to send RPC:", error);
      await recordSandboxError(
        ctx,
        conversation.acpSandboxId,
        error,
        "Failed to send RPC",
        {
          teamId: conversation.teamId,
          conversationId: conversation._id,
          context: "sendRpc",
        },
      );
      return { status: "error", error: "Failed to send RPC" };
    }
  },
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
export const spawnSandbox = internalAction({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> => {
    // Get the sandbox provider (currently supports morph, freestyle, daytona)
    const provider = getDefaultSandboxProvider();

    // Get snapshot ID from sandbox-snapshots.json based on provider
    const snapshotId =
      getDefaultSnapshotId(provider.name as SnapshotSandboxProvider) ??
      "snap_default";
    const streamSecret = generateStreamSecret();

    // Create sandbox record first to get ID for JWT
    const sandboxId = await ctx.runMutation(internal.acpSandboxes.create, {
      teamId: args.teamId,
      provider: provider.name,
      instanceId: "pending",
      snapshotId,
      callbackJwtHash: "pending",
      streamSecret,
    });

    // Parallelize: JWT generation + Morph spawn (both only need sandboxId)
    const [jwtResult, instance] = await Promise.all([
      generateSandboxJwt(sandboxId, args.teamId),
      provider.spawn({
        teamId: args.teamId,
        snapshotId,
        ttlSeconds: 3600, // 1 hour
        ttlAction: "pause",
        metadata: {
          sandboxId,
        },
      }),
    ]);

    const { jwt: callbackJwt, hash: callbackJwtHash } = jwtResult;

    // Update sandbox with JWT hash and instance ID (parallel mutations)
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

    // Configure the sandbox with callback settings
    // This is necessary because Morph uses memory snapshots - processes running
    // in the snapshot don't receive env vars passed at spawn time.
    if (instance.sandboxUrl) {
      await configureSandbox(instance.sandboxUrl, {
        callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
        sandboxJwt: callbackJwt,
        sandboxId,
        // API proxy URL routes CLI requests through Convex HTTP proxy which
        // validates the JWT and injects the real API key (with Vertex fallback)
        apiProxyUrl: env.CONVEX_SITE_URL,
        streamSecret,
      });
    }

    return { sandboxId };
  },
});

/**
 * Spawn a warm sandbox reserved for a user intent signal.
 */
export const spawnWarmSandbox = internalAction({
  args: {
    reservedUserId: v.string(),
    reservedTeamId: v.string(),
  },
  handler: async (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> => {
    const provider = getDefaultSandboxProvider();
    const snapshotId =
      getDefaultSnapshotId(provider.name as SnapshotSandboxProvider) ??
      "snap_default";
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
      await configureSandbox(instance.sandboxUrl, {
        callbackUrl: `${env.CONVEX_SITE_URL}/api/acp/callback`,
        sandboxJwt: callbackJwt,
        sandboxId,
        apiProxyUrl: env.CONVEX_SITE_URL,
        streamSecret,
      });
    }

    await ctx.scheduler.runAfter(
      WARM_SANDBOX_TTL_MS,
      internal.acp.expireWarmSandbox,
      { sandboxId },
    );

    return { sandboxId };
  },
});

/**
 * Deliver a queued message once the sandbox is ready.
 */
export const deliverMessageInternal = internalAction({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("conversationMessages"),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.runQuery(
      internal.acp.getConversationInternal,
      {
        conversationId: args.conversationId,
      },
    );

    if (!conversation) {
      return;
    }

    const message = await ctx.runQuery(
      internal.conversationMessages.getByIdInternal,
      { messageId: args.messageId },
    );

    if (!message || message.conversationId !== args.conversationId) {
      return;
    }

    if (message.role !== "user") {
      return;
    }

    let sandboxId = conversation.acpSandboxId ?? null;
    if (!sandboxId) {
      const replacement = await replaceSandboxForConversation(
        ctx,
        conversation,
        conversation.userId ?? null,
        conversation.teamId,
      );
      sandboxId = replacement ?? null;
    }

    if (!sandboxId) {
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        args.attempt,
      );
      return;
    }

    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId,
    });

    if (!sandbox) {
      await replaceSandboxForConversation(
        ctx,
        conversation,
        conversation.userId ?? null,
        conversation.teamId,
      );
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        args.attempt,
      );
      return;
    }

    const readiness = await ensureSandboxReady(ctx, sandbox);
    if (readiness.status === "error" || sandbox.status === "error") {
      await replaceSandboxForConversation(
        ctx,
        conversation,
        conversation.userId ?? null,
        conversation.teamId,
      );
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        args.attempt,
      );
      return;
    }

    if (!readiness.sandboxUrl || readiness.status !== "running") {
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        args.attempt,
      );
      return;
    }

    try {
      await maybeReconfigureWarmSandbox(ctx, sandbox, conversation.teamId);
      if (!conversation.initializedOnSandbox) {
        await recordOutboundEvent(ctx, {
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
        });
        await initConversationOnSandbox(
          readiness.sandboxUrl,
          args.conversationId,
          conversation.sessionId,
          conversation.providerId,
          conversation.cwd,
          conversation.permissionMode ?? "auto_allow_always",
        );
        await ensureConversationModel(
          ctx,
          readiness.sandboxUrl,
          args.conversationId,
          sandboxId,
          conversation.teamId,
          conversation.modelId ??
            resolveDefaultModelId(conversation.providerId),
        );
        await ctx.runMutation(internal.acp.markConversationInitialized, {
          conversationId: args.conversationId,
        });
      } else {
        await ensureConversationModel(
          ctx,
          readiness.sandboxUrl,
          args.conversationId,
          sandboxId,
          conversation.teamId,
          conversation.modelId ??
            resolveDefaultModelId(conversation.providerId),
        );
      }

      await recordOutboundEvent(ctx, {
        conversationId: args.conversationId,
        sandboxId,
        teamId: conversation.teamId,
        raw: JSON.stringify({
          conversation_id: args.conversationId,
          session_id: conversation.sessionId,
          content: message.content,
        }),
        eventType: "prompt",
      });
      await sendPromptToSandbox(
        readiness.sandboxUrl,
        args.conversationId,
        conversation.sessionId,
        message.content,
      );

      await ctx.runMutation(internal.acpSandboxes.recordActivity, {
        sandboxId,
      });

      await ctx.runMutation(
        internal.conversationMessages.updateDeliveryStatus,
        {
          messageId: args.messageId,
          status: "sent",
        },
      );
    } catch (error) {
      console.error("[acp] Failed to deliver queued message:", error);
      await recordSandboxError(
        ctx,
        sandboxId,
        error,
        "Failed to deliver queued message",
        {
          teamId: conversation.teamId,
          conversationId: conversation._id,
          context: "deliverQueuedMessage",
        },
      );
      await scheduleMessageDelivery(
        ctx,
        args.conversationId,
        args.messageId,
        args.attempt,
      );
    }
  },
});

/**
 * Stop a warm sandbox if it expires without being claimed.
 */
export const expireWarmSandbox = internalAction({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
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

    const provider = getSandboxProvider(sandbox.provider);
    try {
      await provider.stop(sandbox.instanceId);
    } catch (error) {
      console.error("[acp] Failed to stop expired warm sandbox:", error);
      return;
    }

    await ctx.runMutation(internal.acpSandboxes.markStopped, {
      sandboxId: sandbox._id,
    });
  },
});

/**
 * Stop a sandbox instance (best-effort).
 */
export const stopSandboxInternal = internalAction({
  args: {
    sandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
      sandboxId: args.sandboxId,
    });
    if (!sandbox) {
      return;
    }

    const provider = getSandboxProvider(sandbox.provider);
    try {
      await provider.stop(sandbox.instanceId);
      await ctx.runMutation(internal.acpSandboxes.updateStatus, {
        sandboxId: sandbox._id,
        status: "stopped",
      });
    } catch (error) {
      console.error("[acp] Failed to stop sandbox:", error);
    }
  },
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
async function configureSandbox(
  sandboxUrl: string,
  config: {
    callbackUrl: string;
    sandboxJwt: string;
    sandboxId: string;
    apiProxyUrl?: string;
    streamSecret: string;
  },
): Promise<void> {
  console.log(`[acp] Configuring sandbox at ${sandboxUrl}`);

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
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandbox configure failed: ${response.status} - ${text}`);
  }

  console.log(`[acp] Sandbox configured successfully`);
}

/**
 * Initialize a conversation on a sandbox.
 */
async function initConversationOnSandbox(
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  sessionId: string,
  providerId: string,
  cwd: string,
  permissionMode?: string,
): Promise<void> {
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
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandbox init failed: ${response.status} - ${text}`);
  }
}

/**
 * Send a prompt to a sandbox.
 */
async function sendPromptToSandbox(
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
): Promise<void> {
  const response = await fetch(`${sandboxUrl}/api/acp/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      session_id: sessionId,
      content,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sandbox prompt failed: ${response.status} - ${text}`);
  }
}

/**
 * Persist an outbound ACP payload for debugging.
 */
async function recordOutboundEvent(
  ctx: ActionCtx,
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
  ctx: ActionCtx,
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  sandboxId: Id<"acpSandboxes">,
  teamId: string,
  modelId: string | undefined,
): Promise<void> {
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
    await sendRpcToSandbox(sandboxUrl, conversationId, payload);
  } catch (error) {
    console.error("[acp] Failed to set session model:", error);
  }
}

/**
 * Send a raw JSON-RPC payload to a sandbox.
 */
async function sendRpcToSandbox(
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  payload: unknown,
): Promise<void> {
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
