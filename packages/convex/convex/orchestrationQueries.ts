/**
 * Orchestration Queries and Mutations
 *
 * Provides data access for multi-agent orchestration:
 * - Task queue management (create, assign, complete)
 * - Provider health tracking
 * - Dependency resolution
 *
 * Public queries/mutations require authentication and team membership.
 * Internal functions are used by the orchestration worker.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { authMutation, authQuery } from "./users/utils";
import { getTeamId } from "../_shared/team";

// ============================================================================
// Orchestration Task Queries (Authenticated)
// ============================================================================

/**
 * Get all pending tasks for a team, sorted by priority.
 * Requires authentication and team membership.
 */
export const listPendingTasks = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamSlugOrId, limit = 50 }) => {
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, teamSlugOrId);

    return ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", teamId).eq("status", "pending")
      )
      .order("asc")
      .take(limit);
  },
});

/**
 * Get recent tasks for a team, optionally filtered by status.
 * Returns tasks ordered by updatedAt desc.
 * Requires authentication and team membership.
 */
export const listTasksByTeam = authQuery({
  args: {
    teamSlugOrId: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("assigned"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamSlugOrId, status, limit = 50 }) => {
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, teamSlugOrId);

    if (status) {
      // Use the by_team_status index when filtering by status
      const tasks = await ctx.db
        .query("orchestrationTasks")
        .withIndex("by_team_status", (q) =>
          q.eq("teamId", teamId).eq("status", status)
        )
        .collect();

      // Sort by updatedAt desc and take limit
      return tasks
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, limit);
    }

    // Without status filter, query all tasks for team and sort by updatedAt
    const tasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) => q.eq("teamId", teamId))
      .collect();

    return tasks
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, limit);
  },
});

/**
 * Get tasks assigned to a specific agent within a team.
 * Requires authentication and team membership.
 */
export const listAgentTasks = authQuery({
  args: {
    teamSlugOrId: v.string(),
    agentName: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("assigned"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
  },
  handler: async (ctx, { teamSlugOrId, agentName, status }) => {
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, teamSlugOrId);

    // Query by agent, then filter by team (no composite index available)
    let q = ctx.db
      .query("orchestrationTasks")
      .withIndex("by_assigned_agent", (q) => q.eq("assignedAgentName", agentName))
      .filter((q) => q.eq(q.field("teamId"), teamId));

    if (status) {
      q = q.filter((q) => q.eq(q.field("status"), status));
    }

    return q.collect();
  },
});

/**
 * Get a single orchestration task by ID.
 * Requires authentication and team membership.
 */
export const getTask = authQuery({
  args: {
    taskId: v.id("orchestrationTasks"),
    teamSlugOrId: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, teamSlugOrId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return null;

    // If teamSlugOrId provided, verify membership
    if (teamSlugOrId) {
      const teamId = await getTeamId(ctx, teamSlugOrId);
      if (task.teamId !== teamId) {
        throw new Error("Forbidden: Task does not belong to this team");
      }
    } else {
      // Without explicit team, verify user has access to task's team
      await getTeamId(ctx, task.teamId);
    }

    return task;
  },
});

/**
 * Get tasks that are blocked by a specific task.
 * Requires authentication and team membership.
 */
export const getDependentTasks = authQuery({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return [];

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    if (!task.dependents) return [];

    const dependents = await Promise.all(
      task.dependents.map((id) => ctx.db.get(id))
    );

    return dependents.filter(Boolean);
  },
});

/**
 * Get ready-to-execute tasks (no unresolved dependencies).
 * Requires authentication and team membership.
 */
export const getReadyTasks = authQuery({
  args: {
    teamSlugOrId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamSlugOrId, limit = 10 }) => {
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, teamSlugOrId);

    const pendingTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", teamId).eq("status", "pending")
      )
      .order("asc")
      .take(100);

    // Filter to tasks with no dependencies or all dependencies completed
    const readyTasks = [];
    for (const task of pendingTasks) {
      if (!task.dependencies || task.dependencies.length === 0) {
        readyTasks.push(task);
        continue;
      }

      // Check if all dependencies are completed
      const deps = await Promise.all(
        task.dependencies.map((id) => ctx.db.get(id))
      );
      const allCompleted = deps.every(
        (dep) => dep?.status === "completed"
      );

      if (allCompleted) {
        readyTasks.push(task);
      }

      if (readyTasks.length >= limit) break;
    }

    return readyTasks;
  },
});

// ============================================================================
// Orchestration Task Mutations (Authenticated)
// ============================================================================

/**
 * Update dependents for each dependency task.
 * Batches lookups with Promise.all to avoid N+1 queries.
 */
async function updateDependencyDependents(
  ctx: { db: { get: (id: Id<"orchestrationTasks">) => Promise<Doc<"orchestrationTasks"> | null>; patch: (id: Id<"orchestrationTasks">, data: Partial<Doc<"orchestrationTasks">>) => Promise<void> } },
  dependencies: Id<"orchestrationTasks">[],
  newTaskId: Id<"orchestrationTasks">,
  teamId: string,
  now: number,
  validateTeam: boolean
): Promise<void> {
  // Batch fetch all dependencies
  const deps = await Promise.all(dependencies.map((id) => ctx.db.get(id)));

  // Validate and update each dependency
  await Promise.all(
    dependencies.map(async (depId, i) => {
      const dep = deps[i];
      if (dep) {
        if (validateTeam && dep.teamId !== teamId) {
          throw new Error(`Dependency ${depId} belongs to a different team`);
        }
        await ctx.db.patch(depId, {
          dependents: [...(dep.dependents ?? []), newTaskId],
          updatedAt: now,
        });
      }
    })
  );
}

/**
 * Create a new orchestration task.
 * Requires authentication and team membership.
 */
export const createTask = authMutation({
  args: {
    teamSlugOrId: v.string(),
    prompt: v.string(),
    priority: v.optional(v.number()),
    dependencies: v.optional(v.array(v.id("orchestrationTasks"))),
    taskId: v.optional(v.id("tasks")),
    taskRunId: v.optional(v.id("taskRuns")),
    parentTaskId: v.optional(v.id("orchestrationTasks")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    // Verify team membership and get canonical teamId
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    const now = Date.now();

    const taskId = await ctx.db.insert("orchestrationTasks", {
      teamId,
      userId,
      prompt: args.prompt,
      priority: args.priority ?? 5,
      status: "pending",
      dependencies: args.dependencies,
      taskId: args.taskId,
      taskRunId: args.taskRunId,
      parentTaskId: args.parentTaskId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    // Update dependent tasks to track this dependency
    if (args.dependencies && args.dependencies.length > 0) {
      await updateDependencyDependents(ctx, args.dependencies, taskId, teamId, now, true);
    }

    return taskId;
  },
});

/**
 * Internal mutation to create tasks without auth (for background worker).
 */
export const createTaskInternal = internalMutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
    prompt: v.string(),
    priority: v.optional(v.number()),
    dependencies: v.optional(v.array(v.id("orchestrationTasks"))),
    taskId: v.optional(v.id("tasks")),
    taskRunId: v.optional(v.id("taskRuns")),
    parentTaskId: v.optional(v.id("orchestrationTasks")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const taskId = await ctx.db.insert("orchestrationTasks", {
      teamId: args.teamId,
      userId: args.userId,
      prompt: args.prompt,
      priority: args.priority ?? 5,
      status: "pending",
      dependencies: args.dependencies,
      taskId: args.taskId,
      taskRunId: args.taskRunId,
      parentTaskId: args.parentTaskId,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    // Update dependent tasks to track this dependency
    if (args.dependencies && args.dependencies.length > 0) {
      await updateDependencyDependents(ctx, args.dependencies, taskId, args.teamId, now, false);
    }

    return taskId;
  },
});

/**
 * Assign a task to an agent.
 * Requires authentication and team membership.
 */
export const assignTask = authMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    agentName: v.string(),
    sandboxId: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, agentName, sandboxId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "assigned",
      assignedAgentName: agentName,
      assignedSandboxId: sandboxId,
      assignedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Internal mutation to assign task without auth.
 */
export const assignTaskInternal = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    agentName: v.string(),
    sandboxId: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, agentName, sandboxId }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "assigned",
      assignedAgentName: agentName,
      assignedSandboxId: sandboxId,
      assignedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Mark a task as running.
 * Requires authentication and team membership.
 */
export const startTask = authMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Complete a task successfully.
 * After completion, schedules immediate triggering of dependent tasks.
 * Requires authentication and team membership.
 */
export const completeTask = authMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    result: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, result }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "completed",
      result,
      completedAt: now,
      updatedAt: now,
    });

    // Schedule immediate triggering of dependent tasks (0ms delay = immediate)
    await ctx.scheduler.runAfter(0, internal.orchestrationQueries.triggerDependentTasks, {
      completedTaskId: taskId,
    });
  },
});

/**
 * Internal mutation to trigger dependent tasks after a task completes.
 * Sets nextRetryAfter = now for immediate pickup by the orchestration worker.
 */
export const triggerDependentTasks = internalMutation({
  args: {
    completedTaskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, { completedTaskId }) => {
    const completedTask = await ctx.db.get(completedTaskId);
    if (!completedTask?.dependents || completedTask.dependents.length === 0) {
      return;
    }

    const now = Date.now();

    // Check each dependent task
    for (const dependentId of completedTask.dependents) {
      const dependent = await ctx.db.get(dependentId);
      if (!dependent || dependent.status !== "pending") {
        continue;
      }

      // Check if all dependencies are now completed
      if (dependent.dependencies && dependent.dependencies.length > 0) {
        const deps = await Promise.all(
          dependent.dependencies.map((id) => ctx.db.get(id))
        );
        const allCompleted = deps.every((dep) => dep?.status === "completed");

        if (!allCompleted) {
          // Still waiting on other dependencies
          continue;
        }
      }

      // All dependencies are complete - set nextRetryAfter to now for immediate pickup
      await ctx.db.patch(dependentId, {
        nextRetryAfter: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Mark a task as failed.
 * Requires authentication and team membership.
 */
export const failTask = authMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    errorMessage: v.string(),
  },
  handler: async (ctx, { taskId, errorMessage }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "failed",
      errorMessage,
      completedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Internal mutation to fail task without auth.
 */
export const failTaskInternal = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    errorMessage: v.string(),
  },
  handler: async (ctx, { taskId, errorMessage }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "failed",
      errorMessage,
      completedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Internal mutation to complete task without auth.
 */
export const completeTaskInternal = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    result: v.optional(v.string()),
  },
  handler: async (ctx, { taskId, result }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "completed",
      result,
      completedAt: now,
      updatedAt: now,
    });

    // Schedule immediate triggering of dependent tasks
    await ctx.scheduler.runAfter(0, internal.orchestrationQueries.triggerDependentTasks, {
      completedTaskId: taskId,
    });
  },
});

/**
 * Cancel a task.
 * Requires authentication and team membership.
 */
export const cancelTask = authMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Task not found");

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Check for circular dependencies in the task graph.
 * Returns true if adding the proposed dependencies would create a cycle.
 */
async function wouldCreateCircularDependency(
  ctx: { db: { get: (id: Id<"orchestrationTasks">) => Promise<Doc<"orchestrationTasks"> | null> } },
  taskId: Id<"orchestrationTasks">,
  newDepIds: Id<"orchestrationTasks">[]
): Promise<boolean> {
  // BFS/DFS to check if any new dependency eventually leads back to taskId
  const visited = new Set<string>();
  const queue: Id<"orchestrationTasks">[] = [...newDepIds];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    // Found a cycle
    if (currentId === taskId) {
      return true;
    }

    // Skip if already visited
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    // Get the task and check its dependencies
    const task = await ctx.db.get(currentId);
    if (task?.dependencies) {
      queue.push(...task.dependencies);
    }
  }

  return false;
}

/**
 * Core logic for adding dependencies to a task.
 * Validates team membership, checks for circular dependencies, and updates dependents.
 * Uses batched queries to avoid N+1 patterns.
 */
async function addDependenciesCore(
  ctx: { db: { get: (id: Id<"orchestrationTasks">) => Promise<Doc<"orchestrationTasks"> | null>; patch: (id: Id<"orchestrationTasks">, data: Partial<Doc<"orchestrationTasks">>) => Promise<void> } },
  task: Doc<"orchestrationTasks">,
  taskId: Id<"orchestrationTasks">,
  dependencyIds: Id<"orchestrationTasks">[]
): Promise<void> {
  // Check for circular dependencies before adding
  const wouldCycle = await wouldCreateCircularDependency(ctx, taskId, dependencyIds);
  if (wouldCycle) {
    throw new Error("Cannot add dependencies: would create a circular dependency");
  }

  const existing = task.dependencies ?? [];
  const now = Date.now();

  // Batch fetch all dependencies
  const deps = await Promise.all(dependencyIds.map((id) => ctx.db.get(id)));

  // Validate and update each dependency
  await Promise.all(
    dependencyIds.map(async (depId, i) => {
      const dep = deps[i];
      if (!dep) {
        throw new Error(`Dependency ${depId} not found`);
      }
      if (dep.teamId !== task.teamId) {
        throw new Error(`Dependency ${depId} belongs to a different team`);
      }
      // Only add to dependents if not already a dependency
      if (!existing.includes(depId)) {
        await ctx.db.patch(depId, {
          dependents: [...(dep.dependents ?? []), taskId],
          updatedAt: now,
        });
      }
    })
  );

  const merged = [...new Set([...existing, ...dependencyIds])];

  await ctx.db.patch(taskId, {
    dependencies: merged,
    updatedAt: now,
  });
}

/**
 * Add dependencies to a task.
 * The task will not be eligible for assignment until all dependencies are completed.
 * Requires authentication and team membership.
 *
 * Validates:
 * - Dependencies belong to the same team
 * - Adding dependencies would not create a circular dependency
 */
export const addDependencies = authMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    dependencyIds: v.array(v.id("orchestrationTasks")),
  },
  handler: async (ctx, { taskId, dependencyIds }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    // Verify user has access to task's team
    await getTeamId(ctx, task.teamId);

    await addDependenciesCore(ctx, task, taskId, dependencyIds);
  },
});

/**
 * Internal mutation to add dependencies without auth.
 * Validates same-team membership and circular dependency prevention.
 */
export const addDependenciesInternal = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    dependencyIds: v.array(v.id("orchestrationTasks")),
  },
  handler: async (ctx, { taskId, dependencyIds }) => {
    const task = await ctx.db.get(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    await addDependenciesCore(ctx, task, taskId, dependencyIds);
  },
});

// ============================================================================
// Provider Health Queries (Authenticated)
// ============================================================================

/**
 * Get health status for a provider.
 * Requires authentication. Team membership checked if teamSlugOrId provided.
 */
export const getProviderHealth = authQuery({
  args: {
    providerId: v.string(),
    teamSlugOrId: v.optional(v.string()),
  },
  handler: async (ctx, { providerId, teamSlugOrId }) => {
    // Try team-specific health first
    if (teamSlugOrId) {
      const teamId = await getTeamId(ctx, teamSlugOrId);
      const teamHealth = await ctx.db
        .query("providerHealth")
        .withIndex("by_team_provider", (q) =>
          q.eq("teamId", teamId).eq("providerId", providerId)
        )
        .first();
      if (teamHealth) return teamHealth;
    }

    // Fall back to global health (records where teamId is not set)
    const globalRecords = await ctx.db
      .query("providerHealth")
      .withIndex("by_provider", (q) => q.eq("providerId", providerId))
      .collect();

    // Find the record without a teamId (global record)
    return globalRecords.find((r) => !r.teamId) ?? null;
  },
});

/**
 * List all provider health statuses.
 * Requires authentication. Team membership checked if teamSlugOrId provided.
 */
export const listProviderHealth = authQuery({
  args: {
    teamSlugOrId: v.optional(v.string()),
    statusFilter: v.optional(
      v.union(
        v.literal("healthy"),
        v.literal("degraded"),
        v.literal("unhealthy")
      )
    ),
  },
  handler: async (ctx, { teamSlugOrId, statusFilter }) => {
    let results;

    if (statusFilter) {
      results = await ctx.db
        .query("providerHealth")
        .withIndex("by_status", (q) => q.eq("status", statusFilter))
        .order("desc")
        .collect();
    } else {
      results = await ctx.db.query("providerHealth").collect();
    }

    // Filter by team if specified
    if (teamSlugOrId) {
      const teamId = await getTeamId(ctx, teamSlugOrId);
      return results.filter(
        (h) => h.teamId === teamId || h.teamId === undefined
      );
    }

    return results;
  },
});

// ============================================================================
// Provider Health Mutations (Internal - for worker use)
// ============================================================================

/**
 * Upsert provider health status.
 * Internal mutation for background worker/system use only.
 */
export const upsertProviderHealth = internalMutation({
  args: {
    providerId: v.string(),
    status: v.union(
      v.literal("healthy"),
      v.literal("degraded"),
      v.literal("unhealthy")
    ),
    circuitState: v.union(
      v.literal("closed"),
      v.literal("open"),
      v.literal("half-open")
    ),
    failureCount: v.number(),
    successRate: v.number(),
    latencyP50: v.number(),
    latencyP99: v.number(),
    totalRequests: v.number(),
    lastError: v.optional(v.string()),
    teamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Find existing record
    const existing = args.teamId
      ? await ctx.db
          .query("providerHealth")
          .withIndex("by_team_provider", (q) =>
            q.eq("teamId", args.teamId).eq("providerId", args.providerId)
          )
          .first()
      : await (async () => {
          // Find global record (where teamId is not set)
          const globalRecords = await ctx.db
            .query("providerHealth")
            .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
            .collect();
          return globalRecords.find((r) => !r.teamId) ?? null;
        })();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        circuitState: args.circuitState,
        failureCount: args.failureCount,
        successRate: args.successRate,
        latencyP50: args.latencyP50,
        latencyP99: args.latencyP99,
        totalRequests: args.totalRequests,
        lastError: args.lastError,
        lastCheck: now,
      });
      return existing._id;
    }

    return ctx.db.insert("providerHealth", {
      providerId: args.providerId,
      status: args.status,
      circuitState: args.circuitState,
      failureCount: args.failureCount,
      successRate: args.successRate,
      latencyP50: args.latencyP50,
      latencyP99: args.latencyP99,
      totalRequests: args.totalRequests,
      lastError: args.lastError,
      lastCheck: now,
      teamId: args.teamId,
    });
  },
});

// ============================================================================
// Internal Worker Functions (for background orchestration worker)
// ============================================================================

/**
 * Atomic claim of a task by the background worker.
 * Only claims if task is in pending status.
 */
export const claimTask = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    agentName: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "pending") {
      return false;
    }

    await ctx.db.patch(args.taskId, {
      status: "assigned",
      assignedAgentName: args.agentName,
      assignedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return true;
  },
});

/**
 * Release a task back to pending state (on failure before spawn).
 */
export const releaseTask = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: "pending",
      assignedAgentName: undefined,
      assignedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Schedule a retry with exponential backoff.
 * After max retries, marks task as permanently failed.
 */
export const scheduleRetry = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
    errorMessage: v.string(),
    maxRetries: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return;

    const maxRetries = args.maxRetries ?? 3;
    const currentRetry = (task.retryCount ?? 0) + 1;

    if (currentRetry > maxRetries) {
      // Exceeded max retries - fail permanently
      await ctx.db.patch(args.taskId, {
        status: "failed",
        errorMessage: args.errorMessage,
        retryCount: currentRetry,
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return;
    }

    // Exponential backoff: 30s * 2^retryCount, max 5min
    const backoffMs = Math.min(30000 * Math.pow(2, currentRetry - 1), 300000);

    await ctx.db.patch(args.taskId, {
      status: "pending",
      assignedAgentName: undefined,
      assignedAt: undefined,
      retryCount: currentRetry,
      lastRetryAt: Date.now(),
      nextRetryAfter: Date.now() + backoffMs,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Get a single orchestration task by ID (internal).
 * Used for authorization checks (verify task belongs to team).
 */
export const getTaskInternal = internalQuery({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, args) => {
    return ctx.db.get(args.taskId);
  },
});

/**
 * Count running and assigned tasks for a team.
 * Used to enforce concurrent spawn limits.
 */
export const countRunningTasks = internalQuery({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    const running = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "running")
      )
      .collect();

    const assigned = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", args.teamId).eq("status", "assigned")
      )
      .collect();

    return running.length + assigned.length;
  },
});

/**
 * Get ready tasks for internal worker use.
 * Includes nextRetryAfter field for backoff filtering.
 */
export const getReadyTasksInternal = internalQuery({
  args: {
    teamId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamId, limit = 10 }) => {
    const pendingTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", teamId).eq("status", "pending")
      )
      .order("asc")
      .take(100);

    // Filter to tasks with no dependencies or all dependencies completed
    const readyTasks = [];
    for (const task of pendingTasks) {
      if (!task.dependencies || task.dependencies.length === 0) {
        readyTasks.push(task);
        continue;
      }

      // Check if all dependencies are completed
      const deps = await Promise.all(
        task.dependencies.map((id) => ctx.db.get(id))
      );
      const allCompleted = deps.every((dep) => dep?.status === "completed");

      if (allCompleted) {
        readyTasks.push(task);
      }

      if (readyTasks.length >= limit) break;
    }

    return readyTasks;
  },
});

/**
 * Internal version of startTask for worker use.
 */
export const startTaskInternal = internalMutation({
  args: {
    taskId: v.id("orchestrationTasks"),
  },
  handler: async (ctx, { taskId }) => {
    const now = Date.now();
    await ctx.db.patch(taskId, {
      status: "running",
      startedAt: now,
      updatedAt: now,
    });
  },
});

// ============================================================================
// Metrics Queries
// ============================================================================

/**
 * Count tasks by status for a team.
 * More efficient than listTasksByTeam when only the count is needed.
 * Collects all matching tasks to get accurate count (no limit).
 */
export const countTasksByStatus = authQuery({
  args: {
    teamSlugOrId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("assigned"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled")
    ),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const tasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) =>
        q.eq("teamId", teamId).eq("status", args.status)
      )
      .collect();
    return tasks.length;
  },
});

// ============================================================================
// Dashboard Summary Queries
// ============================================================================

/**
 * Get orchestration summary metrics for a team.
 * Returns aggregate counts by status, recent tasks, and active agent info.
 * Used by the orchestration dashboard.
 */
export const getOrchestrationSummary = authQuery({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);

    // Get all tasks for this team (we'll count by status)
    const allTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) => q.eq("teamId", teamId))
      .collect();

    // Count by status
    const statusCounts: Record<string, number> = {
      pending: 0,
      assigned: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const task of allTasks) {
      if (task.status in statusCounts) {
        statusCounts[task.status]++;
      }
    }

    // Get unique active agents (running or assigned tasks)
    const activeAgents = new Set<string>();
    for (const task of allTasks) {
      if (
        (task.status === "running" || task.status === "assigned") &&
        task.assignedAgentName
      ) {
        activeAgents.add(task.assignedAgentName);
      }
    }

    // Get recent activity (last 5 completed or failed tasks)
    const recentTasks = allTasks
      .filter((t) => t.status === "completed" || t.status === "failed")
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, 5);

    return {
      totalTasks: allTasks.length,
      statusCounts,
      activeAgentCount: activeAgents.size,
      activeAgents: Array.from(activeAgents),
      recentTasks: recentTasks.map((t) => ({
        _id: t._id,
        prompt: t.prompt.slice(0, 100) + (t.prompt.length > 100 ? "..." : ""),
        status: t.status,
        assignedAgentName: t.assignedAgentName,
        completedAt: t.completedAt,
        errorMessage: t.errorMessage,
      })),
    };
  },
});

/**
 * List tasks with enriched dependency information.
 * Returns tasks with resolved dependency status (how many complete, how many pending).
 * Used by the orchestration dashboard task list.
 */
export const listTasksWithDependencyInfo = authQuery({
  args: {
    teamSlugOrId: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("assigned"),
        v.literal("running"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled")
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { teamSlugOrId, status, limit = 50 } = args;
    const teamId = await getTeamId(ctx, teamSlugOrId);

    // Fetch tasks
    let tasks: Doc<"orchestrationTasks">[];
    if (status) {
      const taskList = await ctx.db
        .query("orchestrationTasks")
        .withIndex("by_team_status", (q) =>
          q.eq("teamId", teamId).eq("status", status)
        )
        .collect();
      tasks = taskList
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, limit);
    } else {
      const taskList = await ctx.db
        .query("orchestrationTasks")
        .withIndex("by_team_status", (q) => q.eq("teamId", teamId))
        .collect();
      tasks = taskList
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, limit);
    }

    // Enrich each task with dependency information
    const enrichedTasks = await Promise.all(
      tasks.map(async (task) => {
        let dependencyInfo:
          | {
              totalDeps: number;
              completedDeps: number;
              pendingDeps: number;
              blockedBy: Array<{
                _id: Id<"orchestrationTasks">;
                status: string;
                prompt: string;
              }>;
            }
          | undefined;

        if (task.dependencies && task.dependencies.length > 0) {
          const deps = await Promise.all(
            task.dependencies.map((id) => ctx.db.get(id))
          );
          const validDeps = deps.filter(Boolean) as Doc<"orchestrationTasks">[];

          const completedDeps = validDeps.filter(
            (d) => d.status === "completed"
          ).length;
          const pendingDeps = validDeps.filter(
            (d) => d.status !== "completed" && d.status !== "failed"
          ).length;

          dependencyInfo = {
            totalDeps: validDeps.length,
            completedDeps,
            pendingDeps,
            blockedBy: validDeps
              .filter((d) => d.status !== "completed")
              .map((d) => ({
                _id: d._id,
                status: d.status,
                prompt: d.prompt.slice(0, 50) + (d.prompt.length > 50 ? "..." : ""),
              })),
          };
        }

        return {
          ...task,
          dependencyInfo,
        };
      })
    );

    return enrichedTasks;
  },
});

// ============================================================================
// Internal Queries for Orchestration HTTP Pull API (Phase 1)
// ============================================================================

/**
 * Get orchestration state for head agents to sync local PLAN.json.
 * Returns all tasks for the team, optionally filtered by orchestrationId.
 *
 * Used by the pull orchestration state HTTP action.
 */
export const getOrchestrationStateInternal = internalQuery({
  args: {
    teamId: v.string(),
    orchestrationId: v.optional(v.string()),
    taskRunId: v.optional(v.id("taskRuns")),
  },
  handler: async (ctx, { teamId, orchestrationId, taskRunId }) => {
    // If taskRunId provided, fetch tasks associated with that run
    if (taskRunId) {
      const tasks = await ctx.db
        .query("orchestrationTasks")
        .withIndex("by_task_run", (q) => q.eq("taskRunId", taskRunId))
        .collect();
      return tasks;
    }

    // Otherwise, fetch all tasks for the team
    const allTasks = await ctx.db
      .query("orchestrationTasks")
      .withIndex("by_team_status", (q) => q.eq("teamId", teamId))
      .collect();

    // Filter by orchestrationId if provided (stored in metadata)
    if (orchestrationId) {
      return allTasks.filter((task) => {
        const metadata = task.metadata as Record<string, unknown> | undefined;
        return metadata?.orchestrationId === orchestrationId;
      });
    }

    return allTasks;
  },
});

/**
 * Get messages for a specific task run.
 * Used by the pull orchestration state HTTP action.
 */
export const getMessagesForTaskRunInternal = internalQuery({
  args: {
    taskRunId: v.id("taskRuns"),
    includeRead: v.optional(v.boolean()),
  },
  handler: async (ctx, { taskRunId, includeRead = false }) => {
    if (includeRead) {
      return ctx.db
        .query("agentOrchestrateMessages")
        .withIndex("by_task_run", (q) => q.eq("taskRunId", taskRunId))
        .collect();
    }

    return ctx.db
      .query("agentOrchestrateMessages")
      .withIndex("by_task_run_unread", (q) =>
        q.eq("taskRunId", taskRunId).eq("read", false)
      )
      .collect();
  },
});
