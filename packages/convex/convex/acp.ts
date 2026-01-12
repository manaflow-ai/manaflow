import { v } from "convex/values";
import { SignJWT } from "jose";
import { env } from "../_shared/convex-env";
import { getTeamId } from "../_shared/team";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

// Content block validator (simplified ACP ContentBlock)
const contentBlockValidator = v.object({
  type: v.union(
    v.literal("text"),
    v.literal("image"),
    v.literal("resource_link")
  ),
  text: v.optional(v.string()),
  data: v.optional(v.string()), // base64 for images
  mimeType: v.optional(v.string()),
  uri: v.optional(v.string()),
  name: v.optional(v.string()),
});

const providerIdValidator = v.union(
  v.literal("claude"),
  v.literal("codex"),
  v.literal("gemini"),
  v.literal("opencode")
);

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

/**
 * Generate a sandbox callback JWT.
 * This JWT is used by sandboxes to authenticate callbacks to Convex.
 */
async function generateSandboxJwt(
  sandboxId: Id<"acpSandboxes">,
  teamId: string
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
  },
  handler: async (ctx, args): Promise<{
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

    // Find or create sandbox
    let sandboxId = args.sandboxId;
    let status: "starting" | "ready" = "ready";

    if (!sandboxId) {
      // Try to find an existing running sandbox
      const existingSandbox = await ctx.runQuery(
        internal.acpSandboxes.findRunningForTeam,
        { teamId }
      );

      if (existingSandbox) {
        sandboxId = existingSandbox._id;
      } else {
        // Need to spawn a new sandbox
        const result = await ctx.runAction(internal.acp.spawnSandbox, {
          teamId,
        });
        sandboxId = result.sandboxId;
        status = "starting";
      }
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
      }
    );

    // Increment sandbox conversation count
    await ctx.runMutation(internal.acpSandboxes.incrementConversationCount, {
      sandboxId,
    });

    // If sandbox is ready, initialize conversation on it
    if (status === "ready") {
      const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
        sandboxId,
      });
      if (sandbox?.acpServerUrl) {
        try {
          await initConversationOnSandbox(
            sandbox.acpServerUrl,
            conversationId,
            sessionId,
            args.providerId,
            args.cwd
          );
        } catch (error) {
          console.error("[acp] Failed to init conversation on sandbox:", error);
          // Don't fail the whole operation, sandbox might not be ready yet
        }
      }
    }

    return { conversationId, sandboxId, status };
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
  },
  handler: async (ctx, args): Promise<{
    messageId: Id<"conversationMessages">;
    status: "sent" | "error";
  }> => {
    // Verify auth
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Get conversation and verify ownership
    const conversation = await ctx.runQuery(
      internal.acp.getConversationInternal,
      { conversationId: args.conversationId }
    );

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Verify user has access to this team
    await ctx.runQuery(internal.acp.resolveTeamId, {
      teamSlugOrId: conversation.teamId,
      userId: identity.subject,
    });

    // Persist user message
    const messageId = await ctx.runMutation(
      internal.acp.createMessageInternal,
      {
        conversationId: args.conversationId,
        role: "user",
        content: args.content,
      }
    );

    // Update conversation lastMessageAt
    await ctx.runMutation(internal.acp.updateConversationActivity, {
      conversationId: args.conversationId,
    });

    // Get sandbox and forward message
    if (conversation.acpSandboxId) {
      const sandbox = await ctx.runQuery(internal.acpSandboxes.getById, {
        sandboxId: conversation.acpSandboxId,
      });

      if (sandbox?.acpServerUrl && sandbox.status === "running") {
        try {
          await sendPromptToSandbox(
            sandbox.acpServerUrl,
            args.conversationId,
            conversation.sessionId,
            args.content
          );

          // Record activity
          await ctx.runMutation(internal.acpSandboxes.recordActivity, {
            sandboxId: conversation.acpSandboxId,
          });
        } catch (error) {
          console.error("[acp] Failed to send prompt to sandbox:", error);
          return { messageId, status: "error" };
        }
      } else {
        console.warn("[acp] Sandbox not ready for conversation", {
          conversationId: args.conversationId,
          sandboxStatus: sandbox?.status,
        });
        return { messageId, status: "error" };
      }
    }

    return { messageId, status: "sent" };
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
        { sandboxId: conversation.acpSandboxId }
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
        q.eq("teamId", team.teamId).eq("userId", args.userId)
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
    acpSandboxId: v.id("acpSandboxes"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      teamId: args.teamId,
      userId: args.userId,
      sessionId: args.sessionId,
      providerId: args.providerId,
      cwd: args.cwd,
      status: "active",
      acpSandboxId: args.acpSandboxId,
      createdAt: now,
      updatedAt: now,
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

/**
 * Create message (internal).
 */
export const createMessageInternal = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.array(contentBlockValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversationMessages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content.map((block) => ({
        type: block.type,
        text: block.text,
        data: block.data,
        mimeType: block.mimeType,
        uri: block.uri,
        name: block.name,
      })),
      createdAt: Date.now(),
    });
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
 * Spawn a new Morph sandbox for ACP.
 */
export const spawnSandbox = internalAction({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args): Promise<{ sandboxId: Id<"acpSandboxes"> }> => {
    const morphApiKey = env.MORPH_API_KEY;
    if (!morphApiKey) {
      throw new Error("MORPH_API_KEY not configured");
    }

    // TODO: Get snapshot ID from config
    const snapshotId = env.ACP_SNAPSHOT_ID ?? "snap_default";

    // Create sandbox record first to get ID for JWT
    const sandboxId = await ctx.runMutation(internal.acpSandboxes.create, {
      teamId: args.teamId,
      morphInstanceId: "pending",
      snapshotId,
      callbackJwtHash: "pending",
    });

    // Generate callback JWT
    const { jwt: callbackJwt, hash: callbackJwtHash } =
      await generateSandboxJwt(sandboxId, args.teamId);

    // Update sandbox with JWT hash
    await ctx.runMutation(internal.acp.updateSandboxJwtHash, {
      sandboxId,
      callbackJwtHash,
    });

    // Spawn Morph instance
    const morphResponse = await fetch(
      "https://cloud.morph.so/api/instance/start",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${morphApiKey}`,
        },
        body: JSON.stringify({
          snapshot_id: snapshotId,
          ttl_seconds: 3600, // 1 hour
          ttl_action: "pause",
          metadata: {
            app: "cmux-acp",
            teamId: args.teamId,
            sandboxId,
          },
          setup: {
            env: {
              CONVEX_CALLBACK_URL: `${env.CONVEX_SITE_URL}/api/acp/callback`,
              ACP_SANDBOX_JWT: callbackJwt,
            },
          },
        }),
      }
    );

    if (!morphResponse.ok) {
      const text = await morphResponse.text();
      console.error("[acp] Failed to spawn Morph instance:", text);
      throw new Error(`Failed to spawn sandbox: ${morphResponse.status}`);
    }

    const morphData = await morphResponse.json();
    const morphInstanceId = morphData.id;

    // Update sandbox with Morph instance ID
    await ctx.runMutation(internal.acp.updateSandboxMorphInstance, {
      sandboxId,
      morphInstanceId,
    });

    return { sandboxId };
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
 * Update sandbox Morph instance ID.
 */
export const updateSandboxMorphInstance = internalMutation({
  args: {
    sandboxId: v.id("acpSandboxes"),
    morphInstanceId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sandboxId, {
      morphInstanceId: args.morphInstanceId,
    });
  },
});

// ============================================================================
// HTTP helpers for sandbox communication
// ============================================================================

/**
 * Initialize a conversation on a sandbox.
 */
async function initConversationOnSandbox(
  sandboxUrl: string,
  conversationId: Id<"conversations">,
  sessionId: string,
  providerId: string,
  cwd: string
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
  }>
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

// ============================================================================
// Query APIs for iOS subscriptions
// ============================================================================

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
      .withIndex("by_conversation_desc", (q) =>
        q.eq("conversationId", args.conversationId)
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
        q.eq("conversationId", args.conversationId)
      )
      .filter((q) => q.gt(q.field("createdAt"), args.afterTimestamp))
      .order("asc")
      .collect();
  },
});
