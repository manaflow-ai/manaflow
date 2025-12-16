import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery, taskIdWithFake } from "./users/utils";

export const evaluateAndCrownWinner = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    try {
      console.log(`[Crown] ============================================`);
      console.log(`[Crown] EVALUATE AND CROWN WINNER CALLED`);
      console.log(`[Crown] Task ID: ${args.taskId}`);
      console.log(`[Crown] ============================================`);

      const userId = ctx.identity.subject;
      const task = await ctx.db.get(args.taskId);
      if (!task) {
        console.error(`[Crown] Task ${args.taskId} not found`);
        throw new Error("Task not found");
      }
      const teamId = await getTeamId(ctx, args.teamSlugOrId);
      if (task.teamId !== teamId || task.userId !== userId) {
        throw new Error("Unauthorized");
      }

      // Get all completed runs for this task
      const taskRuns = await ctx.db
        .query("taskRuns")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .filter((q) => q.eq(q.field("teamId"), teamId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .filter((q) => q.eq(q.field("status"), "completed"))
        .collect();

      console.log(
        `[Crown] Found ${taskRuns.length} completed runs for task ${args.taskId}`
      );

      // If only one model or less, crown it by default
      if (taskRuns.length <= 1) {
        if (taskRuns.length === 1) {
          await ctx.db.patch(taskRuns[0]._id, {
            isCrowned: true,
            crownReason: "Only one model completed the task",
          });
        }
        return taskRuns[0]?._id || null;
      }

      // Only evaluate if 2+ models completed
      if (taskRuns.length < 2) {
        return null;
      }

      // Check if evaluation already exists or is pending
      const existingEvaluation = await ctx.db
        .query("crownEvaluations")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
        .filter((q) => q.eq(q.field("teamId"), teamId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .first();

      if (existingEvaluation) {
        console.log(
          `[Crown] Evaluation already exists for task ${args.taskId}, returning winner`
        );
        return existingEvaluation.winnerRunId;
      }

      // Check if already marked for evaluation
      if (
        task.crownEvaluationStatus === "pending" ||
        task.crownEvaluationStatus === "in_progress"
      ) {
        console.log(
          `[Crown] Task ${args.taskId} already marked for evaluation (${task.crownEvaluationStatus})`
        );
        return "pending";
      }

      // Mark that crown evaluation is needed
      // The server will handle the actual evaluation using Claude Code
      await ctx.db.patch(args.taskId, {
        crownEvaluationStatus: "pending",
        crownEvaluationError: undefined,
        updatedAt: Date.now(),
      });

      console.log(`[Crown] Marked task ${args.taskId} for crown evaluation`);
      return "pending";
    } catch (error) {
      console.error(
        `[Crown] Crown evaluation failed for task ${args.taskId}:`,
        error
      );
      throw error;
    }
  },
});

export const setCrownWinner = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskRunId: v.id("taskRuns"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`[Crown] ============================================`);
    console.log(`[Crown] SET CROWN WINNER CALLED`);
    console.log(`[Crown] Task Run ID: ${args.taskRunId}`);
    console.log(`[Crown] Reason: ${args.reason}`);
    console.log(`[Crown] ============================================`);

    const userId = ctx.identity.subject;
    const taskRun = await ctx.db.get(args.taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found");
    }
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    if (taskRun.teamId !== teamId || taskRun.userId !== userId) {
      throw new Error("Unauthorized");
    }

    // Get all runs for this task
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", taskRun.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    // Update the selected run as crowned
    await ctx.db.patch(args.taskRunId, {
      isCrowned: true,
      crownReason: args.reason,
    });

    // Update other runs to ensure they're not crowned
    for (const run of taskRuns) {
      if (run._id !== args.taskRunId) {
        await ctx.db.patch(run._id, {
          isCrowned: false,
        });
      }
    }

    // Clear crown evaluation error
    await ctx.db.patch(taskRun.taskId, {
      crownEvaluationStatus: "succeeded",
      crownEvaluationError: undefined,
      updatedAt: Date.now(),
    });

    // Create evaluation record
    await ctx.db.insert("crownEvaluations", {
      taskId: taskRun.taskId,
      evaluatedAt: Date.now(),
      winnerRunId: args.taskRunId,
      candidateRunIds: taskRuns.map((r) => r._id),
      evaluationPrompt: "Evaluated by Claude Code",
      evaluationResponse: args.reason,
      createdAt: Date.now(),
      userId,
      teamId,
    });

    // Mark PR creation needed and clear any existing PR associations
    await ctx.db.patch(args.taskRunId, {
      pullRequestUrl: "pending",
      pullRequests: undefined,
    });

    // Clear junction table entries for this taskRun
    const existingJunctionEntries = await ctx.db
      .query("taskRunPullRequests")
      .withIndex("by_task_run", (q) => q.eq("taskRunId", args.taskRunId))
      .collect();
    for (const entry of existingJunctionEntries) {
      await ctx.db.delete(entry._id);
    }

    return args.taskRunId;
  },
});

export const getCrownedRun = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const crownedRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("isCrowned"), true))
      .first();

    console.log(
      `[Crown] getCrownedRun for task ${args.taskId}: ${crownedRun ? `found ${crownedRun._id}` : "not found"}`
    );

    return crownedRun;
  },
});

export const getCrownEvaluation = authQuery({
  args: {
    teamSlugOrId: v.string(),
    taskId: taskIdWithFake,
  },
  handler: async (ctx, args) => {
    // Handle fake IDs by returning null
    if (typeof args.taskId === 'string' && args.taskId.startsWith('fake-')) {
      return null;
    }

    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const evaluation = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId as Id<"tasks">))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .first();

    return evaluation;
  },
});

export const getTasksWithCrowns = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    
    // Get all crowned runs for this team/user
    const crownedRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .filter((q) => q.eq(q.field("isCrowned"), true))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Extract unique task IDs
    const taskIds = new Set<Id<"tasks">>();
    for (const run of crownedRuns) {
      taskIds.add(run.taskId);
    }

    return Array.from(taskIds);
  },
});

export const getEvaluationByTaskInternal = internalQuery({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const evaluations = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", args.teamId).eq("userId", args.userId)
      )
      .collect();

    return (
      evaluations.find((evaluation) => evaluation.taskId === args.taskId) ?? null
    );
  },
});

export const workerFinalize = internalMutation({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
    winnerRunId: v.id("taskRuns"),
    reason: v.string(),
    summary: v.optional(v.string()),
    evaluationPrompt: v.string(),
    evaluationResponse: v.string(),
    candidateRunIds: v.array(v.id("taskRuns")),
    pullRequest: v.optional(
      v.object({
        url: v.string(),
        isDraft: v.optional(v.boolean()),
        state: v.optional(
          v.union(
            v.literal("none"),
            v.literal("draft"),
            v.literal("open"),
            v.literal("merged"),
            v.literal("closed"),
            v.literal("unknown")
          )
        ),
        number: v.optional(v.number()),
      })
    ),
    pullRequestTitle: v.optional(v.string()),
    pullRequestDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== args.teamId || task.userId !== args.userId) {
      throw new Error("Task not found or unauthorized");
    }

    const existingEvaluation = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter(
        (q) =>
          q.eq(q.field("teamId"), args.teamId) &&
          q.eq(q.field("userId"), args.userId),
      )
      .first();

    if (existingEvaluation) {
      throw new Error("Crown evaluation already exists for this task");
    }

    const now = Date.now();

    await ctx.db.insert("crownEvaluations", {
      taskId: args.taskId,
      evaluatedAt: now,
      winnerRunId: args.winnerRunId,
      candidateRunIds: args.candidateRunIds,
      evaluationPrompt: args.evaluationPrompt,
      evaluationResponse: args.evaluationResponse,
      createdAt: now,
      userId: args.userId,
      teamId: args.teamId,
    });

    const runsForTeam = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter(
        (q) =>
          q.eq(q.field("teamId"), args.teamId) &&
          q.eq(q.field("userId"), args.userId),
      )
      .collect();

    const winnerRun = runsForTeam.find((run) => run._id === args.winnerRunId);
    if (!winnerRun) {
      throw new Error("Winner run not found");
    }

    await ctx.db.patch(args.winnerRunId, {
      isCrowned: true,
      crownReason: args.reason,
      ...(args.summary ? { summary: args.summary } : {}),
      ...(args.pullRequest?.url ? { pullRequestUrl: args.pullRequest.url } : {}),
      ...(args.pullRequest?.isDraft !== undefined
        ? { pullRequestIsDraft: args.pullRequest.isDraft }
        : {}),
      ...(args.pullRequest?.state
        ? { pullRequestState: args.pullRequest.state }
        : {}),
      ...(args.pullRequest?.number !== undefined
        ? { pullRequestNumber: args.pullRequest.number }
        : {}),
      updatedAt: now,
    });

    for (const run of runsForTeam) {
      if (run._id === args.winnerRunId) continue;
      await ctx.db.patch(run._id, {
        isCrowned: false,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.taskId, {
      crownEvaluationStatus: "succeeded",
      crownEvaluationError: undefined,
      isCompleted: true,
      updatedAt: now,
      ...(args.pullRequestTitle ? { pullRequestTitle: args.pullRequestTitle } : {}),
      ...(args.pullRequestDescription
        ? { pullRequestDescription: args.pullRequestDescription }
        : {}),
    });

    return args.winnerRunId;
  },
});
