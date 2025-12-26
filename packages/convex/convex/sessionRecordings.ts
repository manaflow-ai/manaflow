import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

export const create = internalMutation({
  args: {
    taskRunId: v.id("taskRuns"),
    screenshotSetId: v.optional(v.id("taskRunScreenshotSets")),
    teamId: v.string(),
    userId: v.string(),
    videoR2Key: v.optional(v.string()),
    trajectoryR2Key: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"sessionRecordings">> => {
    const now = Date.now();
    return ctx.db.insert("sessionRecordings", {
      taskRunId: args.taskRunId,
      screenshotSetId: args.screenshotSetId,
      teamId: args.teamId,
      userId: args.userId,
      videoR2Key: args.videoR2Key,
      trajectoryR2Key: args.trajectoryR2Key,
      status: "recording",
      recordingStartedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    recordingId: v.id("sessionRecordings"),
    status: v.union(
      v.literal("recording"),
      v.literal("uploading"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    errorMessage: v.optional(v.string()),
    recordingEndedAt: v.optional(v.number()),
    videoUrl: v.optional(v.string()),
    videoDurationMs: v.optional(v.number()),
    videoSizeBytes: v.optional(v.number()),
    videoFormat: v.optional(v.string()),
    videoWidth: v.optional(v.number()),
    videoHeight: v.optional(v.number()),
    trajectoryUrl: v.optional(v.string()),
    trajectorySizeBytes: v.optional(v.number()),
    trajectoryMessageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { recordingId, ...updates } = args;
    await ctx.db.patch(recordingId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const markCompleted = internalMutation({
  args: {
    recordingId: v.id("sessionRecordings"),
    publicBaseUrl: v.string(),
    videoSizeBytes: v.optional(v.number()),
    videoDurationMs: v.optional(v.number()),
    videoWidth: v.optional(v.number()),
    videoHeight: v.optional(v.number()),
    trajectorySizeBytes: v.optional(v.number()),
    trajectoryMessageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const recording = await ctx.db.get(args.recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }

    const updates: Record<string, unknown> = {
      status: "completed",
      recordingEndedAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (recording.videoR2Key) {
      updates.videoUrl = `${args.publicBaseUrl}/${recording.videoR2Key}`;
      updates.videoFormat = "mp4";
    }
    if (recording.trajectoryR2Key) {
      updates.trajectoryUrl = `${args.publicBaseUrl}/${recording.trajectoryR2Key}`;
    }
    if (args.videoSizeBytes !== undefined) updates.videoSizeBytes = args.videoSizeBytes;
    if (args.videoDurationMs !== undefined) updates.videoDurationMs = args.videoDurationMs;
    if (args.videoWidth !== undefined) updates.videoWidth = args.videoWidth;
    if (args.videoHeight !== undefined) updates.videoHeight = args.videoHeight;
    if (args.trajectorySizeBytes !== undefined) updates.trajectorySizeBytes = args.trajectorySizeBytes;
    if (args.trajectoryMessageCount !== undefined) updates.trajectoryMessageCount = args.trajectoryMessageCount;

    await ctx.db.patch(args.recordingId, updates);
  },
});

export const getByTaskRun = internalQuery({
  args: {
    taskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("sessionRecordings")
      .withIndex("by_taskRun", (q) => q.eq("taskRunId", args.taskRunId))
      .order("desc")
      .first();
  },
});
