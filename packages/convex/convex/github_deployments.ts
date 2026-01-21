import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { internalMutation } from "./_generated/server";
import { authQuery } from "./users/utils";
import type {
  DeploymentEvent,
  DeploymentStatusEvent,
} from "@octokit/webhooks-types";

function normalizeTimestamp(
  value: string | number | null | undefined,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    return value > 1000000000000 ? value : value * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export const upsertDeploymentFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as DeploymentEvent;
    const { installationId, repoFullName, teamId } = args;


    const deploymentId = payload.deployment?.id;
    const sha = payload.deployment?.sha;

    if (!deploymentId || !sha) {
      console.warn("[upsertDeployment] Missing required fields", {
        deploymentId,
        sha,
        repoFullName,
        teamId,
      });
      return;
    }

    const createdAt = normalizeTimestamp(payload.deployment?.created_at);
    const updatedAt = normalizeTimestamp(payload.deployment?.updated_at);

    const deploymentDoc = {
      provider: "github" as const,
      installationId,
      repositoryId: payload.repository?.id,
      repoFullName,
      deploymentId,
      teamId,
      sha,
      ref: payload.deployment?.ref ?? undefined,
      task: payload.deployment?.task ?? undefined,
      environment: payload.deployment?.environment ?? undefined,
      description: payload.deployment?.description ?? undefined,
      creatorLogin: payload.deployment?.creator?.login,
      createdAt,
      updatedAt,
      state: undefined,
      statusDescription: undefined,
      targetUrl: undefined,
      environmentUrl: undefined,
      triggeringPrNumber: undefined,
    };


    const existingRecords = await ctx.db
      .query("githubDeployments")
      .withIndex("by_deploymentId", (q) => q.eq("deploymentId", deploymentId))
      .collect();

    const action = existingRecords.length > 0 ? "update" : "insert";
    console.log("[occ-debug:deployments]", {
      deploymentId,
      repoFullName,
      teamId,
      existingCount: existingRecords.length,
      action,
      environment: deploymentDoc.environment,
    });

    if (existingRecords.length > 0) {
      await ctx.db.patch(existingRecords[0]._id, deploymentDoc);

      if (existingRecords.length > 1) {
        console.warn("[occ-debug:deployments] duplicates", {
          deploymentId,
          count: existingRecords.length,
          duplicateIds: existingRecords.slice(1).map(r => r._id),
        });
        for (const duplicate of existingRecords.slice(1)) {
          await ctx.db.delete(duplicate._id);
        }
      }
    } else {
      await ctx.db.insert("githubDeployments", deploymentDoc);
    }
  },
});

export const updateDeploymentStatusFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as DeploymentStatusEvent;
    const { installationId, repoFullName, teamId } = args;


    const deploymentId = payload.deployment?.id;
    const state = payload.deployment_status?.state;

    if (!deploymentId) {
      console.warn("[updateDeploymentStatus] Missing deploymentId", {
        repoFullName,
        teamId,
      });
      return;
    }

    const validStates = ["error", "failure", "pending", "in_progress", "queued", "success"] as const;
    type ValidState = typeof validStates[number];
    const isValidState = (s: string): s is ValidState => validStates.includes(s as ValidState);
    const normalizedState: ValidState | undefined = state && isValidState(state) ? state : undefined;

    const updatedAt = normalizeTimestamp(payload.deployment_status?.updated_at);

    const existingRecords = await ctx.db
      .query("githubDeployments")
      .withIndex("by_deploymentId", (q) => q.eq("deploymentId", deploymentId))
      .collect();

    const action = existingRecords.length > 0 ? "update" : "insert";
    console.log("[occ-debug:deployment_status]", {
      deploymentId,
      repoFullName,
      teamId,
      existingCount: existingRecords.length,
      action,
      state: normalizedState,
    });

    if (existingRecords.length > 0) {
      await ctx.db.patch(existingRecords[0]._id, {
        state: normalizedState,
        statusDescription: payload.deployment_status?.description ?? undefined,
        logUrl: payload.deployment_status?.log_url ?? undefined,
        targetUrl: payload.deployment_status?.target_url ?? undefined,
        environmentUrl: payload.deployment_status?.environment_url ?? undefined,
        updatedAt,
      });

      if (existingRecords.length > 1) {
        console.warn("[occ-debug:deployment_status] duplicates", {
          deploymentId,
          count: existingRecords.length,
          duplicateIds: existingRecords.slice(1).map(r => r._id),
        });
        for (const duplicate of existingRecords.slice(1)) {
          await ctx.db.delete(duplicate._id);
        }
      }
    } else {
      const sha = payload.deployment?.sha;
      if (!sha) {
        console.warn("[updateDeploymentStatus] Deployment not found and no SHA available", {
          deploymentId,
          repoFullName,
          teamId,
        });
        return;
      }

      const createdAt = normalizeTimestamp(payload.deployment?.created_at);

      const deploymentDoc = {
        provider: "github" as const,
        installationId,
        repositoryId: payload.repository?.id,
        repoFullName,
        deploymentId,
        teamId,
        sha,
        ref: payload.deployment?.ref ?? undefined,
        task: payload.deployment?.task ?? undefined,
        environment: payload.deployment?.environment ?? undefined,
        description: payload.deployment?.description ?? undefined,
        creatorLogin: payload.deployment?.creator?.login,
        createdAt,
        updatedAt,
        state: normalizedState,
        statusDescription: payload.deployment_status?.description ?? undefined,
        logUrl: payload.deployment_status?.log_url ?? undefined,
        targetUrl: payload.deployment_status?.target_url ?? undefined,
        environmentUrl: payload.deployment_status?.environment_url ?? undefined,
        triggeringPrNumber: undefined,
      };

      await ctx.db.insert("githubDeployments", deploymentDoc);
    }
  },
});

export const getDeploymentsForPr = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    headSha: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { teamSlugOrId, repoFullName, headSha, limit = 20 } = args;
    const teamId = await getTeamId(ctx, teamSlugOrId);


    const allDeploymentsForRepo = await ctx.db
      .query("githubDeployments")
      .withIndex("by_team_repo", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName),
      )
      .collect();

    const filtered = allDeploymentsForRepo
      .filter((deployment) => {
        if (headSha) {
          return deployment.sha === headSha;
        }
        return deployment.triggeringPrNumber === args.prNumber;
      })
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    // Deduplicate by environment, keeping the most recently updated one
    const dedupMap = new Map<string, typeof filtered[number]>();
    for (const deployment of filtered) {
      const key = deployment.environment || deployment.task || 'default';
      const existing = dedupMap.get(key);
      if (!existing || (deployment.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        dedupMap.set(key, deployment);
      }
    }
    const deployments = Array.from(dedupMap.values()).slice(0, limit);


    return deployments;
  },
});
