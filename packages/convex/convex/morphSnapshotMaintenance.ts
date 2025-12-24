"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import {
  createMorphCloudClient,
  listSnapshotsSnapshotGet,
  listInstancesInstanceGet,
  deleteSnapshotSnapshotSnapshotIdDelete,
  type SnapshotModel,
  type InstanceModel,
} from "@cmux/morphcloud-openapi-client";
import { MORPH_SNAPSHOT_MANIFEST } from "@cmux/shared/morph-snapshots";

const DAYS_THRESHOLD = 14; // Delete snapshots older than 14 days
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 10;
const DRY_RUN = true; // IMPORTANT: Set to false only after testing

/**
 * Get all snapshot IDs from morph-snapshots.json that must NEVER be deleted.
 * This is a failsafe - these are the base preset snapshots.
 */
function getPresetSnapshotIds(): Set<string> {
  const ids = new Set<string>();
  for (const preset of MORPH_SNAPSHOT_MANIFEST.presets) {
    for (const version of preset.versions) {
      ids.add(version.snapshotId);
    }
  }
  return ids;
}

/**
 * Deletes old orphaned Morph snapshots that are:
 * 1. NOT a preset snapshot (morph-snapshots.json) - FAILSAFE
 * 2. NOT referenced by any Convex environment
 * 3. NOT referenced by any Morph instance (running or paused)
 * 4. Older than DAYS_THRESHOLD days
 *
 * Called by the daily cron job.
 */
export const deleteOldMorphSnapshots = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production to avoid dev crons affecting prod snapshots
    if (!env.CONVEX_IS_PRODUCTION) {
      console.log("[morphSnapshotMaintenance] Skipping: not in production");
      return;
    }

    const morphApiKey = env.MORPH_API_KEY;
    if (!morphApiKey) {
      console.error("[morphSnapshotMaintenance] MORPH_API_KEY not configured");
      return;
    }

    const morphClient = createMorphCloudClient({
      auth: morphApiKey,
    });

    // 1. FAILSAFE: Get preset snapshot IDs that must NEVER be deleted
    const presetSnapshotIds = getPresetSnapshotIds();
    console.log(
      `[morphSnapshotMaintenance] Failsafe: ${presetSnapshotIds.size} preset snapshots will never be deleted`
    );

    // 2. Get snapshot IDs from Convex environments (never delete these)
    const environments = await ctx.runQuery(
      internal.environments.listAllSnapshotIds,
      {}
    );
    const environmentSnapshotIds = new Set<string>(
      environments.map((e: { morphSnapshotId: string }) => e.morphSnapshotId)
    );
    console.log(
      `[morphSnapshotMaintenance] ${environmentSnapshotIds.size} active environment snapshots will not be deleted`
    );

    // 2b. Get ALL snapshot IDs from environmentSnapshotVersions (never delete these)
    // These are historical versions users may want to restore
    const environmentVersions = await ctx.runQuery(
      internal.environmentSnapshots.listAllSnapshotIds,
      {}
    );
    const environmentVersionSnapshotIds = new Set<string>(
      environmentVersions.map((v: { morphSnapshotId: string }) => v.morphSnapshotId)
    );
    console.log(
      `[morphSnapshotMaintenance] ${environmentVersionSnapshotIds.size} environment version snapshots will not be deleted`
    );

    // 3. Get all instances from Morph and collect their snapshot IDs
    const instancesResponse = await listInstancesInstanceGet({
      client: morphClient,
    });
    if (instancesResponse.error) {
      console.error(
        "[morphSnapshotMaintenance] Failed to list instances:",
        instancesResponse.error
      );
      return;
    }
    const instances = instancesResponse.data?.data ?? [];
    const instanceSnapshotIds = new Set<string>();
    for (const instance of instances) {
      const snapshotId = (instance as InstanceModel & { refs?: { snapshot_id?: string } }).refs?.snapshot_id;
      if (snapshotId) {
        instanceSnapshotIds.add(snapshotId);
      }
    }
    console.log(
      `[morphSnapshotMaintenance] ${instanceSnapshotIds.size} instance snapshots will not be deleted (from ${instances.length} instances)`
    );

    // 4. List all snapshots from Morph
    const snapshotsResponse = await listSnapshotsSnapshotGet({
      client: morphClient,
    });
    if (snapshotsResponse.error) {
      console.error(
        "[morphSnapshotMaintenance] Failed to list snapshots:",
        snapshotsResponse.error
      );
      return;
    }
    const allSnapshots = snapshotsResponse.data?.data ?? [];
    console.log(
      `[morphSnapshotMaintenance] Total snapshots in Morph: ${allSnapshots.length}`
    );

    // 5. Find snapshots to delete:
    //    - NOT preset (failsafe)
    //    - NOT referenced by any environment
    //    - NOT referenced by any instance
    //    - Older than DAYS_THRESHOLD
    const cutoffTimestamp = (Date.now() - DAYS_THRESHOLD * MILLISECONDS_PER_DAY) / 1000; // Morph uses seconds
    const snapshotsToDelete: SnapshotModel[] = [];
    const skippedPreset: string[] = [];
    const skippedEnvironment: string[] = [];
    const skippedInstance: string[] = [];
    const skippedRecent: string[] = [];

    for (const snapshot of allSnapshots) {
      // FAILSAFE: Never delete preset snapshots
      if (presetSnapshotIds.has(snapshot.id)) {
        skippedPreset.push(snapshot.id);
        continue;
      }

      // Don't delete environment snapshots
      if (environmentSnapshotIds.has(snapshot.id)) {
        skippedEnvironment.push(snapshot.id);
        continue;
      }

      // Don't delete environment version snapshots (historical versions)
      if (environmentVersionSnapshotIds.has(snapshot.id)) {
        skippedEnvironment.push(snapshot.id);
        continue;
      }

      // Don't delete snapshots referenced by instances
      if (instanceSnapshotIds.has(snapshot.id)) {
        skippedInstance.push(snapshot.id);
        continue;
      }

      // Don't delete recent snapshots
      if (snapshot.created > cutoffTimestamp) {
        skippedRecent.push(snapshot.id);
        continue;
      }

      // This snapshot is orphaned and old - candidate for deletion
      snapshotsToDelete.push(snapshot);
    }

    console.log(
      `[morphSnapshotMaintenance] Skipped: ${skippedPreset.length} preset, ${skippedEnvironment.length} environment, ${skippedInstance.length} instance, ${skippedRecent.length} recent`
    );
    console.log(
      `[morphSnapshotMaintenance] Orphaned snapshots to delete: ${snapshotsToDelete.length}`
    );

    if (snapshotsToDelete.length === 0) {
      console.log("[morphSnapshotMaintenance] No snapshots to delete");
      return;
    }

    if (DRY_RUN) {
      console.log("[morphSnapshotMaintenance] DRY RUN - not deleting");
      for (const snapshot of snapshotsToDelete.slice(0, 20)) {
        const ageDays = Math.floor((Date.now() / 1000 - snapshot.created) / (60 * 60 * 24));
        console.log(`  Would delete: ${snapshot.id} (${ageDays} days old)`);
      }
      if (snapshotsToDelete.length > 20) {
        console.log(`  ... and ${snapshotsToDelete.length - 20} more`);
      }
      return;
    }

    // Delete snapshots in batches
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < snapshotsToDelete.length; i += BATCH_SIZE) {
      const batch = snapshotsToDelete.slice(i, i + BATCH_SIZE);
      console.log(
        `[morphSnapshotMaintenance] Deleting batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} snapshots)`
      );

      const results = await Promise.allSettled(
        batch.map(async (snapshot: SnapshotModel) => {
          // Final failsafe check before deletion
          if (presetSnapshotIds.has(snapshot.id)) {
            throw new Error(`FAILSAFE: Attempted to delete preset snapshot ${snapshot.id}`);
          }

          const deleteResponse = await deleteSnapshotSnapshotSnapshotIdDelete({
            client: morphClient,
            path: { snapshot_id: snapshot.id },
          });

          if (deleteResponse.error) {
            throw new Error(JSON.stringify(deleteResponse.error));
          }

          return snapshot.id;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const snapshot = batch[j];
        if (result.status === "fulfilled") {
          successCount++;
        } else {
          failureCount++;
          console.error(
            `[morphSnapshotMaintenance] Failed to delete ${snapshot?.id}:`,
            result.reason
          );
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < snapshotsToDelete.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(
      `[morphSnapshotMaintenance] Finished: ${successCount} deleted, ${failureCount} failed`
    );
  },
});
