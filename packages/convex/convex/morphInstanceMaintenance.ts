"use node";

import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import {
  createMorphCloudClient,
  listInstancesInstanceGet,
  pauseInstanceInstanceInstanceIdPausePost,
  stopInstanceInstanceInstanceIdDelete,
  type InstanceModel,
} from "@cmux/morphcloud-openapi-client";
import { v } from "convex/values";

const PAUSE_HOURS_THRESHOLD = 20;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 5;

/**
 * Pauses all Morph instances that have been running for more than 20 hours.
 * Called by the daily cron job at 4 AM Pacific Time.
 */
export const pauseOldMorphInstances = internalAction({
  args: {},
  handler: async () => {
    // Only run in production to avoid dev crons affecting prod instances
    if (!env.CONVEX_IS_PRODUCTION) {
      console.log("[morphInstanceMaintenance] Skipping: not in production");
      return;
    }

    const morphApiKey = env.MORPH_API_KEY;
    if (!morphApiKey) {
      console.error("[morphInstanceMaintenance] MORPH_API_KEY not configured");
      return;
    }

    const morphClient = createMorphCloudClient({
      auth: morphApiKey,
    });

    // List all instances
    const listResponse = await listInstancesInstanceGet({
      client: morphClient,
    });

    if (listResponse.error) {
      console.error(
        "[morphInstanceMaintenance] Failed to list instances:",
        listResponse.error
      );
      return;
    }

    const instances = listResponse.data?.data ?? [];
    if (instances.length === 0) {
      console.log("[morphInstanceMaintenance] No instances found");
      return;
    }

    const now = Date.now();
    const thresholdMs = PAUSE_HOURS_THRESHOLD * MILLISECONDS_PER_HOUR;

    // Filter for ready instances older than the threshold
    const staleActiveInstances = instances
      .filter((instance: InstanceModel) => instance.status === "ready")
      .filter((instance: InstanceModel) => {
        const createdMs = instance.created * 1000;
        return now - createdMs > thresholdMs;
      })
      .sort((a: InstanceModel, b: InstanceModel) => a.created - b.created);

    if (staleActiveInstances.length === 0) {
      console.log(
        `[morphInstanceMaintenance] No active instances older than ${PAUSE_HOURS_THRESHOLD} hours`
      );
      return;
    }

    console.log(
      `[morphInstanceMaintenance] Found ${staleActiveInstances.length} active instance(s) older than ${PAUSE_HOURS_THRESHOLD} hours`
    );

    let successCount = 0;
    let failureCount = 0;

    // Process instances in batches to balance speed and rate limiting
    for (let i = 0; i < staleActiveInstances.length; i += BATCH_SIZE) {
      const batch = staleActiveInstances.slice(i, i + BATCH_SIZE);
      console.log(
        `[morphInstanceMaintenance] Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} instances)`
      );

      const results = await Promise.allSettled(
        batch.map(async (instance: InstanceModel) => {
          const ageHours = Math.floor(
            (now - instance.created * 1000) / MILLISECONDS_PER_HOUR
          );
          console.log(
            `[morphInstanceMaintenance] Pausing ${instance.id} (${ageHours}h old)...`
          );

          const pauseResponse = await pauseInstanceInstanceInstanceIdPausePost({
            client: morphClient,
            path: { instance_id: instance.id },
          });

          if (pauseResponse.error) {
            throw new Error(JSON.stringify(pauseResponse.error));
          }

          console.log(`[morphInstanceMaintenance] Paused ${instance.id}`);
          return instance.id;
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const instance = batch[j];
        if (result.status === "fulfilled") {
          successCount++;
        } else {
          failureCount++;
          console.error(
            `[morphInstanceMaintenance] Failed to pause ${instance.id}:`,
            result.reason
          );
        }
      }
    }

    console.log(
      `[morphInstanceMaintenance] Finished: ${successCount} paused, ${failureCount} failed`
    );
  },
});

const STOP_DAYS_THRESHOLD = 14; // 2 weeks
const STOP_BATCH_SIZE = 5;

/**
 * Records that a Morph instance was stopped.
 */
export const recordInstanceStop = internalMutation({
  args: {
    instanceId: v.string(),
    ageHoursWhenStopped: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("morphInstanceStops", {
      instanceId: args.instanceId,
      stoppedAt: Date.now(),
      ageHoursWhenStopped: args.ageHoursWhenStopped,
    });
  },
});

/**
 * Checks if an instance has already been stopped by looking up in the DB.
 */
export const isInstanceStopped = internalMutation({
  args: {
    instanceId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("morphInstanceStops")
      .withIndex("by_instanceId", (q) => q.eq("instanceId", args.instanceId))
      .first();
    return existing !== null;
  },
});

/**
 * Stops (deletes) all Morph instances that have been paused for more than 2 weeks.
 * Called by the daily cron job at 5 AM Pacific Time.
 */
export const stopOldMorphInstances = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production to avoid dev crons affecting prod instances
    if (!env.CONVEX_IS_PRODUCTION) {
      console.log("[morphInstanceMaintenance:stop] Skipping: not in production");
      return;
    }

    const morphApiKey = env.MORPH_API_KEY;
    if (!morphApiKey) {
      console.error("[morphInstanceMaintenance:stop] MORPH_API_KEY not configured");
      return;
    }

    const morphClient = createMorphCloudClient({
      auth: morphApiKey,
    });

    // List all instances
    const listResponse = await listInstancesInstanceGet({
      client: morphClient,
    });

    if (listResponse.error) {
      console.error(
        "[morphInstanceMaintenance:stop] Failed to list instances:",
        listResponse.error
      );
      return;
    }

    const instances = listResponse.data?.data ?? [];
    if (instances.length === 0) {
      console.log("[morphInstanceMaintenance:stop] No instances found");
      return;
    }

    const now = Date.now();
    const thresholdMs = STOP_DAYS_THRESHOLD * 24 * MILLISECONDS_PER_HOUR;

    // Filter for paused instances older than 2 weeks
    const stalePausedInstances = instances
      .filter((instance: InstanceModel) => instance.status === "paused")
      .filter((instance: InstanceModel) => {
        const createdMs = instance.created * 1000;
        return now - createdMs > thresholdMs;
      })
      .sort((a: InstanceModel, b: InstanceModel) => a.created - b.created);

    if (stalePausedInstances.length === 0) {
      console.log(
        `[morphInstanceMaintenance:stop] No paused instances older than ${STOP_DAYS_THRESHOLD} days`
      );
      return;
    }

    console.log(
      `[morphInstanceMaintenance:stop] Found ${stalePausedInstances.length} paused instance(s) older than ${STOP_DAYS_THRESHOLD} days`
    );

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    // Process instances in batches
    for (let i = 0; i < stalePausedInstances.length; i += STOP_BATCH_SIZE) {
      const batch = stalePausedInstances.slice(i, i + STOP_BATCH_SIZE);
      console.log(
        `[morphInstanceMaintenance:stop] Processing batch ${Math.floor(i / STOP_BATCH_SIZE) + 1} (${batch.length} instances)`
      );

      const results = await Promise.allSettled(
        batch.map(async (instance: InstanceModel) => {
          // Check if already stopped (recorded in DB)
          const alreadyStopped = await ctx.runMutation(
            internal.morphInstanceMaintenance.isInstanceStopped,
            { instanceId: instance.id }
          );

          if (alreadyStopped) {
            console.log(
              `[morphInstanceMaintenance:stop] Skipping ${instance.id} - already recorded as stopped`
            );
            return { skipped: true, instanceId: instance.id };
          }

          const ageHours = Math.floor(
            (now - instance.created * 1000) / MILLISECONDS_PER_HOUR
          );
          console.log(
            `[morphInstanceMaintenance:stop] Stopping ${instance.id} (${ageHours}h old)...`
          );

          const stopResponse = await stopInstanceInstanceInstanceIdDelete({
            client: morphClient,
            path: { instance_id: instance.id },
          });

          if (stopResponse.error) {
            throw new Error(JSON.stringify(stopResponse.error));
          }

          // Record the stop in the database
          await ctx.runMutation(
            internal.morphInstanceMaintenance.recordInstanceStop,
            {
              instanceId: instance.id,
              ageHoursWhenStopped: ageHours,
            }
          );

          console.log(`[morphInstanceMaintenance:stop] Stopped ${instance.id}`);
          return { skipped: false, instanceId: instance.id };
        })
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const instance = batch[j];
        if (result.status === "fulfilled") {
          if (result.value.skipped) {
            skippedCount++;
          } else {
            successCount++;
          }
        } else {
          failureCount++;
          console.error(
            `[morphInstanceMaintenance:stop] Failed to stop ${instance.id}:`,
            result.reason
          );
        }
      }
    }

    console.log(
      `[morphInstanceMaintenance:stop] Finished: ${successCount} stopped, ${skippedCount} skipped, ${failureCount} failed`
    );
  },
});
