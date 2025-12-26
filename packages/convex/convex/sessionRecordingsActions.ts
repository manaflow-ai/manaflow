"use node";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }

  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function getR2BucketName() {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("Missing R2_BUCKET_NAME environment variable");
  }
  return bucket;
}

function getR2PublicUrl() {
  return process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

export const generateUploadUrls = internalAction({
  args: {
    taskRunId: v.id("taskRuns"),
    includeVideo: v.boolean(),
    includeTrajectory: v.boolean(),
  },
  handler: async (_ctx, args): Promise<{
    videoUploadUrl?: string;
    videoR2Key?: string;
    trajectoryUploadUrl?: string;
    trajectoryR2Key?: string;
  }> => {
    const client = getR2Client();
    const bucket = getR2BucketName();
    const timestamp = Date.now();
    const result: {
      videoUploadUrl?: string;
      videoR2Key?: string;
      trajectoryUploadUrl?: string;
      trajectoryR2Key?: string;
    } = {};

    if (args.includeVideo) {
      const videoKey = `recordings/${args.taskRunId}/${timestamp}/video.mp4`;
      const videoCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: videoKey,
        ContentType: "video/mp4",
      });
      result.videoUploadUrl = await getSignedUrl(client, videoCommand, { expiresIn: 3600 });
      result.videoR2Key = videoKey;
    }

    if (args.includeTrajectory) {
      const trajectoryKey = `recordings/${args.taskRunId}/${timestamp}/trajectory.jsonl`;
      const trajectoryCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: trajectoryKey,
        ContentType: "application/x-ndjson",
      });
      result.trajectoryUploadUrl = await getSignedUrl(client, trajectoryCommand, { expiresIn: 3600 });
      result.trajectoryR2Key = trajectoryKey;
    }

    return result;
  },
});

export const startRecording = internalAction({
  args: {
    taskRunId: v.id("taskRuns"),
    screenshotSetId: v.optional(v.id("taskRunScreenshotSets")),
    teamId: v.string(),
    userId: v.string(),
    includeVideo: v.boolean(),
    includeTrajectory: v.boolean(),
  },
  handler: async (ctx, args): Promise<{
    recordingId: Id<"sessionRecordings">;
    videoUploadUrl?: string;
    videoR2Key?: string;
    trajectoryUploadUrl?: string;
    trajectoryR2Key?: string;
  }> => {
    const uploadUrls = await ctx.runAction(internal.sessionRecordingsActions.generateUploadUrls, {
      taskRunId: args.taskRunId,
      includeVideo: args.includeVideo,
      includeTrajectory: args.includeTrajectory,
    });

    const recordingId = await ctx.runMutation(internal.sessionRecordings.create, {
      taskRunId: args.taskRunId,
      screenshotSetId: args.screenshotSetId,
      teamId: args.teamId,
      userId: args.userId,
      videoR2Key: uploadUrls.videoR2Key,
      trajectoryR2Key: uploadUrls.trajectoryR2Key,
    });

    return {
      recordingId,
      ...uploadUrls,
    };
  },
});

export const completeRecording = internalAction({
  args: {
    recordingId: v.id("sessionRecordings"),
    videoSizeBytes: v.optional(v.number()),
    videoDurationMs: v.optional(v.number()),
    videoWidth: v.optional(v.number()),
    videoHeight: v.optional(v.number()),
    trajectorySizeBytes: v.optional(v.number()),
    trajectoryMessageCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const publicBaseUrl = getR2PublicUrl();
    await ctx.runMutation(internal.sessionRecordings.markCompleted, {
      recordingId: args.recordingId,
      publicBaseUrl,
      videoSizeBytes: args.videoSizeBytes,
      videoDurationMs: args.videoDurationMs,
      videoWidth: args.videoWidth,
      videoHeight: args.videoHeight,
      trajectorySizeBytes: args.trajectorySizeBytes,
      trajectoryMessageCount: args.trajectoryMessageCount,
    });
  },
});

export const failRecording = internalAction({
  args: {
    recordingId: v.id("sessionRecordings"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.sessionRecordings.updateStatus, {
      recordingId: args.recordingId,
      status: "failed",
      errorMessage: args.errorMessage,
      recordingEndedAt: Date.now(),
    });
  },
});
