import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { getTeamId, resolveTeamIdLoose } from "../_shared/team";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { authMutation, authQuery, taskIdWithFake } from "./users/utils";

/**
 * Project task document to lightweight list item.
 * Omits large fields: description, pullRequestDescription, crownEvaluationRetryData, images
 * Saves ~5-10 KB per document in bandwidth.
 */
function projectTaskForList(task: Doc<"tasks">) {
  return {
    _id: task._id,
    _creationTime: task._creationTime,
    text: task.text,
    isCompleted: task.isCompleted,
    isArchived: task.isArchived,
    pinned: task.pinned,
    isPreview: task.isPreview,
    isLocalWorkspace: task.isLocalWorkspace,
    isCloudWorkspace: task.isCloudWorkspace,
    linkedFromCloudTaskRunId: task.linkedFromCloudTaskRunId,
    projectFullName: task.projectFullName,
    baseBranch: task.baseBranch,
    worktreePath: task.worktreePath,
    generatedBranchName: task.generatedBranchName,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastActivityAt: task.lastActivityAt,
    userId: task.userId,
    teamId: task.teamId,
    environmentId: task.environmentId,
    crownEvaluationStatus: task.crownEvaluationStatus,
    crownEvaluationError: task.crownEvaluationError,
    mergeStatus: task.mergeStatus,
    screenshotStatus: task.screenshotStatus,
    selectedTaskRunId: task.selectedTaskRunId,
    // Omit large fields:
    // - description
    // - pullRequestTitle (kept for display)
    // - pullRequestDescription
    // - crownEvaluationRetryData
    // - images
    // - screenshot* fields (except status)
    pullRequestTitle: task.pullRequestTitle,
  };
}

/**
 * Project taskRun document to lightweight list item.
 * Omits large fields: prompt, log, claims, vscode, networking
 * Saves ~10-20 KB per document in bandwidth.
 */
function projectTaskRunForList(run: Doc<"taskRuns"> | null | undefined) {
  if (!run) return null;
  return {
    _id: run._id,
    _creationTime: run._creationTime,
    taskId: run.taskId,
    parentRunId: run.parentRunId,
    agentName: run.agentName,
    summary: run.summary, // Keep for display in UI
    status: run.status,
    isArchived: run.isArchived,
    isLocalWorkspace: run.isLocalWorkspace,
    isCloudWorkspace: run.isCloudWorkspace,
    newBranch: run.newBranch,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
    exitCode: run.exitCode,
    errorMessage: run.errorMessage,
    userId: run.userId,
    teamId: run.teamId,
    environmentId: run.environmentId,
    isCrowned: run.isCrowned,
    crownReason: run.crownReason,
    pullRequestUrl: run.pullRequestUrl,
    pullRequestIsDraft: run.pullRequestIsDraft,
    pullRequestState: run.pullRequestState,
    pullRequestNumber: run.pullRequestNumber,
    pullRequests: run.pullRequests,
    // Omit large fields:
    // - prompt
    // - log
    // - claims
    // - vscode (large nested object)
    // - networking
    // - customPreviews
    // - worktreePath
    // - environmentError
  };
}

export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    excludeLocalWorkspaces: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Use efficient indexes based on archived status
    // by_team_user_active: for non-archived, non-preview tasks (most common case)
    // by_team_user_archived: for archived tasks
    let q;
    if (args.archived === true) {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_archived", (idx) =>
          idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
        )
        .filter((qq) => qq.neq(qq.field("isPreview"), true));
    } else {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_active", (idx) =>
          idx
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("isArchived", false)
            .eq("isPreview", false),
        );
    }

    const tasks = await q
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined))
      .filter((qq) =>
        args.excludeLocalWorkspaces
          ? qq.neq(qq.field("isLocalWorkspace"), true)
          : true,
      )
      .filter((qq) =>
        args.projectFullName
          ? qq.eq(qq.field("projectFullName"), args.projectFullName)
          : true,
      )
      .collect();

    // Get unread task runs for this user in this team
    // Uses taskId directly (denormalized) for O(1) lookup instead of O(N) fetches
    // Limit to 1000 to avoid large scans (users rarely have 1000+ unread)
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
      .take(1000);

    // Build set of taskIds that have unread runs (direct access, no joins needed)
    // Filter out undefined taskIds (pre-migration data)
    const tasksWithUnread = new Set(
      unreadRuns.map((ur) => ur.taskId).filter((id): id is Id<"tasks"> => id !== undefined)
    );

    // Sort by createdAt desc
    const sorted = [...tasks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

    // Return projected tasks with hasUnread indicator (saves ~5-10 KB per doc)
    return sorted.map((task) => ({
      ...projectTaskForList(task),
      hasUnread: tasksWithUnread.has(task._id),
    }));
  },
});

// Lightweight query to check if user has any real tasks (for onboarding)
// Returns early after finding first match - uses by_team_user_active index for efficiency
export const hasRealTasks = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Check active tasks using the efficient by_team_user_active index
    // Only scans tasks where isArchived=false AND isPreview=false
    const activeTask = await ctx.db
      .query("tasks")
      .withIndex("by_team_user_active", (idx) =>
        idx
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("isArchived", false)
          .eq("isPreview", false),
      )
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined))
      // Exclude workspaces - we want "real" tasks
      .filter((qq) => qq.neq(qq.field("isCloudWorkspace"), true))
      .filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true))
      .first();

    if (activeTask) {
      return { hasRealTasks: true, hasCompletedRealTasks: activeTask.isCompleted === true };
    }

    // Check archived tasks using by_team_user_archived index
    const archivedTask = await ctx.db
      .query("tasks")
      .withIndex("by_team_user_archived", (idx) =>
        idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
      )
      .filter((qq) => qq.neq(qq.field("isPreview"), true))
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined))
      .filter((qq) => qq.neq(qq.field("isCloudWorkspace"), true))
      .filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true))
      .first();

    if (archivedTask) {
      return { hasRealTasks: true, hasCompletedRealTasks: archivedTask.isCompleted === true };
    }

    return { hasRealTasks: false, hasCompletedRealTasks: false };
  },
});

// Paginated query for archived tasks (infinite scroll)
export const getArchivedPaginated = authQuery({
  args: {
    teamSlugOrId: v.string(),
    paginationOpts: paginationOptsValidator,
    excludeLocalWorkspaces: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Query archived tasks with pagination using the by_team_user_archived index
    let q = ctx.db
      .query("tasks")
      .withIndex("by_team_user_archived", (idx) =>
        idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
      )
      .filter((qq) => qq.neq(qq.field("isPreview"), true))
      // Exclude linked local workspaces (they're shown under their parent cloud run)
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined));

    // Exclude local workspaces when in web mode
    if (args.excludeLocalWorkspaces) {
      q = q.filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true));
    }

    const paginatedResult = await q.order("desc").paginate(args.paginationOpts);

    // Get unread task runs for this user in this team
    // Limit to 1000 to avoid large scans (users rarely have 1000+ unread)
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .take(1000);

    // Build set of taskIds that have unread runs
    const tasksWithUnread = new Set(
      unreadRuns
        .map((ur) => ur.taskId)
        .filter((id): id is Id<"tasks"> => id !== undefined),
    );

    // Return paginated projected tasks with hasUnread indicator (saves ~5-10 KB per doc)
    return {
      ...paginatedResult,
      page: paginatedResult.page.map((task) => ({
        ...projectTaskForList(task),
        hasUnread: tasksWithUnread.has(task._id),
      })),
    };
  },
});

// Get tasks sorted by most recent activity (iMessage-style):
// - Sorted by lastActivityAt desc (most recently active first)
// - lastActivityAt is updated when a run is started OR notification is received
// - Includes hasUnread for visual indicator (blue dot)
export const getWithNotificationOrder = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    excludeLocalWorkspaces: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Use efficient indexes based on archived status
    let q;
    if (args.archived === true) {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_archived", (idx) =>
          idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
        )
        .filter((qq) => qq.neq(qq.field("isPreview"), true));
    } else {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_active", (idx) =>
          idx
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("isArchived", false)
            .eq("isPreview", false),
        );
    }

    const tasks = await q
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined))
      .filter((qq) =>
        args.excludeLocalWorkspaces
          ? qq.neq(qq.field("isLocalWorkspace"), true)
          : true,
      )
      .filter((qq) =>
        args.projectFullName
          ? qq.eq(qq.field("projectFullName"), args.projectFullName)
          : true,
      )
      .collect();

    // Get unread task runs for this user in this team
    // Uses taskId directly (denormalized) for O(1) lookup instead of O(N) fetches
    // Limit to 1000 to avoid large scans (users rarely have 1000+ unread)
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
      .take(1000);

    // Build set of taskIds that have unread runs (direct access, no joins needed)
    // Filter out undefined taskIds (pre-migration data)
    const tasksWithUnread = new Set(
      unreadRuns.map((ur) => ur.taskId).filter((id): id is Id<"tasks"> => id !== undefined)
    );

    // Sort by lastActivityAt desc (most recently active first)
    // Fall back to createdAt for tasks without lastActivityAt (pre-migration)
    const sorted = [...tasks].sort((a, b) => {
      const aTime = a.lastActivityAt ?? a.createdAt ?? 0;
      const bTime = b.lastActivityAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    });

    // Return projected tasks with hasUnread indicator (saves ~5-10 KB per doc)
    return sorted.map((task) => ({
      ...projectTaskForList(task),
      hasUnread: tasksWithUnread.has(task._id),
    }));
  },
});

// Paginated version of get() for infinite scroll
export const getPaginated = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    excludeLocalWorkspaces: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Use efficient indexes based on archived status
    // by_team_user_active includes lastActivityAt for sorting
    let q;
    if (args.archived === true) {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_archived", (idx) =>
          idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
        )
        .filter((qq) => qq.neq(qq.field("isPreview"), true));
    } else {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_active", (idx) =>
          idx
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("isArchived", false)
            .eq("isPreview", false),
        );
    }

    q = q.filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined));

    if (args.excludeLocalWorkspaces) {
      q = q.filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true));
    }

    if (args.projectFullName) {
      q = q.filter((qq) =>
        qq.eq(qq.field("projectFullName"), args.projectFullName),
      );
    }

    // Server-side sort by lastActivityAt desc (via index)
    const paginatedResult = await q.order("desc").paginate(args.paginationOpts);

    // Limit unread fetch to avoid large scans
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .take(1000);

    const tasksWithUnread = new Set(
      unreadRuns
        .map((ur) => ur.taskId)
        .filter((id): id is Id<"tasks"> => id !== undefined),
    );

    return {
      ...paginatedResult,
      page: paginatedResult.page.map((task) => ({
        ...projectTaskForList(task),
        hasUnread: tasksWithUnread.has(task._id),
      })),
    };
  },
});

// Paginated version of getWithNotificationOrder() for infinite scroll
// Uses by_team_user_active index for efficient server-side sorting by lastActivityAt
export const getWithNotificationOrderPaginated = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    excludeLocalWorkspaces: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Use efficient indexes based on archived status
    // by_team_user_active includes lastActivityAt for sorting
    let q;
    if (args.archived === true) {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_archived", (idx) =>
          idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
        )
        .filter((qq) => qq.neq(qq.field("isPreview"), true));
    } else {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_active", (idx) =>
          idx
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("isArchived", false)
            .eq("isPreview", false),
        );
    }

    q = q.filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined));

    if (args.excludeLocalWorkspaces) {
      q = q.filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true));
    }

    if (args.projectFullName) {
      q = q.filter((qq) =>
        qq.eq(qq.field("projectFullName"), args.projectFullName),
      );
    }

    // Server-side sort by lastActivityAt desc (via index)
    const paginatedResult = await q.order("desc").paginate(args.paginationOpts);

    // Limit unread fetch to avoid large scans
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .take(1000);

    const tasksWithUnread = new Set(
      unreadRuns
        .map((ur) => ur.taskId)
        .filter((id): id is Id<"tasks"> => id !== undefined),
    );

    return {
      ...paginatedResult,
      page: paginatedResult.page.map((task) => ({
        ...projectTaskForList(task),
        hasUnread: tasksWithUnread.has(task._id),
      })),
    };
  },
});

export const getPreviewTasks = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const take = Math.max(1, Math.min(args.limit ?? 50, 100));

    // Get preview tasks using the dedicated index (team-wide, not user-specific)
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_team_preview", (idx) =>
        idx.eq("teamId", teamId).eq("isPreview", true),
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Sort: in-progress (not completed) first, then by createdAt desc
    const sorted = tasks.sort((a, b) => {
      // In-progress first
      const aInProgress = !a.isCompleted;
      const bInProgress = !b.isCompleted;
      if (aInProgress && !bInProgress) return -1;
      if (!aInProgress && bInProgress) return 1;
      // Then by createdAt desc
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });

    return sorted.slice(0, take);
  },
});

export const getPinned = authQuery({
  args: {
    teamSlugOrId: v.string(),
    excludeLocalWorkspaces: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Get pinned tasks (excluding archived and preview tasks)
    let q = ctx.db
      .query("tasks")
      .withIndex("by_pinned", (idx) =>
        idx.eq("pinned", true).eq("teamId", teamId).eq("userId", userId),
      )
      .filter((qq) => qq.neq(qq.field("isArchived"), true))
      .filter((qq) => qq.neq(qq.field("isPreview"), true));

    // Exclude local workspaces when in web mode
    if (args.excludeLocalWorkspaces) {
      q = q.filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true));
    }

    const pinnedTasks = await q.collect();

    // Get unread task runs for this user in this team
    // Uses taskId directly (denormalized) for O(1) lookup instead of O(N) fetches
    const unreadRuns = await ctx.db
      .query("unreadTaskRuns")
      .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
      .collect();

    // Build set of taskIds that have unread runs (direct access, no joins needed)
    // Filter out undefined taskIds (pre-migration data)
    const tasksWithUnread = new Set(
      unreadRuns.map((ur) => ur.taskId).filter((id): id is Id<"tasks"> => id !== undefined)
    );

    const sorted = pinnedTasks.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

    return sorted.map((task) => ({
      ...projectTaskForList(task),
      hasUnread: tasksWithUnread.has(task._id),
    }));
  },
});

export const getTasksWithTaskRuns = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Use efficient indexes based on archived status
    let q;
    if (args.archived === true) {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_archived", (idx) =>
          idx.eq("teamId", teamId).eq("userId", userId).eq("isArchived", true),
        )
        .filter((qq) => qq.neq(qq.field("isPreview"), true));
    } else {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_active", (idx) =>
          idx
            .eq("teamId", teamId)
            .eq("userId", userId)
            .eq("isArchived", false)
            .eq("isPreview", false),
        );
    }

    const tasks = await q
      .filter((qq) =>
        args.projectFullName
          ? qq.eq(qq.field("projectFullName"), args.projectFullName)
          : true,
      )
      .collect();

    // Collect unique selectedTaskRunIds (filter out undefined)
    const runIds = tasks
      .map((t) => t.selectedTaskRunId)
      .filter((id): id is Id<"taskRuns"> => id !== undefined);

    // Batch fetch all selected runs using direct ID lookups (much cheaper than indexed queries)
    const runs = await Promise.all(runIds.map((id) => ctx.db.get(id)));
    const runMap = new Map(
      runs
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => [r._id, r]),
    );

    // Sort by createdAt desc
    const sortedTasks = tasks.sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
    );

    // Map projected tasks with their projected selected runs (saves ~10-20 KB per doc)
    return sortedTasks.map((task) => ({
      ...projectTaskForList(task),
      selectedTaskRun: projectTaskRunForList(
        task.selectedTaskRunId ? runMap.get(task.selectedTaskRunId) : null
      ),
    }));
  },
});

/**
 * Lightweight version of getTasksWithTaskRuns for CommandBar.
 * Uses by_team_user_active index for tasks with explicit isArchived/isPreview=false values.
 * After data migration, this will efficiently fetch only ~limit documents.
 *
 * Note: Pre-migration tasks with undefined isArchived/isPreview won't be included.
 * Run the normalizeBooleanFields migration to fix this.
 */
export const getTasksWithTaskRunsLimited = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
    excludeLocalWorkspaces: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

    // Use by_team_user_active compound index: [teamId, userId, isArchived, isPreview, lastActivityAt]
    // This efficiently fetches only active tasks without full table scan.
    // Requires tasks to have isArchived=false and isPreview=false explicitly set (not undefined).
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_team_user_active", (idx) =>
        idx
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("isArchived", false)
          .eq("isPreview", false),
      )
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined))
      .filter((qq) =>
        args.excludeLocalWorkspaces
          ? qq.neq(qq.field("isLocalWorkspace"), true)
          : true,
      )
      .order("desc")
      .take(limit);

    // Collect unique selectedTaskRunIds (filter out undefined)
    const runIds = tasks
      .map((t) => t.selectedTaskRunId)
      .filter((id): id is Id<"taskRuns"> => id !== undefined);

    // Batch fetch all selected runs
    const runs = await Promise.all(runIds.map((id) => ctx.db.get(id)));
    const runMap = new Map(
      runs
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => [r._id, r]),
    );

    // Map projected tasks with their projected selected runs
    return tasks.map((task) => ({
      ...projectTaskForList(task),
      selectedTaskRun: projectTaskRunForList(
        task.selectedTaskRunId ? runMap.get(task.selectedTaskRunId) : null
      ),
    }));
  },
});

export const create = authMutation({
  args: {
    teamSlugOrId: v.string(),
    text: v.string(),
    description: v.optional(v.string()),
    projectFullName: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    worktreePath: v.optional(v.string()),
    images: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          fileName: v.optional(v.string()),
          altText: v.string(),
        }),
      ),
    ),
    environmentId: v.optional(v.id("environments")),
    isCloudWorkspace: v.optional(v.boolean()),
    // GitHub Projects v2 linkage
    githubProjectId: v.optional(v.string()),
    githubProjectItemId: v.optional(v.string()),
    githubProjectInstallationId: v.optional(v.number()),
    githubProjectOwner: v.optional(v.string()),
    githubProjectOwnerType: v.optional(v.string()),
    // Optional: create task runs atomically with the task
    selectedAgents: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    if (args.environmentId) {
      const environment = await ctx.db.get(args.environmentId);
      if (!environment || environment.teamId !== teamId) {
        throw new Error("Environment not found");
      }
    }
    // Validate GitHub project linkage belongs to this team
    if (args.githubProjectInstallationId != null) {
      const connection = await ctx.db
        .query("providerConnections")
        .withIndex("by_installationId", (q) =>
          q.eq("installationId", args.githubProjectInstallationId as number),
        )
        .first();
      if (!connection || connection.teamId !== teamId) {
        throw new Error("GitHub installation not found or does not belong to team");
      }
    }
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      text: args.text,
      description: args.description,
      projectFullName: args.projectFullName,
      baseBranch: args.baseBranch,
      worktreePath: args.worktreePath,
      isCompleted: false,
      isArchived: false,
      isPreview: false,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      images: args.images,
      userId,
      teamId,
      environmentId: args.environmentId,
      isCloudWorkspace: args.isCloudWorkspace,
      githubProjectId: args.githubProjectId,
      githubProjectItemId: args.githubProjectItemId,
      githubProjectInstallationId: args.githubProjectInstallationId,
      githubProjectOwner: args.githubProjectOwner,
      githubProjectOwnerType: args.githubProjectOwnerType,
    });

    // If selectedAgents provided, create task runs atomically
    let taskRunIds: Id<"taskRuns">[] | undefined;
    if (args.selectedAgents && args.selectedAgents.length > 0) {
      taskRunIds = await Promise.all(
        args.selectedAgents.map(async (agentName) => {
          return ctx.db.insert("taskRuns", {
            taskId,
            prompt: args.text,
            agentName,
            status: "pending",
            createdAt: now,
            updatedAt: now,
            userId,
            teamId,
            environmentId: args.environmentId,
            isCloudWorkspace: args.isCloudWorkspace,
          });
        }),
      );
    }

    return { taskId, taskRunIds };
  },
});

export const remove = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const doc = await ctx.db.get(args.id);
    if (!doc || doc.teamId !== teamId || doc.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.delete(args.id);
  },
});

export const toggle = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(args.id, { isCompleted: !task.isCompleted });
  },
});

export const setCompleted = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    isCompleted: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found");
    }
    await ctx.db.patch(args.id, {
      isCompleted: args.isCompleted,
      updatedAt: Date.now(),
    });
  },
});

export const update = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks"), text: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(args.id, { text: args.text, updatedAt: Date.now() });
  },
});

export const updateWorktreePath = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    worktreePath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(args.id, {
      worktreePath: args.worktreePath,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Set projectFullName and baseBranch on a task.
 * Called during sandbox startup to populate GitHub info for crown evaluation refresh.
 * Only updates fields if provided AND task doesn't already have them.
 */
export const setProjectAndBranch = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    projectFullName: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }

    // Only update if values are provided and task doesn't already have them
    const patch: Record<string, unknown> = {};
    if (args.projectFullName && !task.projectFullName) {
      patch.projectFullName = args.projectFullName;
    }
    if (args.baseBranch && !task.baseBranch) {
      patch.baseBranch = args.baseBranch;
    }

    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(args.id, patch);
    }
  },
});

export const getById = authQuery({
  args: { teamSlugOrId: v.string(), id: taskIdWithFake },
  handler: async (ctx, args) => {
    // Handle fake IDs by returning null
    if (typeof args.id === "string" && args.id.startsWith("fake-")) {
      return null;
    }

    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id as Id<"tasks">);
    if (!task || task.teamId !== teamId) return null;

    if (task.images && task.images.length > 0) {
      const imagesWithUrls = await Promise.all(
        task.images.map(async (image) => {
          const url = await ctx.storage.getUrl(image.storageId);
          return {
            ...image,
            url,
          };
        }),
      );
      return {
        ...task,
        images: imagesWithUrls,
      };
    }

    return task;
  },
});

export const getVersions = authQuery({
  args: { teamSlugOrId: v.string(), taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("taskVersions")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .collect();
  },
});

export const archive = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    const now = Date.now();
    await ctx.db.patch(args.id, { isArchived: true, updatedAt: now });

    // Also archive all task runs for this task
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();
    await Promise.all(
      taskRuns.map((run) =>
        ctx.db.patch(run._id, { isArchived: true, updatedAt: now })
      )
    );
  },
});

export const unarchive = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    const now = Date.now();
    await ctx.db.patch(args.id, { isArchived: false, updatedAt: now });

    // Also unarchive all task runs for this task
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .filter((q) => q.eq(q.field("isArchived"), true))
      .collect();
    await Promise.all(
      taskRuns.map((run) =>
        ctx.db.patch(run._id, { isArchived: false, updatedAt: now })
      )
    );
  },
});

export const pin = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(args.id, { pinned: true, updatedAt: Date.now() });
  },
});

export const unpin = authMutation({
  args: { teamSlugOrId: v.string(), id: v.id("tasks") },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(args.id, { pinned: false, updatedAt: Date.now() });
  },
});

export const updateCrownError = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    crownEvaluationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("in_progress"),
        v.literal("succeeded"),
        v.literal("error"),
      ),
    ),
    crownEvaluationError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const { id, teamSlugOrId, ...updates } = args;
    const teamId = await resolveTeamIdLoose(ctx, teamSlugOrId);
    const task = await ctx.db.get(id);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const setCrownEvaluationStatusInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("succeeded"),
      v.literal("error"),
    ),
    errorMessage: v.optional(v.string()),
    clearError: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== args.teamId || task.userId !== args.userId) {
      throw new Error("Task not found or unauthorized");
    }

    const patch: Record<string, unknown> = {
      crownEvaluationStatus: args.status,
      updatedAt: Date.now(),
    };

    if (args.clearError) {
      patch.crownEvaluationError = undefined;
    } else if (Object.prototype.hasOwnProperty.call(args, "errorMessage")) {
      patch.crownEvaluationError = args.errorMessage;
    }

    await ctx.db.patch(args.taskId, patch);
  },
});

/**
 * Clear crown evaluation retry data after successful retry
 */
export const clearCrownRetryData = internalMutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      crownEvaluationRetryData: undefined,
      crownEvaluationRetryCount: undefined,
      crownEvaluationLastRetryAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Set crown evaluation retry data (used to re-run evaluation + summarization).
 * Intended to be called by worker-facing httpActions before finalization so we
 * have enough context to retry (especially for single-run scenarios).
 */
export const setCrownRetryDataInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
    retryData: v.string(),
    overwrite: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== args.teamId || task.userId !== args.userId) {
      throw new Error("Task not found or unauthorized");
    }

    if (task.crownEvaluationRetryData && !args.overwrite) {
      return false;
    }

    await ctx.db.patch(args.taskId, {
      crownEvaluationRetryData: args.retryData,
      updatedAt: Date.now(),
    });
    return true;
  },
});

// Try to atomically begin a crown evaluation; returns true if we acquired the lock
export const tryBeginCrownEvaluation = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    if (task.crownEvaluationStatus === "in_progress") {
      return false;
    }
    await ctx.db.patch(args.id, {
      crownEvaluationStatus: "in_progress",
      crownEvaluationError: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

// Set or update the generated pull request description for a task
export const setPullRequestDescription = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    pullRequestDescription: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const { id, teamSlugOrId, pullRequestDescription } = args;
    const teamId = await resolveTeamIdLoose(ctx, teamSlugOrId);
    const task = await ctx.db.get(id);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(id, {
      pullRequestDescription,
      updatedAt: Date.now(),
    });
  },
});

// Set or update the generated pull request title for a task
export const setPullRequestTitle = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    pullRequestTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const { id, teamSlugOrId, pullRequestTitle } = args;
    const teamId = await resolveTeamIdLoose(ctx, teamSlugOrId);
    const task = await ctx.db.get(id);
    if (!task || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found or unauthorized");
    }
    await ctx.db.patch(id, {
      pullRequestTitle,
      updatedAt: Date.now(),
    });
  },
});

export const createVersion = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
    diff: v.string(),
    summary: v.string(),
    files: v.array(
      v.object({
        path: v.string(),
        changes: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const existingVersions = await ctx.db
      .query("taskVersions")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    const version = existingVersions.length + 1;

    const versionId = await ctx.db.insert("taskVersions", {
      taskId: args.taskId,
      version,
      diff: args.diff,
      summary: args.summary,
      files: args.files,
      createdAt: Date.now(),
      userId,
      teamId,
    });

    await ctx.db.patch(args.taskId, { updatedAt: Date.now() });

    return versionId;
  },
});

// Check if all runs for a task are completed and trigger crown evaluation
export const getTasksWithPendingCrownEvaluation = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    // Only get tasks that are pending, not already in progress
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId),
      )
      .filter((q) => q.eq(q.field("crownEvaluationStatus"), "pending"))
      .collect();

    // Double-check that no evaluation exists for these tasks
    // Batch fetch all evaluations for the user/team, then filter in memory (avoids N+1 queries)
    const taskIds = tasks.map((task) => task._id);
    if (taskIds.length === 0) {
      return [];
    }

    // Fetch evaluations in parallel using Promise.all
    const evaluationChecks = await Promise.all(
      taskIds.map((taskId) =>
        ctx.db
          .query("crownEvaluations")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .filter((q) => q.eq(q.field("teamId"), teamId))
          .filter((q) => q.eq(q.field("userId"), userId))
          .first()
      )
    );

    // Filter tasks that don't have an existing evaluation
    const tasksToEvaluate = tasks.filter(
      (_, index) => evaluationChecks[index] === null
    );

    return tasksToEvaluate;
  },
});

export const updateMergeStatus = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("tasks"),
    mergeStatus: v.union(
      v.literal("none"),
      v.literal("pr_draft"),
      v.literal("pr_open"),
      v.literal("pr_approved"),
      v.literal("pr_changes_requested"),
      v.literal("pr_merged"),
      v.literal("pr_closed"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const task = await ctx.db.get(args.id);
    if (task === null || task.teamId !== teamId || task.userId !== userId) {
      throw new Error("Task not found");
    }
    await ctx.db.patch(args.id, {
      mergeStatus: args.mergeStatus,
      updatedAt: Date.now(),
    });
  },
});

export const recordScreenshotResult = internalMutation({
  args: {
    taskId: v.id("tasks"),
    runId: v.id("taskRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    /** Required for completed status, optional for failed/skipped */
    commitSha: v.optional(v.string()),
    hasUiChanges: v.optional(v.boolean()),
    screenshots: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          mimeType: v.string(),
          fileName: v.optional(v.string()),
          commitSha: v.string(),
          description: v.optional(v.string()),
        }),
      ),
    ),
    videos: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          mimeType: v.string(),
          fileName: v.optional(v.string()),
          description: v.optional(v.string()),
        }),
      ),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    const run = await ctx.db.get(args.runId);
    if (!run || run.taskId !== args.taskId) {
      throw new Error("Task run not found for task");
    }

    const now = Date.now();
    const screenshots = args.screenshots ?? [];
    const videos = args.videos ?? [];

    const screenshotSetId = await ctx.db.insert("taskRunScreenshotSets", {
      taskId: args.taskId,
      runId: args.runId,
      status: args.status,
      hasUiChanges: args.hasUiChanges ?? undefined,
      commitSha: args.commitSha,
      capturedAt: now,
      error: args.error ?? undefined,
      images: screenshots.map((screenshot) => ({
        storageId: screenshot.storageId,
        mimeType: screenshot.mimeType,
        fileName: screenshot.fileName,
        description: screenshot.description,
      })),
      videos: videos.length > 0 ? videos.map((video) => ({
        storageId: video.storageId,
        mimeType: video.mimeType,
        fileName: video.fileName,
        description: video.description,
      })) : undefined,
      createdAt: now,
      updatedAt: now,
    });

    const hasMedia = screenshots.length > 0 || videos.length > 0;

    const patch: Record<string, unknown> = {
      screenshotStatus: args.status,
      screenshotRunId: args.runId,
      screenshotRequestedAt: now,
      updatedAt: now,
      latestScreenshotSetId:
        args.status === "completed" && hasMedia
          ? screenshotSetId
          : undefined,
    };

    if (args.status === "completed" && screenshots.length > 0) {
      // Use first screenshot for primary thumbnail
      patch.screenshotStorageId = screenshots[0].storageId;
      patch.screenshotMimeType = screenshots[0].mimeType;
      patch.screenshotFileName = screenshots[0].fileName;
      patch.screenshotCommitSha = screenshots[0].commitSha;
      patch.screenshotCompletedAt = now;
      patch.screenshotError = undefined;
    } else if (args.status === "completed" && videos.length > 0) {
      // No screenshot thumbnail available, but still mark as completed
      patch.screenshotStorageId = undefined;
      patch.screenshotMimeType = undefined;
      patch.screenshotFileName = undefined;
      patch.screenshotCommitSha = undefined;
      patch.screenshotCompletedAt = now;
      patch.screenshotError = undefined;
    } else {
      patch.screenshotStorageId = undefined;
      patch.screenshotMimeType = undefined;
      patch.screenshotFileName = undefined;
      patch.screenshotCommitSha = undefined;
      patch.screenshotCompletedAt = undefined;
      patch.screenshotError = args.error ?? undefined;
    }

    if (args.status === "failed" || args.status === "skipped") {
      patch.screenshotError = args.error ?? patch.screenshotError;
    }

    await ctx.db.patch(args.taskId, patch);

    return screenshotSetId;
  },
});

export const checkAndEvaluateCrown = authMutation({
  args: {
    teamSlugOrId: v.string(),
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args): Promise<Id<"taskRuns"> | "pending" | null> => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    // Get all runs for this task
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    console.log(`[CheckCrown] Task ${args.taskId} has ${taskRuns.length} runs`);
    console.log(
      `[CheckCrown] Run statuses:`,
      taskRuns.map((r) => ({
        id: r._id,
        status: r.status,
        isCrowned: r.isCrowned,
      })),
    );

    // Check if all runs are completed or failed
    const allCompleted = taskRuns.every(
      (run) => run.status === "completed" || run.status === "failed",
    );

    if (!allCompleted) {
      console.log(`[CheckCrown] Not all runs completed`);
      return null;
    }

    // Special handling for single agent scenario
    if (taskRuns.length === 1) {
      console.log(`[CheckCrown] Single agent scenario - marking task complete`);

      // Mark the task as completed
      await ctx.db.patch(args.taskId, {
        isCompleted: true,
        updatedAt: Date.now(),
      });

      // If the single run was successful, return it as the "winner" for potential auto-PR
      const singleRun = taskRuns[0];
      if (singleRun.status === "completed") {
        console.log(
          `[CheckCrown] Single agent completed successfully: ${singleRun._id}`,
        );
        return singleRun._id;
      }

      return null;
    }

    // For multiple runs, require at least 2 to perform crown evaluation
    if (taskRuns.length < 2) {
      console.log(`[CheckCrown] Not enough runs (${taskRuns.length} < 2)`);
      return null;
    }

    // Check if we've already evaluated crown for this task
    const existingEvaluation = await ctx.db
      .query("crownEvaluations")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();

    if (existingEvaluation) {
      console.log(
        `[CheckCrown] Crown already evaluated for task ${args.taskId}, winner: ${existingEvaluation.winnerRunId}`,
      );
      return existingEvaluation.winnerRunId;
    }

    // Check if crown evaluation is already pending or in progress
    const task = await ctx.db.get(args.taskId);
    if (
      task?.crownEvaluationStatus === "pending" ||
      task?.crownEvaluationStatus === "in_progress"
    ) {
      console.log(
        `[CheckCrown] Crown evaluation already ${task.crownEvaluationStatus} for task ${args.taskId}`,
      );
      return "pending";
    }

    console.log(
      `[CheckCrown] No existing evaluation, proceeding with crown evaluation`,
    );

    // Only evaluate if we have at least 2 completed runs
    const completedRuns = taskRuns.filter((run) => run.status === "completed");
    if (completedRuns.length < 2) {
      console.log(
        `[CheckCrown] Not enough completed runs (${completedRuns.length} < 2)`,
      );
      return null;
    }

    // Trigger crown evaluation with error handling
    let winnerId = null;
    try {
      console.log(
        `[CheckCrown] Starting crown evaluation for task ${args.taskId}`,
      );
      winnerId = await ctx.runMutation(api.crown.evaluateAndCrownWinner, {
        teamSlugOrId: args.teamSlugOrId,
        taskId: args.taskId,
      });
      console.log(
        `[CheckCrown] Crown evaluation completed, winner: ${winnerId}`,
      );
    } catch (error) {
      console.error(`[CheckCrown] Crown evaluation failed:`, error);
      // Store the error message on the task
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await ctx.db.patch(args.taskId, {
        crownEvaluationStatus: "error",
        crownEvaluationError: errorMessage,
        updatedAt: Date.now(),
      });
      // Continue to mark task as completed even if crown evaluation fails
    }

    // Mark the task as completed since all runs are done
    await ctx.db.patch(args.taskId, {
      isCompleted: true,
      updatedAt: Date.now(),
    });
    console.log(`[CheckCrown] Marked task ${args.taskId} as completed`);

    return winnerId;
  },
});

export const getByIdInternal = internalQuery({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const createForPreview = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    previewRunId: v.id("previewRuns"),
    repoFullName: v.string(),
    prNumber: v.number(),
    prUrl: v.string(),
    headSha: v.string(),
    baseBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      text: `Preview screenshots for PR #${args.prNumber}`,
      description: `Capture UI screenshots for ${args.prUrl}`,
      projectFullName: args.repoFullName,
      baseBranch: args.baseBranch,
      worktreePath: undefined,
      isCompleted: false,
      isArchived: false,
      isPreview: true,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      images: undefined,
      userId: args.userId,
      teamId: args.teamId,
      environmentId: undefined,
      isCloudWorkspace: undefined,
    });
    return taskId;
  },
});

/**
 * Create a minimal test task for development/testing purposes.
 * Used by the test preview task endpoint.
 */
export const createTestTask = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    name: v.string(),
    repoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      text: args.name,
      description: "Test task for screenshot collection development",
      projectFullName: args.repoUrl,
      baseBranch: undefined,
      worktreePath: undefined,
      isCompleted: false,
      isArchived: false,
      isPreview: true,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      images: undefined,
      userId: args.userId,
      teamId: args.teamId,
      environmentId: undefined,
      isCloudWorkspace: true,
    });
    return taskId;
  },
});

export const setCompletedInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    isCompleted: v.boolean(),
    crownEvaluationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("in_progress"),
        v.literal("succeeded"),
        v.literal("error"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      isCompleted: args.isCompleted,
      updatedAt: Date.now(),
      ...(args.crownEvaluationStatus && {
        crownEvaluationStatus: args.crownEvaluationStatus,
      }),
    });
  },
});

/**
 * Internal mutation to set projectFullName and baseBranch on a task.
 * Used for backfilling tasks that were created before these fields were populated.
 */
export const setProjectAndBranchInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    projectFullName: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.projectFullName) {
      patch.projectFullName = args.projectFullName;
    }
    if (args.baseBranch) {
      patch.baseBranch = args.baseBranch;
    }
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(args.taskId, patch);
    }
  },
});

/**
 * Internal query to list tasks for a user in a team.
 * Used by CLI HTTP API for task list endpoint.
 */
export const listInternal = internalQuery({
  args: {
    teamId: v.string(),
    userId: v.string(),
    archived: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);

    // Use efficient indexes based on archived status
    let q;
    if (args.archived === true) {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_archived", (idx) =>
          idx.eq("teamId", args.teamId).eq("userId", args.userId).eq("isArchived", true),
        )
        .filter((qq) => qq.neq(qq.field("isPreview"), true));
    } else {
      q = ctx.db
        .query("tasks")
        .withIndex("by_team_user_active", (idx) =>
          idx
            .eq("teamId", args.teamId)
            .eq("userId", args.userId)
            .eq("isArchived", false)
            .eq("isPreview", false),
        );
    }

    const tasks = await q
      .filter((qq) => qq.eq(qq.field("linkedFromCloudTaskRunId"), undefined))
      .filter((qq) => qq.neq(qq.field("isLocalWorkspace"), true))
      .order("desc")
      .take(limit);

    return tasks;
  },
});

/**
 * Look up a task by its linked GitHub Project item ID.
 * Used by Phase 4 (bi-directional status sync) and head agent task dispatch.
 */
export const getByGithubProjectItem = internalQuery({
  args: {
    githubProjectItemId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("tasks")
      .withIndex("by_github_project_item", (q) =>
        q.eq("githubProjectItemId", args.githubProjectItemId),
      )
      .first();
  },
});

/**
 * Check if a GitHub Project item has a linked task.
 * Public query for use by CLI and frontend to filter unlinked items.
 */
export const hasLinkedTask = authQuery({
  args: {
    githubProjectItemId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_github_project_item", (q) =>
        q.eq("githubProjectItemId", args.githubProjectItemId),
      )
      .first();
    return task !== null;
  },
});

/**
 * Get a task by ID (internal, no auth).
 * Used by githubProjectSync action to read project linkage fields.
 */
export const getInternal = internalQuery({
  args: {
    id: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    return ctx.db.get(args.id);
  },
});

/**
 * Internal mutation to create a task (without task runs).
 * Task runs are created separately via taskRuns.createInternal to get JWTs.
 * Used by CLI HTTP API for task create endpoint.
 *
 * Note: isCloudWorkspace is NOT set here so tasks appear in "In progress"
 * category (same as web app). Setting isCloudWorkspace: true would cause
 * tasks to appear in "Workspaces" category instead.
 */
export const createInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    text: v.string(),
    description: v.optional(v.string()),
    projectFullName: v.optional(v.string()),
    baseBranch: v.optional(v.string()),
    pullRequestTitle: v.optional(v.string()),
    // GitHub Projects v2 linkage
    githubProjectId: v.optional(v.string()),
    githubProjectItemId: v.optional(v.string()),
    githubProjectInstallationId: v.optional(v.number()),
    githubProjectOwner: v.optional(v.string()),
    githubProjectOwnerType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate GitHub project linkage belongs to this team
    if (args.githubProjectInstallationId != null) {
      const connection = await ctx.db
        .query("providerConnections")
        .withIndex("by_installationId", (q) =>
          q.eq("installationId", args.githubProjectInstallationId as number),
        )
        .first();
      if (!connection || connection.teamId !== args.teamId) {
        throw new Error("GitHub installation not found or does not belong to team");
      }
    }
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", {
      text: args.text,
      description: args.description,
      projectFullName: args.projectFullName,
      baseBranch: args.baseBranch,
      pullRequestTitle: args.pullRequestTitle,
      isCompleted: false,
      isArchived: false,
      isPreview: false,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      userId: args.userId,
      teamId: args.teamId,
      githubProjectId: args.githubProjectId,
      githubProjectItemId: args.githubProjectItemId,
      githubProjectInstallationId: args.githubProjectInstallationId,
      githubProjectOwner: args.githubProjectOwner,
      githubProjectOwnerType: args.githubProjectOwnerType,
      // Note: isCloudWorkspace is NOT set so tasks appear in "In progress"
      // category in the UI (same as normal web app tasks)
    });

    return { taskId };
  },
});

/**
 * Internal mutation to archive a task (stop).
 * Used by CLI HTTP API for task stop endpoint.
 */
export const archiveInternal = internalMutation({
  args: {
    taskId: v.id("tasks"),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.teamId !== args.teamId || task.userId !== args.userId) {
      throw new Error("Task not found or unauthorized");
    }
    const now = Date.now();
    await ctx.db.patch(args.taskId, { isArchived: true, updatedAt: now });

    // Also archive all task runs for this task
    const taskRuns = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();
    await Promise.all(
      taskRuns.map((run) =>
        ctx.db.patch(run._id, { isArchived: true, updatedAt: now })
      )
    );

    return { archived: true };
  },
});

/**
 * Get local workspace task linked from a cloud task run.
 * Used to show linked local VS Code entry in the sidebar under cloud task runs.
 */
export const getLinkedLocalWorkspace = authQuery({
  args: {
    teamSlugOrId: v.string(),
    cloudTaskRunId: v.id("taskRuns"),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    // Find local workspace task linked from this cloud task run
    // Exclude archived tasks - they should not block creating a new local workspace
    const linkedTask = await ctx.db
      .query("tasks")
      .withIndex("by_linked_cloud_task_run", (q) =>
        q.eq("linkedFromCloudTaskRunId", args.cloudTaskRunId),
      )
      .filter((q) => q.eq(q.field("teamId"), teamId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .first();

    if (!linkedTask) {
      return null;
    }

    // Get the task run for the linked local workspace (we need its ID and vscode status)
    const taskRun = await ctx.db
      .query("taskRuns")
      .withIndex("by_task", (q) => q.eq("taskId", linkedTask._id))
      .first();

    if (!taskRun) {
      return null;
    }

    return {
      task: linkedTask,
      taskRun,
    };
  },
});
