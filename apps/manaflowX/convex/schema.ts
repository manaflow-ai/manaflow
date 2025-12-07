import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// =============================================================================
// XAGI SCHEMA - Beads-inspired Issue Tracker + Twitter-style Posts
// =============================================================================
// Two core concepts:
// - Posts: ephemeral activity stream (Twitter-like)
// - Issues: persistent problems/features (Beads-like)
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
  // POSTS (Twitter-style activity stream)
  // ---------------------------------------------------------------------------
  // Ephemeral, agent updates, permission requests, notes
  // Threading supported via replyTo/threadRoot

  posts: defineTable({
    // Content
    content: v.string(), // Markdown

    // Author
    author: v.string(), // agent name or user display name
    authorId: v.optional(v.id("users")), // null for agents

    // Threading
    replyTo: v.optional(v.id("posts")), // Direct parent
    threadRoot: v.optional(v.id("posts")), // Root of thread (for easy queries)
    depth: v.number(), // 0 for root posts

    // Optional link to issue
    issue: v.optional(v.id("issues")),

    // Stats (denormalized)
    replyCount: v.number(),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadRoot", "createdAt"])
    .index("by_replyTo", ["replyTo", "createdAt"])
    .index("by_issue", ["issue", "createdAt"])
    .index("by_author", ["author", "createdAt"])
    .index("by_created", ["createdAt"]),

  // ---------------------------------------------------------------------------
  // ISSUES (Beads-style persistent problems/features)
  // ---------------------------------------------------------------------------
  // Long-lived, tracked, dependencies, lifecycle

  issues: defineTable({
    // Human-readable short ID (like bd-a1b2)
    shortId: v.string(),

    // Content
    title: v.string(),
    description: v.optional(v.string()),

    // Status lifecycle
    status: v.union(
      v.literal("open"),
      v.literal("in_progress"),
      v.literal("closed")
    ),

    // Priority (0 = highest, 4 = lowest, like Beads)
    priority: v.number(),

    // Type
    type: v.union(
      v.literal("bug"),
      v.literal("feature"),
      v.literal("task"),
      v.literal("epic"),
      v.literal("chore")
    ),

    // Assignment
    assignee: v.optional(v.string()),

    // Labels (flexible tagging)
    labels: v.array(v.string()),

    // Hierarchical issues (epic -> sub-issues)
    parentIssue: v.optional(v.id("issues")),

    // Closure info
    closedAt: v.optional(v.number()),
    closedReason: v.optional(v.string()),

    // Compaction (memory decay)
    isCompacted: v.boolean(),
    compactedSummary: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_shortId", ["shortId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_status_priority", ["status", "priority"])
    .index("by_assignee", ["assignee", "status"])
    .index("by_parent", ["parentIssue"])
    .index("by_type", ["type", "status"]),

  // ---------------------------------------------------------------------------
  // DEPENDENCIES (issue relationships, Beads-style)
  // ---------------------------------------------------------------------------

  dependencies: defineTable({
    fromIssue: v.id("issues"), // The issue that depends
    toIssue: v.id("issues"), // The issue it depends on
    type: v.union(
      v.literal("blocks"), // Hard blocker - affects ready work
      v.literal("related"), // Soft link for reference
      v.literal("parent_child"), // Hierarchical relationship
      v.literal("discovered_from") // Found during work on another issue
    ),
    createdAt: v.number(),
  })
    .index("by_from", ["fromIssue"])
    .index("by_to", ["toIssue"])
    .index("by_from_type", ["fromIssue", "type"]),

  // ---------------------------------------------------------------------------
  // ISSUE EVENTS (audit trail for issues)
  // ---------------------------------------------------------------------------

  issueEvents: defineTable({
    issue: v.id("issues"),
    type: v.string(), // "created", "updated", "closed", "reopened", etc.
    data: v.any(), // JSON blob with change details
    actor: v.optional(v.string()), // who made the change
    createdAt: v.number(),
  }).index("by_issue", ["issue", "createdAt"]),

  // ---------------------------------------------------------------------------
  // REACTIONS (for posts)
  // ---------------------------------------------------------------------------

  reactions: defineTable({
    postId: v.id("posts"),
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
    .index("by_post", ["postId"])
    .index("by_user_post", ["userId", "postId"]),

  // ---------------------------------------------------------------------------
  // FEED (algorithm output for personalized feeds)
  // ---------------------------------------------------------------------------

  feedItems: defineTable({
    userId: v.id("users"),
    postId: v.id("posts"),

    // Algorithm scores (0-100)
    relevanceScore: v.number(),
    urgencyScore: v.number(),
    finalScore: v.number(),

    // Why shown
    reason: v.union(
      v.literal("assigned"),
      v.literal("trending"),
      v.literal("urgent"),
      v.literal("recent"),
      v.literal("for_you")
    ),

    // State
    seen: v.boolean(),
    dismissed: v.boolean(),

    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_user_feed", ["userId", "dismissed", "finalScore"])
    .index("by_post", ["postId"])
    .index("by_expires", ["expiresAt"]),

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
      v.literal("issue_assigned"),
      v.literal("issue_mentioned"),
      v.literal("issue_completed"),
      v.literal("permission_requested"),
      v.literal("reply_received"),
      v.literal("reaction_received")
    ),

    // References
    postId: v.optional(v.id("posts")),
    issueId: v.optional(v.id("issues")),
    actorId: v.optional(v.id("users")),

    // Content
    title: v.string(),
    body: v.optional(v.string()),

    // State
    read: v.boolean(),
    archived: v.boolean(),

    createdAt: v.number(),
  })
    .index("by_user_unread", ["userId", "read", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),

  // ---------------------------------------------------------------------------
  // SESSIONS (AI conversation container)
  // ---------------------------------------------------------------------------
  // Groups a series of turns (messages) into a logical conversation

  sessions: defineTable({
    // Source of the session
    source: v.union(
      v.literal("api"), // Vercel AI SDK / API calls
      v.literal("opencode"), // OpenCode / Claude Code
      v.literal("workflow") // Internal workflow
    ),

    // Links to higher-level entities
    postId: v.optional(v.id("posts")), // If this session produced a post
    workflowRunId: v.optional(v.string()), // Workflow run ID

    // Status
    status: v.union(
      v.literal("active"),
      v.literal("completed"),
      v.literal("failed")
    ),

    // Model/agent info
    model: v.optional(v.string()),
    provider: v.optional(v.string()),
    agent: v.optional(v.string()),

    // Aggregated token usage
    tokens: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        reasoning: v.optional(v.number()),
        cacheRead: v.optional(v.number()),
        cacheWrite: v.optional(v.number()),
      })
    ),

    // Cost (in cents)
    cost: v.optional(v.number()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_created", ["createdAt"]),

  // ---------------------------------------------------------------------------
  // TURNS (AI messages with inline parts)
  // ---------------------------------------------------------------------------
  // Individual messages in a session, with parts for streaming content

  turns: defineTable({
    sessionId: v.id("sessions"),

    // Role
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool")
    ),

    // For tool role turns
    toolCallId: v.optional(v.string()),
    toolName: v.optional(v.string()),

    // Status (for streaming)
    status: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error")
    ),

    // Inline parts array - granular content pieces
    parts: v.array(
      v.object({
        type: v.union(
          v.literal("text"),
          v.literal("reasoning"),
          v.literal("tool_call"),
          v.literal("tool_result"),
          v.literal("file"),
          v.literal("step_start"),
          v.literal("step_finish"),
          v.literal("error")
        ),

        // Text content (for text, reasoning, error types)
        text: v.optional(v.string()),

        // Tool call fields
        toolCallId: v.optional(v.string()),
        toolName: v.optional(v.string()),
        toolInput: v.optional(v.any()),
        toolOutput: v.optional(v.string()),
        toolStatus: v.optional(
          v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("error")
          )
        ),

        // File fields
        fileUrl: v.optional(v.string()),
        fileMime: v.optional(v.string()),
        fileName: v.optional(v.string()),

        // Step token usage (for step_finish)
        stepTokens: v.optional(
          v.object({
            input: v.number(),
            output: v.number(),
          })
        ),

        // Part state
        isComplete: v.boolean(),
      })
    ),

    // Error info (if status is error)
    error: v.optional(
      v.object({
        name: v.string(),
        message: v.string(),
      })
    ),

    // Per-turn token usage
    tokens: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
      })
    ),

    // Finish reason (for assistant turns)
    finishReason: v.optional(v.string()),

    // Ordering within session
    order: v.number(),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session", ["sessionId", "order"])
    .index("by_session_created", ["sessionId", "createdAt"]),
});
