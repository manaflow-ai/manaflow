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

    // Tweet source (for posts that are imported from X/Twitter)
    tweetSource: v.optional(
      v.object({
        tweetId: v.string(), // Original tweet ID
        tweetUrl: v.string(), // Link to original tweet
        authorUsername: v.string(), // @username
        authorName: v.string(), // Display name
        authorProfileImageUrl: v.optional(v.string()),
        metrics: v.optional(
          v.object({
            likes: v.number(),
            retweets: v.number(),
            replies: v.number(),
            views: v.optional(v.number()),
          })
        ),
        mediaUrls: v.optional(v.array(v.string())), // Images/videos from tweet
      })
    ),

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

    // Owner (Stack Auth user ID) - determines which user's algorithm processes this
    userId: v.optional(v.string()),

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

    // GitHub issue link (for issues imported from GitHub)
    githubIssueUrl: v.optional(v.string()),
    githubIssueNumber: v.optional(v.number()),
    githubRepo: v.optional(v.string()), // e.g., "owner/repo"
    // Repo config (for workflow execution)
    gitRemote: v.optional(v.string()), // e.g., "https://github.com/owner/repo.git"
    gitBranch: v.optional(v.string()), // e.g., "main"
    installationId: v.optional(v.number()), // GitHub App installation ID

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
    .index("by_type", ["type", "status"])
    .index("by_github_issue", ["githubRepo", "githubIssueNumber"])
    .index("by_userId_status", ["userId", "status"]),

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
  // FEED (algorithm output for curated feeds - global or per-user)
  // ---------------------------------------------------------------------------

  feedItems: defineTable({
    userId: v.optional(v.id("users")), // Optional - null for global feed items
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
    .index("by_global_feed", ["dismissed", "finalScore"]) // For global feed queries
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
    // Scripts for workspace setup (env vars stored in Stack Auth Data Vault)
    scripts: v.optional(
      v.object({
        maintenanceScript: v.string(),
        devScript: v.string(),
      })
    ),
    // Algorithm monitoring
    isMonitored: v.optional(v.boolean()), // Whether to monitor this repo for PRs
  })
    .index("by_org", ["org"])
    .index("by_gitRemote", ["gitRemote"])
    .index("by_userId", ["userId"])
    .index("by_fullName", ["fullName"])
    .index("by_userId_monitored", ["userId", "isMonitored"])
    .index("by_userId_lastPushed", ["userId", "lastPushedAt"]),

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
  // Supports: Vercel AI SDK, OpenCode SDK, Claude Agent SDK

  sessions: defineTable({
    // Source of the session
    source: v.union(
      v.literal("api"), // Vercel AI SDK / API calls
      v.literal("opencode"), // OpenCode SDK
      v.literal("claude_agent"), // Claude Agent SDK
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

    // Aggregated token usage (enhanced for all SDKs)
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

    // -------------------------------------------------------------------------
    // Claude Agent SDK specific fields
    // -------------------------------------------------------------------------

    // Per-model usage breakdown { [modelName: string]: ModelUsage }
    modelUsage: v.optional(v.any()),

    // Result tracking from SDKResultMessage
    totalCostUsd: v.optional(v.number()),
    numTurns: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    durationApiMs: v.optional(v.number()),

    // Permission mode used for the session
    permissionMode: v.optional(v.string()),

    // -------------------------------------------------------------------------
    // OpenCode SDK specific fields
    // -------------------------------------------------------------------------

    // Morph VM instance ID (for accessing the running VM)
    morphInstanceId: v.optional(v.string()),

    // External session ID from OpenCode
    externalSessionId: v.optional(v.string()),

    // JWT secret for coding agent authentication (stored directly on session)
    jwtSecret: v.optional(v.string()),

    // Session title (OpenCode)
    title: v.optional(v.string()),

    // Task text (for coding agent sessions - used for UI lookup)
    task: v.optional(v.string()),

    // Session summary with file diffs (OpenCode)
    summary: v.optional(
      v.object({
        additions: v.optional(v.number()),
        deletions: v.optional(v.number()),
        files: v.optional(v.number()),
      })
    ),
    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_post", ["postId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_created", ["createdAt"])
    .index("by_external_session", ["externalSessionId"])
    .index("by_task", ["task"]),

  // ---------------------------------------------------------------------------
  // TURNS (AI messages with inline parts)
  // ---------------------------------------------------------------------------
  // Individual messages in a session, with parts for streaming content
  // Supports: Vercel AI SDK, OpenCode SDK, Claude Agent SDK

  turns: defineTable({
    sessionId: v.id("sessions"),

    // Role
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
      v.literal("tool")
    ),

    // -------------------------------------------------------------------------
    // Message type for SDK-specific message types
    // -------------------------------------------------------------------------
    // Claude Agent SDK: result, stream_event, tool_progress, auth_status
    // OpenCode SDK: init, status, compact_boundary, hook_response
    messageType: v.optional(
      v.union(
        // Claude Agent SDK message types
        v.literal("result"), // SDKResultMessage
        v.literal("stream_event"), // SDKPartialAssistantMessage
        v.literal("tool_progress"), // SDKToolProgressMessage
        v.literal("auth_status"), // SDKAuthStatusMessage
        // OpenCode SDK / shared system message subtypes
        v.literal("init"), // SDKSystemMessage (init)
        v.literal("status"), // SDKStatusMessage
        v.literal("compact_boundary"), // SDKCompactBoundaryMessage
        v.literal("hook_response") // SDKHookResponseMessage
      )
    ),

    // For tool role turns
    toolCallId: v.optional(v.string()),
    toolName: v.optional(v.string()),

    // Parent tool use ID (for nested tool calls - both SDKs)
    parentToolUseId: v.optional(v.string()),

    // Status (for streaming)
    status: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("complete"),
      v.literal("error")
    ),

    // -------------------------------------------------------------------------
    // Inline parts array - granular content pieces (supports all SDKs)
    // -------------------------------------------------------------------------
    parts: v.array(
      v.object({
        type: v.union(
          // Core types (all SDKs)
          v.literal("text"),
          v.literal("reasoning"), // thinking/reasoning blocks
          v.literal("tool_call"),
          v.literal("tool_result"),
          v.literal("file"),
          v.literal("step_start"),
          v.literal("step_finish"),
          v.literal("error"),
          // OpenCode SDK specific types
          v.literal("snapshot"), // codebase snapshot state
          v.literal("patch"), // file patches/diffs
          v.literal("agent"), // which agent handled response
          v.literal("retry"), // retry attempt tracking
          v.literal("compaction"), // session compaction tracking
          v.literal("subtask") // spawned sub-agent tasks
        ),

        // Part identifier (OpenCode uses these)
        partId: v.optional(v.string()),

        // Text content (for text, reasoning, error types)
        text: v.optional(v.string()),

        // Text part flags (OpenCode SDK)
        synthetic: v.optional(v.boolean()), // AI-generated vs original
        ignored: v.optional(v.boolean()), // ignored parts

        // Tool call fields - supports both SDKs
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
        // OpenCode SDK tool fields
        toolTitle: v.optional(v.string()), // human-readable title
        toolError: v.optional(v.string()), // error message
        // Progress tracking for long-running tools (like coding agent)
        toolProgress: v.optional(
          v.object({
            stage: v.string(), // e.g., "creating_session", "starting_vm", "running"
            message: v.string(), // Human-readable progress message
            sessionId: v.optional(v.string()), // Coding agent session ID
            instanceId: v.optional(v.string()), // Morph instance ID
          })
        ),
        toolAttachments: v.optional(
          v.array(
            v.object({
              mime: v.string(),
              filename: v.optional(v.string()),
              url: v.string(),
            })
          )
        ),

        // File fields (both SDKs)
        fileUrl: v.optional(v.string()),
        fileMime: v.optional(v.string()),
        fileName: v.optional(v.string()),
        fileSource: v.optional(v.any()), // FileSource | SymbolSource (OpenCode)

        // Step finish fields (OpenCode SDK - enhanced)
        finishReason: v.optional(v.string()),
        stepCost: v.optional(v.number()),
        stepTokens: v.optional(
          v.object({
            input: v.number(),
            output: v.number(),
            reasoning: v.optional(v.number()),
            cacheRead: v.optional(v.number()),
            cacheWrite: v.optional(v.number()),
          })
        ),

        // Snapshot fields (OpenCode SDK)
        snapshot: v.optional(v.string()),

        // Patch fields (OpenCode SDK)
        patchHash: v.optional(v.string()),
        patchFiles: v.optional(v.array(v.string())),

        // Agent part fields (OpenCode SDK)
        agentName: v.optional(v.string()),
        agentSource: v.optional(
          v.object({
            value: v.string(),
            start: v.number(),
            end: v.number(),
          })
        ),

        // Retry fields (OpenCode SDK)
        retryAttempt: v.optional(v.number()),
        retryError: v.optional(v.any()),

        // Compaction fields (OpenCode SDK)
        compactionAuto: v.optional(v.boolean()),

        // Subtask fields (OpenCode SDK)
        subtaskPrompt: v.optional(v.string()),
        subtaskDescription: v.optional(v.string()),
        subtaskAgent: v.optional(v.string()),

        // Universal timing (OpenCode SDK)
        time: v.optional(
          v.object({
            start: v.optional(v.number()),
            end: v.optional(v.number()),
          })
        ),

        // Generic metadata (both SDKs)
        metadata: v.optional(v.any()),

        // Part state
        isComplete: v.boolean(),
      })
    ),

    // Error info (if status is error) - enhanced for Claude Agent SDK
    error: v.optional(
      v.object({
        name: v.string(),
        message: v.string(),
        // Claude Agent SDK error types
        type: v.optional(
          v.union(
            v.literal("authentication_failed"),
            v.literal("billing_error"),
            v.literal("rate_limit"),
            v.literal("invalid_request"),
            v.literal("server_error"),
            v.literal("unknown")
          )
        ),
      })
    ),

    // Per-turn token usage - enhanced for both SDKs
    tokens: v.optional(
      v.object({
        input: v.number(),
        output: v.number(),
        reasoning: v.optional(v.number()),
        cacheRead: v.optional(v.number()),
        cacheWrite: v.optional(v.number()),
      })
    ),

    // Per-model usage breakdown (Claude Agent SDK)
    modelUsage: v.optional(v.any()), // { [modelName: string]: ModelUsage }

    // Finish reason (for assistant turns)
    finishReason: v.optional(v.string()),

    // Cost tracking (both SDKs)
    cost: v.optional(v.number()), // in USD

    // -------------------------------------------------------------------------
    // Claude Agent SDK specific fields
    // -------------------------------------------------------------------------

    // UUID from SDK
    uuid: v.optional(v.string()),

    // Message flags
    isSynthetic: v.optional(v.boolean()), // system-generated message
    isReplay: v.optional(v.boolean()), // replayed message

    // Tool use result JSON (for user messages responding to tool calls)
    toolUseResult: v.optional(v.any()),

    // Result message fields (SDKResultMessage)
    resultSubtype: v.optional(
      v.union(
        v.literal("success"),
        v.literal("error_during_execution"),
        v.literal("error_max_turns"),
        v.literal("error_max_budget_usd"),
        v.literal("error_max_structured_output_retries")
      )
    ),
    resultText: v.optional(v.string()), // final result text
    structuredOutput: v.optional(v.any()), // structured output if requested
    durationMs: v.optional(v.number()), // execution duration
    durationApiMs: v.optional(v.number()), // API call duration
    numTurns: v.optional(v.number()), // number of turns
    permissionDenials: v.optional(
      v.array(
        v.object({
          toolName: v.string(),
          toolUseId: v.string(),
          toolInput: v.any(),
        })
      )
    ),
    errors: v.optional(v.array(v.string())), // error messages

    // System init message fields (SDKSystemMessage)
    systemInit: v.optional(
      v.object({
        agents: v.optional(v.array(v.string())),
        claudeCodeVersion: v.optional(v.string()),
        cwd: v.optional(v.string()),
        tools: v.optional(v.array(v.string())),
        mcpServers: v.optional(
          v.array(
            v.object({
              name: v.string(),
              status: v.string(),
            })
          )
        ),
        model: v.optional(v.string()),
        permissionMode: v.optional(v.string()),
        slashCommands: v.optional(v.array(v.string())),
      })
    ),

    // Status message fields (SDKStatusMessage)
    systemStatus: v.optional(v.string()), // "compacting" | null

    // Compact boundary fields (SDKCompactBoundaryMessage)
    compactMetadata: v.optional(
      v.object({
        trigger: v.union(v.literal("manual"), v.literal("auto")),
        preTokens: v.number(),
      })
    ),

    // Hook response fields (SDKHookResponseMessage)
    hookResponse: v.optional(
      v.object({
        hookName: v.string(),
        hookEvent: v.string(),
        stdout: v.string(),
        stderr: v.string(),
        exitCode: v.optional(v.number()),
      })
    ),

    // Tool progress fields (SDKToolProgressMessage)
    toolProgress: v.optional(
      v.object({
        toolUseId: v.string(),
        toolName: v.string(),
        elapsedTimeSeconds: v.number(),
      })
    ),

    // Auth status fields (SDKAuthStatusMessage)
    authStatus: v.optional(
      v.object({
        isAuthenticating: v.boolean(),
        output: v.array(v.string()),
        error: v.optional(v.string()),
      })
    ),

    // -------------------------------------------------------------------------
    // OpenCode SDK specific fields
    // -------------------------------------------------------------------------

    // External message ID from OpenCode
    externalMessageId: v.optional(v.string()),

    // Ordering within session
    order: v.number(),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session", ["sessionId", "order"])
    .index("by_session_created", ["sessionId", "createdAt"])
    .index("by_uuid", ["uuid"]),

  // ---------------------------------------------------------------------------
  // CODING AGENT TOOL CALL MAPPINGS
  // ---------------------------------------------------------------------------
  // Links parent workflow tool calls to coding agent sessions
  // This enables the UI to show "View session" immediately when the tool starts

  codingAgentToolCalls: defineTable({
    // The AI SDK tool call ID from the parent workflow
    toolCallId: v.string(),

    // The parent session ID (workflow session)
    parentSessionId: v.id("sessions"),

    // The coding agent session ID (filled in when session is created)
    codingAgentSessionId: v.optional(v.id("sessions")),

    // Task hash for matching (hash of task text)
    taskHash: v.string(),

    // JWT secret for this invocation (stored for HTTP endpoint verification)
    jwtSecret: v.optional(v.string()),

    // Status
    status: v.union(
      v.literal("pending"), // Tool call started, waiting for session
      v.literal("linked"), // Session created and linked
      v.literal("completed"), // Tool finished
      v.literal("failed") // Tool failed
    ),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tool_call", ["toolCallId"])
    .index("by_task_hash", ["taskHash"])
    .index("by_parent_session", ["parentSessionId"])
    .index("by_coding_agent_session", ["codingAgentSessionId"]),

  // ---------------------------------------------------------------------------
  // ALGORITHM SETTINGS (per-user settings for the autonomous agent)
  // ---------------------------------------------------------------------------

  algorithmSettings: defineTable({
    userId: v.string(), // Stack Auth user ID
    enabled: v.boolean(), // Whether the autonomous agent is enabled for this user
    prompt: v.optional(v.string()), // Custom system prompt for Poaster (GitHub algorithm)
    curatorPrompt: v.optional(v.string()), // Custom system prompt for Curator (feed curation)
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  // ---------------------------------------------------------------------------
  // WORKFLOW QUEUE (for triggering workflows from Convex actions)
  // ---------------------------------------------------------------------------
  // Convex actions can't call Next.js workflow library directly, so they
  // insert tasks here. Next.js subscribes and processes them.

  workflowQueue: defineTable({
    // Task type
    type: v.literal("solve_issue"), // GitHub issue to solve

    // Status
    status: v.union(
      v.literal("pending"), // Waiting to be processed
      v.literal("processing"), // Being processed by Next.js
      v.literal("completed"), // Successfully completed
      v.literal("failed") // Failed to process
    ),

    // Link to internal issue
    issueId: v.id("issues"),

    // Repository info for the coding agent
    repoFullName: v.string(),
    gitRemote: v.string(),
    branch: v.string(),
    installationId: v.optional(v.number()),

    // Result tracking
    workflowId: v.optional(v.string()), // ID from workflow.start()
    prUrl: v.optional(v.string()), // URL of created PR
    error: v.optional(v.string()), // Error message if failed

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_issue", ["issueId"]),
});
