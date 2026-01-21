import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { authMutation, authQuery } from "./users/utils";

const SYSTEM_BRANCH_USER_ID = "__system__";

type WebhookUser = {
  login?: string;
  id?: number;
};

type WebhookRepo = {
  id?: number;
  pushed_at?: string;
};

type WebhookBranchRef = {
  ref?: string;
  sha?: string;
  repo?: WebhookRepo;
};

type WebhookPullRequest = {
  number?: number;
  id?: number;
  title?: string;
  state?: string;
  merged?: boolean;
  draft?: boolean;
  html_url?: string;
  merge_commit_sha?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  merged_at?: string;
  comments?: number;
  review_comments?: number;
  commits?: number;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  user?: WebhookUser;
  base?: WebhookBranchRef;
  head?: WebhookBranchRef;
};

type PullRequestWebhookEnvelope = {
  pull_request?: WebhookPullRequest;
  number?: number;
};

async function upsertBranchMetadata(
  ctx: MutationCtx,
  {
    teamId,
    repoFullName,
    branchName,
    baseSha,
    mergeCommitSha,
    headSha,
    activityTimestamp,
  }: {
    teamId: string;
    repoFullName: string;
    branchName: string;
    baseSha?: string;
    mergeCommitSha?: string;
    headSha?: string;
    activityTimestamp?: number;
  }
) {
  if (!baseSha && !mergeCommitSha && !headSha) {
    return;
  }

  const repoDoc = await ctx.db
    .query("repos")
    .withIndex("by_team", (q) => q.eq("teamId", teamId))
    .filter((q) => q.eq(q.field("fullName"), repoFullName))
    .first();
  const repoId = repoDoc?._id;

  // Query only for the system branch using .first() to minimize read set for OCC
  // User-created branches have their own update paths
  const systemBranch = await ctx.db
    .query("branches")
    .withIndex("by_repo", (q) => q.eq("repo", repoFullName))
    .filter((q) => q.eq(q.field("teamId"), teamId))
    .filter((q) => q.eq(q.field("name"), branchName))
    .filter((q) => q.eq(q.field("userId"), SYSTEM_BRANCH_USER_ID))
    .first();

  const timestamp = activityTimestamp ?? Date.now();
  const action = systemBranch ? "update" : "insert";

  console.log("[occ-debug:branches]", {
    branchName,
    repoFullName,
    teamId,
    action,
    repoDocFound: !!repoDoc,
  });

  if (systemBranch) {
    // Skip stale updates - if existing branch has newer activity, don't overwrite
    if (
      typeof systemBranch.lastActivityAt === "number" &&
      timestamp <= systemBranch.lastActivityAt
    ) {
      console.log("[occ-debug:branches] skipped-stale", {
        branchName,
        existingLastActivityAt: systemBranch.lastActivityAt,
        newTimestamp: timestamp,
      });
      return;
    }

    // Build patch with only changed fields (no-op check)
    const patch: Record<string, unknown> = {};
    if (repoId && systemBranch.repoId !== repoId) {
      patch.repoId = repoId;
    }
    if (baseSha && systemBranch.lastKnownBaseSha !== baseSha) {
      patch.lastKnownBaseSha = baseSha;
    }
    if (mergeCommitSha && systemBranch.lastKnownMergeCommitSha !== mergeCommitSha) {
      patch.lastKnownMergeCommitSha = mergeCommitSha;
    }
    if (headSha && systemBranch.lastCommitSha !== headSha) {
      patch.lastCommitSha = headSha;
    }
    patch.lastActivityAt = timestamp;

    if (Object.keys(patch).length > 1 || patch.lastActivityAt !== systemBranch.lastActivityAt) {
      await ctx.db.patch(systemBranch._id, patch);
    } else {
      console.log("[occ-debug:branches] skipped-noop", { branchName });
    }
  } else {
    await ctx.db.insert("branches", {
      repo: repoFullName,
      repoId,
      name: branchName,
      userId: SYSTEM_BRANCH_USER_ID,
      teamId,
      lastKnownBaseSha: baseSha,
      lastKnownMergeCommitSha: mergeCommitSha,
      lastCommitSha: headSha,
      lastActivityAt: timestamp,
    });
  }
}

async function upsertCore(
  ctx: MutationCtx,
  {
    teamId,
    installationId,
    repoFullName,
    number,
    record,
  }: {
    teamId: string;
    installationId: number;
    repoFullName: string;
    number: number;
    record: {
      providerPrId?: number;
      repositoryId?: number;
      title: string;
      state: "open" | "closed";
      merged?: boolean;
      draft?: boolean;
      authorLogin?: string;
      authorId?: number;
      htmlUrl?: string;
      baseRef?: string;
      headRef?: string;
      baseSha?: string;
      headSha?: string;
      mergeCommitSha?: string;
      createdAt?: number;
      updatedAt?: number;
      closedAt?: number;
      mergedAt?: number;
      commentsCount?: number;
      reviewCommentsCount?: number;
      commitsCount?: number;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
    };
  }
) {
  const existing = await ctx.db
    .query("pullRequests")
    .withIndex("by_team_repo_number", (q) =>
      q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", number)
    )
    .first();

  const action = existing ? "update" : "insert";
  console.log("[occ-debug:pull_requests]", {
    prNumber: number,
    repoFullName,
    teamId,
    action,
    state: record.state,
    merged: record.merged,
    baseRef: record.baseRef,
    headRef: record.headRef,
  });

  if (existing) {
    // Skip no-op updates - only patch if something actually changed
    const needsUpdate =
      existing.title !== record.title ||
      existing.state !== record.state ||
      existing.merged !== record.merged ||
      existing.draft !== record.draft ||
      existing.updatedAt !== record.updatedAt ||
      existing.closedAt !== record.closedAt ||
      existing.mergedAt !== record.mergedAt ||
      existing.headSha !== record.headSha ||
      existing.baseSha !== record.baseSha ||
      existing.mergeCommitSha !== record.mergeCommitSha;

    if (needsUpdate) {
      await ctx.db.patch(existing._id, {
        ...record,
        installationId,
        repoFullName,
        number,
        provider: "github",
        teamId,
      });
    } else {
      console.log("[occ-debug:pull_requests] skipped-noop", { prNumber: number });
    }
    return existing._id;
  }
  const id = await ctx.db.insert("pullRequests", {
    provider: "github",
    teamId,
    installationId,
    repoFullName,
    number,
    ...record,
  });
  return id;
}

export const upsertPullRequestInternal = internalMutation({
  args: {
    teamId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    number: v.number(),
    record: v.object({
      providerPrId: v.optional(v.number()),
      repositoryId: v.optional(v.number()),
      title: v.string(),
      state: v.union(v.literal("open"), v.literal("closed")),
      merged: v.optional(v.boolean()),
      draft: v.optional(v.boolean()),
      authorLogin: v.optional(v.string()),
      authorId: v.optional(v.number()),
      htmlUrl: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      baseSha: v.optional(v.string()),
      headSha: v.optional(v.string()),
      mergeCommitSha: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      closedAt: v.optional(v.number()),
      mergedAt: v.optional(v.number()),
      commentsCount: v.optional(v.number()),
      reviewCommentsCount: v.optional(v.number()),
      commitsCount: v.optional(v.number()),
      additions: v.optional(v.number()),
      deletions: v.optional(v.number()),
      changedFiles: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { teamId, installationId, repoFullName, number, record }) =>
    upsertCore(ctx, { teamId, installationId, repoFullName, number, record }),
});

export const listPullRequests = authQuery({
  args: {
    teamSlugOrId: v.string(),
    state: v.optional(v.union(v.literal("open"), v.literal("closed"), v.literal("all"))),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { teamSlugOrId, state, search, limit }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);

    const useState = state ?? "open";
    const cursor = ctx.db
      .query("pullRequests")
      .withIndex(
        useState === "all" ? "by_team" : "by_team_state",
        (q) =>
          useState === "all"
            ? q.eq("teamId", teamId)
            : q.eq("teamId", teamId).eq("state", useState)
      )
      .order("desc");

    const rows = await cursor.collect();
    const q = (search ?? "").trim().toLowerCase();
    const filtered = !q
      ? rows
      : rows.filter((r) => {
          return (
            r.title.toLowerCase().includes(q) ||
            (r.authorLogin ?? "").toLowerCase().includes(q) ||
            r.repoFullName.toLowerCase().includes(q)
          );
        });
    const limited = typeof limit === "number" ? filtered.slice(0, Math.max(1, limit)) : filtered;
    return limited;
  },
});

export const getPullRequest = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    number: v.number(),
  },
  handler: async (ctx, { teamSlugOrId, repoFullName, number }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);

    const pr = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q.eq("teamId", teamId).eq("repoFullName", repoFullName).eq("number", number)
      )
      .first();

    return pr ?? null;
  },
});

// Helper to look up a provider connection for a repository owner
export const getConnectionForOwnerInternal = internalQuery({
  args: { owner: v.string() },
  handler: async (ctx, { owner }) => {
    // If the same owner has multiple installations, this returns one arbitrarily.
    const row = await ctx.db
      .query("providerConnections")
      .filter((q) => q.eq(q.field("accountLogin"), owner))
      .first();
    return row ?? null;
  },
});

export const upsertFromWebhookPayload = internalMutation({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    teamId: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { installationId, repoFullName, teamId, payload }) => {
    try {
      const envelope = (payload ?? {}) as PullRequestWebhookEnvelope;
      const pr = envelope.pull_request ?? {};
      const number = Number(pr.number ?? envelope.number ?? 0);
      if (!number) return { ok: false as const };
      const mapStr = (value: unknown) =>
        typeof value === "string" ? value : undefined;
      const mapNum = (value: unknown) =>
        typeof value === "number" ? value : undefined;
      const ts = (s: unknown) => {
        if (typeof s !== "string") return undefined;
        const n = Date.parse(s);
        return Number.isFinite(n) ? n : undefined;
      };
      const baseRef = mapStr(pr.base?.ref);
      const headRef = mapStr(pr.head?.ref);
      const baseSha = mapStr(pr.base?.sha);
      const headSha = mapStr(pr.head?.sha);
      const mergeCommitSha = mapStr(pr.merge_commit_sha);
      const baseActivityTs =
        ts(pr.base?.repo?.pushed_at) ??
        ts(pr.merged_at) ??
        ts(pr.updated_at) ??
        Date.now();

      await upsertCore(ctx, {
        teamId,
        installationId,
        repoFullName,
        number,
        record: {
          providerPrId: mapNum(pr.id),
          repositoryId: mapNum(pr.base?.repo?.id),
          title: mapStr(pr.title) ?? "",
          state: mapStr(pr.state) === "closed" ? "closed" : "open",
          merged: Boolean(pr.merged),
          draft: Boolean(pr.draft),
          authorLogin: mapStr(pr.user?.login),
          authorId: mapNum(pr.user?.id),
          htmlUrl: mapStr(pr.html_url),
          baseRef,
          headRef,
          baseSha,
          headSha,
          mergeCommitSha,
          createdAt: ts(pr.created_at),
          updatedAt: ts(pr.updated_at),
          closedAt: ts(pr.closed_at),
          mergedAt: ts(pr.merged_at),
          commentsCount: mapNum(pr.comments),
          reviewCommentsCount: mapNum(pr.review_comments),
          commitsCount: mapNum(pr.commits),
          additions: mapNum(pr.additions),
          deletions: mapNum(pr.deletions),
          changedFiles: mapNum(pr.changed_files),
        },
      });

      if (baseRef && (baseSha || mergeCommitSha)) {
        await upsertBranchMetadata(ctx, {
          teamId,
          repoFullName,
          branchName: baseRef,
          baseSha,
          mergeCommitSha,
          activityTimestamp: baseActivityTs,
        });
      }
      if (headRef && headSha) {
        await upsertBranchMetadata(ctx, {
          teamId,
          repoFullName,
          branchName: headRef,
          headSha,
          activityTimestamp: ts(pr.updated_at) ?? Date.now(),
        });
      }
      return { ok: true as const };
    } catch (_e) {
      return { ok: false as const };
    }
  },
});

export const upsertFromServer = authMutation({
  args: {
    teamSlugOrId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    number: v.number(),
    record: v.object({
      providerPrId: v.optional(v.number()),
      repositoryId: v.optional(v.number()),
      title: v.string(),
      state: v.union(v.literal("open"), v.literal("closed")),
      merged: v.optional(v.boolean()),
      draft: v.optional(v.boolean()),
      authorLogin: v.optional(v.string()),
      authorId: v.optional(v.number()),
      htmlUrl: v.optional(v.string()),
      baseRef: v.optional(v.string()),
      headRef: v.optional(v.string()),
      baseSha: v.optional(v.string()),
      headSha: v.optional(v.string()),
      mergeCommitSha: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      closedAt: v.optional(v.number()),
      mergedAt: v.optional(v.number()),
      commentsCount: v.optional(v.number()),
      reviewCommentsCount: v.optional(v.number()),
      commitsCount: v.optional(v.number()),
      additions: v.optional(v.number()),
      deletions: v.optional(v.number()),
      changedFiles: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { teamSlugOrId, installationId, repoFullName, number, record }) => {
    const teamId = await getTeamId(ctx, teamSlugOrId);
    return await upsertCore(ctx, { teamId, installationId, repoFullName, number, record });
  },
});
