import { v } from "convex/values";
import { getTeamId } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";
import {
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const MILLIS_THRESHOLD = 1_000_000_000_000;

const REACTION_FIELD_MAP = {
  "+1": "plusOne",
  "-1": "minusOne",
  laugh: "laugh",
  confused: "confused",
  heart: "heart",
  hooray: "hooray",
  rocket: "rocket",
  eyes: "eyes",
} as const;

type GithubReactionContent = keyof typeof REACTION_FIELD_MAP;
type ReactionContent = (typeof REACTION_FIELD_MAP)[GithubReactionContent];
type CommentSource = "issue" | "review";

type ReactionCounts = {
  totalCount?: number;
} & {
  [K in ReactionContent]?: number;
};

type CommentRecord = {
  providerCommentId: number;
  providerNodeId?: string;
  type: CommentSource;
  body?: string;
  bodyHtml?: string;
  bodyText?: string;
  authorLogin?: string;
  authorId?: number;
  authorAvatarUrl?: string;
  authorAssociation?: string;
  url?: string;
  htmlUrl?: string;
  inReplyToId?: number;
  reviewId?: number;
  path?: string;
  position?: number;
  originalPosition?: number;
  commitId?: string;
  originalCommitId?: string;
  diffHunk?: string;
  line?: number;
  originalLine?: number;
  side?: string;
  startLine?: number;
  startSide?: string;
  createdAt?: number;
  updatedAt?: number;
  submittedAt?: number;
  reactions?: ReactionCounts;
  isDeleted?: boolean;
};

const reactionContentArg = v.union(
  v.literal("+1"),
  v.literal("-1"),
  v.literal("laugh"),
  v.literal("confused"),
  v.literal("heart"),
  v.literal("hooray"),
  v.literal("rocket"),
  v.literal("eyes"),
);

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > MILLIS_THRESHOLD ? Math.round(value) : Math.round(value * 1000);
  }
  if (typeof value === "string" && value.length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric > MILLIS_THRESHOLD
        ? Math.round(numeric)
        : Math.round(numeric * 1000);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function mapReactions(raw: unknown): ReactionCounts | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const source = raw as Record<string, unknown>;
  const counts: ReactionCounts = {};
  let hasAny = false;
  for (const [githubKey, field] of Object.entries(REACTION_FIELD_MAP) as Array<[
    GithubReactionContent,
    ReactionContent,
  ]>) {
    const value = toNumber(source[githubKey]);
    if (typeof value === "number" && value > 0) {
      counts[field] = value;
      hasAny = true;
    } else if (typeof value === "number" && value === 0) {
      counts[field] = 0;
    }
  }
  const total = toNumber(source.total_count);
  if (typeof total === "number") {
    counts.totalCount = total;
    hasAny = hasAny || total > 0;
  } else if (hasAny) {
    counts.totalCount = Object.values(REACTION_FIELD_MAP).reduce(
      (sum, field) => sum + (counts[field] ?? 0),
      0,
    );
  }
  return hasAny ? counts : undefined;
}

function mapCommentRecord(
  source: CommentSource,
  raw: unknown,
  action: string,
): CommentRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const comment = raw as Record<string, any>;
  const providerCommentId = toNumber(comment.id);
  if (!providerCommentId) {
    return null;
  }
  const createdAt =
    toTimestamp(comment.created_at) ??
    toTimestamp(comment.submitted_at) ??
    Date.now();
  const updatedAt =
    toTimestamp(comment.updated_at) ??
    createdAt;

  const record: CommentRecord = {
    providerCommentId,
    providerNodeId: toString(comment.node_id),
    type: source,
    body: toString(comment.body),
    bodyHtml: toString(comment.body_html),
    bodyText: toString(comment.body_text),
    authorLogin: toString(comment.user?.login),
    authorId: toNumber(comment.user?.id),
    authorAvatarUrl: toString(comment.user?.avatar_url),
    authorAssociation: toString(comment.author_association),
    url: toString(comment.url),
    htmlUrl: toString(comment.html_url),
    inReplyToId: toNumber(comment.in_reply_to_id),
    reviewId: toNumber(comment.pull_request_review_id),
    path: toString(comment.path),
    position: toNumber(comment.position),
    originalPosition: toNumber(comment.original_position),
    commitId: toString(comment.commit_id),
    originalCommitId: toString(comment.original_commit_id),
    diffHunk: toString(comment.diff_hunk),
    line: toNumber(comment.line),
    originalLine: toNumber(comment.original_line),
    side: toString(comment.side),
    startLine: toNumber(comment.start_line),
    startSide: toString(comment.start_side),
    createdAt,
    updatedAt,
    submittedAt: toTimestamp(comment.submitted_at),
    reactions: mapReactions(comment.reactions),
  };

  if (source === "issue") {
    delete record.inReplyToId;
    delete record.reviewId;
    delete record.path;
    delete record.position;
    delete record.originalPosition;
    delete record.commitId;
    delete record.originalCommitId;
    delete record.diffHunk;
    delete record.line;
    delete record.originalLine;
    delete record.side;
    delete record.startLine;
    delete record.startSide;
  }

  if (action === "deleted") {
    record.isDeleted = true;
  }

  return record;
}

async function upsertCommentDoc(
  ctx: MutationCtx,
  args: {
    teamId: string;
    installationId: number;
    repoFullName: string;
    repositoryId?: number;
    prNumber: number;
    record: CommentRecord;
  },
) {
  const existing = await ctx.db
    .query("pullRequestComments")
    .withIndex("by_comment_id", (q) =>
      q.eq("providerCommentId", args.record.providerCommentId),
    )
    .first();

  const createdAt =
    existing?.createdAt ?? args.record.createdAt ?? args.record.updatedAt ?? Date.now();
  const record: CommentRecord = {
    ...args.record,
    createdAt,
    updatedAt: args.record.updatedAt ?? createdAt,
  };

  const patch: Record<string, unknown> = {
    provider: "github",
    teamId: args.teamId,
    installationId: args.installationId,
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
  };
  if (args.repositoryId !== undefined) {
    patch.repositoryId = args.repositoryId;
  }
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) {
      patch[key] = value;
    }
  }

  if (existing) {
    await ctx.db.patch(
      existing._id,
      patch as Partial<Doc<"pullRequestComments">>,
    );
    return existing._id;
  }
  return ctx.db.insert(
    "pullRequestComments",
    patch as Doc<"pullRequestComments">,
  );
}

export const upsertCommentFromWebhook = internalMutation({
  args: {
    teamId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    repositoryId: v.optional(v.number()),
    prNumber: v.number(),
    source: v.union(v.literal("issue"), v.literal("review")),
    action: v.optional(v.string()),
    comment: v.any(),
  },
  handler: async (ctx, args) => {
    const record = mapCommentRecord(args.source, args.comment, args.action ?? "");
    if (!record) {
      return { ok: false as const, reason: "invalid" as const };
    }
    await upsertCommentDoc(ctx, {
      teamId: args.teamId,
      installationId: args.installationId,
      repoFullName: args.repoFullName,
      repositoryId: args.repositoryId,
      prNumber: args.prNumber,
      record,
    });
    return { ok: true as const };
  },
});

export const upsertFromServer = authMutation({
  args: {
    teamSlugOrId: v.string(),
    installationId: v.number(),
    repoFullName: v.string(),
    repositoryId: v.optional(v.number()),
    prNumber: v.number(),
    source: v.union(v.literal("issue"), v.literal("review")),
    action: v.optional(v.string()),
    comment: v.any(),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const record = mapCommentRecord(args.source, args.comment, args.action ?? "");
    if (!record) {
      return { ok: false as const, reason: "invalid" as const };
    }
    await upsertCommentDoc(ctx, {
      teamId,
      installationId: args.installationId,
      repoFullName: args.repoFullName,
      repositoryId: args.repositoryId,
      prNumber: args.prNumber,
      record,
    });
    return { ok: true as const };
  },
});

export const listForPullRequest = authQuery({
  args: {
    teamSlugOrId: v.string(),
    repoFullName: v.string(),
    number: v.number(),
  },
  handler: async (ctx, args) => {
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    return ctx.db
      .query("pullRequestComments")
      .withIndex("by_team_repo_pr_created", (q) =>
        q
          .eq("teamId", teamId)
          .eq("repoFullName", args.repoFullName)
          .eq("prNumber", args.number),
      )
      .order("asc")
      .collect();
  },
});

function applyReactionUpdate(
  existing: ReactionCounts | undefined,
  field: ReactionContent,
  delta: number,
): ReactionCounts {
  const next: ReactionCounts = { ...(existing ?? {}) };
  const current = next[field] ?? 0;
  const updated = Math.max(0, current + delta);
  next[field] = updated;
  const total = Object.values(REACTION_FIELD_MAP).reduce(
    (sum, reactionField) => sum + (next[reactionField] ?? 0),
    0,
  );
  if (total > 0) {
    next.totalCount = total;
  } else {
    delete next.totalCount;
  }
  return next;
}

export const applyReactionDelta = internalMutation({
  args: {
    providerCommentId: v.number(),
    content: reactionContentArg,
    delta: v.number(),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db
      .query("pullRequestComments")
      .withIndex("by_comment_id", (q) =>
        q.eq("providerCommentId", args.providerCommentId),
      )
      .first();
    if (!comment) {
      return { ok: false as const, reason: "missing" as const };
    }
    const mappedField = REACTION_FIELD_MAP[args.content];
    if (!mappedField) {
      return { ok: false as const, reason: "invalid_content" as const };
    }
    const reactions = applyReactionUpdate(comment.reactions, mappedField, args.delta);
    await ctx.db.patch(comment._id, {
      reactions,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});
