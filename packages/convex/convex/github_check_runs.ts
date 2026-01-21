/**
 * GitHub Check Runs
 *
 * Handles check_run webhooks from GitHub Checks API.
 * These are checks from third-party apps like Vercel, Bugbot, etc.
 *
 * NOT to be confused with:
 * - workflow_run events (see github_workflows.ts) - GitHub Actions workflows
 * - deployment events (see github_deployments.ts) - deployment records
 * - status events (see github_commit_statuses.ts) - legacy commit statuses
 */
import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { authQuery } from "./users/utils";
import type { CheckRunEvent } from "@octokit/webhooks-types";

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

export const upsertCheckRunFromWebhook = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const payload = args.payload as CheckRunEvent;
    const { installationId, repoFullName, teamId } = args;


    // Extract core check run data
    const checkRunId = payload.check_run?.id;
    const name = payload.check_run?.name;
    const headSha = payload.check_run?.head_sha;

    if (!checkRunId || !name || !headSha) {
      console.warn("[upsertCheckRun] Missing required fields", {
        checkRunId,
        name,
        headSha,
        repoFullName,
        teamId,
      });
      return;
    }

    const githubStatus = payload.check_run?.status;
    const validStatuses = ["queued", "in_progress", "completed", "pending", "waiting"] as const;
    type ValidStatus = typeof validStatuses[number];
    const status = githubStatus && validStatuses.includes(githubStatus as ValidStatus) ? githubStatus : undefined;

    // Map GitHub conclusion to our schema conclusion
    const githubConclusion = payload.check_run?.conclusion;
    const conclusion =
      githubConclusion === "stale" || githubConclusion === null
        ? undefined
        : githubConclusion;

    const updatedAt = normalizeTimestamp((payload.check_run as { updated_at?: string | null })?.updated_at);
    const startedAt = normalizeTimestamp((payload.check_run as { started_at?: string | null })?.started_at);
    const completedAt = normalizeTimestamp((payload.check_run as { completed_at?: string | null })?.completed_at);

    // Extract app info
    const appName = payload.check_run?.app?.name;
    const appSlug = payload.check_run?.app?.slug;

    // Extract URLs
    const htmlUrl = payload.check_run?.html_url;

    // Extract triggering PR info if available
    let triggeringPrNumber: number | undefined;
    if (
      payload.check_run?.pull_requests &&
      payload.check_run.pull_requests.length > 0
    ) {
      // Take the first PR if multiple are associated
      triggeringPrNumber = payload.check_run.pull_requests[0]?.number;
    }

    // Prepare the document
    const checkRunDoc = {
      provider: "github" as const,
      installationId,
      repositoryId: payload.repository?.id,
      repoFullName,
      checkRunId,
      teamId,
      name,
      status,
      conclusion,
      headSha,
      htmlUrl,
      updatedAt,
      startedAt,
      completedAt,
      appName,
      appSlug,
      triggeringPrNumber,
    };


    // Upsert the check run - fetch all matching records to handle duplicates
    const existingRecords = await ctx.db
      .query("githubCheckRuns")
      .withIndex("by_checkRunId", (q) => q.eq("checkRunId", checkRunId))
      .collect();

    const action = existingRecords.length > 0 ? "update" : "insert";
    console.log("[occ-debug:check_runs]", {
      checkRunId,
      repoFullName,
      teamId,
      existingCount: existingRecords.length,
      action,
      status: checkRunDoc.status,
      conclusion: checkRunDoc.conclusion,
    });

    if (existingRecords.length > 0) {
      // Update the first record
      await ctx.db.patch(existingRecords[0]._id, checkRunDoc);

      // Delete any duplicates
      if (existingRecords.length > 1) {
        console.warn("[occ-debug:check_runs] duplicates", {
          checkRunId,
          count: existingRecords.length,
          duplicateIds: existingRecords.slice(1).map(r => r._id),
        });
        for (const duplicate of existingRecords.slice(1)) {
          await ctx.db.delete(duplicate._id);
        }
      }
    } else {
      // Insert new check run
      await ctx.db.insert("githubCheckRuns", checkRunDoc);
    }
  },
});

// Query to get check runs for a specific PR
export const getCheckRunsForPr = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    headSha: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { teamSlugOrId, repoFullName, prNumber, headSha, limit = 20 } = args;
    const teamId = await getTeamId(ctx, teamSlugOrId);

    let filtered: Doc<"githubCheckRuns">[];

    if (headSha) {
      // Use the by_headSha index for efficient filtering when headSha is provided
      filtered = await ctx.db
        .query("githubCheckRuns")
        .withIndex("by_headSha", (q) => q.eq("headSha", headSha))
        .order("desc")
        .collect();
      // Filter to ensure it's for the right team/repo
      filtered = filtered.filter(
        (run) => run.teamId === teamId && run.repoFullName === repoFullName
      );
    } else {
      // Use the by_team_repo_pr index for filtering by PR number
      filtered = await ctx.db
        .query("githubCheckRuns")
        .withIndex("by_team_repo_pr", (q) =>
          q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("triggeringPrNumber", prNumber)
        )
        .order("desc")
        .collect();
    }

    // Deduplicate by name (for same app), keeping the most recently updated one
    const dedupMap = new Map<string, typeof filtered[number]>();
    for (const run of filtered) {
      const key = `${run.appSlug || run.appName || 'unknown'}-${run.name}`;
      const existing = dedupMap.get(key);
      if (!existing || (run.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        dedupMap.set(key, run);
      }
    }

    const runs = Array.from(dedupMap.values())
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
      .slice(0, limit);


    return runs;
  },
});
