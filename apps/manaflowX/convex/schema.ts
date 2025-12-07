import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// =============================================================================
// XAGI SCHEMA - Task Feed for Human-AI Collaboration
// =============================================================================
// Core concept: Tasks appear in feed → algorithm curates → humans review
// =============================================================================

export default defineSchema({
  // ---------------------------------------------------------------------------
  // USERS (synced from Stack Auth via webhooks)
  // ---------------------------------------------------------------------------

  users: defineTable({
    userId: v.string(), // Stack Auth user ID

    // Basic identity
    primaryEmail: v.optional(v.string()),
    primaryEmailVerified: v.optional(v.boolean()),
    displayName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),

    // Selected team
    selectedTeamId: v.optional(v.string()),
    selectedTeamDisplayName: v.optional(v.string()),
    selectedTeamProfileImageUrl: v.optional(v.string()),

    // Security flags
    hasPassword: v.optional(v.boolean()),

    // Timestamps from Stack
    signedUpAtMillis: v.optional(v.number()),
    lastActiveAtMillis: v.optional(v.number()),

    // Metadata
    clientMetadata: v.optional(v.any()),
    clientReadOnlyMetadata: v.optional(v.any()),
    serverMetadata: v.optional(v.any()),

    // Local bookkeeping
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["primaryEmail"]),

  // ---------------------------------------------------------------------------
  // TASKS (the "tweets" - core content unit)
  // ---------------------------------------------------------------------------

  tasks: defineTable({
    // Content
    title: v.string(),
    content: v.string(), // Markdown
    summary: v.optional(v.string()), // Short summary for feed

    // Type of review needed
    type: v.union(
      v.literal("code_review"),
      v.literal("approval"),
      v.literal("verification"),
      v.literal("decision"),
      v.literal("triage"),
      v.literal("feedback"),
      v.literal("discussion")
    ),

    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("in_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("changes_requested"),
      v.literal("completed"),
      v.literal("archived")
    ),

    // Priority
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low")
    ),
    urgencyScore: v.number(), // 0-100, for ranking

    // Author
    authorId: v.optional(v.id("users")),

    // Tree structure
    parentId: v.optional(v.id("tasks")),
    threadRootId: v.optional(v.id("tasks")),
    path: v.optional(v.string()), // Materialized path for subtree queries
    depth: v.number(),
    childCount: v.number(),
    descendantCount: v.number(),

    // Quote
    quotedTaskId: v.optional(v.id("tasks")),

    // Attachments
    attachments: v.array(
      v.object({
        type: v.union(v.literal("file"), v.literal("code"), v.literal("image"), v.literal("link")),
        url: v.string(),
        name: v.string(),
        metadata: v.optional(v.any()),
      })
    ),

    // Code context
    codeContext: v.optional(
      v.object({
        language: v.string(),
        filePath: v.string(),
        diff: v.optional(v.string()),
        lineStart: v.optional(v.number()),
        lineEnd: v.optional(v.number()),
      })
    ),

    // Tags
    tags: v.array(v.string()),

    // Stats (denormalized)
    replyCount: v.number(),
    reactionCount: v.number(),
    viewCount: v.number(),

    // Assignment
    assigneeId: v.optional(v.id("users")),

    // Timestamps
    dueAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_type", ["type"])
    .index("by_priority", ["priority", "urgencyScore"])
    .index("by_author", ["authorId", "createdAt"])
    .index("by_assignee", ["assigneeId", "status"])
    .index("by_parent", ["parentId", "createdAt"])
    .index("by_thread_root", ["threadRootId", "depth", "createdAt"])
    .index("by_path", ["path"])
    .index("by_created", ["createdAt"]),

  // ---------------------------------------------------------------------------
  // REACTIONS
  // ---------------------------------------------------------------------------

  reactions: defineTable({
    taskId: v.id("tasks"),
    userId: v.id("users"),
    type: v.union(
      v.literal("agree"),
      v.literal("disagree"),
      v.literal("important"),
      v.literal("question"),
      v.literal("celebrate")
    ),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_user_task", ["userId", "taskId"]),

  // ---------------------------------------------------------------------------
  // COMMENTS
  // ---------------------------------------------------------------------------

  comments: defineTable({
    taskId: v.id("tasks"),
    authorId: v.id("users"),
    content: v.string(),
    parentCommentId: v.optional(v.id("comments")),
    mentions: v.array(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_task", ["taskId", "createdAt"])
    .index("by_parent", ["parentCommentId"]),

  // ---------------------------------------------------------------------------
  // FEED (the core algorithm output)
  // ---------------------------------------------------------------------------

  // Materialized feed items per user
  feedItems: defineTable({
    userId: v.id("users"),
    taskId: v.id("tasks"),

    // Algorithm scores (0-100)
    relevanceScore: v.number(), // How relevant to user
    urgencyScore: v.number(), // Time sensitivity
    expertiseMatch: v.number(), // Matches user expertise
    finalScore: v.number(), // Combined ranking score

    // Why shown (for transparency/debugging)
    reason: v.union(
      v.literal("expertise_match"),
      v.literal("assigned"),
      v.literal("trending"),
      v.literal("urgent"),
      v.literal("recent"),
      v.literal("for_you")
    ),

    // State
    seen: v.boolean(),
    dismissed: v.boolean(),
    interactedAt: v.optional(v.number()),

    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_user_feed", ["userId", "dismissed", "finalScore"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_task", ["taskId"])
    .index("by_expires", ["expiresAt"]),

  // Engagement signals (for training/improving the algorithm)
  engagementSignals: defineTable({
    userId: v.id("users"),
    taskId: v.id("tasks"),

    action: v.union(
      v.literal("view"),
      v.literal("expand"),
      v.literal("dwell"),
      v.literal("react"),
      v.literal("comment"),
      v.literal("review"),
      v.literal("dismiss"),
      v.literal("bookmark"),
      v.literal("share")
    ),

    dwellTimeSeconds: v.optional(v.number()),
    feedPosition: v.optional(v.number()),
    sourceScreen: v.string(),

    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_task", ["taskId"]),

  // ---------------------------------------------------------------------------
  // GITHUB REPOSITORIES
  // ---------------------------------------------------------------------------

  repos: defineTable({
    fullName: v.string(), // e.g. "owner/repo"
    org: v.string(), // owner or organization name
    name: v.string(), // repository name
    gitRemote: v.string(), // e.g. "https://github.com/owner/repo.git"
    provider: v.optional(v.string()), // e.g. "github"
    userId: v.string(), // Stack Auth user ID

    // Provider metadata (GitHub App)
    providerRepoId: v.optional(v.number()),
    ownerLogin: v.optional(v.string()),
    ownerType: v.optional(v.union(v.literal("User"), v.literal("Organization"))),
    visibility: v.optional(v.union(v.literal("public"), v.literal("private"))),
    defaultBranch: v.optional(v.string()),
    connectionId: v.optional(v.id("providerConnections")),
    lastSyncedAt: v.optional(v.number()),
    lastPushedAt: v.optional(v.number()),
  })
    .index("by_org", ["org"])
    .index("by_gitRemote", ["gitRemote"])
    .index("by_userId", ["userId"])
    .index("by_fullName", ["fullName"]),

  // ---------------------------------------------------------------------------
  // PROVIDER CONNECTIONS (GitHub App installations)
  // ---------------------------------------------------------------------------

  providerConnections: defineTable({
    userId: v.optional(v.string()), // Stack Auth user ID
    connectedByUserId: v.optional(v.string()),
    type: v.union(v.literal("github_app"), v.literal("twitter_oauth")),
    // GitHub App fields
    installationId: v.optional(v.number()),
    accountLogin: v.optional(v.string()), // org or user login (GitHub) or username (Twitter)
    accountId: v.optional(v.number()),
    accountType: v.optional(v.union(v.literal("User"), v.literal("Organization"))),
    // Twitter OAuth fields
    twitterUserId: v.optional(v.string()),
    twitterUsername: v.optional(v.string()),
    twitterName: v.optional(v.string()),
    twitterProfileImageUrl: v.optional(v.string()),
    twitterAccessToken: v.optional(v.string()),
    twitterRefreshToken: v.optional(v.string()),
    twitterTokenExpiresAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_installationId", ["installationId"])
    .index("by_userId", ["userId"])
    .index("by_type_userId", ["type", "userId"])
    .index("by_twitterUserId", ["twitterUserId"]),

  // ---------------------------------------------------------------------------
  // INSTALL STATES (for GitHub App installation flow)
  // ---------------------------------------------------------------------------

  installStates: defineTable({
    nonce: v.string(),
    userId: v.string(),
    iat: v.number(),
    exp: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("used"),
      v.literal("expired")
    ),
    createdAt: v.number(),
    returnUrl: v.optional(v.string()),
  }).index("by_nonce", ["nonce"]),

  // ---------------------------------------------------------------------------
  // TWITTER OAUTH STATES (for Twitter OAuth 2.0 PKCE flow)
  // ---------------------------------------------------------------------------

  twitterOAuthStates: defineTable({
    state: v.string(),
    codeVerifier: v.string(), // PKCE code verifier
    userId: v.string(),
    iat: v.number(),
    exp: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("used"),
      v.literal("expired")
    ),
    createdAt: v.number(),
    returnUrl: v.optional(v.string()),
  }).index("by_state", ["state"]),

  // ---------------------------------------------------------------------------
  // NOTIFICATIONS
  // ---------------------------------------------------------------------------

  notifications: defineTable({
    userId: v.id("users"),

    type: v.union(
      v.literal("task_assigned"),
      v.literal("task_mentioned"),
      v.literal("task_completed"),
      v.literal("task_urgent"),
      v.literal("review_requested"),
      v.literal("review_received"),
      v.literal("reply_received"),
      v.literal("reply_in_thread"),
      v.literal("comment_received"),
      v.literal("reaction_received"),
      v.literal("quoted")
    ),

    // References
    taskId: v.optional(v.id("tasks")),
    parentTaskId: v.optional(v.id("tasks")),
    threadRootId: v.optional(v.id("tasks")),
    actorId: v.optional(v.id("users")),
    commentId: v.optional(v.id("comments")),

    // Content
    title: v.string(),
    body: v.optional(v.string()),
    preview: v.optional(v.string()),

    // Grouping
    groupKey: v.optional(v.string()),
    groupCount: v.number(),

    // State
    read: v.boolean(),
    seen: v.boolean(),
    archived: v.boolean(),

    createdAt: v.number(),
  })
    .index("by_user_unread", ["userId", "read", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),
});
