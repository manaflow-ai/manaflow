import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

export const startWorkflow = action({
  args: {
    content: v.string(),
  },
  handler: async (ctx, args) => {
    // In a real app, this might trigger an external API,
    // run a long-running process, or use AI to analyze the content.

    console.log("Starting workflow for:", args.content);

    // Create a post in the activity stream
    await ctx.runMutation(api.posts.createPost, {
      content: args.content,
      author: "Workflow",
    });

    return { success: true, message: "Workflow started" };
  },
});
