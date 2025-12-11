import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";

/**
 * Get the latest active screenshot collector release for a given environment.
 */
export const getLatestRelease = query({
  args: {
    isStaging: v.boolean(),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db
      .query("screenshotCollectorReleases")
      .withIndex("by_staging_active", (q) =>
        q.eq("isStaging", args.isStaging).eq("isActive", true)
      )
      .order("desc")
      .first();

    if (!release) {
      return null;
    }

    // Generate a URL for the stored file
    const fileUrl = await ctx.storage.getUrl(release.storageId);

    return {
      version: release.version,
      downloadUrl: fileUrl,
      sha256: release.sha256,
      size: release.size,
      commitSha: release.commitSha,
      uploadedAt: release.uploadedAt,
    };
  },
});

/**
 * Internal query to get the latest release (used by actions).
 */
export const getLatestReleaseInternal = internalQuery({
  args: {
    isStaging: v.boolean(),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db
      .query("screenshotCollectorReleases")
      .withIndex("by_staging_active", (q) =>
        q.eq("isStaging", args.isStaging).eq("isActive", true)
      )
      .order("desc")
      .first();

    if (!release) {
      return null;
    }

    const fileUrl = await ctx.storage.getUrl(release.storageId);

    return {
      version: release.version,
      downloadUrl: fileUrl,
      sha256: release.sha256,
      size: release.size,
      commitSha: release.commitSha,
      uploadedAt: release.uploadedAt,
      storageId: release.storageId,
    };
  },
});

/**
 * Internal mutation to store a new release record.
 */
export const storeRelease = internalMutation({
  args: {
    version: v.string(),
    storageId: v.id("_storage"),
    downloadUrl: v.string(),
    sha256: v.string(),
    size: v.number(),
    commitSha: v.string(),
    isStaging: v.boolean(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Deactivate any existing active releases for this environment
    const existingActive = await ctx.db
      .query("screenshotCollectorReleases")
      .withIndex("by_staging_active", (q) =>
        q.eq("isStaging", args.isStaging).eq("isActive", true)
      )
      .collect();

    for (const release of existingActive) {
      await ctx.db.patch(release._id, {
        isActive: false,
        updatedAt: now,
      });
    }

    // Create the new release as active
    const releaseId = await ctx.db.insert("screenshotCollectorReleases", {
      version: args.version,
      storageId: args.storageId,
      downloadUrl: args.downloadUrl,
      sha256: args.sha256,
      size: args.size,
      commitSha: args.commitSha,
      isStaging: args.isStaging,
      isActive: true,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return releaseId;
  },
});

/**
 * Internal query to check if a release version already exists.
 */
export const getReleaseByVersion = internalQuery({
  args: {
    version: v.string(),
    isStaging: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("screenshotCollectorReleases")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .filter((q) => q.eq(q.field("isStaging"), args.isStaging))
      .first();
  },
});

/**
 * List all releases for an environment (for debugging/admin purposes).
 */
export const listReleases = query({
  args: {
    isStaging: v.boolean(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const releases = await ctx.db
      .query("screenshotCollectorReleases")
      .withIndex("by_staging_created", (q) =>
        q.eq("isStaging", args.isStaging)
      )
      .order("desc")
      .take(args.limit ?? 20);

    return releases.map((release) => ({
      id: release._id,
      version: release.version,
      sha256: release.sha256,
      size: release.size,
      commitSha: release.commitSha,
      isActive: release.isActive,
      uploadedAt: release.uploadedAt,
    }));
  },
});
