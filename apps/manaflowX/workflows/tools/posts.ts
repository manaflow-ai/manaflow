import { tool } from "ai";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// =============================================================================
// AI SDK Tools for Twitter-style Posts
// =============================================================================

export const createPostTool = tool({
  description: "Create a new post in the activity stream",
  inputSchema: z.object({
    content: z.string().describe("Content of the post"),
    author: z.string().optional().describe("Author name (default: Anonymous)"),
  }),
  execute: async ({ content, author }) => {
    const postId = await convex.mutation(api.posts.createPost, {
      content,
      author,
    });
    return { postId, success: true };
  },
});

export const replyToPostTool = tool({
  description: "Reply to an existing post",
  inputSchema: z.object({
    content: z.string().describe("Content of the reply"),
    replyToId: z.string().describe("ID of the post to reply to"),
    author: z.string().optional().describe("Author name (default: Anonymous)"),
  }),
  execute: async ({ content, replyToId, author }) => {
    const postId = await convex.mutation(api.posts.createPost, {
      content,
      author,
      replyTo: replyToId as Id<"posts">,
    });
    return { postId, success: true };
  },
});

export const listPostsTool = tool({
  description: "List recent posts from the activity stream",
  inputSchema: z.object({
    limit: z.number().optional().describe("Max results (default: 20)"),
  }),
  execute: async ({ limit }) => {
    const result = await convex.query(api.posts.listPosts, {
      limit: limit ?? 20,
    });
    return result.posts.map((p) => ({
      id: p._id,
      content: p.content,
      author: p.author,
      replyCount: p.replyCount,
      createdAt: new Date(p.createdAt).toISOString(),
    }));
  },
});

export const getPostThreadTool = tool({
  description: "Get a post and all its replies (the full thread)",
  inputSchema: z.object({
    postId: z.string().describe("ID of the post"),
  }),
  execute: async ({ postId }) => {
    const thread = await convex.query(api.posts.getPostThread, {
      postId: postId as Id<"posts">,
    });
    if (!thread) return null;

    return {
      root: {
        id: thread.root._id,
        content: thread.root.content,
        author: thread.root.author,
        replyCount: thread.root.replyCount,
      },
      replies: thread.replies.map((r) => ({
        id: r._id,
        content: r.content,
        author: r.author,
        depth: r.depth,
      })),
    };
  },
});

// Export all tools
export const postTools = {
  createPost: createPostTool,
  replyToPost: replyToPostTool,
  listPosts: listPostsTool,
  getPostThread: getPostThreadTool,
};
