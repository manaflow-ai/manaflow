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
    
    // For now, we'll simulate a workflow step and then create the task.
    console.log("Starting workflow for:", args.content);

    // Generate a title from the content (first 50 chars)
    const title = args.content.slice(0, 50) + (args.content.length > 50 ? "..." : "");

    await ctx.runMutation(api.myFunctions.createTask, {
      title,
      content: args.content,
      type: "discussion", // Default type
      priority: "medium",
    });

    return { success: true, message: "Workflow started" };
  },
});
