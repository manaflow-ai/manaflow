import { tool } from "ai";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// =============================================================================
// AI SDK Tools for Beads-style Issue Tracking
// =============================================================================

export const createIssueTool = tool({
  description:
    "Create a new issue for tracking bugs, features, tasks, epics, or chores. Returns the issue ID, short ID, and a link to view the issue. If a repository is relevant to this issue, include the repo config so the coding agent knows where to work.",
  inputSchema: z.object({
    title: z.string().describe("Title of the issue"),
    description: z.string().optional().describe("Detailed description"),
    type: z
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Type of issue (default: task)"),
    priority: z
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe("Priority 0-4 where 0 is highest (default: 2)"),
    assignee: z.string().optional().describe("Who is assigned to this issue"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Labels/tags for categorization"),
    // Optional repo config for workflow execution
    gitRemote: z
      .string()
      .optional()
      .describe("Git remote URL (e.g., https://github.com/owner/repo.git)"),
    gitBranch: z
      .string()
      .optional()
      .describe("Git branch to work on (default: main)"),
    installationId: z
      .number()
      .optional()
      .describe("GitHub App installation ID for authentication"),
  }),
  execute: async ({ title, description, type, priority, assignee, labels, gitRemote, gitBranch, installationId }) => {
    const result = await convex.mutation(api.issues.createIssue, {
      title,
      description,
      type,
      priority,
      assignee,
      labels,
      gitRemote,
      gitBranch,
      installationId,
    });
    return {
      ...result,
      url: `/issue/${result.shortId}`,
    };
  },
});

export const updateIssueTool = tool({
  description: "Update an existing issue's fields. Returns the updated issue with a link.",
  inputSchema: z.object({
    shortId: z.string().describe("Short ID of the issue (e.g., x-a1b2)"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z
      .enum(["open", "in_progress", "closed"])
      .optional()
      .describe("New status"),
    priority: z.number().min(0).max(4).optional().describe("New priority 0-4"),
    assignee: z.string().optional().describe("New assignee"),
    labels: z.array(z.string()).optional().describe("Replace all labels"),
  }),
  execute: async ({
    shortId,
    title,
    description,
    status,
    priority,
    assignee,
    labels,
  }) => {
    const issue = await convex.query(api.issues.getIssueByShortId, { shortId });
    if (!issue) throw new Error(`Issue ${shortId} not found`);

    const result = await convex.mutation(api.issues.updateIssue, {
      issueId: issue._id,
      title,
      description,
      status,
      priority,
      assignee,
      labels,
    });
    return {
      ...result,
      shortId,
      url: `/issue/${shortId}`,
    };
  },
});

export const closeIssueTool = tool({
  description: "Close an issue with an optional reason. Returns a link to the closed issue.",
  inputSchema: z.object({
    shortId: z.string().describe("Short ID of the issue (e.g., x-a1b2)"),
    reason: z.string().optional().describe("Reason for closing"),
  }),
  execute: async ({ shortId, reason }) => {
    const issue = await convex.query(api.issues.getIssueByShortId, { shortId });
    if (!issue) throw new Error(`Issue ${shortId} not found`);

    const result = await convex.mutation(api.issues.closeIssue, {
      issueId: issue._id,
      reason,
    });
    return {
      ...result,
      shortId,
      url: `/issue/${shortId}`,
    };
  },
});

export const reopenIssueTool = tool({
  description: "Reopen a closed issue. Returns a link to the reopened issue.",
  inputSchema: z.object({
    shortId: z.string().describe("Short ID of the issue (e.g., x-a1b2)"),
  }),
  execute: async ({ shortId }) => {
    const issue = await convex.query(api.issues.getIssueByShortId, { shortId });
    if (!issue) throw new Error(`Issue ${shortId} not found`);

    const result = await convex.mutation(api.issues.reopenIssue, {
      issueId: issue._id,
    });
    return {
      ...result,
      shortId,
      url: `/issue/${shortId}`,
    };
  },
});

export const listIssuesTool = tool({
  description: "List issues with optional filters. Each issue includes a link.",
  inputSchema: z.object({
    status: z
      .enum(["open", "in_progress", "closed"])
      .optional()
      .describe("Filter by status"),
    type: z
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Filter by type"),
    assignee: z.string().optional().describe("Filter by assignee"),
    label: z.string().optional().describe("Filter by label"),
    limit: z.number().optional().describe("Max results (default: 20)"),
  }),
  execute: async ({ status, type, assignee, label, limit }) => {
    const issues = await convex.query(api.issues.listIssues, {
      status,
      type,
      assignee,
      label,
      limit: limit ?? 20,
    });
    return issues.map((i) => ({
      shortId: i.shortId,
      title: i.title,
      status: i.status,
      type: i.type,
      priority: i.priority,
      assignee: i.assignee,
      labels: i.labels,
      url: `/issue/${i.shortId}`,
    }));
  },
});

export const listReadyIssuesTool = tool({
  description:
    "List issues that are ready to work on (open with no blocking dependencies). Each issue includes a link.",
  inputSchema: z.object({
    assignee: z.string().optional().describe("Filter by assignee"),
    limit: z.number().optional().describe("Max results (default: 10)"),
  }),
  execute: async ({ assignee, limit }) => {
    const issues = await convex.query(api.issues.listReadyIssues, {
      assignee,
      limit: limit ?? 10,
    });
    return issues.map((i) => ({
      shortId: i.shortId,
      title: i.title,
      priority: i.priority,
      type: i.type,
      assignee: i.assignee,
      url: `/issue/${i.shortId}`,
    }));
  },
});

export const searchIssuesTool = tool({
  description: "Search issues by text in title, description, or short ID. Each issue includes a link.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    status: z
      .enum(["open", "in_progress", "closed"])
      .optional()
      .describe("Filter by status"),
    limit: z.number().optional().describe("Max results (default: 10)"),
  }),
  execute: async ({ query, status, limit }) => {
    const issues = await convex.query(api.issues.searchIssues, {
      query,
      status,
      limit: limit ?? 10,
    });
    return issues.map((i) => ({
      shortId: i.shortId,
      title: i.title,
      status: i.status,
      type: i.type,
      description: i.description?.slice(0, 200),
      url: `/issue/${i.shortId}`,
    }));
  },
});

export const getIssueTool = tool({
  description: "Get detailed information about a specific issue. Includes a link to view the issue.",
  inputSchema: z.object({
    shortId: z.string().describe("Short ID of the issue (e.g., x-a1b2)"),
  }),
  execute: async ({ shortId }) => {
    const issue = await convex.query(api.issues.getIssueByShortId, { shortId });
    if (!issue) throw new Error(`Issue ${shortId} not found`);

    const deps = await convex.query(api.issues.getIssueDependencies, {
      issueId: issue._id,
    });

    return {
      ...issue,
      url: `/issue/${shortId}`,
      blockedBy: deps.dependsOn
        .filter((d) => d.dependency.type === "blocks")
        .map((d) => ({ shortId: d.issue?.shortId, url: `/issue/${d.issue?.shortId}` })),
      blocking: deps.blockedBy
        .filter((d) => d.dependency.type === "blocks")
        .map((d) => ({ shortId: d.issue?.shortId, url: `/issue/${d.issue?.shortId}` })),
    };
  },
});

export const addIssueLabelTool = tool({
  description: "Add a label to an issue. Returns a link to the issue.",
  inputSchema: z.object({
    shortId: z.string().describe("Short ID of the issue"),
    label: z.string().describe("Label to add"),
  }),
  execute: async ({ shortId, label }) => {
    const issue = await convex.query(api.issues.getIssueByShortId, { shortId });
    if (!issue) throw new Error(`Issue ${shortId} not found`);

    const result = await convex.mutation(api.issues.addIssueLabel, {
      issueId: issue._id,
      label,
    });
    return {
      ...result,
      shortId,
      url: `/issue/${shortId}`,
    };
  },
});

export const removeIssueLabelTool = tool({
  description: "Remove a label from an issue. Returns a link to the issue.",
  inputSchema: z.object({
    shortId: z.string().describe("Short ID of the issue"),
    label: z.string().describe("Label to remove"),
  }),
  execute: async ({ shortId, label }) => {
    const issue = await convex.query(api.issues.getIssueByShortId, { shortId });
    if (!issue) throw new Error(`Issue ${shortId} not found`);

    const result = await convex.mutation(api.issues.removeIssueLabel, {
      issueId: issue._id,
      label,
    });
    return {
      ...result,
      shortId,
      url: `/issue/${shortId}`,
    };
  },
});

export const addIssueDependencyTool = tool({
  description:
    "Add a dependency between issues. The 'from' issue depends on 'to' issue. Returns links to both issues.",
  inputSchema: z.object({
    fromShortId: z.string().describe("Short ID of the dependent issue"),
    toShortId: z.string().describe("Short ID of the blocking issue"),
    type: z
      .enum(["blocks", "related", "parent_child", "discovered_from"])
      .optional()
      .describe("Dependency type (default: blocks)"),
  }),
  execute: async ({ fromShortId, toShortId, type }) => {
    const fromIssue = await convex.query(api.issues.getIssueByShortId, {
      shortId: fromShortId,
    });
    const toIssue = await convex.query(api.issues.getIssueByShortId, {
      shortId: toShortId,
    });

    if (!fromIssue) throw new Error(`Issue ${fromShortId} not found`);
    if (!toIssue) throw new Error(`Issue ${toShortId} not found`);

    const dependencyId = await convex.mutation(api.issues.addIssueDependency, {
      fromIssue: fromIssue._id,
      toIssue: toIssue._id,
      type,
    });
    return {
      dependencyId,
      fromIssue: { shortId: fromShortId, url: `/issue/${fromShortId}` },
      toIssue: { shortId: toShortId, url: `/issue/${toShortId}` },
    };
  },
});

export const removeIssueDependencyTool = tool({
  description: "Remove a dependency between issues. Returns links to both issues.",
  inputSchema: z.object({
    fromShortId: z.string().describe("Short ID of the dependent issue"),
    toShortId: z.string().describe("Short ID of the blocking issue"),
  }),
  execute: async ({ fromShortId, toShortId }) => {
    const fromIssue = await convex.query(api.issues.getIssueByShortId, {
      shortId: fromShortId,
    });
    const toIssue = await convex.query(api.issues.getIssueByShortId, {
      shortId: toShortId,
    });

    if (!fromIssue) throw new Error(`Issue ${fromShortId} not found`);
    if (!toIssue) throw new Error(`Issue ${toShortId} not found`);

    await convex.mutation(api.issues.removeIssueDependency, {
      fromIssue: fromIssue._id,
      toIssue: toIssue._id,
    });
    return {
      success: true,
      fromIssue: { shortId: fromShortId, url: `/issue/${fromShortId}` },
      toIssue: { shortId: toShortId, url: `/issue/${toShortId}` },
    };
  },
});

export const getIssueStatsTool = tool({
  description: "Get statistics about all issues",
  inputSchema: z.object({}),
  execute: async () => {
    return await convex.query(api.issues.getIssueStats, {});
  },
});

export const detectCyclesTool = tool({
  description: "Check for circular dependencies in the issue graph",
  inputSchema: z.object({}),
  execute: async () => {
    return await convex.query(api.issues.detectDependencyCycles, {});
  },
});

// Export all tools as a single object for easy use
export const issueTools = {
  createIssue: createIssueTool,
  updateIssue: updateIssueTool,
  closeIssue: closeIssueTool,
  reopenIssue: reopenIssueTool,
  listIssues: listIssuesTool,
  listReadyIssues: listReadyIssuesTool,
  searchIssues: searchIssuesTool,
  getIssue: getIssueTool,
  addIssueLabel: addIssueLabelTool,
  removeIssueLabel: removeIssueLabelTool,
  addIssueDependency: addIssueDependencyTool,
  removeIssueDependency: removeIssueDependencyTool,
  getIssueStats: getIssueStatsTool,
  detectCycles: detectCyclesTool,
};
