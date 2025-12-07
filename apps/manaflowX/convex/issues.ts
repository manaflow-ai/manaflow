import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// =============================================================================
// ISSUES - Beads-style persistent issue tracker
// =============================================================================

// Generate a short hash ID (like x-a1b2)
function generateShortId(): string {
  const chars = "0123456789abcdef";
  let hash = "";
  for (let i = 0; i < 4; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return `x-${hash}`;
}

// =============================================================================
// QUERIES
// =============================================================================

// List issues with filters
export const listIssues = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
    assignee: v.optional(v.string()),
    label: v.optional(v.string()),
    priorityMin: v.optional(v.number()),
    priorityMax: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let issuesQuery;

    if (args.status) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc");
    } else if (args.assignee) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_assignee", (q) => q.eq("assignee", args.assignee!))
        .order("desc");
    } else {
      issuesQuery = ctx.db.query("issues").order("desc");
    }

    const issues = await issuesQuery.take(limit * 2); // Fetch extra for filtering

    // Apply secondary filters
    let filtered = issues;

    if (args.type) {
      filtered = filtered.filter((i) => i.type === args.type);
    }
    if (args.label) {
      filtered = filtered.filter((i) => i.labels.includes(args.label!));
    }
    if (args.priorityMin !== undefined) {
      filtered = filtered.filter((i) => i.priority >= args.priorityMin!);
    }
    if (args.priorityMax !== undefined) {
      filtered = filtered.filter((i) => i.priority <= args.priorityMax!);
    }

    return filtered.slice(0, limit);
  },
});

// Search issues by text
export const searchIssues = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const searchLower = args.query.toLowerCase();

    let issuesQuery;
    if (args.status) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_status", (q) => q.eq("status", args.status!));
    } else {
      issuesQuery = ctx.db.query("issues");
    }

    const allIssues = await issuesQuery.collect();

    // Search in title and description
    const matches = allIssues.filter((issue) => {
      const titleMatch = issue.title.toLowerCase().includes(searchLower);
      const descMatch = issue.description?.toLowerCase().includes(searchLower);
      const shortIdMatch = issue.shortId.toLowerCase().includes(searchLower);
      return titleMatch || descMatch || shortIdMatch;
    });

    return matches.slice(0, limit);
  },
});

// Get ready work (issues with no open blockers)
export const listReadyIssues = query({
  args: {
    limit: v.optional(v.number()),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get all open issues
    const openIssues = await ctx.db
      .query("issues")
      .withIndex("by_status_priority", (q) => q.eq("status", "open"))
      .order("asc") // Lower priority number = higher priority
      .collect();

    // Get all blocking dependencies
    const allDeps = await ctx.db.query("dependencies").collect();
    const blockingDeps = allDeps.filter((d) => d.type === "blocks");

    // Find issues that are blocked
    const blockedIssueIds = new Set<string>();
    for (const dep of blockingDeps) {
      const blocker = await ctx.db.get(dep.toIssue);
      if (blocker && blocker.status !== "closed") {
        blockedIssueIds.add(dep.fromIssue);
      }
    }

    // Filter to ready issues (not blocked)
    let readyIssues = openIssues.filter(
      (issue) => !blockedIssueIds.has(issue._id)
    );

    if (args.assignee) {
      readyIssues = readyIssues.filter((i) => i.assignee === args.assignee);
    }

    return readyIssues.slice(0, limit);
  },
});

// Get blocked issues (issues that have open blockers)
export const listBlockedIssues = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Get all open issues
    const openIssues = await ctx.db
      .query("issues")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();

    // Get all blocking dependencies
    const allDeps = await ctx.db.query("dependencies").collect();
    const blockingDeps = allDeps.filter((d) => d.type === "blocks");

    // Find issues that are blocked and their blockers
    const blockedIssues: Array<{
      issue: (typeof openIssues)[0];
      blockedBy: Array<{ dependency: (typeof blockingDeps)[0]; blocker: (typeof openIssues)[0] | null }>;
    }> = [];

    for (const issue of openIssues) {
      const blockers = blockingDeps.filter((d) => d.fromIssue === issue._id);
      const openBlockers = [];

      for (const dep of blockers) {
        const blocker = await ctx.db.get(dep.toIssue);
        if (blocker && blocker.status !== "closed") {
          openBlockers.push({ dependency: dep, blocker });
        }
      }

      if (openBlockers.length > 0) {
        blockedIssues.push({ issue, blockedBy: openBlockers });
      }
    }

    return blockedIssues.slice(0, limit);
  },
});

// Get a single issue with its events
export const getIssue = query({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) return null;

    const events = await ctx.db
      .query("issueEvents")
      .withIndex("by_issue", (q) => q.eq("issue", args.issueId))
      .order("desc")
      .take(50);

    return { issue, events };
  },
});

// Get issue by short ID
export const getIssueByShortId = query({
  args: {
    shortId: v.string(),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();

    return issue;
  },
});

// Get issue statistics
export const getIssueStats = query({
  args: {},
  handler: async (ctx) => {
    const allIssues = await ctx.db.query("issues").collect();

    const byStatus = { open: 0, in_progress: 0, closed: 0 };
    const byType = { bug: 0, feature: 0, task: 0, epic: 0, chore: 0 };
    const byPriority = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    const labelCounts: Record<string, number> = {};

    for (const issue of allIssues) {
      byStatus[issue.status]++;
      byType[issue.type]++;
      byPriority[issue.priority as 0 | 1 | 2 | 3 | 4]++;
      for (const label of issue.labels) {
        labelCounts[label] = (labelCounts[label] || 0) + 1;
      }
    }

    // Get ready count
    const deps = await ctx.db.query("dependencies").collect();
    const blockingDeps = deps.filter((d) => d.type === "blocks");
    const blockedIds = new Set<string>();
    for (const dep of blockingDeps) {
      const blocker = await ctx.db.get(dep.toIssue);
      if (blocker && blocker.status !== "closed") {
        blockedIds.add(dep.fromIssue);
      }
    }
    const readyCount = allIssues.filter(
      (i) => i.status === "open" && !blockedIds.has(i._id)
    ).length;

    return {
      total: allIssues.length,
      byStatus,
      byType,
      byPriority,
      labelCounts,
      readyCount,
      blockedCount: blockedIds.size,
    };
  },
});

// Get issue events (standalone query)
export const listIssueEvents = query({
  args: {
    issueId: v.id("issues"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const events = await ctx.db
      .query("issueEvents")
      .withIndex("by_issue", (q) => q.eq("issue", args.issueId))
      .order("desc")
      .take(limit);

    return events;
  },
});

// =============================================================================
// MUTATIONS
// =============================================================================

// Create an issue
export const createIssue = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
    priority: v.optional(v.number()),
    assignee: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    parentIssue: v.optional(v.id("issues")),
    // Optional repo config for workflow execution
    gitRemote: v.optional(v.string()),
    gitBranch: v.optional(v.string()),
    installationId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get user ID from auth (optional - issues can be created without auth)
    const identity = await ctx.auth.getUserIdentity();
    const userId = identity?.subject;

    const now = Date.now();
    let shortId: string;

    // If parent issue exists, generate hierarchical ID
    if (args.parentIssue) {
      const parent = await ctx.db.get(args.parentIssue);
      if (parent) {
        // Count existing children to determine next number
        const children = await ctx.db
          .query("issues")
          .withIndex("by_parent", (q) => q.eq("parentIssue", args.parentIssue))
          .collect();
        const nextNum = children.length + 1;
        shortId = `${parent.shortId}.${nextNum}`;
      } else {
        shortId = generateShortId();
      }
    } else {
      shortId = generateShortId();
    }

    const issueId = await ctx.db.insert("issues", {
      shortId,
      userId, // Owner of the issue (from auth)
      title: args.title,
      description: args.description,
      status: "open",
      priority: args.priority ?? 2,
      type: args.type ?? "task",
      assignee: args.assignee,
      labels: args.labels ?? [],
      parentIssue: args.parentIssue,
      isCompacted: false,
      // Optional repo config
      gitRemote: args.gitRemote,
      gitBranch: args.gitBranch,
      installationId: args.installationId,
      createdAt: now,
      updatedAt: now,
    });

    // If parent exists, create parent-child dependency
    if (args.parentIssue) {
      await ctx.db.insert("dependencies", {
        fromIssue: issueId,
        toIssue: args.parentIssue,
        type: "parent_child",
        createdAt: now,
      });
    }

    await ctx.db.insert("issueEvents", {
      issue: issueId,
      type: "created",
      data: { title: args.title, type: args.type ?? "task", shortId },
      createdAt: now,
    });

    return { issueId, shortId };
  },
});

// Update an issue
export const updateIssue = mutation({
  args: {
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
    priority: v.optional(v.number()),
    assignee: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (args.title !== undefined && args.title !== issue.title) {
      updates.title = args.title;
      changes.title = { from: issue.title, to: args.title };
    }
    if (args.description !== undefined && args.description !== issue.description) {
      updates.description = args.description;
      changes.description = { from: issue.description, to: args.description };
    }
    if (args.status !== undefined && args.status !== issue.status) {
      updates.status = args.status;
      changes.status = { from: issue.status, to: args.status };
      if (args.status === "closed") {
        updates.closedAt = now;
      }
    }
    if (args.priority !== undefined && args.priority !== issue.priority) {
      updates.priority = args.priority;
      changes.priority = { from: issue.priority, to: args.priority };
    }
    if (args.assignee !== undefined && args.assignee !== issue.assignee) {
      updates.assignee = args.assignee;
      changes.assignee = { from: issue.assignee, to: args.assignee };
    }
    if (args.labels !== undefined) {
      updates.labels = args.labels;
      changes.labels = { from: issue.labels, to: args.labels };
    }

    await ctx.db.patch(args.issueId, updates);

    if (Object.keys(changes).length > 0) {
      await ctx.db.insert("issueEvents", {
        issue: args.issueId,
        type: "updated",
        data: changes,
        createdAt: now,
      });
    }

    return { success: true };
  },
});

// Close an issue
export const closeIssue = mutation({
  args: {
    issueId: v.id("issues"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const now = Date.now();

    await ctx.db.patch(args.issueId, {
      status: "closed",
      closedAt: now,
      closedReason: args.reason,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "closed",
      data: { reason: args.reason },
      createdAt: now,
    });

    return { success: true };
  },
});

// Reopen an issue
export const reopenIssue = mutation({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    const now = Date.now();

    await ctx.db.patch(args.issueId, {
      status: "open",
      closedAt: undefined,
      closedReason: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "reopened",
      data: {},
      createdAt: now,
    });

    return { success: true };
  },
});

// Delete an issue
export const deleteIssue = mutation({
  args: {
    issueId: v.id("issues"),
    cascade: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    // Get all dependencies involving this issue
    const depsFrom = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.issueId))
      .collect();
    const depsTo = await ctx.db
      .query("dependencies")
      .withIndex("by_to", (q) => q.eq("toIssue", args.issueId))
      .collect();

    // If cascade, delete child issues
    if (args.cascade) {
      const children = await ctx.db
        .query("issues")
        .withIndex("by_parent", (q) => q.eq("parentIssue", args.issueId))
        .collect();

      for (const child of children) {
        // Recursively delete children
        await ctx.db.delete(child._id);
        // Delete their events
        const childEvents = await ctx.db
          .query("issueEvents")
          .withIndex("by_issue", (q) => q.eq("issue", child._id))
          .collect();
        for (const event of childEvents) {
          await ctx.db.delete(event._id);
        }
      }
    }

    // Delete all dependencies
    for (const dep of [...depsFrom, ...depsTo]) {
      await ctx.db.delete(dep._id);
    }

    // Delete all events for this issue
    const events = await ctx.db
      .query("issueEvents")
      .withIndex("by_issue", (q) => q.eq("issue", args.issueId))
      .collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }

    // Delete the issue
    await ctx.db.delete(args.issueId);

    return { success: true, deletedId: issue.shortId };
  },
});

// =============================================================================
// LABELS
// =============================================================================

// Add a label to an issue
export const addIssueLabel = mutation({
  args: {
    issueId: v.id("issues"),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    if (issue.labels.includes(args.label)) {
      return { success: true, alreadyExists: true };
    }

    const now = Date.now();
    const newLabels = [...issue.labels, args.label];

    await ctx.db.patch(args.issueId, {
      labels: newLabels,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "label_added",
      data: { label: args.label },
      createdAt: now,
    });

    return { success: true };
  },
});

// Remove a label from an issue
export const removeIssueLabel = mutation({
  args: {
    issueId: v.id("issues"),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");

    if (!issue.labels.includes(args.label)) {
      return { success: true, notFound: true };
    }

    const now = Date.now();
    const newLabels = issue.labels.filter((l) => l !== args.label);

    await ctx.db.patch(args.issueId, {
      labels: newLabels,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "label_removed",
      data: { label: args.label },
      createdAt: now,
    });

    return { success: true };
  },
});

// =============================================================================
// DEPENDENCIES
// =============================================================================

// Add a dependency
export const addIssueDependency = mutation({
  args: {
    fromIssue: v.id("issues"),
    toIssue: v.id("issues"),
    type: v.optional(
      v.union(
        v.literal("blocks"),
        v.literal("related"),
        v.literal("parent_child"),
        v.literal("discovered_from")
      )
    ),
  },
  handler: async (ctx, args) => {
    const from = await ctx.db.get(args.fromIssue);
    const to = await ctx.db.get(args.toIssue);
    if (!from || !to) throw new Error("Issue not found");

    // Prevent self-dependency
    if (args.fromIssue === args.toIssue) {
      throw new Error("Cannot create dependency to self");
    }

    // Check for existing dependency
    const existing = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.fromIssue))
      .filter((q) => q.eq(q.field("toIssue"), args.toIssue))
      .first();

    if (existing) throw new Error("Dependency already exists");

    const depId = await ctx.db.insert("dependencies", {
      fromIssue: args.fromIssue,
      toIssue: args.toIssue,
      type: args.type ?? "blocks",
      createdAt: Date.now(),
    });

    return depId;
  },
});

// Remove a dependency
export const removeIssueDependency = mutation({
  args: {
    fromIssue: v.id("issues"),
    toIssue: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const dep = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.fromIssue))
      .filter((q) => q.eq(q.field("toIssue"), args.toIssue))
      .first();

    if (dep) {
      await ctx.db.delete(dep._id);
    }

    return { success: true };
  },
});

// Get dependencies for an issue
export const getIssueDependencies = query({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, args) => {
    const dependsOn = await ctx.db
      .query("dependencies")
      .withIndex("by_from", (q) => q.eq("fromIssue", args.issueId))
      .collect();

    const blockedBy = await ctx.db
      .query("dependencies")
      .withIndex("by_to", (q) => q.eq("toIssue", args.issueId))
      .collect();

    const dependsOnIssues = await Promise.all(
      dependsOn.map(async (d) => ({
        dependency: d,
        issue: await ctx.db.get(d.toIssue),
      }))
    );

    const blockedByIssues = await Promise.all(
      blockedBy.map(async (d) => ({
        dependency: d,
        issue: await ctx.db.get(d.fromIssue),
      }))
    );

    return {
      dependsOn: dependsOnIssues,
      blockedBy: blockedByIssues,
    };
  },
});

// Get dependency tree for an issue
export const getIssueDependencyTree = query({
  args: {
    issueId: v.id("issues"),
    maxDepth: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxDepth = args.maxDepth ?? 10;
    const visited = new Set<string>();

    type TreeNode = {
      issue: Awaited<ReturnType<typeof ctx.db.get>>;
      dependsOn: TreeNode[];
      depth: number;
    };

    async function buildTree(
      issueId: Id<"issues">,
      depth: number
    ): Promise<TreeNode | null> {
      if (depth > maxDepth || visited.has(issueId)) {
        return null;
      }
      visited.add(issueId);

      const issue = await ctx.db.get(issueId);
      if (!issue) return null;

      const deps = await ctx.db
        .query("dependencies")
        .withIndex("by_from", (q) => q.eq("fromIssue", issueId))
        .filter((q) => q.eq(q.field("type"), "blocks"))
        .collect();

      const children: TreeNode[] = [];
      for (const dep of deps) {
        const child = await buildTree(dep.toIssue, depth + 1);
        if (child) children.push(child);
      }

      return { issue, dependsOn: children, depth };
    }

    const tree = await buildTree(args.issueId, 0);
    return tree;
  },
});

// Detect dependency cycles
export const detectDependencyCycles = query({
  args: {},
  handler: async (ctx) => {
    const allDeps = await ctx.db.query("dependencies").collect();
    const blockingDeps = allDeps.filter((d) => d.type === "blocks");

    // Build adjacency list
    const graph = new Map<string, string[]>();
    for (const dep of blockingDeps) {
      const from = dep.fromIssue;
      const to = dep.toIssue;
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from)!.push(to);
    }

    // DFS to detect cycles
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycles: string[][] = [];

    function dfs(node: string, path: string[]): boolean {
      visited.add(node);
      recStack.add(node);
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor, path)) return true;
        } else if (recStack.has(neighbor)) {
          // Found cycle
          const cycleStart = path.indexOf(neighbor);
          cycles.push(path.slice(cycleStart));
          return true;
        }
      }

      path.pop();
      recStack.delete(node);
      return false;
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node, []);
      }
    }

    // Fetch issue details for cycles
    const cyclesWithDetails = await Promise.all(
      cycles.map(async (cycle) => {
        const issues = await Promise.all(
          cycle.map((id) => ctx.db.get(id as Id<"issues">))
        );
        return issues.filter(Boolean);
      })
    );

    return {
      hasCycles: cycles.length > 0,
      cycles: cyclesWithDetails,
    };
  },
});

// =============================================================================
// COMPACTION (Memory Decay)
// =============================================================================

// Get compaction candidates (closed issues older than threshold)
export const listCompactionCandidates = query({
  args: {
    daysOld: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const daysOld = args.daysOld ?? 30;
    const limit = args.limit ?? 50;
    const threshold = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    const closedIssues = await ctx.db
      .query("issues")
      .withIndex("by_status", (q) => q.eq("status", "closed"))
      .collect();

    const candidates = closedIssues.filter(
      (issue) =>
        !issue.isCompacted &&
        issue.closedAt &&
        issue.closedAt < threshold
    );

    return candidates.slice(0, limit);
  },
});

// Apply compaction to an issue
export const compactIssue = mutation({
  args: {
    issueId: v.id("issues"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.issueId);
    if (!issue) throw new Error("Issue not found");
    if (issue.status !== "closed") throw new Error("Can only compact closed issues");

    const now = Date.now();

    await ctx.db.patch(args.issueId, {
      isCompacted: true,
      compactedSummary: args.summary,
      // Clear the full description to save space
      description: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: args.issueId,
      type: "compacted",
      data: { summaryLength: args.summary.length },
      createdAt: now,
    });

    return { success: true };
  },
});

// =============================================================================
// ENHANCED QUERIES FOR UI
// =============================================================================

// Get all issues with full dependency graph (for tree view)
export const listIssuesWithDependencyGraph = query({
  args: {
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
  },
  handler: async (ctx, args) => {
    // Get all issues
    let issuesQuery;
    if (args.status) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_status", (q) => q.eq("status", args.status!));
    } else {
      issuesQuery = ctx.db.query("issues");
    }

    let issues = await issuesQuery.collect();

    if (args.type) {
      issues = issues.filter((i) => i.type === args.type);
    }

    // Get all dependencies
    const allDeps = await ctx.db.query("dependencies").collect();

    // Build dependency maps
    const blockedByMap: Record<string, Array<{ issueId: string; type: string }>> = {};
    const blocksMap: Record<string, Array<{ issueId: string; type: string }>> = {};
    const childrenMap: Record<string, string[]> = {};

    for (const dep of allDeps) {
      const fromId = dep.fromIssue as string;
      const toId = dep.toIssue as string;

      if (dep.type === "parent_child") {
        // fromIssue is child, toIssue is parent
        if (!childrenMap[toId]) childrenMap[toId] = [];
        childrenMap[toId].push(fromId);
      } else if (dep.type === "blocks") {
        // fromIssue is blocked BY toIssue
        if (!blockedByMap[fromId]) blockedByMap[fromId] = [];
        blockedByMap[fromId].push({ issueId: toId, type: dep.type });

        if (!blocksMap[toId]) blocksMap[toId] = [];
        blocksMap[toId].push({ issueId: fromId, type: dep.type });
      } else {
        // related, discovered_from - treat as soft links
        if (!blockedByMap[fromId]) blockedByMap[fromId] = [];
        blockedByMap[fromId].push({ issueId: toId, type: dep.type });
      }
    }

    // Sort issues by priority then by creation date
    issues.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.createdAt - a.createdAt;
    });

    // Return issues with their relationships
    return {
      issues: issues.map((issue) => ({
        ...issue,
        blockedBy: blockedByMap[issue._id] || [],
        blocks: blocksMap[issue._id] || [],
        children: childrenMap[issue._id] || [],
      })),
      // Also return a map for quick lookup
      issueMap: Object.fromEntries(issues.map((i) => [i._id, i])),
    };
  },
});

// List issues with dependency counts (for issue list view)
export const listIssuesWithDependencies = query({
  args: {
    limit: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("open"), v.literal("in_progress"), v.literal("closed"))
    ),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Get issues
    let issuesQuery;
    if (args.status) {
      issuesQuery = ctx.db
        .query("issues")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc");
    } else {
      issuesQuery = ctx.db.query("issues").order("desc");
    }

    let issues = await issuesQuery.take(limit * 2);

    if (args.type) {
      issues = issues.filter((i) => i.type === args.type);
    }

    issues = issues.slice(0, limit);

    // Get all dependencies
    const allDeps = await ctx.db.query("dependencies").collect();

    // Build maps for quick lookup
    const blockedByCount: Record<string, number> = {};
    const blocksCount: Record<string, number> = {};

    for (const dep of allDeps) {
      if (dep.type === "blocks") {
        // dep.fromIssue is blocked BY dep.toIssue
        // So dep.toIssue blocks dep.fromIssue
        const blockerId = dep.toIssue;
        const blockedId = dep.fromIssue;

        // Check if the blocker is still open
        const blocker = await ctx.db.get(blockerId);
        if (blocker && blocker.status !== "closed") {
          blockedByCount[blockedId] = (blockedByCount[blockedId] || 0) + 1;
          blocksCount[blockerId] = (blocksCount[blockerId] || 0) + 1;
        }
      }
    }

    return issues.map((issue) => ({
      ...issue,
      blockedByCount: blockedByCount[issue._id] || 0,
      blocksCount: blocksCount[issue._id] || 0,
    }));
  },
});

// =============================================================================
// LIST ISSUES BY USER (for issue-solver-polling)
// =============================================================================

// List open issues for a specific user (public query for external polling services)
export const listOpenIssuesForUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const issues = await ctx.db
      .query("issues")
      .withIndex("by_userId_status", (q) =>
        q.eq("userId", args.userId).eq("status", "open")
      )
      .take(limit);

    return issues;
  },
});

// =============================================================================
// CLAIM ISSUE FOR PROCESSING (atomic operation to prevent duplicates)
// =============================================================================

// Atomically claim an issue for processing - returns the issue only if it's still "open"
export const claimIssueForProcessing = mutation({
  args: {
    issueId: v.id("issues"),
  },
  handler: async (ctx, { issueId }) => {
    const issue = await ctx.db.get(issueId);

    // Only claim if the issue exists and is still open
    if (!issue || issue.status !== "open") {
      return null; // Already claimed or doesn't exist
    }

    const now = Date.now();

    // Mark as in_progress
    await ctx.db.patch(issueId, {
      status: "in_progress",
      updatedAt: now,
    });

    // Add event
    await ctx.db.insert("issueEvents", {
      issue: issueId,
      type: "updated",
      data: { status: { from: "open", to: "in_progress" } },
      actor: "issue-solver",
      createdAt: now,
    });

    return issue;
  },
});

// =============================================================================
// INTERNAL MUTATIONS (for GitHub integration)
// =============================================================================

// Check if a GitHub issue already exists in our system
export const getIssueByGitHub = internalQuery({
  args: {
    githubRepo: v.string(),
    githubIssueNumber: v.number(),
  },
  handler: async (ctx, { githubRepo, githubIssueNumber }) => {
    return await ctx.db
      .query("issues")
      .withIndex("by_github_issue", (q) =>
        q.eq("githubRepo", githubRepo).eq("githubIssueNumber", githubIssueNumber)
      )
      .first();
  },
});

// Create an issue from GitHub (internal mutation for githubMonitor)
export const createIssueFromGitHub = internalMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    type: v.optional(
      v.union(
        v.literal("bug"),
        v.literal("feature"),
        v.literal("task"),
        v.literal("epic"),
        v.literal("chore")
      )
    ),
    priority: v.optional(v.number()),
    labels: v.optional(v.array(v.string())),
    // GitHub-specific fields
    githubIssueUrl: v.string(),
    githubIssueNumber: v.number(),
    githubRepo: v.string(),
    // Repo config for workflow execution
    gitRemote: v.string(),
    gitBranch: v.string(),
    installationId: v.optional(v.number()),
    // Owner of the issue (user who owns the repo)
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check for existing issue with same GitHub repo and issue number
    const existing = await ctx.db
      .query("issues")
      .withIndex("by_github_issue", (q) =>
        q.eq("githubRepo", args.githubRepo).eq("githubIssueNumber", args.githubIssueNumber)
      )
      .first();

    if (existing) {
      // Return existing issue instead of creating duplicate
      return { issueId: existing._id, shortId: existing.shortId, alreadyExists: true };
    }

    const now = Date.now();
    const shortId = generateShortId();

    const issueId = await ctx.db.insert("issues", {
      shortId,
      userId: args.userId, // Owner of the issue
      title: args.title,
      description: args.description,
      status: "open",
      priority: args.priority ?? 2,
      type: args.type ?? "task",
      assignee: "Grok", // Assigned to the AI agent
      labels: args.labels ?? ["github"],
      isCompacted: false,
      // GitHub fields
      githubIssueUrl: args.githubIssueUrl,
      githubIssueNumber: args.githubIssueNumber,
      githubRepo: args.githubRepo,
      // Repo config
      gitRemote: args.gitRemote,
      gitBranch: args.gitBranch,
      installationId: args.installationId,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("issueEvents", {
      issue: issueId,
      type: "created",
      data: {
        title: args.title,
        type: args.type ?? "task",
        shortId,
        source: "github",
        githubUrl: args.githubIssueUrl,
      },
      actor: "Grok",
      createdAt: now,
    });

    return { issueId, shortId };
  },
});
