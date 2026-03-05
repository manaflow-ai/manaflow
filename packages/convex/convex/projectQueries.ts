/**
 * Project Queries and Mutations
 *
 * Provides data access for project tracking:
 * - Project CRUD operations (create, update, get, list)
 * - Plan storage and sync
 * - Progress metrics aggregation
 * - Orchestration task linkage
 *
 * Public queries/mutations require authentication and team membership.
 * Internal functions are used by background workers and HTTP actions.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { authMutation, authQuery } from "./users/utils";
import { getTeamId } from "../_shared/team";

// ============================================================================
// Project Status Validator
// ============================================================================

const projectStatusValidator = v.union(
  v.literal("planning"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("archived")
);

// ============================================================================
// Project Queries (Authenticated)
// ============================================================================

/**
 * Get a single project by ID.
 * Requires authentication and team membership.
 */
export const getProject = authQuery({
  args: {
    projectId: v.id("projects"),
    teamSlugOrId: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, teamSlugOrId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return null;

    // If teamSlugOrId provided, verify membership
    if (teamSlugOrId) {
      const teamId = await getTeamId(ctx, teamSlugOrId);
      if (project.teamId !== teamId) {
        throw new Error("Forbidden: Project does not belong to this team");
      }
    } else {
      // Without explicit team, verify user has access to project's team
      await getTeamId(ctx, project.teamId);
    }

    return project;
  },
});

/**
 * List all projects for a team with optional status filter.
 * Returns projects ordered by updatedAt desc.
 * Requires authentication and team membership.
 */
export const listProjects = authQuery({
  args: {
    teamSlugOrId: v.string(),
    status: v.optional(projectStatusValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamSlugOrId, status, limit = 50 }) => {
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, teamSlugOrId);

    if (status) {
      // Use the by_team_status index when filtering by status
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_team_status", (q) =>
          q.eq("teamId", teamId).eq("status", status)
        )
        .order("desc")
        .take(limit);

      return projects;
    }

    // Without status filter, query all projects for team
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .take(limit);

    return projects;
  },
});

/**
 * Get project progress metrics (aggregated from linked orchestration tasks).
 * Returns total, completed, running, failed, and pending counts.
 * Requires authentication and team membership.
 */
export const getProjectProgress = authQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify user has access to project's team
    await getTeamId(ctx, project.teamId);

    // If project has embedded plan, calculate from plan tasks
    if (project.plan?.tasks) {
      const tasks = project.plan.tasks;
      const statusCounts = {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === "completed").length,
        running: tasks.filter((t) => t.status === "running" || t.status === "assigned").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        pending: tasks.filter((t) => t.status === "pending").length,
        cancelled: tasks.filter((t) => t.status === "cancelled").length,
      };

      const progressPercent = tasks.length > 0
        ? Math.round((statusCounts.completed / tasks.length) * 100)
        : 0;

      return {
        ...statusCounts,
        progressPercent,
        lastUpdated: project.plan.updatedAt,
      };
    }

    // Fallback to denormalized metrics
    return {
      total: project.totalTasks ?? 0,
      completed: project.completedTasks ?? 0,
      running: 0,
      failed: project.failedTasks ?? 0,
      pending: (project.totalTasks ?? 0) - (project.completedTasks ?? 0) - (project.failedTasks ?? 0),
      cancelled: 0,
      progressPercent: project.totalTasks
        ? Math.round(((project.completedTasks ?? 0) / project.totalTasks) * 100)
        : 0,
      lastUpdated: new Date(project.updatedAt).toISOString(),
    };
  },
});

// ============================================================================
// Project Mutations (Authenticated)
// ============================================================================

/**
 * Create a new project.
 * Requires authentication and team membership.
 */
export const createProject = authMutation({
  args: {
    teamSlugOrId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    goals: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          completed: v.boolean(),
        })
      )
    ),
    status: v.optional(projectStatusValidator),
    obsidianNotePath: v.optional(v.string()),
    githubProjectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      teamId,
      userId,
      name: args.name,
      description: args.description,
      goals: args.goals,
      status: args.status ?? "planning",
      obsidianNotePath: args.obsidianNotePath,
      githubProjectId: args.githubProjectId,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      createdAt: now,
      updatedAt: now,
    });

    return projectId;
  },
});

/**
 * Update an existing project.
 * Requires authentication and team membership.
 */
export const updateProject = authMutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    goals: v.optional(
      v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          completed: v.boolean(),
        })
      )
    ),
    status: v.optional(projectStatusValidator),
    obsidianNotePath: v.optional(v.string()),
    githubProjectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify user has access to project's team
    await getTeamId(ctx, project.teamId);

    const now = Date.now();
    const updates: Partial<Doc<"projects">> = {
      updatedAt: now,
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.goals !== undefined) updates.goals = args.goals;
    if (args.status !== undefined) updates.status = args.status;
    if (args.obsidianNotePath !== undefined) updates.obsidianNotePath = args.obsidianNotePath;
    if (args.githubProjectId !== undefined) updates.githubProjectId = args.githubProjectId;

    await ctx.db.patch(args.projectId, updates);

    return args.projectId;
  },
});

/**
 * Upsert project plan (create or update the embedded plan).
 * Requires authentication and team membership.
 */
export const upsertPlan = authMutation({
  args: {
    projectId: v.id("projects"),
    orchestrationId: v.string(),
    headAgent: v.string(),
    description: v.optional(v.string()),
    tasks: v.array(
      v.object({
        id: v.string(),
        prompt: v.string(),
        agentName: v.string(),
        status: v.string(),
        dependsOn: v.optional(v.array(v.string())),
        priority: v.optional(v.number()),
        orchestrationTaskId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify user has access to project's team
    await getTeamId(ctx, project.teamId);

    const now = Date.now();
    const plan = {
      orchestrationId: args.orchestrationId,
      headAgent: args.headAgent,
      description: args.description,
      tasks: args.tasks,
      updatedAt: new Date(now).toISOString(),
    };

    // Calculate progress metrics from plan
    const totalTasks = args.tasks.length;
    const completedTasks = args.tasks.filter((t) => t.status === "completed").length;
    const failedTasks = args.tasks.filter((t) => t.status === "failed").length;

    await ctx.db.patch(args.projectId, {
      plan,
      totalTasks,
      completedTasks,
      failedTasks,
      updatedAt: now,
      // Auto-transition to active if we have a plan with tasks
      status: project.status === "planning" && totalTasks > 0 ? "active" : project.status,
    });

    return args.projectId;
  },
});

/**
 * Link orchestration tasks to a project.
 * Creates the orchestration ID linkage for plan sync.
 * Requires authentication and team membership.
 */
export const linkOrchestration = authMutation({
  args: {
    projectId: v.id("projects"),
    orchestrationId: v.string(),
    headAgent: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify user has access to project's team
    await getTeamId(ctx, project.teamId);

    const now = Date.now();

    // Initialize plan if it doesn't exist
    const plan = project.plan ?? {
      orchestrationId: args.orchestrationId,
      headAgent: args.headAgent,
      tasks: [],
      updatedAt: new Date(now).toISOString(),
    };

    // Update orchestration linkage
    plan.orchestrationId = args.orchestrationId;
    plan.headAgent = args.headAgent;
    plan.updatedAt = new Date(now).toISOString();

    await ctx.db.patch(args.projectId, {
      plan,
      updatedAt: now,
    });

    return args.projectId;
  },
});

/**
 * Delete a project (soft delete by archiving).
 * Requires authentication and team membership.
 */
export const archiveProject = authMutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify user has access to project's team
    await getTeamId(ctx, project.teamId);

    const now = Date.now();
    await ctx.db.patch(projectId, {
      status: "archived",
      updatedAt: now,
    });

    return projectId;
  },
});

// ============================================================================
// Internal Functions (for HTTP actions and background workers)
// ============================================================================

/**
 * Get project by ID (internal).
 * Used by HTTP actions for auth-free access.
 */
export const getProjectInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, { projectId }) => {
    return ctx.db.get(projectId);
  },
});

/**
 * Get project by orchestration ID (internal).
 * Used for syncing agent memory back to project.
 */
export const getProjectByOrchestrationId = internalQuery({
  args: {
    orchestrationId: v.string(),
    teamId: v.string(),
  },
  handler: async (ctx, { orchestrationId, teamId }) => {
    // Query all projects for team and find one with matching orchestrationId
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .collect();

    return projects.find((p) => p.plan?.orchestrationId === orchestrationId) ?? null;
  },
});

/**
 * Update project plan (internal).
 * Used by agent memory sync to update plan state.
 */
export const updatePlanInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    tasks: v.array(
      v.object({
        id: v.string(),
        prompt: v.string(),
        agentName: v.string(),
        status: v.string(),
        dependsOn: v.optional(v.array(v.string())),
        priority: v.optional(v.number()),
        orchestrationTaskId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || !project.plan) {
      return;
    }

    const now = Date.now();

    // Update plan tasks
    const plan = {
      ...project.plan,
      tasks: args.tasks,
      updatedAt: new Date(now).toISOString(),
    };

    // Calculate progress metrics
    const totalTasks = args.tasks.length;
    const completedTasks = args.tasks.filter((t) => t.status === "completed").length;
    const failedTasks = args.tasks.filter((t) => t.status === "failed").length;

    // Determine project status based on task completion
    let status = project.status;
    if (totalTasks > 0 && completedTasks === totalTasks) {
      status = "completed";
    } else if (failedTasks > 0 && completedTasks + failedTasks === totalTasks) {
      // All tasks are done but some failed - keep as active for user review
      status = "active";
    }

    await ctx.db.patch(args.projectId, {
      plan,
      totalTasks,
      completedTasks,
      failedTasks,
      status,
      updatedAt: now,
    });
  },
});

/**
 * Update project progress metrics (internal).
 * Called when orchestration tasks complete.
 */
export const updateProgressInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    totalTasks: v.number(),
    completedTasks: v.number(),
    failedTasks: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      return;
    }

    const now = Date.now();

    // Determine project status based on completion
    let status = project.status;
    if (args.totalTasks > 0 && args.completedTasks === args.totalTasks) {
      status = "completed";
    }

    await ctx.db.patch(args.projectId, {
      totalTasks: args.totalTasks,
      completedTasks: args.completedTasks,
      failedTasks: args.failedTasks,
      status,
      updatedAt: now,
    });
  },
});

// ============================================================================
// Dispatch & Live Tracking
// ============================================================================

/**
 * Dispatch a project plan by creating orchestration tasks for each plan task.
 * Two-pass: create tasks first, then wire dependencies using planTaskId->orchestrationTaskId mapping.
 * Requires authentication and team membership.
 */
export const dispatchPlan = authMutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, { projectId }) => {
    const userId = ctx.identity.subject;
    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Verify user has access to project's team
    const teamId = await getTeamId(ctx, project.teamId);

    if (!project.plan?.tasks || project.plan.tasks.length === 0) {
      throw new Error("No plan tasks to dispatch");
    }

    const now = Date.now();
    const planTasks = project.plan.tasks;

    // Pass 1: Create orchestration tasks (without dependencies)
    const planToOrchMap = new Map<string, Id<"orchestrationTasks">>();

    for (const planTask of planTasks) {
      const orchTaskId = await ctx.db.insert("orchestrationTasks", {
        teamId,
        userId,
        prompt: planTask.prompt,
        priority: planTask.priority ?? 5,
        status: "pending",
        assignedAgentName: planTask.agentName,
        metadata: {
          agentName: planTask.agentName,
          projectId: projectId as string,
          planTaskId: planTask.id,
          orchestrationId: project.plan.orchestrationId,
        },
        createdAt: now,
        updatedAt: now,
      });
      planToOrchMap.set(planTask.id, orchTaskId);
    }

    // Pass 2: Wire dependencies
    for (const planTask of planTasks) {
      if (!planTask.dependsOn?.length) continue;

      const orchTaskId = planToOrchMap.get(planTask.id);
      if (!orchTaskId) continue;

      const depIds: Id<"orchestrationTasks">[] = [];
      for (const depPlanId of planTask.dependsOn) {
        const depOrchId = planToOrchMap.get(depPlanId);
        if (depOrchId) {
          depIds.push(depOrchId);
        }
      }

      if (depIds.length > 0) {
        await ctx.db.patch(orchTaskId, {
          dependencies: depIds,
          updatedAt: now,
        });

        // Batch-fetch all dependencies and update dependents in parallel
        const deps = await Promise.all(depIds.map((id) => ctx.db.get(id)));
        await Promise.all(
          depIds.map((depId, i) => {
            const dep = deps[i];
            if (!dep) return;
            return ctx.db.patch(depId, {
              dependents: [...(dep.dependents ?? []), orchTaskId],
              updatedAt: now,
            });
          })
        );
      }
    }

    // Update plan tasks with orchestrationTaskId
    const updatedPlanTasks = planTasks.map((t) => ({
      ...t,
      orchestrationTaskId: planToOrchMap.get(t.id)?.toString(),
    }));

    await ctx.db.patch(projectId, {
      plan: {
        ...project.plan,
        tasks: updatedPlanTasks,
        updatedAt: new Date(now).toISOString(),
      },
      status: "active",
      runningTasks: 0,
      totalTasks: planTasks.length,
      completedTasks: 0,
      failedTasks: 0,
      updatedAt: now,
    });

    return { dispatched: planTasks.length };
  },
});

/**
 * Get live orchestration tasks for a project.
 * Reads the project plan, extracts orchestrationTaskIds, and batch-fetches them.
 * Uses Convex reactive queries for real-time updates.
 */
export const getOrchestrationTasksForProject = authQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, { projectId }) => {
    const project = await ctx.db.get(projectId);
    if (!project) return [];

    // Verify user has access to project's team
    await getTeamId(ctx, project.teamId);

    if (!project.plan?.tasks) return [];

    // Extract orchestration task IDs
    const orchTaskIds = project.plan.tasks
      .map((t) => t.orchestrationTaskId)
      .filter((id): id is string => id != null);

    if (orchTaskIds.length === 0) return [];

    // Batch fetch orchestration tasks
    const tasks = await Promise.all(
      orchTaskIds.map((id) => ctx.db.get(id as Id<"orchestrationTasks">))
    );

    return tasks.filter((t): t is NonNullable<typeof t> => t != null);
  },
});

/**
 * Sync plan task status from orchestration task updates.
 * Called when an orchestration task changes status.
 * Updates the corresponding plan task and recalculates progress metrics.
 */
export const syncPlanStatusFromOrchestration = internalMutation({
  args: {
    orchestrationTaskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, { orchestrationTaskId }) => {
    const orchTask = await ctx.db.get(orchestrationTaskId);
    if (!orchTask) return;

    // Check if this task has project metadata
    const metadata = orchTask.metadata as Record<string, unknown> | undefined;
    const projectIdStr = metadata?.projectId as string | undefined;
    const planTaskId = metadata?.planTaskId as string | undefined;

    if (!projectIdStr || !planTaskId) return;

    const project = await ctx.db.get(projectIdStr as Id<"projects">);
    if (!project?.plan?.tasks) return;

    const now = Date.now();

    // Update the matching plan task's status
    const updatedTasks = project.plan.tasks.map((t) => {
      if (t.id === planTaskId) {
        return { ...t, status: orchTask.status };
      }
      return t;
    });

    // Calculate progress metrics
    const totalTasks = updatedTasks.length;
    const completedTasks = updatedTasks.filter((t) => t.status === "completed").length;
    const failedTasks = updatedTasks.filter((t) => t.status === "failed").length;
    const runningTasks = updatedTasks.filter(
      (t) => t.status === "running" || t.status === "assigned"
    ).length;

    // Determine project status
    let status = project.status;
    if (totalTasks > 0 && completedTasks === totalTasks) {
      status = "completed";
    } else if (totalTasks > 0 && completedTasks + failedTasks === totalTasks) {
      // All done but some failed - keep active for review
      status = "active";
    }

    await ctx.db.patch(project._id, {
      plan: {
        ...project.plan,
        tasks: updatedTasks,
        updatedAt: new Date(now).toISOString(),
      },
      totalTasks,
      completedTasks,
      failedTasks,
      runningTasks,
      status,
      updatedAt: now,
    });
  },
});
