import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

// Get repo by full name with installation ID (for workflow/API use)
export const getRepoWithInstallation = query({
  args: { fullName: v.string() },
  handler: async (ctx, { fullName }) => {
    // Find the repo by fullName
    const repo = await ctx.db
      .query("repos")
      .withIndex("by_fullName", (q) => q.eq("fullName", fullName))
      .first();

    if (!repo) return null;

    // Get the connection to get installation ID
    let installationId: number | undefined;
    if (repo.connectionId) {
      const connection = await ctx.db.get(repo.connectionId);
      installationId = connection?.installationId ?? undefined;
    }

    return {
      fullName: repo.fullName,
      gitRemote: repo.gitRemote,
      defaultBranch: repo.defaultBranch,
      installationId,
      scripts: repo.scripts,
    };
  },
});

// List all repos for the current user
export const getAllRepos = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;
    return await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Get repos grouped by organization
export const getReposByOrg = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {};

    const userId = identity.subject;
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Group by organization
    const reposByOrg = repos.reduce(
      (acc, repo) => {
        if (!acc[repo.org]) {
          acc[repo.org] = [];
        }
        acc[repo.org].push(repo);
        return acc;
      },
      {} as Record<string, typeof repos>
    );

    return reposByOrg;
  },
});

// Get repo by full name
export const getRepoByFullName = query({
  args: { fullName: v.string() },
  handler: async (ctx, { fullName }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const userId = identity.subject;
    const repo = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("fullName"), fullName))
      .first();

    return repo ?? null;
  },
});

// Check if user has any repos
export const hasRepos = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;

    const userId = identity.subject;
    const existing = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(1);
    return existing.length > 0;
  },
});

// Internal query to check if user has repos
export const hasReposForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(1);
    return existing.length > 0;
  },
});

// Sync repos for an installation
export const syncReposForInstallation = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("providerConnections"),
    repos: v.array(
      v.object({
        fullName: v.string(),
        org: v.string(),
        name: v.string(),
        gitRemote: v.string(),
        providerRepoId: v.optional(v.number()),
        ownerLogin: v.optional(v.string()),
        ownerType: v.optional(
          v.union(v.literal("User"), v.literal("Organization"))
        ),
        visibility: v.optional(
          v.union(v.literal("public"), v.literal("private"))
        ),
        defaultBranch: v.optional(v.string()),
        lastPushedAt: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, { userId, connectionId, repos }) => {
    if (repos.length === 0) {
      return { inserted: 0, updated: 0 } as const;
    }

    const existing = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const existingByFullName = new Map<string, Doc<"repos">>(
      existing.map((repo) => [repo.fullName, repo])
    );

    const now = Date.now();

    const results = await Promise.all(
      repos.map(async (repo) => {
        const current = existingByFullName.get(repo.fullName);
        if (!current) {
          await ctx.db.insert("repos", {
            fullName: repo.fullName,
            org: repo.org,
            name: repo.name,
            gitRemote: repo.gitRemote,
            provider: "github",
            userId,
            providerRepoId: repo.providerRepoId,
            ownerLogin: repo.ownerLogin,
            ownerType: repo.ownerType,
            visibility: repo.visibility,
            defaultBranch: repo.defaultBranch,
            lastPushedAt: repo.lastPushedAt,
            lastSyncedAt: now,
            connectionId,
          });
          return { inserted: 1, updated: 0 };
        }

        const patch: Partial<Doc<"repos">> = {};

        if (!current.connectionId || current.connectionId !== connectionId) {
          patch.connectionId = connectionId;
        }
        if (current.provider !== "github") {
          patch.provider = "github";
        }
        if (
          repo.providerRepoId !== undefined &&
          current.providerRepoId !== repo.providerRepoId
        ) {
          patch.providerRepoId = repo.providerRepoId;
        }
        if (repo.ownerLogin && current.ownerLogin !== repo.ownerLogin) {
          patch.ownerLogin = repo.ownerLogin;
        }
        if (repo.ownerType && current.ownerType !== repo.ownerType) {
          patch.ownerType = repo.ownerType;
        }
        if (repo.visibility && current.visibility !== repo.visibility) {
          patch.visibility = repo.visibility;
        }
        if (repo.defaultBranch && current.defaultBranch !== repo.defaultBranch) {
          patch.defaultBranch = repo.defaultBranch;
        }
        if (
          repo.lastPushedAt !== undefined &&
          (current.lastPushedAt === undefined ||
            repo.lastPushedAt > current.lastPushedAt)
        ) {
          patch.lastPushedAt = repo.lastPushedAt;
        }
        if ((current.lastSyncedAt ?? 0) < now) {
          patch.lastSyncedAt = now;
        }

        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(current._id, patch);
          return { inserted: 0, updated: 1 };
        }

        return { inserted: 0, updated: 0 };
      })
    );

    return results.reduce(
      (acc, result) => ({
        inserted: acc.inserted + result.inserted,
        updated: acc.updated + result.updated,
      }),
      { inserted: 0, updated: 0 }
    );
  },
});

// Upsert a repo manually
export const upsertRepo = mutation({
  args: {
    fullName: v.string(),
    org: v.string(),
    name: v.string(),
    gitRemote: v.string(),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;
    const now = Date.now();

    // Check if repo already exists
    const existing = await ctx.db
      .query("repos")
      .withIndex("by_gitRemote", (q) => q.eq("gitRemote", args.gitRemote))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();

    if (existing) {
      // Update existing repo
      return await ctx.db.patch(existing._id, {
        fullName: args.fullName,
        org: args.org,
        name: args.name,
        gitRemote: args.gitRemote,
        provider: args.provider,
        lastSyncedAt: now,
      });
    } else {
      // Insert new repo
      return await ctx.db.insert("repos", {
        fullName: args.fullName,
        org: args.org,
        name: args.name,
        gitRemote: args.gitRemote,
        provider: args.provider || "github",
        userId,
        lastSyncedAt: now,
      });
    }
  },
});

// Bulk insert repos
export const bulkInsertRepos = mutation({
  args: {
    repos: v.array(
      v.object({
        fullName: v.string(),
        org: v.string(),
        name: v.string(),
        gitRemote: v.string(),
        provider: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { repos }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;

    // Get existing repos to check for duplicates
    const existingRepos = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const existingRepoNames = new Set(existingRepos.map((r) => r.fullName));

    // Only insert repos that don't already exist
    const newRepos = repos.filter(
      (repo) => !existingRepoNames.has(repo.fullName)
    );

    const now = Date.now();
    const insertedIds = await Promise.all(
      newRepos.map((repo) =>
        ctx.db.insert("repos", {
          ...repo,
          provider: repo.provider || "github",
          userId,
          lastSyncedAt: now,
        })
      )
    );
    return insertedIds;
  },
});

// Delete a repo
export const deleteRepo = mutation({
  args: { id: v.id("repos") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const repo = await ctx.db.get(id);
    if (!repo) throw new Error("Repo not found");
    if (repo.userId !== identity.subject) throw new Error("Not authorized");

    await ctx.db.delete(id);
  },
});

// Update scripts for a repo (env vars stored in Stack Auth Data Vault, not here)
export const updateRepoScripts = mutation({
  args: {
    repoId: v.id("repos"),
    scripts: v.object({
      maintenanceScript: v.string(),
      devScript: v.string(),
    }),
  },
  handler: async (ctx, { repoId, scripts }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const repo = await ctx.db.get(repoId);
    if (!repo) throw new Error("Repo not found");
    if (repo.userId !== identity.subject) throw new Error("Not authorized");

    await ctx.db.patch(repoId, { scripts });
    return { success: true };
  },
});

// Get repo by ID (with scripts)
export const getRepoById = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, { repoId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const repo = await ctx.db.get(repoId);
    if (!repo) return null;
    if (repo.userId !== identity.subject) return null;

    return repo;
  },
});

// ---------------------------------------------------------------------------
// ALGORITHM MONITORING
// ---------------------------------------------------------------------------

// Get all repos sorted by lastPushedAt (most active first)
export const getReposSortedByActivity = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Sort by lastPushedAt descending (most recent first)
    return repos.sort((a, b) => {
      const aTime = a.lastPushedAt ?? 0;
      const bTime = b.lastPushedAt ?? 0;
      return bTime - aTime;
    });
  },
});

// Get only monitored repos
export const getMonitoredRepos = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const userId = identity.subject;
    const repos = await ctx.db
      .query("repos")
      .withIndex("by_userId_monitored", (q) =>
        q.eq("userId", userId).eq("isMonitored", true)
      )
      .collect();

    // Sort by lastPushedAt descending (most active first)
    return repos.sort((a, b) => {
      const aTime = a.lastPushedAt ?? 0;
      const bTime = b.lastPushedAt ?? 0;
      return bTime - aTime;
    });
  },
});

// Toggle monitoring for a repo
export const toggleRepoMonitoring = mutation({
  args: { repoId: v.id("repos") },
  handler: async (ctx, { repoId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const repo = await ctx.db.get(repoId);
    if (!repo) throw new Error("Repo not found");
    if (repo.userId !== identity.subject) throw new Error("Not authorized");

    const newValue = !repo.isMonitored;
    await ctx.db.patch(repoId, { isMonitored: newValue });
    return { isMonitored: newValue };
  },
});

// Set monitoring for a repo explicitly
export const setRepoMonitoring = mutation({
  args: {
    repoId: v.id("repos"),
    isMonitored: v.boolean(),
  },
  handler: async (ctx, { repoId, isMonitored }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const repo = await ctx.db.get(repoId);
    if (!repo) throw new Error("Repo not found");
    if (repo.userId !== identity.subject) throw new Error("Not authorized");

    await ctx.db.patch(repoId, { isMonitored });
    return { isMonitored };
  },
});

// Public query to get the first monitored repo (for issue solver - no auth required)
// Returns the first monitored repo with installation ID, used as default for internal issues
export const getDefaultMonitoredRepo = query({
  args: {},
  handler: async (ctx) => {
    // Get first monitored repo (not user-specific)
    const repo = await ctx.db
      .query("repos")
      .filter((q) => q.eq(q.field("isMonitored"), true))
      .first();

    if (!repo) return null;

    // Get installation ID
    let installationId: number | undefined;
    if (repo.connectionId) {
      const connection = await ctx.db.get(repo.connectionId);
      installationId = connection?.installationId ?? undefined;
    }

    if (!installationId) return null;

    return {
      fullName: repo.fullName,
      gitRemote: repo.gitRemote,
      defaultBranch: repo.defaultBranch,
      installationId,
    };
  },
});

// Internal query to get monitored repos with their installation IDs (for githubMonitor action)
export const getMonitoredReposWithInstallation = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Get ALL monitored repos (not user-specific, for cron job)
    const repos = await ctx.db
      .query("repos")
      .filter((q) => q.eq(q.field("isMonitored"), true))
      .collect();

    // Get installation IDs for each repo
    const reposWithInstallation = await Promise.all(
      repos.map(async (repo) => {
        let installationId: number | undefined;
        if (repo.connectionId) {
          const connection = await ctx.db.get(repo.connectionId);
          installationId = connection?.installationId ?? undefined;
        }
        return {
          fullName: repo.fullName,
          gitRemote: repo.gitRemote,
          defaultBranch: repo.defaultBranch,
          userId: repo.userId, // Owner of the repo
          installationId,
        };
      })
    );

    return reposWithInstallation.filter((r) => r.installationId !== undefined);
  },
});

// ---------------------------------------------------------------------------
// ALGORITHM SETTINGS (per-user settings for autonomous agent)
// ---------------------------------------------------------------------------

// Default system prompt for Grok algorithm
const DEFAULT_GROK_SYSTEM_PROMPT = `You are curating a developer feed and deciding how to engage with the codebase. You have two options:

1. **Post about a PR** - Share an interesting Pull Request with the community
2. **Solve an Issue** - Pick an issue to work on and delegate to a coding agent

IMPORTANT: Aim for roughly 50/50 balance between these actions over time. Alternate between them - if you'd normally pick a PR, consider if there's a good issue to solve instead, and vice versa. Both actions are equally valuable.

For PRs, look for:
- Significant features or important bug fixes
- PRs that look ready to merge or need review
- Interesting technical changes

For Issues, look for:
- Tractable bugs or features that can realistically be solved
- Well-defined issues with clear requirements
- Issues that would provide clear value when fixed

Pick the most interesting item from whichever category you choose. Write engaging content that makes developers want to check it out.`;

// Get current user's algorithm settings
export const getAlgorithmSettings = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { enabled: false, prompt: null };

    const userId = identity.subject;
    const setting = await ctx.db
      .query("algorithmSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    return {
      enabled: setting?.enabled ?? false,
      prompt: setting?.prompt ?? null,
    };
  },
});

// Internal query to get algorithm settings for a specific user
export const getAlgorithmSettingsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const setting = await ctx.db
      .query("algorithmSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    return {
      enabled: setting?.enabled ?? false,
      prompt: setting?.prompt ?? null,
    };
  },
});

// Internal query to get all users with algorithm enabled
export const getUsersWithAlgorithmEnabled = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("algorithmSettings")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();

    return settings.map((s) => s.userId);
  },
});

// Public query to check if any user has algorithm enabled (for external polling services)
export const isAlgorithmEnabledGlobally = query({
  args: {},
  handler: async (ctx) => {
    const setting = await ctx.db
      .query("algorithmSettings")
      .filter((q) => q.eq(q.field("enabled"), true))
      .first();

    return { enabled: setting !== null };
  },
});

// Public query to get all enabled users with their settings (for issue-solver-polling)
export const getEnabledUsersWithSettings = query({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db
      .query("algorithmSettings")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();

    return settings.map((s) => ({
      userId: s.userId,
      prompt: s.prompt ?? null,
    }));
  },
});

// Internal query to get the first enabled user's algorithm settings (for cron job to use their prompt)
export const getFirstEnabledAlgorithmSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const setting = await ctx.db
      .query("algorithmSettings")
      .filter((q) => q.eq(q.field("enabled"), true))
      .first();

    if (!setting) return null;

    return {
      userId: setting.userId,
      enabled: setting.enabled,
      prompt: setting.prompt ?? null,
    };
  },
});

// Toggle algorithm enabled state
export const toggleAlgorithmEnabled = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;
    const now = Date.now();

    const existing = await ctx.db
      .query("algorithmSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      const newEnabled = !existing.enabled;
      await ctx.db.patch(existing._id, { enabled: newEnabled, updatedAt: now });
      return { enabled: newEnabled };
    } else {
      // Create with true (toggled from default false) and set default prompt
      await ctx.db.insert("algorithmSettings", {
        userId,
        enabled: true,
        prompt: DEFAULT_GROK_SYSTEM_PROMPT,
        updatedAt: now,
      });
      return { enabled: true };
    }
  },
});

// Set algorithm prompt
export const setAlgorithmPrompt = mutation({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const userId = identity.subject;
    const now = Date.now();

    const existing = await ctx.db
      .query("algorithmSettings")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { prompt, updatedAt: now });
    } else {
      await ctx.db.insert("algorithmSettings", {
        userId,
        enabled: false,
        prompt,
        updatedAt: now,
      });
    }
    return { prompt };
  },
});
