"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import {
  createMorphCloudClient,
  listInstancesInstanceGet,
  pauseInstanceInstanceInstanceIdPausePost,
  stopInstanceInstanceInstanceIdDelete,
} from "@cmux/morphcloud-openapi-client";

const PAUSE_HOURS_THRESHOLD = 20;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 5;

/**
 * Pauses all Morph instances that have been running for more than 20 hours.
 * Called by the daily cron job at 4 AM Pacific Time.
 */
export const pauseOldMorphInstances = internalAction({
  args: {},
  handler: async (ctx) => {
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

    // Filter for cmux ready instances older than the threshold
    // Note: app can be "cmux", "cmux-dev", "cmux-preview", "cmux-automated-code-review", etc.
    const staleActiveInstances = instances
      .filter((instance) => instance.metadata?.app?.startsWith("cmux"))
      .filter((instance) => instance.status === "ready")
      .filter((instance) => {
        const createdMs = instance.created * 1000;
        return now - createdMs > thresholdMs;
      })
      .sort((a, b) => a.created - b.created);

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
        batch.map(async (instance) => {
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

          // Record the pause in our activity table
          await ctx.runMutation(internal.morphInstances.recordPauseInternal, {
            instanceId: instance.id,
          });

          // If this was a warm pool instance, remove it from the pool
          if (instance.metadata?.app === "cmux-warm-pool") {
            await ctx.runMutation(internal.warmPool.removeByInstanceId, {
              instanceId: instance.id,
            });
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
 * Stops (deletes) Morph instances that have been inactive for more than 2 weeks.
 * Only stops instances where lastResumedAt is older than 2 weeks (or never resumed).
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

    // Filter for cmux paused instances only (we don't stop running instances or non-cmux instances)
    // Note: app can be "cmux", "cmux-dev", "cmux-preview", "cmux-automated-code-review", etc.
    const pausedInstances = instances
      .filter((instance) => instance.metadata?.app?.startsWith("cmux"))
      .filter((instance) => instance.status === "paused");

    if (pausedInstances.length === 0) {
      console.log("[morphInstanceMaintenance:stop] No paused instances found");
      return;
    }

    console.log(
      `[morphInstanceMaintenance:stop] Checking ${pausedInstances.length} paused instance(s) for inactivity`
    );

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;

    // Process instances in batches
    for (let i = 0; i < pausedInstances.length; i += STOP_BATCH_SIZE) {
      const batch = pausedInstances.slice(i, i + STOP_BATCH_SIZE);
      console.log(
        `[morphInstanceMaintenance:stop] Processing batch ${Math.floor(i / STOP_BATCH_SIZE) + 1} (${batch.length} instances)`
      );

      const results = await Promise.allSettled(
        batch.map(async (instance) => {
          // Get activity record to check last resume time
          const activity = await ctx.runQuery(
            internal.morphInstances.getActivityInternal,
            { instanceId: instance.id }
          );

          // Already stopped?
          if (activity?.stoppedAt) {
            console.log(
              `[morphInstanceMaintenance:stop] Skipping ${instance.id} - already recorded as stopped`
            );
            return { skipped: true, reason: "already_stopped", instanceId: instance.id };
          }

          // Determine last activity time:
          // - If resumed, use lastResumedAt
          // - If never resumed but was paused, use lastPausedAt (means it was auto-paused and never used)
          // - If no activity record, use instance creation time (legacy instance)
          const lastActivityAt = activity?.lastResumedAt
            ?? activity?.lastPausedAt
            ?? (instance.created * 1000);

          const inactiveDuration = now - lastActivityAt;
          const inactiveDays = Math.floor(inactiveDuration / (24 * MILLISECONDS_PER_HOUR));

          if (inactiveDuration < thresholdMs) {
            console.log(
              `[morphInstanceMaintenance:stop] Skipping ${instance.id} - last activity ${inactiveDays} days ago (< ${STOP_DAYS_THRESHOLD} days)`
            );
            return { skipped: true, reason: "recently_active", instanceId: instance.id };
          }

          console.log(
            `[morphInstanceMaintenance:stop] Stopping ${instance.id} (inactive for ${inactiveDays} days)...`
          );

          const stopResponse = await stopInstanceInstanceInstanceIdDelete({
            client: morphClient,
            path: { instance_id: instance.id },
          });

          if (stopResponse.error) {
            throw new Error(JSON.stringify(stopResponse.error));
          }

          // Record the stop in the database
          await ctx.runMutation(internal.morphInstances.recordStopInternal, {
            instanceId: instance.id,
          });

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
