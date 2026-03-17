import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Get the latest screenshot collector release URL for an environment
 */
export const getLatestReleaseUrl = query({
  args: {
    isStaging: v.boolean(),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db
      .query("hostScreenshotCollectorReleases")
      .withIndex("by_staging_latest", (q) =>
        q.eq("isStaging", args.isStaging).eq("isLatest", true)
      )
      .first();

    if (!release) {
      return null;
    }

    const url = await ctx.storage.getUrl(release.storageId);
    return {
      version: release.version,
      commitSha: release.commitSha,
      url,
      releaseUrl: release.releaseUrl,
      createdAt: release.createdAt,
    };
  },
});

/**
 * Get all releases for an environment (for debugging/admin)
 */
export const listReleases = query({
  args: {
    isStaging: v.boolean(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const releases = await ctx.db
      .query("hostScreenshotCollectorReleases")
      .withIndex("by_staging_created", (q) => q.eq("isStaging", args.isStaging))
      .order("desc")
      .take(args.limit ?? 10);

    return Promise.all(
      releases.map(async (release) => ({
        version: release.version,
        commitSha: release.commitSha,
        isLatest: release.isLatest,
        url: await ctx.storage.getUrl(release.storageId),
        releaseUrl: release.releaseUrl,
        createdAt: release.createdAt,
      }))
    );
  },
});

/**
 * Internal mutation to store a release record
 */
export const storeRelease = internalMutation({
  args: {
    version: v.string(),
    commitSha: v.string(),
    storageId: v.id("_storage"),
    isStaging: v.boolean(),
    releaseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // First, unmark any existing "latest" releases for this environment
    const existingLatest = await ctx.db
      .query("hostScreenshotCollectorReleases")
      .withIndex("by_staging_latest", (q) =>
        q.eq("isStaging", args.isStaging).eq("isLatest", true)
      )
      .collect();

    for (const release of existingLatest) {
      await ctx.db.patch(release._id, { isLatest: false });
    }

    // Insert the new release as latest
    const releaseId = await ctx.db.insert("hostScreenshotCollectorReleases", {
      version: args.version,
      commitSha: args.commitSha,
      storageId: args.storageId,
      isStaging: args.isStaging,
      isLatest: true,
      releaseUrl: args.releaseUrl,
      createdAt: Date.now(),
    });

    return releaseId;
  },
});
