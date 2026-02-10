import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authQuery } from "./users/utils";

/**
 * Bucket an array of timestamps into 7 daily counts.
 * Returns an array of length 7 where index 0 = 6 days ago, index 6 = today.
 */
function bucketByDay(timestamps: number[]): number[] {
  const days = new Array<number>(7).fill(0);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();

  for (const ts of timestamps) {
    const dayIndex = Math.floor((startOfToday - ts) / (24 * 60 * 60 * 1000));
    // dayIndex 0 = today, 1 = yesterday, ... 6 = 6 days ago
    // We want array index 0 = oldest, 6 = today
    if (dayIndex >= 0 && dayIndex < 7) {
      days[6 - dayIndex] += 1;
    }
  }
  return days;
}

export const getDashboardStats = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Fetch tasks for this user/team
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_team_user", (idx) =>
        idx.eq("teamId", teamId).eq("userId", userId),
      )
      .collect();

    // Tasks created in the past 7 days (exclude workspaces and previews)
    const recentTasks = allTasks.filter(
      (t) =>
        (t.createdAt ?? t._creationTime) >= sevenDaysAgo &&
        !t.isCloudWorkspace &&
        !t.isLocalWorkspace &&
        !t.isPreview,
    );

    // Tasks merged in the past 7 days
    const mergedTasks = allTasks.filter(
      (t) =>
        t.mergeStatus === "pr_merged" &&
        (t.updatedAt ?? t._creationTime) >= sevenDaysAgo,
    );

    // Fetch task runs for this user/team
    const allRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_team_user", (idx) =>
        idx.eq("teamId", teamId).eq("userId", userId),
      )
      .collect();

    // Completed runs in the past 7 days
    const completedRuns = allRuns.filter(
      (r) =>
        r.status === "completed" &&
        (r.completedAt ?? r.updatedAt) >= sevenDaysAgo,
    );

    return {
      tasksStarted: {
        total: recentTasks.length,
        daily: bucketByDay(
          recentTasks.map((t) => t.createdAt ?? t._creationTime),
        ),
      },
      tasksMerged: {
        total: mergedTasks.length,
        daily: bucketByDay(
          mergedTasks.map((t) => t.updatedAt ?? t._creationTime),
        ),
      },
      runsCompleted: {
        total: completedRuns.length,
        daily: bucketByDay(
          completedRuns.map((r) => r.completedAt ?? r.updatedAt),
        ),
      },
    };
  },
});
