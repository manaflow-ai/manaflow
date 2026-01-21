import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { internalMutation } from "./_generated/server";
import { authQuery } from "./users/utils";
import type { StatusEvent } from "@octokit/webhooks-types";

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

export const upsertCommitStatusFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as StatusEvent;
    const { installationId, repoFullName, teamId } = args;


    const statusId = payload.id;
    const sha = payload.sha;
    const context = payload.context;

    if (!statusId || !sha || !context) {
      console.warn("[upsertCommitStatus] Missing required fields", {
        statusId,
        sha,
        context,
        repoFullName,
        teamId,
      });
      return;
    }

    const validStates = ["error", "failure", "pending", "success"] as const;
    type ValidState = typeof validStates[number];
    const state = validStates.includes(payload.state as ValidState)
      ? payload.state
      : "pending";

    const createdAt = normalizeTimestamp(payload.created_at);
    const updatedAt = normalizeTimestamp(payload.updated_at);

    const statusDoc = {
      provider: "github" as const,
      installationId,
      repositoryId: payload.repository?.id,
      repoFullName,
      statusId,
      teamId,
      sha,
      state,
      context,
      description: payload.description ?? undefined,
      targetUrl: payload.target_url ?? undefined,
      creatorLogin: payload.sender?.login,
      createdAt,
      updatedAt,
      triggeringPrNumber: undefined,
    };


    // Use .take(2) for low OCC cost while enabling duplicate cleanup
    // Happy path (0-1 records): same cost as .first()
    // Duplicate path (2 records): cleanup only when needed
    const existingRecords = await ctx.db
      .query("githubCommitStatuses")
      .withIndex("by_statusId", (q) => q.eq("statusId", statusId))
      .take(2);

    // Find the newest record by updatedAt (handles duplicates correctly)
    let existing = existingRecords[0];
    if (existingRecords.length > 1) {
      for (const record of existingRecords) {
        const recordTimestamp = record.updatedAt ?? record.createdAt ?? 0;
        const existingTimestamp = existing?.updatedAt ?? existing?.createdAt ?? 0;
        if (recordTimestamp > existingTimestamp) {
          existing = record;
        }
      }
    }

    const action = existing ? "update" : "insert";
    console.log("[occ-debug:commit_statuses]", {
      statusId,
      repoFullName,
      teamId,
      action,
      state: statusDoc.state,
      context: statusDoc.context,
    });

    if (existing) {
      const existingTimestamp = existing.updatedAt ?? existing.createdAt;
      const incomingTimestamp = statusDoc.updatedAt ?? statusDoc.createdAt;
      const isStale =
        typeof existingTimestamp === "number" &&
        typeof incomingTimestamp === "number" &&
        existingTimestamp >= incomingTimestamp;

      if (isStale) {
        console.log("[occ-debug:commit_statuses] skipped-stale", {
          statusId,
          existingTimestamp,
          incomingTimestamp,
        });
      } else {
        const needsUpdate =
          existing.state !== statusDoc.state ||
          existing.description !== statusDoc.description ||
          existing.targetUrl !== statusDoc.targetUrl ||
          existing.updatedAt !== statusDoc.updatedAt ||
          existing.createdAt !== statusDoc.createdAt ||
          existing.sha !== statusDoc.sha ||
          existing.repoFullName !== statusDoc.repoFullName ||
          existing.repositoryId !== statusDoc.repositoryId ||
          existing.installationId !== statusDoc.installationId;

        if (needsUpdate) {
          await ctx.db.patch(existing._id, statusDoc);
        } else {
          console.log("[occ-debug:commit_statuses] skipped-noop", { statusId });
        }
      }

      // Lazy cleanup: delete duplicates only when they exist (keep the newest)
      if (existingRecords.length > 1) {
        console.warn("[occ-debug:commit_statuses] cleaning-duplicates", {
          statusId,
          count: existingRecords.length,
        });
        for (const duplicate of existingRecords) {
          if (duplicate._id !== existing._id) {
            await ctx.db.delete(duplicate._id);
          }
        }
      }
    } else {
      await ctx.db.insert("githubCommitStatuses", statusDoc);
    }
  },
});

export const getCommitStatusesForPr = authQuery({
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


    if (!headSha) {
      return [];
    }

    const allStatuses = await ctx.db
      .query("githubCommitStatuses")
      .withIndex("by_sha", (q) => q.eq("sha", headSha))
      .filter((q) =>
        q.and(
          q.eq(q.field("teamId"), teamId),
          q.eq(q.field("repoFullName"), repoFullName),
        ),
      )
      .order("desc")
      .collect();

    // Deduplicate by context (status name), keeping the most recently updated one
    const dedupMap = new Map<string, typeof allStatuses[number]>();
    for (const status of allStatuses) {
      const existing = dedupMap.get(status.context);
      if (!existing || (status.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        dedupMap.set(status.context, status);
      }
    }
    const statuses = Array.from(dedupMap.values()).slice(0, limit);


    return statuses;
  },
});
