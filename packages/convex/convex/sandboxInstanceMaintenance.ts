"use node";

/**
 * Unified Sandbox Instance Maintenance
 *
 * Provider-agnostic maintenance handlers for sandbox instances.
 * Handles pause/stop lifecycle for all providers: morph, pve-lxc, docker, daytona.
 *
 * Design principles:
 * 1. Provider detection via instance ID prefix
 * 2. Pluggable provider-specific clients
 * 3. Shared activity tracking via sandboxInstances.ts
 * 4. Graceful handling when provider APIs are unavailable
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { env } from "../_shared/convex-env";
import {
  createMorphCloudClient,
  listInstancesInstanceGet,
  pauseInstanceInstanceInstanceIdPausePost,
  stopInstanceInstanceInstanceIdDelete,
} from "@cmux/morphcloud-openapi-client";
import type { SandboxProvider } from "./sandboxInstances";
import { PveLxcClient } from "@cmux/pve-lxc-client";

// ============================================================================
// Configuration
// ============================================================================

const PAUSE_HOURS_THRESHOLD = 20;
// Provider-specific threshold for PVE LXC
// PVE LXC doesn't preserve memory state on pause, so use longer pause threshold
const PAUSE_DAYS_THRESHOLD_PVE = 3;
const STOP_DAYS_THRESHOLD = 7;
const ORPHAN_MIN_AGE_DAYS = 5;
const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const BATCH_SIZE = 5;

// ============================================================================
// Provider Client Interfaces
// ============================================================================

interface ProviderInstance {
  id: string;
  status: string;
  created: number; // Unix timestamp in seconds
  metadata?: {
    app?: string;
    teamId?: string;
    userId?: string;
  };
}

interface ProviderClient {
  listInstances(): Promise<ProviderInstance[]>;
  pauseInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
  listOrphanedTemplates?: () => Promise<Array<{ vmid: number; hostname: string }>>;
  deleteTemplate?: (vmid: number) => Promise<void>;
}

// ============================================================================
// Morph Provider Client
// ============================================================================

function createMorphProviderClient(apiKey: string): ProviderClient {
  const client = createMorphCloudClient({ auth: apiKey });

  return {
    async listInstances(): Promise<ProviderInstance[]> {
      const response = await listInstancesInstanceGet({ client });
      if (response.error) {
        throw new Error(`Morph API error: ${JSON.stringify(response.error)}`);
      }
      return (response.data?.data ?? [])
        .filter((inst) => inst.status !== undefined)
        .map((inst) => ({
          id: inst.id,
          status: inst.status as string,
          created: inst.created,
          metadata: inst.metadata as ProviderInstance["metadata"],
        }));
    },

    async pauseInstance(instanceId: string): Promise<void> {
      const response = await pauseInstanceInstanceInstanceIdPausePost({
        client,
        path: { instance_id: instanceId },
      });
      if (response.error) {
        throw new Error(`Morph pause error: ${JSON.stringify(response.error)}`);
      }
    },

    async stopInstance(instanceId: string): Promise<void> {
      const response = await stopInstanceInstanceInstanceIdDelete({
        client,
        path: { instance_id: instanceId },
      });
      if (response.error) {
        throw new Error(`Morph stop error: ${JSON.stringify(response.error)}`);
      }
    },
  };
}

// ============================================================================
// PVE LXC Provider Client (delegates to @cmux/pve-lxc-client)
// ============================================================================

function createPveLxcProviderClient(
  apiUrl: string,
  apiToken: string,
  node?: string
): ProviderClient {
  const pveClient = new PveLxcClient({
    apiUrl,
    apiToken,
    node,
    verifyTls:
      process.env.PVE_VERIFY_TLS === "1" ||
      process.env.PVE_VERIFY_TLS?.toLowerCase() === "true",
  });

  return {
    async listInstances(): Promise<ProviderInstance[]> {
      const instances = await pveClient.instances.list();
      return instances
        .filter((inst) => inst.vmid < 9000) // Exclude template VMID range
        .map((inst) => ({
          id: inst.id,
          status: inst.status === "running" ? "ready" : inst.status,
          created: 0, // Activity table has actual creation time
          metadata: { app: "cmux" },
        }));
    },

    async pauseInstance(instanceId: string): Promise<void> {
      const inst = await pveClient.instances.get({ instanceId });
      await inst.pause();
    },

    async stopInstance(instanceId: string): Promise<void> {
      const inst = await pveClient.instances.get({ instanceId });
      await inst.delete();
    },

    // Add method to list orphaned templates
    listOrphanedTemplates: async (): Promise<Array<{ vmid: number; hostname: string }>> => {
      return pveClient.listOrphanedTemplates();
    },

    // Add method to delete templates
    deleteTemplate: async (vmid: number): Promise<void> => {
      return pveClient.deleteTemplate(vmid);
    },
  };
}

// ============================================================================
// Provider Factory
// ============================================================================

interface ProviderConfig {
  provider: SandboxProvider;
  client: ProviderClient | null;
  available: boolean;
  error?: string;
}

function getProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  // Morph provider
  if (env.MORPH_API_KEY) {
    try {
      configs.push({
        provider: "morph",
        client: createMorphProviderClient(env.MORPH_API_KEY),
        available: true,
      });
    } catch (error) {
      configs.push({
        provider: "morph",
        client: null,
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else {
    configs.push({
      provider: "morph",
      client: null,
      available: false,
      error: "MORPH_API_KEY not configured",
    });
  }

  // PVE LXC provider
  // Note: Use process.env directly to avoid Convex static analysis requiring these vars
  const pveApiUrl = process.env.PVE_API_URL;
  const pveApiToken = process.env.PVE_API_TOKEN;
  const pveNode = process.env.PVE_NODE;

  if (pveApiUrl && pveApiToken) {
    try {
      configs.push({
        provider: "pve-lxc",
        client: createPveLxcProviderClient(pveApiUrl, pveApiToken, pveNode),
        available: true,
      });
    } catch (error) {
      configs.push({
        provider: "pve-lxc",
        client: null,
        available: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } else {
    configs.push({
      provider: "pve-lxc",
      client: null,
      available: false,
      error: "PVE_API_URL or PVE_API_TOKEN not configured",
    });
  }

  // Docker provider - placeholder for future implementation
  configs.push({
    provider: "docker",
    client: null,
    available: false,
    error: "Docker provider not yet implemented",
  });

  // Daytona provider - placeholder for future implementation
  configs.push({
    provider: "daytona",
    client: null,
    available: false,
    error: "Daytona provider not yet implemented",
  });

  return configs;
}

// ============================================================================
// Maintenance Actions
// ============================================================================

/**
 * Test function to debug provider configuration (public for debugging).
 * Returns provider availability without actually pausing anything.
 * NOTE: Remove this function before production deployment!
 */
import { action } from "./_generated/server";

export const debugProviderConfig = action({
  args: {},
  handler: async () => {
    const configs = getProviderConfigs();
    const results = configs.map((c) => ({
      provider: c.provider,
      available: c.available,
      error: c.error,
    }));

    console.log("[sandboxMaintenance:debug] Provider configs:", JSON.stringify(results, null, 2));
    console.log("[sandboxMaintenance:debug] CONVEX_IS_PRODUCTION:", env.CONVEX_IS_PRODUCTION);
    console.log("[sandboxMaintenance:debug] MORPH_API_KEY set:", !!env.MORPH_API_KEY);
    console.log("[sandboxMaintenance:debug] PVE_API_URL set:", !!process.env.PVE_API_URL);
    console.log("[sandboxMaintenance:debug] PVE_API_TOKEN set:", !!process.env.PVE_API_TOKEN);

    return {
      providers: results,
      isProduction: env.CONVEX_IS_PRODUCTION,
      morphApiKeySet: !!env.MORPH_API_KEY,
      pveApiUrlSet: !!process.env.PVE_API_URL,
      pveApiTokenSet: !!process.env.PVE_API_TOKEN,
    };
  },
});

/**
 * Test function to list instances from all providers (public for debugging).
 * NOTE: Remove this function before production deployment!
 */
export const debugListInstances = action({
  args: {},
  handler: async () => {
    const configs = getProviderConfigs();
    const results: Record<string, { count: number; instances: Array<{ id: string; status: string }>; error?: string }> = {};

    for (const config of configs) {
      if (!config.available || !config.client) {
        results[config.provider] = {
          count: 0,
          instances: [],
          error: config.error,
        };
        continue;
      }

      try {
        const instances = await config.client.listInstances();
        const cmuxInstances = instances.filter((inst) => inst.metadata?.app?.startsWith("cmux"));
        results[config.provider] = {
          count: cmuxInstances.length,
          instances: cmuxInstances.slice(0, 10).map((i) => ({ id: i.id, status: i.status })),
        };
        console.log(`[sandboxMaintenance:debug] ${config.provider}: ${cmuxInstances.length} cmux instances`);
      } catch (error) {
        results[config.provider] = {
          count: 0,
          instances: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
        console.error(`[sandboxMaintenance:debug] ${config.provider} error:`, error);
      }
    }

    return results;
  },
});

/**
 * Pauses all sandbox instances that have been running for more than the threshold.
 * Called by the daily cron job.
 */
export const pauseOldSandboxInstances = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production
    if (env.CONVEX_IS_PRODUCTION !== "true") {
      console.log("[sandboxMaintenance:pause] Skipping: not in production");
      return;
    }

    const providerConfigs = getProviderConfigs();
    const now = Date.now();

    let totalSuccess = 0;
    let totalFailure = 0;

    for (const config of providerConfigs) {
      const thresholdMs =
        config.provider === "pve-lxc"
          ? PAUSE_DAYS_THRESHOLD_PVE * 24 * MILLISECONDS_PER_HOUR
          : PAUSE_HOURS_THRESHOLD * MILLISECONDS_PER_HOUR;

      if (!config.available || !config.client) {
        console.log(
          `[sandboxMaintenance:pause] Skipping ${config.provider}: ${config.error}`
        );
        continue;
      }

      const client = config.client;

      console.log(
        `[sandboxMaintenance:pause] Processing provider: ${config.provider}`
      );

      try {
        const instances = await client.listInstances();

        // Filter for cmux instances that are ready/running and older than threshold
        let staleInstances = instances
          .filter((inst) => inst.metadata?.app?.startsWith("cmux"))
          .filter((inst) => inst.status === "ready" || inst.status === "running")
          .filter((inst) => {
            // For PVE, check activity table since PVE doesn't track creation time
            if (inst.created === 0) {
              // Will be checked via activity table below
              return true;
            }
            const createdMs = inst.created * 1000;
            return now - createdMs > thresholdMs;
          })
          .sort((a, b) => a.created - b.created);

        if (staleInstances.length === 0) {
          console.log(
            `[sandboxMaintenance:pause] No stale instances for ${config.provider}`
          );
          continue;
        }

        // For PVE, we need to check activity table for creation time
        if (config.provider === "pve-lxc") {
          const instanceIds = staleInstances.map((i) => i.id);
          const activities = await ctx.runQuery(
            internal.sandboxInstances.getActivitiesByInstanceIdsInternal,
            { instanceIds }
          );

          // Filter based on activity creation time
          const filteredStale = staleInstances.filter((inst) => {
            const activity = activities[inst.id];
            if (!activity?.createdAt) return true; // No record, assume old
            return now - activity.createdAt > thresholdMs;
          });

          if (filteredStale.length === 0) {
            console.log(
              `[sandboxMaintenance:pause] No stale PVE instances after activity check`
            );
            continue;
          }

          staleInstances = filteredStale;
        }

        console.log(
          `[sandboxMaintenance:pause] Found ${staleInstances.length} stale ${config.provider} instances`
        );

        // Process in batches
        for (let i = 0; i < staleInstances.length; i += BATCH_SIZE) {
          const batch = staleInstances.slice(i, i + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (instance) => {
              const ageHours =
                instance.created > 0
                  ? Math.floor(
                      (now - instance.created * 1000) / MILLISECONDS_PER_HOUR
                    )
                  : "unknown";

              console.log(
                `[sandboxMaintenance:pause] Pausing ${instance.id} (${ageHours}h old)...`
              );

              await client.pauseInstance(instance.id);

              // Record in activity table
              await ctx.runMutation(internal.sandboxInstances.recordPauseInternal, {
                instanceId: instance.id,
                provider: config.provider,
              });

              console.log(`[sandboxMaintenance:pause] Paused ${instance.id}`);
              return instance.id;
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              totalSuccess++;
            } else {
              totalFailure++;
              console.error(
                `[sandboxMaintenance:pause] Failed to pause instance:`,
                result.reason
              );
            }
          }
        }
      } catch (error) {
        console.error(
          `[sandboxMaintenance:pause] Error processing ${config.provider}:`,
          error
        );
      }
    }

    console.log(
      `[sandboxMaintenance:pause] Finished: ${totalSuccess} paused, ${totalFailure} failed`
    );
  },
});

/**
 * Stops (deletes) sandbox instances that have been inactive for more than the threshold.
 * Called by the daily cron job.
 */
export const stopOldSandboxInstances = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production
    if (env.CONVEX_IS_PRODUCTION !== "true") {
      console.log("[sandboxMaintenance:stop] Skipping: not in production");
      return;
    }

    const providerConfigs = getProviderConfigs();
    const now = Date.now();
    const thresholdMs = STOP_DAYS_THRESHOLD * 24 * MILLISECONDS_PER_HOUR;

    let totalSuccess = 0;
    let totalFailure = 0;
    let totalSkipped = 0;

    for (const config of providerConfigs) {
      if (!config.available || !config.client) {
        console.log(
          `[sandboxMaintenance:stop] Skipping ${config.provider}: ${config.error}`
        );
        continue;
      }

      const client = config.client;

      console.log(
        `[sandboxMaintenance:stop] Processing provider: ${config.provider}`
      );

      try {
        const instances = await client.listInstances();

        // Filter for cmux instances that are paused/stopped
        const pausedInstances = instances
          .filter((inst) => inst.metadata?.app?.startsWith("cmux"))
          .filter(
            (inst) => inst.status === "paused" || inst.status === "stopped"
          );

        if (pausedInstances.length === 0) {
          console.log(
            `[sandboxMaintenance:stop] No paused instances for ${config.provider}`
          );
          continue;
        }

        console.log(
          `[sandboxMaintenance:stop] Checking ${pausedInstances.length} paused ${config.provider} instances`
        );

        // Get activity records for all instances
        const instanceIds = pausedInstances.map((i) => i.id);
        const activities = await ctx.runQuery(
          internal.sandboxInstances.getActivitiesByInstanceIdsInternal,
          { instanceIds }
        );

        // Process in batches
        for (let i = 0; i < pausedInstances.length; i += BATCH_SIZE) {
          const batch = pausedInstances.slice(i, i + BATCH_SIZE);

          const results = await Promise.allSettled(
            batch.map(async (instance) => {
              const activity = activities[instance.id];

              // Already stopped?
              if (activity?.stoppedAt) {
                console.log(
                  `[sandboxMaintenance:stop] Skipping ${instance.id} - already recorded as stopped`
                );
                return { skipped: true, reason: "already_stopped" };
              }

              // PVE LXC doesn't expose creation time; created is 0 in the provider list.
              // If we also have no activity record, we can't safely determine age/inactivity.
              if (!activity && instance.created === 0) {
                console.warn(
                  `[sandboxMaintenance:stop] Skipping ${instance.id} - unknown creation time (no activity record)`
                );
                return { skipped: true, reason: "unknown_creation_time" };
              }

              // Determine last activity time
              const lastActivityAt =
                activity?.lastResumedAt ??
                activity?.lastPausedAt ??
                activity?.createdAt ??
                instance.created * 1000;

              const inactiveDuration = now - lastActivityAt;
              const inactiveDays = Math.floor(
                inactiveDuration / (24 * MILLISECONDS_PER_HOUR)
              );

              if (inactiveDuration < thresholdMs) {
                console.log(
                  `[sandboxMaintenance:stop] Skipping ${instance.id} - last activity ${inactiveDays} days ago`
                );
                return { skipped: true, reason: "recently_active" };
              }

              console.log(
                `[sandboxMaintenance:stop] Stopping ${instance.id} (inactive ${inactiveDays} days)...`
              );

              await client.stopInstance(instance.id);

              // Record in activity table
              await ctx.runMutation(internal.sandboxInstances.recordStopInternal, {
                instanceId: instance.id,
                provider: config.provider,
              });

              console.log(`[sandboxMaintenance:stop] Stopped ${instance.id}`);
              return { skipped: false };
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") {
              if (result.value.skipped) {
                totalSkipped++;
              } else {
                totalSuccess++;
              }
            } else {
              totalFailure++;
              console.error(
                `[sandboxMaintenance:stop] Failed to stop instance:`,
                result.reason
              );
            }
          }
        }
      } catch (error) {
        console.error(
          `[sandboxMaintenance:stop] Error processing ${config.provider}:`,
          error
        );
      }
    }

    console.log(
      `[sandboxMaintenance:stop] Finished: ${totalSuccess} stopped, ${totalSkipped} skipped, ${totalFailure} failed`
    );
  },
});

// ============================================================================
// Orphan Container Cleanup (Garbage Collection)
// ============================================================================

/**
 * Clean up orphaned containers that exist in the provider but have no
 * corresponding Convex sandboxInstanceActivity record.
 *
 * This handles cases where:
 * - Container was created but server crashed before recording to Convex
 * - Manual container creation on PVE that shouldn't exist
 * - Stale containers from failed cleanup attempts
 *
 * Safety measures:
 * - Only processes containers with "cmux-" hostname prefix
 * - Requires container to be stopped (not running)
 * - Logs all actions for audit purposes
 */
export const cleanupOrphanedContainers = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production
    if (env.CONVEX_IS_PRODUCTION !== "true") {
      console.log("[sandboxMaintenance:orphanCleanup] Skipping: not in production");
      return;
    }

    console.log("[sandboxMaintenance:orphanCleanup] Starting orphan cleanup...");
    const now = Date.now();
    const orphanMinAgeMs = ORPHAN_MIN_AGE_DAYS * 24 * MILLISECONDS_PER_HOUR;

    const configs = getProviderConfigs();
    let totalCleaned = 0;
    let totalSkipped = 0;

    for (const config of configs) {
      if (!config.available || !config.client) {
        console.log(
          `[sandboxMaintenance:orphanCleanup] Skipping ${config.provider}: not available`
        );
        continue;
      }

      try {
        // Get all instances from provider
        const instances = await config.client.listInstances();
        const managedInstances = instances.filter((inst) =>
          inst.metadata?.app?.startsWith("cmux")
        );
        console.log(
          `[sandboxMaintenance:orphanCleanup] ${config.provider}: Found ${managedInstances.length} managed instances`
        );

        if (managedInstances.length === 0) continue;

        // Get activity records for these instances from Convex
        const instanceIds = managedInstances.map((i) => i.id);
        const activities = await ctx.runQuery(
          internal.sandboxInstances.getActivitiesByInstanceIdsInternal,
          { instanceIds }
        );

        // Find orphans: instances with no activity record
        const orphans = managedInstances.filter((inst) => !activities[inst.id]);

        console.log(
          `[sandboxMaintenance:orphanCleanup] ${config.provider}: Found ${orphans.length} orphaned instances`
        );

        for (const orphan of orphans) {
          // Safety: only clean up stopped/paused containers
          if (orphan.status !== "stopped" && orphan.status !== "paused") {
            console.log(
              `[sandboxMaintenance:orphanCleanup] Skipping non-stopped orphan: ${orphan.id} (status=${orphan.status})`
            );
            totalSkipped++;
            continue;
          }

          // Extra safety for PVE: only delete stopped containers.
          // PVE doesn't preserve memory state on stop, and doesn't expose creation time in our provider list.
          if (config.provider === "pve-lxc" && orphan.status !== "stopped") {
            console.log(
              `[sandboxMaintenance:orphanCleanup] Skipping PVE orphan not stopped: ${orphan.id} (status=${orphan.status})`
            );
            totalSkipped++;
            continue;
          }

          // For PVE-LXC without creation time, add extra safety:
          // keep any instance tracked in devboxInfo, only clean truly untracked orphans.
          if (orphan.created === 0) {
            if (config.provider === "pve-lxc") {
              const devboxRecord = await ctx.runQuery(
                internal.devboxInstances.getByProviderInstanceIdInternal,
                { providerInstanceId: orphan.id }
              );
              if (devboxRecord) {
                console.warn(
                  `[sandboxMaintenance:orphanCleanup] Skipping PVE orphan with devbox record: ${orphan.id}`
                );
                totalSkipped++;
                continue;
              }
              // PVE orphan verified: no activity record, no devbox record, stopped status
              // Delete immediately (skip age check since created=0 would miscalculate)
              try {
                console.log(
                  `[sandboxMaintenance:orphanCleanup] Deleting verified PVE orphan (no activity, no devbox): ${orphan.id}`
                );
                await config.client.stopInstance(orphan.id);
                totalCleaned++;
              } catch (error) {
                console.error(
                  `[sandboxMaintenance:orphanCleanup] Failed to delete PVE orphan ${orphan.id}:`,
                  error
                );
              }
              continue;
            } else {
              console.warn(
                `[sandboxMaintenance:orphanCleanup] Skipping orphan with unknown creation time: ${orphan.id} (provider=${config.provider})`
              );
              totalSkipped++;
              continue;
            }
          }

          const ageMs = now - orphan.created * 1000;
          const ageDays = Math.floor(ageMs / (24 * MILLISECONDS_PER_HOUR));
          if (ageMs < orphanMinAgeMs) {
            console.log(
              `[sandboxMaintenance:orphanCleanup] Skipping young orphan: ${orphan.id} (${ageDays}d old, provider=${config.provider})`
            );
            totalSkipped++;
            continue;
          }

          try {
            console.log(
              `[sandboxMaintenance:orphanCleanup] Deleting orphan: ${orphan.id} (status=${orphan.status})`
            );
            await config.client.stopInstance(orphan.id);
            totalCleaned++;
          } catch (error) {
            console.error(
              `[sandboxMaintenance:orphanCleanup] Failed to delete ${orphan.id}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error(
          `[sandboxMaintenance:orphanCleanup] Error processing ${config.provider}:`,
          error
        );
      }
    }

    console.log(
      `[sandboxMaintenance:orphanCleanup] Finished: ${totalCleaned} cleaned, ${totalSkipped} skipped`
    );
  },
});

/**
 * Clean up orphaned PVE templates with VMID < 9000.
 * These are intermediate templates created during custom environment saving
 * that were not properly cleaned up (bug fix in createTemplateFromContainer).
 *
 * Safety: Only deletes templates that:
 * - Have cmux-* or pvelxc-* hostname prefix
 * - Are templates (not running containers)
 * - Have VMID in range 200-8999 (excludes base templates 100-199 and protected 9000+)
 * - Are NOT referenced by any environmentSnapshotVersions record
 */
export const cleanupOrphanedPveTemplates = internalAction({
  args: {},
  handler: async (ctx) => {
    // Only run in production
    if (env.CONVEX_IS_PRODUCTION !== "true") {
      console.log("[sandboxMaintenance:templateCleanup] Skipping: not in production");
      return;
    }

    console.log("[sandboxMaintenance:templateCleanup] Starting orphaned template cleanup...");

    // Only run for PVE-LXC provider
    const pveApiUrl = process.env.PVE_API_URL;
    const pveApiToken = process.env.PVE_API_TOKEN;
    const pveNode = process.env.PVE_NODE;

    if (!pveApiUrl || !pveApiToken) {
      console.log("[sandboxMaintenance:templateCleanup] Skipping: PVE not configured");
      return;
    }

    const pveClient = createPveLxcProviderClient(pveApiUrl, pveApiToken, pveNode);
    if (!pveClient.listOrphanedTemplates || !pveClient.deleteTemplate) {
      console.log("[sandboxMaintenance:templateCleanup] Skipping: PVE template APIs unavailable");
      return;
    }

    try {
      const orphanedTemplates = await pveClient.listOrphanedTemplates();
      console.log(
        `[sandboxMaintenance:templateCleanup] Found ${orphanedTemplates.length} orphaned templates`
      );

      if (orphanedTemplates.length === 0) {
        return;
      }

      // Get all template VMIDs that are actually in use by environments
      const usedTemplateVmids = await ctx.runQuery(
        internal.environments.getUsedTemplateVmidsInternal
      );
      const usedVmidSet = new Set(usedTemplateVmids);

      let totalCleaned = 0;
      let totalSkipped = 0;

      for (const orphan of orphanedTemplates) {
        // Skip if this template is referenced by an environment
        if (usedVmidSet.has(orphan.vmid)) {
          console.log(
            `[sandboxMaintenance:templateCleanup] Skipping template ${orphan.vmid} (${orphan.hostname}): in use by environment`
          );
          totalSkipped++;
          continue;
        }

        try {
          console.log(
            `[sandboxMaintenance:templateCleanup] Deleting orphaned template ${orphan.vmid} (${orphan.hostname})`
          );
          await pveClient.deleteTemplate(orphan.vmid);
          totalCleaned++;
        } catch (error) {
          console.error(
            `[sandboxMaintenance:templateCleanup] Failed to delete template ${orphan.vmid}:`,
            error
          );
        }
      }

      console.log(
        `[sandboxMaintenance:templateCleanup] Finished: ${totalCleaned} deleted, ${totalSkipped} skipped`
      );
    } catch (error) {
      console.error("[sandboxMaintenance:templateCleanup] Error:", error);
    }
  },
});
