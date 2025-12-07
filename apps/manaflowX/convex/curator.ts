import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";

// =============================================================================
// CURATOR - AI-powered feed curation using Grok
// =============================================================================
// Distinct from the AI Poster (githubMonitor.ts), the Curator:
// - Scans recent posts AND replies
// - Uses Grok AI to score them for relevance/interest
// - Surfaces interesting posts to each user's curated feed
// - When a reply is interesting, includes the parent context
// =============================================================================

const CURATION_WINDOW_MS = 24 * 60 * 60 * 1000; // Look at posts from last 24 hours
const FEED_ITEM_TTL_MS = 48 * 60 * 60 * 1000; // Feed items expire after 48 hours
const MAX_CURATED_PER_RUN = 10; // Max posts to curate per run

const DEFAULT_CURATOR_PROMPT = `You are a feed curator focused on surfacing high-quality code changes ready for review and merging.

Review these posts and select up to ${MAX_CURATED_PER_RUN} that are worth showing. Prioritize:
- PRs and code changes that appear complete and ready to merge
- PRs that need review attention (ready for eyes, not WIP)
- Significant features or bug fixes that are polished
- Code discussions showing finalized implementations
- Posts about merged or nearly-merged contributions
- Funny, clever, or genuinely interesting content that brings joy

Deprioritize:
- Work-in-progress or draft PRs
- Early-stage explorations or experiments
- Posts asking for help with incomplete code
- Low effort or trivial changes
- Off-topic or spam-like content

For replies: If a reply indicates a PR is approved, ready to merge, or provides final review feedback, surface it.

Select posts that help users see what's ready to ship. Return an empty array if none qualify.`;

// -----------------------------------------------------------------------------
// Internal queries for curation
// -----------------------------------------------------------------------------

// Get recent posts (including replies) for curation
export const getRecentPostsForCuration = internalQuery({
  args: {
    since: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_created")
      .order("desc")
      .filter((q) => q.gte(q.field("createdAt"), args.since))
      .take(limit);

    return posts;
  },
});

// Get a post by ID (for fetching parent posts)
export const getPost = internalQuery({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.postId);
  },
});

// Get all users to curate feeds for
export const getAllUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").collect();
  },
});

// Get existing feed items to check what's already curated (per user)
export const getExistingFeedPostIds = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("feedItems")
      .withIndex("by_user_feed", (q) => q.eq("userId", args.userId))
      .collect();

    return items.map((item) => item.postId.toString());
  },
});

// Get globally curated post IDs (no user filter)
export const getGloballyCuratedPostIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("feedItems").collect();
    return items.map((item) => item.postId.toString());
  },
});

// Get engagement metrics for a post
export const getPostEngagement = internalQuery({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const reactions = await ctx.db
      .query("reactions")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .collect();

    const post = await ctx.db.get(args.postId);

    return {
      reactionCount: reactions.length,
      replyCount: post?.replyCount ?? 0,
      agreeCount: reactions.filter((r) => r.type === "agree").length,
      importantCount: reactions.filter((r) => r.type === "important").length,
    };
  },
});

// -----------------------------------------------------------------------------
// Internal mutations for writing feed items
// -----------------------------------------------------------------------------

export const writeFeedItem = internalMutation({
  args: {
    userId: v.id("users"),
    postId: v.id("posts"),
    parentPostId: v.optional(v.id("posts")), // Parent post if this is a reply
    relevanceScore: v.number(),
    urgencyScore: v.number(),
    finalScore: v.number(),
    reason: v.union(
      v.literal("assigned"),
      v.literal("trending"),
      v.literal("urgent"),
      v.literal("recent"),
      v.literal("for_you")
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if this feed item already exists
    const existing = await ctx.db
      .query("feedItems")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    if (existing) {
      // Update existing item with new scores
      await ctx.db.patch(existing._id, {
        relevanceScore: args.relevanceScore,
        urgencyScore: args.urgencyScore,
        finalScore: args.finalScore,
        reason: args.reason,
        expiresAt: now + FEED_ITEM_TTL_MS,
      });
      return existing._id;
    }

    // Create new feed item
    return await ctx.db.insert("feedItems", {
      userId: args.userId,
      postId: args.postId,
      relevanceScore: args.relevanceScore,
      urgencyScore: args.urgencyScore,
      finalScore: args.finalScore,
      reason: args.reason,
      seen: false,
      dismissed: false,
      createdAt: now,
      expiresAt: now + FEED_ITEM_TTL_MS,
    });
  },
});

// Write a global feed item (no userId - visible to all)
export const writeGlobalFeedItem = internalMutation({
  args: {
    postId: v.id("posts"),
    parentPostId: v.optional(v.id("posts")),
    relevanceScore: v.number(),
    urgencyScore: v.number(),
    finalScore: v.number(),
    reason: v.union(
      v.literal("assigned"),
      v.literal("trending"),
      v.literal("urgent"),
      v.literal("recent"),
      v.literal("for_you")
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if this feed item already exists globally
    const existing = await ctx.db
      .query("feedItems")
      .withIndex("by_post", (q) => q.eq("postId", args.postId))
      .first();

    if (existing) {
      // Update existing item with new scores
      await ctx.db.patch(existing._id, {
        relevanceScore: args.relevanceScore,
        urgencyScore: args.urgencyScore,
        finalScore: args.finalScore,
        reason: args.reason,
        expiresAt: now + FEED_ITEM_TTL_MS,
      });
      return existing._id;
    }

    // Create new global feed item (userId is undefined)
    return await ctx.db.insert("feedItems", {
      userId: undefined,
      postId: args.postId,
      relevanceScore: args.relevanceScore,
      urgencyScore: args.urgencyScore,
      finalScore: args.finalScore,
      reason: args.reason,
      seen: false,
      dismissed: false,
      createdAt: now,
      expiresAt: now + FEED_ITEM_TTL_MS,
    });
  },
});

// Clean up expired feed items
export const cleanupExpiredFeedItems = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const expired = await ctx.db
      .query("feedItems")
      .withIndex("by_expires")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100);

    for (const item of expired) {
      await ctx.db.delete(item._id);
    }

    return expired.length;
  },
});

// -----------------------------------------------------------------------------
// Main curation action using Grok AI
// -----------------------------------------------------------------------------

export const runCurator = internalAction({
  args: {},
  handler: async (ctx): Promise<{ curated: number; cleanedUp?: number }> => {
    const now = Date.now();
    const since = now - CURATION_WINDOW_MS;

    // Get recent posts (including replies)
    const posts = await ctx.runQuery(
      internal.curator.getRecentPostsForCuration,
      {
        since,
        limit: 100,
      }
    );

    if (posts.length === 0) {
      console.log("[Curator] No recent posts to curate");
      return { curated: 0 };
    }

    // Get the first enabled user's algorithm settings to use their curator prompt
    const algorithmSettings = await ctx.runQuery(
      internal.github.getFirstEnabledAlgorithmSettings
    );
    const curatorPrompt = algorithmSettings?.curatorPrompt || DEFAULT_CURATOR_PROMPT;
    console.log(`[Curator] Using ${algorithmSettings?.curatorPrompt ? "custom" : "default"} curator prompt`);

    // Get existing globally curated post IDs to avoid duplicates
    const existingPostIds = await ctx.runQuery(
      internal.curator.getGloballyCuratedPostIds,
      {}
    );
    const existingSet = new Set(existingPostIds);

    console.log(`[Curator] Processing ${posts.length} posts globally`);

    // Get engagement for all posts and fetch parent posts for replies
    type PostWithContext = Doc<"posts"> & {
      engagement: {
        reactionCount: number;
        replyCount: number;
        agreeCount: number;
        importantCount: number;
      };
      parentPost?: Doc<"posts"> | null;
    };

    const postsWithContext: PostWithContext[] = [];
    for (const post of posts) {
      const engagement = await ctx.runQuery(
        internal.curator.getPostEngagement,
        { postId: post._id }
      );

      let parentPost: Doc<"posts"> | null = null;
      if (post.replyTo) {
        parentPost = await ctx.runQuery(internal.curator.getPost, {
          postId: post.replyTo,
        });
      }

      postsWithContext.push({
        ...post,
        engagement,
        parentPost,
      });
    }

    // Filter out already-curated posts
    const uncuratedPosts = postsWithContext.filter(
      (post) => !existingSet.has(post._id.toString())
    );

    if (uncuratedPosts.length === 0) {
      console.log("[Curator] All posts already curated");
      return { curated: 0 };
    }

    // Prepare posts for Grok evaluation
    const postSummaries = uncuratedPosts.slice(0, 30).map((post, index) => ({
      index,
      author: post.author,
      content:
        post.content.length > 500
          ? post.content.slice(0, 500) + "..."
          : post.content,
      isReply: !!post.replyTo,
      parentContent: post.parentPost
        ? post.parentPost.content.length > 300
          ? post.parentPost.content.slice(0, 300) + "..."
          : post.parentPost.content
        : null,
      parentAuthor: post.parentPost?.author ?? null,
      replyCount: post.replyCount,
      reactionCount: post.engagement.reactionCount,
      ageHours: Math.round((now - post.createdAt) / (1000 * 60 * 60)),
    }));

    let totalCurated = 0;

    try {
      // Ask Grok to select the most interesting posts
      const xai = createXai({
        apiKey: process.env.XAI_API_KEY,
      });

      const result = await generateObject({
        model: xai("grok-4-1-fast-reasoning"),
        schema: z.object({
          selectedPosts: z
            .array(
              z.object({
                index: z.number().describe("Index of the post to curate"),
                score: z
                  .number()
                  .min(0)
                  .max(100)
                  .describe("Interest score 0-100"),
                reason: z
                  .enum(["trending", "recent", "for_you"])
                  .describe("Why this post is interesting"),
                reasoning: z
                  .string()
                  .describe("Brief explanation of why this is interesting"),
              })
            )
            .describe("Posts to surface to the user, most interesting first"),
        }),
        prompt: `${curatorPrompt}

Posts to evaluate:
${JSON.stringify(postSummaries, null, 2)}`,
      });

      // Write feed items for selected posts (globally, no userId)
      for (const selected of result.object.selectedPosts) {
        if (selected.index < 0 || selected.index >= uncuratedPosts.length) {
          continue;
        }

        const post = uncuratedPosts[selected.index];

        await ctx.runMutation(internal.curator.writeGlobalFeedItem, {
          postId: post._id,
          parentPostId: post.replyTo ?? undefined,
          relevanceScore: selected.score,
          urgencyScore: Math.max(
            0,
            100 - Math.round((now - post.createdAt) / (1000 * 60 * 60 * 0.24))
          ),
          finalScore: selected.score,
          reason: selected.reason,
        });
        totalCurated++;

        console.log(
          `[Curator] Selected: "${post.content.slice(0, 50)}..." - ${selected.reasoning}`
        );
      }
    } catch (error) {
      console.error(`[Curator] Error curating:`, error);
    }

    // Cleanup expired items
    const cleanedUp: number = await ctx.runMutation(
      internal.curator.cleanupExpiredFeedItems,
      {}
    );

    console.log(
      `[Curator] Curated ${totalCurated} feed items, cleaned up ${cleanedUp} expired items`
    );

    return { curated: totalCurated, cleanedUp };
  },
});

// -----------------------------------------------------------------------------
// Public queries for reading curated feed
// -----------------------------------------------------------------------------

export const listCuratedFeed = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const identity = await ctx.auth.getUserIdentity();

    // Get global curated feed items (not dismissed, sorted by score)
    const feedItems = await ctx.db
      .query("feedItems")
      .withIndex("by_global_feed", (q) => q.eq("dismissed", false))
      .order("desc")
      .take(limit);

    // Fetch the actual posts and their parents if they're replies
    const itemsWithPosts = await Promise.all(
      feedItems.map(async (item) => {
        const post = await ctx.db.get(item.postId);
        let parentPost: Doc<"posts"> | null = null;

        // If this is a reply, fetch the parent post
        if (post?.replyTo) {
          parentPost = await ctx.db.get(post.replyTo);
        }

        return {
          ...item,
          post,
          parentPost,
        };
      })
    );

    // Filter out items where post was deleted
    const validItems = itemsWithPosts.filter((item) => item.post !== null);

    return {
      viewer: identity?.name ?? null,
      items: validItems,
    };
  },
});

// Mark feed item as seen
export const markFeedItemSeen = internalMutation({
  args: {
    feedItemId: v.id("feedItems"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedItemId, {
      seen: true,
    });
  },
});

// Dismiss a feed item
export const dismissFeedItem = internalMutation({
  args: {
    feedItemId: v.id("feedItems"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.feedItemId, {
      dismissed: true,
    });
  },
});
