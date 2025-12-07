import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// =============================================================================
// XAGI SCHEMA - Task Feed for Human-AI Collaboration
// =============================================================================
// Core concept: Tasks appear in feed → algorithm curates → humans review
// =============================================================================

export default defineSchema({
  // ---------------------------------------------------------------------------
  // USERS
  // ---------------------------------------------------------------------------

  users: defineTable({
    // Convex auth token identifier
    tokenIdentifier: v.string(),

    // Profile
    username: v.string(),
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),

    // Expertise (used by feed algorithm)
    expertise: v.array(v.string()), // ["typescript", "react", "ml"]

    // Stats
    tasksReviewed: v.number(),
    reputation: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_username", ["username"]),

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
