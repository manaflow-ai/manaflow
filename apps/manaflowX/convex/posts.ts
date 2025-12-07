import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// =============================================================================
// POSTS - Twitter-style activity stream
// =============================================================================

export const listPosts = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    const postsQuery = ctx.db
      .query("posts")
      .withIndex("by_created")
      .order("desc");

    // Only get root posts (not replies) for main feed
    const allPosts = await postsQuery.take(limit * 2);
    const rootPosts = allPosts.filter((p) => !p.replyTo).slice(0, limit);

    return {
      viewer: (await ctx.auth.getUserIdentity())?.name ?? null,
      posts: rootPosts,
    };
  },
});

export const createPost = mutation({
  args: {
    content: v.string(),
    author: v.optional(v.string()),
    replyTo: v.optional(v.id("posts")),
    issue: v.optional(v.id("issues")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const identity = await ctx.auth.getUserIdentity();

    const author = args.author ?? identity?.name ?? "Anonymous";

    // Handle threading
    let depth = 0;
    let threadRoot = undefined;

    if (args.replyTo) {
      const parent = await ctx.db.get(args.replyTo);
      if (parent) {
        depth = parent.depth + 1;
        threadRoot = parent.threadRoot ?? parent._id;

        // Update parent's reply count
        await ctx.db.patch(args.replyTo, {
          replyCount: parent.replyCount + 1,
          updatedAt: now,
        });
      }
    }

    const postId = await ctx.db.insert("posts", {
      content: args.content,
      author,
      authorId: undefined,
      replyTo: args.replyTo,
      threadRoot,
      depth,
      issue: args.issue,
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return postId;
  },
});

export const getPostThread = query({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    const post = await ctx.db.get(args.postId);
    if (!post) return null;

    const threadRootId = post.threadRoot ?? post._id;

    const replies = await ctx.db
      .query("posts")
      .withIndex("by_thread", (q) => q.eq("threadRoot", threadRootId))
      .order("asc")
      .collect();

    let rootPost = post;
    if (post.threadRoot) {
      const root = await ctx.db.get(post.threadRoot);
      if (root) rootPost = root;
    }

    return {
      root: rootPost,
      replies,
      focusedPost: post,
    };
  },
});

export const getPostReplies = query({
  args: {
    postId: v.id("posts"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const replies = await ctx.db
      .query("posts")
      .withIndex("by_replyTo", (q) => q.eq("replyTo", args.postId))
      .order("asc")
      .take(limit);

    return replies;
  },
});

export const getPostsByIssue = query({
  args: {
    issueId: v.id("issues"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const posts = await ctx.db
      .query("posts")
      .withIndex("by_issue", (q) => q.eq("issue", args.issueId))
      .order("desc")
      .take(limit);

    return posts;
  },
});
