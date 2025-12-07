import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

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
