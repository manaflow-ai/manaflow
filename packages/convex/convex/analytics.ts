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

    // Fetch tasks created in the past 7 days (filter by date at index level)
    const recentTasksRaw = await ctx.db
      .query("tasks")
      .withIndex("by_team_user_created", (idx) =>
        idx
          .eq("teamId", teamId)
          .eq("userId", userId)
          .gte("createdAt", sevenDaysAgo),
      )
      .collect();

    // Exclude workspaces and previews in memory
    const recentTasks = recentTasksRaw.filter(
      (t) => !t.isCloudWorkspace && !t.isLocalWorkspace && !t.isPreview,
    );

    // Fetch only merged tasks updated in the past 7 days
    const mergedTasks = await ctx.db
      .query("tasks")
      .withIndex("by_team_user_merge_updated", (idx) =>
        idx
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("mergeStatus", "pr_merged")
          .gte("updatedAt", sevenDaysAgo),
      )
      .collect();

    // Fetch only completed task runs created in the past 7 days
    const completedRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_team_user_status_created", (idx) =>
        idx
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("status", "completed")
          .gte("createdAt", sevenDaysAgo),
      )
      .collect();

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
