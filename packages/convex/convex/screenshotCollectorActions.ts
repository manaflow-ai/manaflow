"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

interface UploadResult {
  ok: boolean;
  skipped?: boolean;
  message?: string;
  releaseId?: Id<"screenshotCollectorReleases">;
  storageId?: Id<"_storage">;
  version?: string;
}

/**
 * Action to upload a screenshot collector release from GitHub Releases.
 * This downloads the bundle from GitHub and stores it in Convex storage.
 */
export const uploadFromGitHub = action({
  args: {
    version: v.string(),
    downloadUrl: v.string(),
    sha256: v.string(),
    size: v.number(),
    commitSha: v.string(),
    isStaging: v.boolean(),
  },
  handler: async (ctx, args): Promise<UploadResult> => {
    console.log(
      `[screenshot-collector] Uploading release ${args.version} (staging=${args.isStaging})`
    );
    console.log(`[screenshot-collector] Download URL: ${args.downloadUrl}`);

    // Check if this version already exists
    const existingRelease = await ctx.runQuery(
      internal.screenshotCollector.getReleaseByVersion,
      { version: args.version, isStaging: args.isStaging }
    );

    if (existingRelease) {
      console.log(
        `[screenshot-collector] Release ${args.version} already exists, skipping upload`
      );
      return {
        ok: true,
        skipped: true,
        message: "Release already exists",
      };
    }

    // Download the bundle from GitHub Releases
    console.log(`[screenshot-collector] Downloading bundle from GitHub...`);
    const response = await fetch(args.downloadUrl);

    if (!response.ok) {
      console.error(
        `[screenshot-collector] Failed to download bundle: ${response.status} ${response.statusText}`
      );
      throw new Error(
        `Failed to download bundle: ${response.status} ${response.statusText}`
      );
    }

    const bundleContent = await response.arrayBuffer();
    console.log(
      `[screenshot-collector] Downloaded ${bundleContent.byteLength} bytes`
    );

    // Verify size matches
    if (bundleContent.byteLength !== args.size) {
      console.warn(
        `[screenshot-collector] Size mismatch: expected ${args.size}, got ${bundleContent.byteLength}`
      );
    }

    // Verify SHA256 checksum
    const hashBuffer = await crypto.subtle.digest("SHA-256", bundleContent);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actualSha256 = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (actualSha256 !== args.sha256) {
      console.error(
        `[screenshot-collector] SHA256 mismatch: expected ${args.sha256}, got ${actualSha256}`
      );
      throw new Error(
        `SHA256 checksum mismatch: expected ${args.sha256}, got ${actualSha256}`
      );
    }

    console.log(`[screenshot-collector] SHA256 verified: ${actualSha256}`);

    // Store in Convex storage
    const blob = new Blob([bundleContent], {
      type: "application/javascript",
    });
    const storageId = await ctx.storage.store(blob);

    console.log(`[screenshot-collector] Stored in Convex: ${storageId}`);

    // Create the release record
    const releaseId = await ctx.runMutation(
      internal.screenshotCollector.storeRelease,
      {
        version: args.version,
        storageId,
        downloadUrl: args.downloadUrl,
        sha256: args.sha256,
        size: args.size,
        commitSha: args.commitSha,
        isStaging: args.isStaging,
      }
    );

    console.log(
      `[screenshot-collector] Release created: ${releaseId} (version=${args.version})`
    );

    return {
      ok: true,
      releaseId,
      storageId,
      version: args.version,
    };
  },
});
