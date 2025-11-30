import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const createScreenshotSet = internalMutation({
  args: {
    previewRunId: v.id("previewRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    commitSha: v.string(),
    error: v.optional(v.string()),
    images: v.array(
      v.object({
        storageId: v.id("_storage"),
        mimeType: v.string(),
        fileName: v.optional(v.string()),
        commitSha: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"taskRunScreenshotSets">> => {
    const previewRun = await ctx.db.get(args.previewRunId);
    if (!previewRun) {
      throw new Error("Preview run not found");
    }

    if (!previewRun.taskRunId) {
      throw new Error("Preview run is not linked to a task run");
    }

    const taskRun = await ctx.db.get(previewRun.taskRunId);
    if (!taskRun) {
      throw new Error("Task run not found for preview run");
    }

    if (args.status === "completed" && args.images.length === 0) {
      throw new Error("At least one screenshot is required for completed status");
    }

    const screenshots = args.images.map((image) => ({
      storageId: image.storageId,
      mimeType: image.mimeType,
      fileName: image.fileName,
      commitSha: image.commitSha ?? args.commitSha,
    }));

    const screenshotSetId: Id<"taskRunScreenshotSets"> = await ctx.runMutation(
      internal.tasks.recordScreenshotResult,
      {
        taskId: taskRun.taskId,
        runId: taskRun._id,
        status: args.status,
        screenshots,
        error: args.error,
      },
    );

    const primaryScreenshot = screenshots[0];
    if (primaryScreenshot) {
      await ctx.runMutation(internal.taskRuns.updateScreenshotMetadata, {
        id: taskRun._id,
        storageId: primaryScreenshot.storageId,
        mimeType: primaryScreenshot.mimeType,
        fileName: primaryScreenshot.fileName,
        commitSha: primaryScreenshot.commitSha,
        screenshotSetId,
      });
    } else if (args.status !== "completed") {
      await ctx.runMutation(internal.taskRuns.clearScreenshotMetadata, {
        id: taskRun._id,
      });
    }

    await ctx.db.patch(args.previewRunId, {
      screenshotSetId,
      updatedAt: Date.now(),
    });

    return screenshotSetId;
  },
});

export const getScreenshotSet = internalQuery({
  args: {
    screenshotSetId: v.id("taskRunScreenshotSets"),
  },
  handler: async (ctx, args) => {
    const set = await ctx.db.get(args.screenshotSetId);
    return set ?? null;
  },
});

export const getScreenshotSetByRun = internalQuery({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.previewRunId);
    if (!run?.screenshotSetId) {
      return null;
    }
    return await ctx.db.get(run.screenshotSetId);
  },
});

export const triggerGithubComment = internalAction({
  args: {
    previewRunId: v.id("previewRuns"),
  },
  handler: async (ctx, args) => {
    console.log("[previewScreenshots] Triggering GitHub comment", {
      previewRunId: args.previewRunId,
    });

    const run = await ctx.runQuery(internal.previewRuns.getRunWithConfig, {
      previewRunId: args.previewRunId,
    });

    if (!run?.run || !run.config) {
      console.error("[previewScreenshots] Run or config not found", {
        previewRunId: args.previewRunId,
      });
      return;
    }

    const { run: previewRun } = run;

    if (!previewRun.screenshotSetId) {
      console.warn("[previewScreenshots] No screenshot set for run", {
        previewRunId: args.previewRunId,
      });
      return;
    }

    if (!previewRun.repoInstallationId) {
      console.error("[previewScreenshots] No installation ID for run", {
        previewRunId: args.previewRunId,
      });
      return;
    }

    console.log("[previewScreenshots] Posting GitHub comment", {
      previewRunId: args.previewRunId,
      repoFullName: previewRun.repoFullName,
      prNumber: previewRun.prNumber,
      screenshotSetId: previewRun.screenshotSetId,
    });

    // Post GitHub comment with screenshots
    await ctx.runAction(internal.github_pr_comments.postPreviewComment, {
      installationId: previewRun.repoInstallationId,
      repoFullName: previewRun.repoFullName,
      prNumber: previewRun.prNumber,
      screenshotSetId: previewRun.screenshotSetId,
      previewRunId: args.previewRunId,
    });

    console.log("[previewScreenshots] GitHub comment posted successfully", {
      previewRunId: args.previewRunId,
    });
  },
});
