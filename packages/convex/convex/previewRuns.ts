import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authQuery } from "./users/utils";
import { internalMutation, internalQuery } from "./_generated/server";

function normalizeRepoFullName(value: string): string {
  return value.trim().replace(/\.git$/i, "").toLowerCase();
}

export const enqueueFromWebhook = internalMutation({
  args: {
    previewConfigId: v.id("previewConfigs"),
    teamId: v.string(),
    repoFullName: v.string(),
    repoInstallationId: v.optional(v.number()),
    prNumber: v.number(),
    prUrl: v.string(),
    headSha: v.string(),
    baseSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
    headRepoFullName: v.optional(v.string()),
    headRepoCloneUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);
    const headRepoFullName = args.headRepoFullName
      ? normalizeRepoFullName(args.headRepoFullName)
      : undefined;

    // Check if a preview run already exists for this config + headSha combination
    const existingBySha = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_head", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("headSha", args.headSha),
      )
      .order("desc")
      .first();

    if (existingBySha && (existingBySha.status === "pending" || existingBySha.status === "running")) {
      return existingBySha._id;
    }

    // Also check if there's already a pending/running preview for this PR
    // This prevents duplicates when both webhook and crown worker try to create preview jobs
    const existingByPr = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_pr", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("prNumber", args.prNumber),
      )
      .order("desc")
      .first();

    if (existingByPr && (existingByPr.status === "pending" || existingByPr.status === "running")) {
      return existingByPr._id;
    }

    const now = Date.now();
    const runId = await ctx.db.insert("previewRuns", {
      previewConfigId: args.previewConfigId,
      teamId: args.teamId,
      repoFullName,
      repoInstallationId: args.repoInstallationId,
      prNumber: args.prNumber,
      prUrl: args.prUrl,
      headSha: args.headSha,
      baseSha: args.baseSha,
      headRef: args.headRef,
      headRepoFullName,
      headRepoCloneUrl: args.headRepoCloneUrl,
      status: "pending",
      dispatchedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      screenshotSetId: undefined,
      githubCommentUrl: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.previewConfigId, {
      lastRunAt: now,
      updatedAt: now,
    });

    return runId;
  },
});

export const linkTaskRun = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      throw new Error("Preview run not found");
    }
    await ctx.db.patch(run._id, {
      taskRunId: args.taskRunId,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Enqueue a preview run from the crown worker path.
 * This is called after a task completes and creates a PR.
 * Returns the existing previewRun ID if one already exists for this PR (pending/running),
 * or null if no preview config exists for the repo.
 */
export const enqueueFromCrown = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    prUrl: v.string(),
    headSha: v.optional(v.string()),
    headRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const repoFullName = normalizeRepoFullName(args.repoFullName);

    // Look up the preview config for this repo
    const previewConfig = await ctx.db
      .query("previewConfigs")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", args.teamId).eq("repoFullName", repoFullName),
      )
      .first();

    if (!previewConfig) {
      // No preview config for this repo, nothing to do
      return { created: false, previewRunId: null, reason: "no_config" } as const;
    }

    // Check if a preview run already exists for this config + headSha combination (if we have headSha)
    const providedHeadSha = args.headSha;
    if (providedHeadSha) {
      const existingBySha = await ctx.db
        .query("previewRuns")
        .withIndex("by_config_head", (q) =>
          q.eq("previewConfigId", previewConfig._id).eq("headSha", providedHeadSha),
        )
        .order("desc")
        .first();

      if (existingBySha && (existingBySha.status === "pending" || existingBySha.status === "running")) {
        return { created: false, previewRunId: existingBySha._id, reason: "existing_by_sha" } as const;
      }
    }

    // Also check if there's already a pending/running preview for this PR
    const existingByPr = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_pr", (q) =>
        q.eq("previewConfigId", previewConfig._id).eq("prNumber", args.prNumber),
      )
      .order("desc")
      .first();

    if (existingByPr && (existingByPr.status === "pending" || existingByPr.status === "running")) {
      return { created: false, previewRunId: existingByPr._id, reason: "existing_by_pr" } as const;
    }

    // Generate a placeholder headSha if not provided (needed for the index)
    // This will be a unique-ish value based on PR number and timestamp
    const headSha = args.headSha ?? `crown-${args.prNumber}-${Date.now()}`;

    // Create a new preview run
    const now = Date.now();
    const runId = await ctx.db.insert("previewRuns", {
      previewConfigId: previewConfig._id,
      teamId: args.teamId,
      repoFullName,
      repoInstallationId: previewConfig.repoInstallationId,
      prNumber: args.prNumber,
      prUrl: args.prUrl,
      headSha,
      baseSha: undefined,
      headRef: args.headRef,
      headRepoFullName: undefined,
      headRepoCloneUrl: undefined,
      status: "pending",
      dispatchedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      screenshotSetId: undefined,
      githubCommentUrl: undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(previewConfig._id, {
      lastRunAt: now,
      updatedAt: now,
    });

    return { created: true, previewRunId: runId, previewConfigId: previewConfig._id, reason: "created" } as const;
  },
});

export const markDispatched = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      throw new Error("Preview run not found");
    }
    await ctx.db.patch(run._id, {
      status: "running",
      dispatchedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    screenshotSetId: v.optional(v.id("taskRunScreenshotSets")),
    githubCommentUrl: v.optional(v.string()),
    githubCommentId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      throw new Error("Preview run not found");
    }
    const now = Date.now();
    const patch: Record<string, unknown> = {
      status: args.status,
      screenshotSetId: args.screenshotSetId,
      githubCommentUrl: args.githubCommentUrl ?? run.githubCommentUrl,
      githubCommentId: args.githubCommentId ?? run.githubCommentId,
      updatedAt: now,
    };
    if (args.status === "completed" || args.status === "failed" || args.status === "skipped") {
      patch.completedAt = now;
    } else if (args.status === "running" && !run.startedAt) {
      patch.startedAt = now;
    }
    await ctx.db.patch(run._id, patch);
  },
});

export const getById = internalQuery({
  args: {
    id: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getRunWithConfig = internalQuery({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run) {
      return null;
    }
    const config = await ctx.db.get(run.previewConfigId);
    if (!config) {
      return null;
    }
    return { run, config } as const;
  },
});

export const getByTaskRunId = internalQuery({
  args: {
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("previewRuns")
      .filter((q) => q.eq(q.field("taskRunId"), args.taskRunId))
      .first();
    return run ?? null;
  },
});

export const getExistingPendingOrRunningByPr = internalQuery({
  args: {
    previewConfigId: v.id("previewConfigs"),
    prNumber: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_pr", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("prNumber", args.prNumber),
      )
      .order("desc")
      .first();

    if (existing && (existing.status === "pending" || existing.status === "running")) {
      return existing;
    }
    return null;
  },
});

export const listRecentByConfig = internalQuery({
  args: {
    previewConfigId: v.id("previewConfigs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_status", (q) =>
        q.eq("previewConfigId", args.previewConfigId),
      )
      .order("desc")
      .take(take);
    return runs;
  },
});

export const listByConfigAndPr = internalQuery({
  args: {
    previewConfigId: v.id("previewConfigs"),
    prNumber: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const take = Math.max(1, Math.min(args.limit ?? 20, 100));
    const runs = await ctx.db
      .query("previewRuns")
      .withIndex("by_config_pr", (q) =>
        q.eq("previewConfigId", args.previewConfigId).eq("prNumber", args.prNumber),
      )
      .order("desc")
      .take(take);
    return runs;
  },
});

export const listByConfig = authQuery({
  args: {
    teamSlugOrId: v.string(),
    previewConfigId: v.id("previewConfigs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const config = await ctx.db.get(args.previewConfigId);
    if (!config || config.teamId !== teamId) {
      throw new Error("Preview configuration not found");
    }
    const take = Math.max(1, Math.min(args.limit ?? 25, 100));
    const runs = await ctx.db
      .query("previewRuns")
      .withIndex("by_team_created", (q) =>
        q.eq("teamId", teamId),
      )
      .filter((q) => q.eq(q.field("previewConfigId"), config._id))
      .order("desc")
      .take(take);
    return runs;
  },
});
