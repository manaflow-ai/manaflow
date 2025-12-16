import { v } from "convex/values";
import type { PullRequestEvent } from "@octokit/webhooks-types";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/**
 * Find taskRuns associated with a PR using indexed queries.
 * Queries both the legacy pullRequestUrl field and the junction table.
 */
async function findTaskRunsByPullRequest(
  ctx: QueryCtx,
  teamId: string,
  repoFullName: string,
  prNumber: number,
  prUrl: string,
): Promise<Doc<"taskRuns">[]> {
  // Query the junction table by PR identity (most reliable for new data)
  const junctionEntries = await ctx.db
    .query("taskRunPullRequests")
    .withIndex("by_pr", (q) =>
      q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("prNumber", prNumber)
    )
    .collect();

  const junctionMatches: Doc<"taskRuns">[] = [];
  for (const entry of junctionEntries) {
    const taskRun = await ctx.db.get(entry.taskRunId);
    if (taskRun) {
      junctionMatches.push(taskRun);
    }
  }

  // Also query the legacy pullRequestUrl field for old data not yet in junction table
  const legacyMatches = await ctx.db
    .query("taskRuns")
    .withIndex("by_pull_request_url", (q) => q.eq("pullRequestUrl", prUrl))
    .collect();

  // Filter legacy matches to this team
  const teamLegacyMatches = legacyMatches.filter(run => run.teamId === teamId);

  // Combine and deduplicate
  const allMatches = [...junctionMatches, ...teamLegacyMatches];
  return Array.from(
    new Map(allMatches.map(run => [run._id, run])).values()
  );
}

/**
 * Update the task's merge status when a PR is merged or closed.
 */
async function updateTaskMergeStatus(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  isMerged: boolean,
  isClosed: boolean,
): Promise<void> {
  const task = await ctx.db.get(taskId);
  if (!task) {
    console.warn("[PR merge handler] Task not found", { taskId });
    return;
  }

  // Only update if the PR was merged (not just closed)
  if (isMerged) {
    await ctx.db.patch(taskId, {
      mergeStatus: "pr_merged",
      updatedAt: Date.now(),
    });
    console.log("[PR merge handler] Updated task merge status to pr_merged", {
      taskId,
      taskDescription: task.description
    });
  } else if (isClosed && task.mergeStatus !== "pr_merged") {
    // Only update to closed if it's not already merged
    await ctx.db.patch(taskId, {
      mergeStatus: "pr_closed",
      updatedAt: Date.now(),
    });
    console.log("[PR merge handler] Updated task merge status to pr_closed", {
      taskId,
      taskDescription: task.description
    });
  }
}

/**
 * Handle PR merge/close events from GitHub webhook.
 * This updates the corresponding task's mergeStatus when a PR is merged.
 */
export const handlePullRequestMergeEvent = internalMutation({
  args: {
    teamId: v.string(),
    repoFullName: v.string(),
    prNumber: v.number(),
    prUrl: v.string(),
    isMerged: v.boolean(),
    isClosed: v.boolean(),
    action: v.string(),
  },
  handler: async (ctx, args) => {
    const { teamId, repoFullName, prNumber, prUrl, isMerged, isClosed, action } = args;

    console.log("[PR merge handler] Processing PR event", {
      teamId,
      repoFullName,
      prNumber,
      prUrl,
      isMerged,
      isClosed,
      action,
    });

    // Find all taskRuns that reference this PR
    const taskRuns = await findTaskRunsByPullRequest(ctx, teamId, repoFullName, prNumber, prUrl);

    if (taskRuns.length === 0) {
      console.log("[PR merge handler] No taskRuns found for PR", {
        prUrl,
        teamId
      });
      return { processed: 0 };
    }

    console.log("[PR merge handler] Found taskRuns for PR", {
      prUrl,
      count: taskRuns.length,
      taskRunIds: taskRuns.map(run => run._id),
    });

    let processedCount = 0;

    for (const taskRun of taskRuns) {
      try {
        // Update the taskRun's PR state
        const updates: Partial<Doc<"taskRuns">> = {
          pullRequestState: isMerged ? "merged" : (isClosed ? "closed" : taskRun.pullRequestState),
          updatedAt: Date.now(),
        };

        // If the taskRun has multiple PRs, update the specific one
        if (taskRun.pullRequests && taskRun.pullRequests.length > 0) {
          const updatedPRs = taskRun.pullRequests.map(pr => {
            if (pr.url === prUrl ||
                (pr.repoFullName === repoFullName && pr.number === prNumber)) {
              return {
                ...pr,
                state: isMerged ? "merged" as const : (isClosed ? "closed" as const : pr.state),
              };
            }
            return pr;
          });
          updates.pullRequests = updatedPRs;

          // Check if all PRs are merged (for multi-PR scenarios)
          const allMerged = updatedPRs.every(pr => pr.state === "merged");
          const anyOpen = updatedPRs.some(pr => pr.state === "open" || pr.state === "draft");

          if (allMerged) {
            updates.pullRequestState = "merged";
          } else if (anyOpen) {
            updates.pullRequestState = "open";
          } else if (updatedPRs.every(pr => pr.state === "closed")) {
            updates.pullRequestState = "closed";
          }
        }

        await ctx.db.patch(taskRun._id, updates);

        // Update the corresponding task's merge status
        if (taskRun.taskId) {
          await updateTaskMergeStatus(ctx, taskRun.taskId, isMerged, isClosed);
        }

        processedCount++;
        console.log("[PR merge handler] Updated taskRun", {
          taskRunId: taskRun._id,
          taskId: taskRun.taskId,
          newState: updates.pullRequestState,
        });
      } catch (error) {
        console.error("[PR merge handler] Error updating taskRun", {
          taskRunId: taskRun._id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { processed: processedCount };
  },
});

/**
 * Process a PR webhook payload to extract merge/close information.
 * This is called from the main webhook handler.
 */
export const processPullRequestWebhook = internalMutation({
  args: {
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const { teamId, payload } = args;

    try {
      const prEvent = payload as PullRequestEvent;
      const pr = prEvent.pull_request;

      if (!pr) {
        console.warn("[PR merge handler] No pull_request in payload");
        return { processed: false };
      }

      const action = prEvent.action;
      const repoFullName = prEvent.repository?.full_name || "";
      const prNumber = pr.number;
      const prUrl = pr.html_url || "";
      const isMerged = Boolean(pr.merged);
      const isClosed = pr.state === "closed";

      // We're interested in closed and merged events
      if (action === "closed" || (action === "edited" && isMerged)) {
        await ctx.scheduler.runAfter(0, internal.github_pr_merge_handler.handlePullRequestMergeEvent, {
          teamId,
          repoFullName,
          prNumber,
          prUrl,
          isMerged,
          isClosed,
          action,
        });

        return { processed: true, isMerged, isClosed };
      }

      return { processed: false };
    } catch (error) {
      console.error("[PR merge handler] Error processing webhook", {
        error: error instanceof Error ? error.message : String(error),
        teamId,
      });
      return { processed: false, error: String(error) };
    }
  },
});