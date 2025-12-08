import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// =============================================================================
// TWEET FEED DATABASE OPERATIONS
// =============================================================================
// These run in the default Convex runtime (not Node.js)
// =============================================================================

// -----------------------------------------------------------------------------
// Internal queries
// -----------------------------------------------------------------------------

// Get recent posts for context (to understand what topics are relevant)
export const getRecentPostsForContext = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_created")
      .order("desc")
      .filter((q) => q.eq(q.field("depth"), 0)) // Only root posts
      .take(args.limit);

    return posts.map((post) => ({
      content: post.content.slice(0, 500),
      author: post.author,
      createdAt: post.createdAt,
    }));
  },
});

// Get recently imported tweet IDs to avoid duplicates
export const getRecentTweetIds = internalQuery({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const posts = await ctx.db
      .query("posts")
      .withIndex("by_created")
      .order("desc")
      .take(args.limit * 10); // Check more posts to find tweet imports

    const tweetIds: string[] = [];
    for (const post of posts) {
      if (post.tweetSource?.tweetId) {
        tweetIds.push(post.tweetSource.tweetId);
      }
    }

    return tweetIds.slice(0, args.limit);
  },
});

// -----------------------------------------------------------------------------
// Internal mutations
// -----------------------------------------------------------------------------

// Create a post from a tweet
export const createTweetPost = internalMutation({
  args: {
    content: v.string(),
    tweetSource: v.object({
      tweetId: v.string(),
      tweetUrl: v.string(),
      authorUsername: v.string(),
      authorName: v.string(),
      authorProfileImageUrl: v.optional(v.string()),
      metrics: v.optional(
        v.object({
          likes: v.number(),
          retweets: v.number(),
          replies: v.number(),
          views: v.optional(v.number()),
        })
      ),
      mediaUrls: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const postId = await ctx.db.insert("posts", {
      content: args.content,
      author: `@${args.tweetSource.authorUsername}`,
      authorId: undefined,
      replyTo: undefined,
      threadRoot: undefined,
      depth: 0,
      issue: undefined,
      tweetSource: args.tweetSource,
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return postId;
  },
});
