"use node";

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import { v } from "convex/values";

// =============================================================================
// TWEET FEED - Grok-powered Twitter/X content curation
// =============================================================================
// This module:
// - Uses Grok to search for interesting tweets relevant to recent posts
// - Creates posts from those tweets with proper attribution
// - Runs on a cron every minute to populate the feed
// =============================================================================

const MAX_TWEETS_PER_RUN = 3; // Max tweets to import per run
const RECENT_POSTS_CONTEXT = 5; // Number of recent posts to use for context

const TWEET_SEARCH_PROMPT = `You are a content curator for a developer-focused feed. Your job is to find interesting and relevant tweets from X/Twitter that would be valuable to our community.

Based on the recent posts in our feed, search for tweets that are:
- Developer demos and showcases (showing off cool projects)
- AI/ML announcements and updates
- Interesting technical discussions
- Product launches relevant to developers
- Helpful tutorials or tips
- Funny/clever developer humor that would bring joy

You have real-time access to X/Twitter data. Search for tweets that complement the topics being discussed.

IMPORTANT:
- Find tweets from the last 24 hours when possible
- Prefer tweets with good engagement (likes, retweets)
- Include a mix of content types (demos, news, humor)
- Avoid spam, low-quality content, or controversial topics
- Include the full tweet text and author information`;

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

// -----------------------------------------------------------------------------
// Main tweet feed action
// -----------------------------------------------------------------------------

export const runTweetFeed = internalAction({
  args: {},
  handler: async (ctx): Promise<{ imported: number; message: string }> => {
    // Check if any user has algorithm enabled (same as github monitor)
    const enabledUsers = await ctx.runQuery(
      internal.github.getUsersWithAlgorithmEnabled
    );

    if (enabledUsers.length === 0) {
      console.log("[tweetFeed] No users have algorithm enabled, skipping");
      return { imported: 0, message: "No users have algorithm enabled" };
    }

    // Get recent posts for context
    const recentPosts = await ctx.runQuery(
      internal.tweetFeed.getRecentPostsForContext,
      { limit: RECENT_POSTS_CONTEXT }
    );

    if (recentPosts.length === 0) {
      console.log("[tweetFeed] No recent posts for context, skipping");
      return { imported: 0, message: "No recent posts for context" };
    }

    // Get recently imported tweet IDs to avoid duplicates
    const recentTweetIds = await ctx.runQuery(
      internal.tweetFeed.getRecentTweetIds,
      { limit: 50 }
    );
    const recentTweetIdSet = new Set(recentTweetIds);

    console.log(`[tweetFeed] Finding tweets based on ${recentPosts.length} recent posts`);

    // Format recent posts for Grok context
    const postsContext = recentPosts.map((post: { author: string; content: string; createdAt: number }, i: number) => ({
      index: i,
      author: post.author,
      content: post.content,
    }));

    try {
      // Ask Grok to search for and return relevant tweets
      const xai = createXai({
        apiKey: process.env.XAI_API_KEY,
      });

      const result = await generateObject({
        model: xai("grok-4-1-fast-reasoning"),
        schema: z.object({
          tweets: z.array(
            z.object({
              tweetId: z.string().describe("The unique ID of the tweet"),
              tweetUrl: z.string().describe("Full URL to the tweet (https://x.com/username/status/id)"),
              authorUsername: z.string().describe("The @username of the tweet author (without @)"),
              authorName: z.string().describe("The display name of the tweet author"),
              authorProfileImageUrl: z.string().optional().describe("Profile image URL if available"),
              text: z.string().describe("The full text content of the tweet"),
              metrics: z.object({
                likes: z.number().describe("Number of likes"),
                retweets: z.number().describe("Number of retweets"),
                replies: z.number().describe("Number of replies"),
                views: z.number().optional().describe("Number of views if available"),
              }).optional(),
              mediaUrls: z.array(z.string()).optional().describe("URLs of images/videos in the tweet"),
              reasoning: z.string().describe("Why this tweet is relevant and interesting"),
            })
          ).describe(`Up to ${MAX_TWEETS_PER_RUN} interesting tweets to import`),
        }),
        prompt: `${TWEET_SEARCH_PROMPT}

Recent posts in our feed for context:
${JSON.stringify(postsContext, null, 2)}

Already imported tweet IDs (DO NOT include these):
${JSON.stringify(Array.from(recentTweetIdSet).slice(0, 20))}

Search X/Twitter and find ${MAX_TWEETS_PER_RUN} interesting, relevant tweets that would complement this feed. Include tweets with developer content, AI updates, technical demos, or entertaining developer humor.

Return the tweets with all available metadata including engagement metrics and media URLs.`,
      });

      const { tweets } = result.object;

      if (!tweets || tweets.length === 0) {
        console.log("[tweetFeed] No tweets found");
        return { imported: 0, message: "No relevant tweets found" };
      }

      // Filter out duplicates
      const newTweets = tweets.filter((tweet) => !recentTweetIdSet.has(tweet.tweetId));

      if (newTweets.length === 0) {
        console.log("[tweetFeed] All found tweets were already imported");
        return { imported: 0, message: "All tweets already imported" };
      }

      // Import each tweet as a post
      let imported = 0;
      for (const tweet of newTweets.slice(0, MAX_TWEETS_PER_RUN)) {
        // Format the content with tweet text and media
        let content = tweet.text;

        // Add media images if present
        if (tweet.mediaUrls && tweet.mediaUrls.length > 0) {
          content += "\n\n";
          content += tweet.mediaUrls.map((url, i) => `![Image ${i + 1}](${url})`).join("\n");
        }

        // Add link to original tweet
        content += `\n\n[View on X](${tweet.tweetUrl})`;

        await ctx.runMutation(internal.tweetFeed.createTweetPost, {
          content,
          tweetSource: {
            tweetId: tweet.tweetId,
            tweetUrl: tweet.tweetUrl,
            authorUsername: tweet.authorUsername,
            authorName: tweet.authorName,
            authorProfileImageUrl: tweet.authorProfileImageUrl,
            metrics: tweet.metrics,
            mediaUrls: tweet.mediaUrls,
          },
        });

        console.log(`[tweetFeed] Imported tweet from @${tweet.authorUsername}: ${tweet.reasoning}`);
        imported++;
      }

      console.log(`[tweetFeed] Imported ${imported} tweets`);
      return { imported, message: `Imported ${imported} tweets` };
    } catch (error) {
      console.error("[tweetFeed] Error searching tweets:", error);
      return { imported: 0, message: `Error: ${error instanceof Error ? error.message : "Unknown error"}` };
    }
  },
});
