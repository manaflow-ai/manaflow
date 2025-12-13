"use node";

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

type SyncResult = {
  releaseId: Id<"hostScreenshotCollectorReleases">;
  storageId: Id<"_storage">;
};

/**
 * Action to sync a release from GitHub Actions
 * This uploads the file to Convex storage and registers the release
 */
export const syncRelease = action({
  args: {
    version: v.string(),
    commitSha: v.string(),
    isStaging: v.boolean(),
    releaseUrl: v.optional(v.string()),
    fileContent: v.string(), // Base64 encoded file content
  },
  handler: async (ctx, args): Promise<SyncResult> => {
    // Decode base64 content
    const fileBuffer = Buffer.from(args.fileContent, "base64");
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: "application/javascript" });

    // Upload to Convex storage
    const storageId = await ctx.storage.store(blob);

    // Store the release record
    const releaseId: Id<"hostScreenshotCollectorReleases"> = await ctx.runMutation(
      internal.hostScreenshotCollector.storeRelease,
      {
        version: args.version,
        commitSha: args.commitSha,
        storageId,
        isStaging: args.isStaging,
        releaseUrl: args.releaseUrl,
      }
    );

    console.log(
      `Synced host-screenshot-collector release: version=${args.version}, isStaging=${args.isStaging}, releaseId=${releaseId}`
    );

    return { releaseId, storageId };
  },
});

/**
 * Internal action for syncing releases via HTTP endpoint (for GitHub Actions)
 */
export const syncReleaseFromHttp = internalAction({
  args: {
    version: v.string(),
    commitSha: v.string(),
    isStaging: v.boolean(),
    releaseUrl: v.optional(v.string()),
    fileContent: v.bytes(),
  },
  handler: async (ctx, args): Promise<SyncResult> => {
    const blob = new Blob([args.fileContent], { type: "application/javascript" });

    // Upload to Convex storage
    const storageId = await ctx.storage.store(blob);

    // Store the release record
    const releaseId: Id<"hostScreenshotCollectorReleases"> = await ctx.runMutation(
      internal.hostScreenshotCollector.storeRelease,
      {
        version: args.version,
        commitSha: args.commitSha,
        storageId,
        isStaging: args.isStaging,
        releaseUrl: args.releaseUrl,
      }
    );

    console.log(
      `Synced host-screenshot-collector release via HTTP: version=${args.version}, isStaging=${args.isStaging}, releaseId=${releaseId}`
    );

    return { releaseId, storageId };
  },
});
