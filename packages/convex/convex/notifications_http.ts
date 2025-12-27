import { v } from "convex/values";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction, internalMutation } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import { typedZid } from "@cmux/shared/utils/typed-zid";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const AgentStoppedRequestSchema = z.object({
  taskRunId: typedZid("taskRuns"),
});

/**
 * HTTP endpoint called by the stop hook when Claude Code stops responding.
 * This creates a notification every time it's called - each stop is a
 * meaningful event the user should know about.
 *
 * This is separate from crown/complete which handles status updates.
 * The stop hook should call BOTH endpoints:
 * - crown/complete for status tracking
 * - notifications/agent-stopped for user notifications
 */
export const agentStopped = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, {
    loggerPrefix: "[convex.notifications]",
  });
  if (!auth) {
    console.error("[convex.notifications] Auth failed for agent-stopped");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }

  const validation = AgentStoppedRequestSchema.safeParse(json);
  if (!validation.success) {
    console.warn(
      "[convex.notifications] Invalid agent-stopped payload",
      validation.error
    );
    return jsonResponse({ code: 400, message: "Invalid input" }, 400);
  }

  const taskRunId = validation.data.taskRunId;

  // Verify the task run belongs to this worker
  const taskRun = await ctx.runQuery(internal.taskRuns.getById, {
    id: taskRunId,
  });

  if (!taskRun) {
    console.warn("[convex.notifications] Task run not found", { taskRunId });
    return jsonResponse({ code: 404, message: "Task run not found" }, 404);
  }

  if (
    auth.payload.taskRunId !== taskRunId ||
    taskRun.teamId !== auth.payload.teamId ||
    taskRun.userId !== auth.payload.userId
  ) {
    console.warn(
      "[convex.notifications] Worker attempted to notify for unauthorized task run",
      {
        requestedTaskRunId: taskRunId,
        tokenTaskRunId: auth.payload.taskRunId,
        workerTeamId: auth.payload.teamId,
        taskRunTeamId: taskRun.teamId,
      }
    );
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  // Create the notification
  await ctx.runMutation(
    internal.notifications_http.createAgentStoppedNotification,
    {
      taskRunId,
      taskId: taskRun.taskId,
      teamId: taskRun.teamId,
      userId: taskRun.userId,
    }
  );

  console.log("[convex.notifications] Created agent-stopped notification", {
    taskRunId,
    taskId: taskRun.taskId,
  });

  return jsonResponse({ ok: true });
});

/**
 * Internal mutation to create an agent-stopped notification.
 * Called by the agentStopped HTTP action.
 */
export const createAgentStoppedNotification = internalMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if notification already exists for this task run (avoid duplicates)
    // Since taskRunId is optional and not indexed, we scan with filter
    const existingNotifications = await ctx.db
      .query("taskNotifications")
      .withIndex("by_team_user_created", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .filter((q) => q.eq(q.field("taskRunId"), args.taskRunId))
      .first();

    if (!existingNotifications) {
      // Fetch the task run to determine the notification type based on actual status
      const taskRun = await ctx.db.get(args.taskRunId);
      const notificationType =
        taskRun?.status === "completed" ? "run_completed" : "run_failed";

      await ctx.db.insert("taskNotifications", {
        taskId: args.taskId,
        taskRunId: args.taskRunId,
        teamId: args.teamId,
        userId: args.userId,
        type: notificationType,
        createdAt: now,
      });
    }

    // Update task's lastActivityAt for sorting (notification received = activity)
    await ctx.db.patch(args.taskId, { lastActivityAt: now });

    // Insert unread row for this task run (explicit unread tracking)
    // Check if already unread (avoid duplicates)
    const existing = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_run_user", (q) =>
        q.eq("taskRunId", args.taskRunId).eq("userId", args.userId)
      )
      .first();

    if (!existing) {
      await ctx.db.insert("unreadTaskRuns", {
        taskRunId: args.taskRunId,
        taskId: args.taskId,
        userId: args.userId,
        teamId: args.teamId,
      });
    }

    return { success: true };
  },
});
