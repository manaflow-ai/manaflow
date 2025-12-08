import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";

// =============================================================================
// CODING AGENT - Sessions and turns for delegateToCodingAgent tool calls
// =============================================================================

// =============================================================================
// Tool Call Mapping - Links parent workflow tool calls to coding agent sessions
// =============================================================================

/**
 * Simple hash function for task text.
 * Used to match tool calls with coding agent sessions.
 */
function hashTask(task: string): string {
  let hash = 0;
  for (let i = 0; i < task.length; i++) {
    const char = task.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Register a coding agent tool call when it starts in the parent workflow.
 * Called from the workflow stream handler when tool-call chunk is received.
 */
export const registerCodingAgentToolCall = mutation({
  args: {
    toolCallId: v.string(),
    parentSessionId: v.id("sessions"),
    task: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const taskHash = hashTask(args.task);

    const id = await ctx.db.insert("codingAgentToolCalls", {
      toolCallId: args.toolCallId,
      parentSessionId: args.parentSessionId,
      taskHash,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    return { id, taskHash };
  },
});

/**
 * Link a coding agent session to its parent tool call.
 * Called from the workflow stream handler for UI linking.
 *
 * NOTE: This is only used for UI purposes (showing "View session" in the parent workflow).
 * Authentication is handled by the jwtSecret stored directly on the session.
 */
export const linkCodingAgentSession = mutation({
  args: {
    taskHash: v.string(),
    codingAgentSessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find the most recent pending tool call with matching task hash
    const toolCall = await ctx.db
      .query("codingAgentToolCalls")
      .withIndex("by_task_hash", (q) => q.eq("taskHash", args.taskHash))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .order("desc")
      .first();

    if (toolCall) {
      await ctx.db.patch(toolCall._id, {
        codingAgentSessionId: args.codingAgentSessionId,
        status: "linked",
        updatedAt: now,
      });
      return toolCall._id;
    }

    return null;
  },
});

/**
 * Get the JWT secret for a coding agent session.
 * Used by the HTTP endpoint to verify incoming JWTs.
 *
 * The secret is stored directly on the session for reliable lookup.
 */
export const getJwtSecretForSession = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    return session?.jwtSecret ?? null;
  },
});

/**
 * Internal version for HTTP actions.
 */
export const getJwtSecretForSessionInternal = internalQuery({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    return session?.jwtSecret ?? null;
  },
});

/**
 * Get the coding agent session ID for a tool call.
 * Used by the UI to show "View session" immediately.
 *
 * @deprecated Use getCodingAgentSessionByTask instead for more reliable matching
 */
export const getCodingAgentSessionForToolCall = query({
  args: {
    toolCallId: v.string(),
  },
  handler: async (ctx, args) => {
    const toolCall = await ctx.db
      .query("codingAgentToolCalls")
      .withIndex("by_tool_call", (q) => q.eq("toolCallId", args.toolCallId))
      .first();

    return toolCall?.codingAgentSessionId ?? null;
  },
});

/**
 * Get the parent session ID for a tool call.
 * Used by the coding agent tool to update progress in the parent session.
 */
export const getParentSessionForToolCall = query({
  args: {
    toolCallId: v.string(),
  },
  handler: async (ctx, args) => {
    const toolCall = await ctx.db
      .query("codingAgentToolCalls")
      .withIndex("by_tool_call", (q) => q.eq("toolCallId", args.toolCallId))
      .first();

    return toolCall?.parentSessionId ?? null;
  },
});

/**
 * Get the coding agent session by task text.
 * Returns the most recently created opencode session with matching task.
 * This is more reliable than toolCallId-based lookup since we query directly.
 */
export const getCodingAgentSessionByTask = query({
  args: {
    task: v.string(),
  },
  handler: async (ctx, args) => {
    // Find the most recent opencode session with this exact task
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_task", (q) => q.eq("task", args.task))
      .filter((q) => q.eq(q.field("source"), "opencode"))
      .order("desc")
      .first();

    return session?._id ?? null;
  },
});

// =============================================================================
// OpenCode SDK Types (mirrors @opencode-ai/sdk types for type safety)
// =============================================================================

/** OpenCode message part types */
type OpenCodePartType =
  | "text"
  | "reasoning"
  | "tool"
  | "file"
  | "step"
  | "snapshot"
  | "patch"
  | "agent"
  | "retry"
  | "compaction"
  | "subtask";

/** OpenCode tool state */
interface OpenCodeToolState {
  status?: "pending" | "running" | "completed" | "error";
  output?: string;
  error?: string;
}

/** OpenCode message part (simplified from SDK) */
interface OpenCodePart {
  type: OpenCodePartType;
  // Text/reasoning
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
  // Tool
  id?: string;
  tool?: string;
  input?: unknown;
  title?: string;
  state?: OpenCodeToolState;
  time?: { start?: number; end?: number };
  // File
  mime?: string;
  filename?: string;
  url?: string;
  source?: unknown;
  // Step
  finish?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/** Part types that match our Convex schema */
type SchemaPartType =
  | "text"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "file"
  | "step_start"
  | "step_finish"
  | "error"
  | "snapshot"
  | "patch"
  | "agent"
  | "retry"
  | "compaction"
  | "subtask";

/** Our internal part type after transformation */
interface TransformedPart {
  type: SchemaPartType;
  isComplete: boolean;
  text?: string;
  synthetic?: boolean;
  ignored?: boolean;
  toolCallId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolTitle?: string;
  toolStatus?: "pending" | "running" | "completed" | "error";
  toolOutput?: string;
  toolError?: string;
  time?: { start?: number; end?: number };
  fileMime?: string;
  fileName?: string;
  fileUrl?: string;
  fileSource?: unknown;
  finishReason?: string;
  stepCost?: number;
  stepTokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/**
 * Create a coding agent session when delegateToCodingAgent is invoked.
 * Returns the session ID to be included in the JWT for the VM.
 *
 * IMPORTANT: The jwtSecret is stored directly on the session for reliable
 * authentication. This removes the dependency on taskHash-based lookup
 * which had race conditions and collision risks.
 */
export const createCodingAgentSession = mutation({
  args: {
    // The tool call ID from the parent workflow
    toolCallId: v.string(),
    // The parent session ID (from the workflow that invoked this tool)
    parentSessionId: v.optional(v.id("sessions")),
    // Task details
    task: v.string(),
    context: v.optional(v.string()),
    agent: v.string(),
    // VM info
    morphInstanceId: v.optional(v.string()),
    // JWT secret for authentication (generated by caller, stored here)
    jwtSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const sessionId = await ctx.db.insert("sessions", {
      source: "opencode",
      status: "active",
      agent: args.agent,
      title: `Task: ${args.task.slice(0, 50)}...`,
      morphInstanceId: args.morphInstanceId,
      task: args.task, // Store full task for UI lookup
      jwtSecret: args.jwtSecret,
      createdAt: now,
      updatedAt: now,
    });

    return sessionId;
  },
});

/**
 * Internal mutation to upsert a turn from OpenCode hook events.
 * Called by the HTTP action when receiving message.updated events.
 */
export const upsertTurnFromHook = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    externalMessageId: v.string(),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool")
    ),
    parts: v.array(v.any()), // OpenCode message parts
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("streaming"),
        v.literal("complete"),
        v.literal("error")
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if turn already exists by external message ID
    const existing = await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("externalMessageId"), args.externalMessageId))
      .first();

    // Transform OpenCode parts to our schema format
    const transformedParts: TransformedPart[] = args.parts.map((rawPart: unknown) => {
      const part = rawPart as OpenCodePart;
      const basePart: TransformedPart = {
        type: mapOpenCodePartType(part.type),
        isComplete: true, // Hook sends complete messages
      };

      // Text/reasoning parts
      if (part.type === "text" || part.type === "reasoning") {
        basePart.text = part.text;
        if (part.synthetic !== undefined) basePart.synthetic = part.synthetic;
        if (part.ignored !== undefined) basePart.ignored = part.ignored;
      }

      // Tool parts
      if (part.type === "tool") {
        basePart.toolCallId = part.id;
        basePart.toolName = part.tool;
        basePart.toolInput = part.input;
        basePart.toolTitle = part.title;
        if (part.state) {
          basePart.toolStatus = mapToolStatus(part.state.status);
          basePart.toolOutput = part.state.output;
          basePart.toolError = part.state.error;
        }
        if (part.time) basePart.time = part.time;
      }

      // File parts
      if (part.type === "file") {
        basePart.fileMime = part.mime;
        basePart.fileName = part.filename;
        basePart.fileUrl = part.url;
        basePart.fileSource = part.source;
      }

      // Step parts
      if (part.type === "step") {
        basePart.finishReason = part.finish;
        basePart.stepCost = part.cost;
        basePart.stepTokens = part.tokens;
      }

      return basePart;
    });

    if (existing) {
      // Update existing turn
      await ctx.db.patch(existing._id, {
        parts: transformedParts,
        status: args.status || "streaming",
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Extract order from external message ID
      // OpenCode message IDs are in format: msg_<timestamp><random>
      // We use the timestamp portion for ordering to ensure correct message order
      // even if events arrive out of order
      let order = 0;
      if (args.externalMessageId) {
        // Extract the hex timestamp from the message ID (after "msg_")
        // Format: msg_af852433d001... where af852433 is the timestamp portion
        const match = args.externalMessageId.match(/^msg_([a-f0-9]+)/i);
        if (match?.[1]) {
          // Parse the first 8 hex chars as a timestamp-like value
          const hexTimestamp = match[1].slice(0, 8);
          order = parseInt(hexTimestamp, 16);
        }
      }

      // Fallback: if we couldn't extract order, use sequential numbering
      if (order === 0) {
        const lastTurn = await ctx.db
          .query("turns")
          .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
          .order("desc")
          .first();
        order = lastTurn ? lastTurn.order + 1 : 0;
      }

      // Create new turn
      const turnId = await ctx.db.insert("turns", {
        sessionId: args.sessionId,
        externalMessageId: args.externalMessageId,
        role: args.role,
        status: args.status || "streaming",
        parts: transformedParts,
        order,
        createdAt: now,
        updatedAt: now,
      });

      return turnId;
    }
  },
});

/**
 * Update the Morph instance ID for a coding agent session.
 * Called after the VM is spawned.
 */
export const updateCodingAgentSessionInstance = mutation({
  args: {
    sessionId: v.id("sessions"),
    morphInstanceId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      morphInstanceId: args.morphInstanceId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Internal mutation to update session status from hook events.
 */
export const updateSessionFromHook = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    status: v.optional(
      v.union(v.literal("active"), v.literal("completed"), v.literal("failed"))
    ),
    externalSessionId: v.optional(v.string()),
    tokens: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        reasoning: v.optional(v.number()),
        cacheRead: v.optional(v.number()),
        cacheWrite: v.optional(v.number()),
      })
    ),
    summary: v.optional(
      v.object({
        additions: v.optional(v.number()),
        deletions: v.optional(v.number()),
        files: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.status) {
      updates.status = args.status;
      if (args.status === "completed" || args.status === "failed") {
        updates.completedAt = now;
      }
    }
    if (args.externalSessionId) updates.externalSessionId = args.externalSessionId;
    if (args.tokens) updates.tokens = args.tokens;
    if (args.summary) updates.summary = args.summary;

    await ctx.db.patch(args.sessionId, updates);
  },
});

/**
 * Get session by ID with its turns for UI rendering.
 */
export const getCodingAgentSession = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;

    const turns = await ctx.db
      .query("turns")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    return { session, turns };
  },
});

/**
 * List all coding agent sessions (for debugging/admin).
 */
export const listCodingAgentSessions = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("source"), "opencode"))
      .order("desc")
      .take(args.limit || 20);

    return sessions;
  },
});

// =============================================================================
// Helper functions
// =============================================================================

function mapOpenCodePartType(type: string): SchemaPartType {
  const typeMap: Record<string, SchemaPartType> = {
    text: "text",
    reasoning: "reasoning",
    tool: "tool_call",
    file: "file",
    step: "step_finish",
    snapshot: "snapshot",
    patch: "patch",
    agent: "agent",
    retry: "retry",
    compaction: "compaction",
    subtask: "subtask",
  };
  return typeMap[type] || "text";
}

function mapToolStatus(status?: string): "pending" | "running" | "completed" | "error" {
  const statusMap: Record<string, "pending" | "running" | "completed" | "error"> = {
    pending: "pending",
    running: "running",
    completed: "completed",
    error: "error",
  };
  return statusMap[status || ""] || "pending";
}
