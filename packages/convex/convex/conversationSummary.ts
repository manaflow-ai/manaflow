"use node";

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type TitleStyle = "sentence" | "lowercase" | "title";

const STYLE_PROMPTS: Record<TitleStyle, { instruction: string; examples: string }> = {
  sentence: {
    instruction: "Use sentence case (capitalize only the first letter, except for proper nouns).",
    examples: [
      "User: Implement OAuth login with Google\nTitle: OAuth Google login",
      "User: Fix the bug where users can't upload images larger than 5MB\nTitle: Fix large image upload bug",
      "User: Refactor the authentication module to use JWT tokens\nTitle: Refactor auth to JWT",
      "User: Add a dark mode toggle to the settings page\nTitle: Add dark mode toggle",
      "User: Why is my database query slow?\nTitle: Debug slow database query",
      "User: curl ipinfo.io\nTitle: Get public IP info",
      "User: ls -la\nTitle: List directory contents",
      "User: Create a React component for displaying user profiles\nTitle: Create user profile component",
      "User: help me understand this error: TypeError: Cannot read property 'map' of undefined\nTitle: Debug map undefined error",
      "User: Write tests for the payment service\nTitle: Write payment service tests",
    ].join("\n\n"),
  },
  lowercase: {
    instruction: "Use lowercase unless it's a proper noun.",
    examples: [
      "User: Implement OAuth login with Google\nTitle: OAuth Google login",
      "User: Fix the bug where users can't upload images larger than 5MB\nTitle: fix large image upload bug",
      "User: Refactor the authentication module to use JWT tokens\nTitle: refactor auth to JWT",
      "User: Add a dark mode toggle to the settings page\nTitle: add dark mode toggle",
      "User: Why is my database query slow?\nTitle: debug slow database query",
      "User: curl ipinfo.io\nTitle: get public IP info",
      "User: ls -la\nTitle: list directory contents",
      "User: Create a React component for displaying user profiles\nTitle: create user profile component",
      "User: help me understand this error: TypeError: Cannot read property 'map' of undefined\nTitle: debug map undefined error",
      "User: Write tests for the payment service\nTitle: write payment service tests",
    ].join("\n\n"),
  },
  title: {
    instruction: "Use Title Case (capitalize the first letter of each major word).",
    examples: [
      "User: Implement OAuth login with Google\nTitle: OAuth Google Login",
      "User: Fix the bug where users can't upload images larger than 5MB\nTitle: Fix Large Image Upload Bug",
      "User: Refactor the authentication module to use JWT tokens\nTitle: Refactor Auth to JWT",
      "User: Add a dark mode toggle to the settings page\nTitle: Add Dark Mode Toggle",
      "User: Why is my database query slow?\nTitle: Debug Slow Database Query",
      "User: curl ipinfo.io\nTitle: Get Public IP Info",
      "User: ls -la\nTitle: List Directory Contents",
      "User: Create a React component for displaying user profiles\nTitle: Create User Profile Component",
      "User: help me understand this error: TypeError: Cannot read property 'map' of undefined\nTitle: Debug Map Undefined Error",
      "User: Write tests for the payment service\nTitle: Write Payment Service Tests",
    ].join("\n\n"),
  },
};

function buildSystemPrompt(style: TitleStyle): string {
  const styleConfig = STYLE_PROMPTS[style];
  return [
    "You generate ultra-brief titles (3-8 words) for coding conversations.",
    "Output ONLY the title as plain text. No quotes, no punctuation at the end.",
    `Focus on the main action or topic. ${styleConfig.instruction}`,
    "If it's a shell command, describe what it does briefly.",
  ].join("\n");
}

function buildExamples(style: TitleStyle): string {
  return STYLE_PROMPTS[style].examples;
}

/**
 * Generate a brief title (3-8 words) from the first user message.
 * Uses GPT-4.1 Nano for fast, cheap inference.
 */
export const generateTitle = internalAction({
  args: {
    conversationId: v.id("conversations"),
    firstMessageText: v.string(),
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn(
        "[conversationTitle] OPENAI_API_KEY not configured, skipping title generation"
      );
      return;
    }

    // Fetch workspace settings to get title style preference
    const settings = await ctx.runQuery(
      internal.workspaceSettings.getByTeamAndUserInternal,
      { teamId: args.teamId, userId: args.userId }
    );

    const titleStyle: TitleStyle = settings?.conversationTitleStyle ?? "sentence";
    const customPrompt = settings?.conversationTitleCustomPrompt;

    // Truncate message if too long
    const maxChars = 2000;
    const truncatedMessage =
      args.firstMessageText.length > maxChars
        ? args.firstMessageText.slice(0, maxChars)
        : args.firstMessageText;

    // Use custom prompt if provided, otherwise use style-based prompt
    const system = customPrompt || buildSystemPrompt(titleStyle);
    const examples = buildExamples(titleStyle);

    const prompt = [
      "Examples:\n",
      examples,
      "\n\nNow generate a title for this message:\n\n",
      `User: ${truncatedMessage}\nTitle:`,
    ].join("");

    try {
      const openai = createOpenAI({ apiKey });
      const { text } = await generateText({
        model: openai("gpt-4.1-nano"),
        system,
        prompt,
        maxRetries: 2,
      });

      const title = text.trim().slice(0, 100); // Cap at 100 chars just in case
      if (title) {
        await ctx.runMutation(internal.conversationTitle.setTitle, {
          conversationId: args.conversationId,
          title,
        });
        console.log(
          `[conversationTitle] Generated title for ${args.conversationId}: ${title}`
        );
      }
    } catch (error) {
      console.error("[conversationTitle] Failed to generate title:", error);
      // Non-critical - don't throw, just log
    }
  },
});
