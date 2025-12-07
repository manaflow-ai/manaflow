"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { searchRecentTweets, Tweet } from "./_shared/twitterApi";

// =============================================================================
// TWEET FEED - X API-powered Twitter/X content curation
// =============================================================================
// This module:
// - Uses the X API to search for interesting dev tweets
// - Creates posts from those tweets with proper attribution
// - Runs on a cron to populate the feed
// =============================================================================

const MAX_TWEETS_PER_RUN = 1; // Max tweets to import per run (keep low to avoid 429)

// Search query for developer-focused content
// Using X API query syntax: https://docs.x.com/x-api/posts/search/integrate/build-a-query
const SEARCH_QUERY = "(AI OR LLM OR developer OR coding) (demo OR launch OR shipped OR built) -is:retweet -is:reply lang:en";

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

    // Get X Bearer Token from environment
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      console.log("[tweetFeed] X_BEARER_TOKEN not configured, skipping");
      return { imported: 0, message: "X_BEARER_TOKEN not configured" };
    }

    // Get recently imported tweet IDs to avoid duplicates
    const recentTweetIds = await ctx.runQuery(
      internal.tweetFeedDb.getRecentTweetIds,
      { limit: 50 }
    );
    const recentTweetIdSet = new Set(recentTweetIds);

    console.log("[tweetFeed] Searching for tweets...");

    // Single API call to avoid rate limits
    let tweets: Tweet[] = [];
    try {
      const result = await searchRecentTweets({
        query: SEARCH_QUERY,
        maxResults: 10,
        bearerToken,
      });

      if (result.success) {
        // Filter out already imported tweets
        tweets = result.tweets.filter((tweet) => !recentTweetIdSet.has(tweet.id));
        console.log(`[tweetFeed] Found ${tweets.length} new tweets`);
      } else {
        console.error(`[tweetFeed] Search failed: ${result.error}`);
        return { imported: 0, message: `Search failed: ${result.error}` };
      }
    } catch (error) {
      console.error("[tweetFeed] Error searching:", error);
      return { imported: 0, message: `Error: ${error instanceof Error ? error.message : "Unknown"}` };
    }

    if (tweets.length === 0) {
      console.log("[tweetFeed] No new tweets found");
      return { imported: 0, message: "No new tweets found" };
    }

    // Sort by engagement and take top one
    const sortedTweets = tweets
      .sort((a, b) => {
        const engagementA = (a.metrics?.likes ?? 0) + (a.metrics?.retweets ?? 0);
        const engagementB = (b.metrics?.likes ?? 0) + (b.metrics?.retweets ?? 0);
        return engagementB - engagementA;
      })
      .slice(0, MAX_TWEETS_PER_RUN);

    // Import each tweet as a post
    let imported = 0;
    for (const tweet of sortedTweets) {
      // Format the content with tweet text and media
      let content = tweet.text;

      // Add media images if present
      if (tweet.mediaUrls && tweet.mediaUrls.length > 0) {
        content += "\n\n";
        content += tweet.mediaUrls.map((url, i) => `![Image ${i + 1}](${url})`).join("\n");
      }

      // Add link to original tweet
      const tweetUrl = `https://x.com/${tweet.authorUsername}/status/${tweet.id}`;
      content += `\n\n[View on X](${tweetUrl})`;

      await ctx.runMutation(internal.tweetFeedDb.createTweetPost, {
        content,
        tweetSource: {
          tweetId: tweet.id,
          tweetUrl,
          authorUsername: tweet.authorUsername,
          authorName: tweet.authorName,
          authorProfileImageUrl: tweet.authorProfileImageUrl,
          metrics: tweet.metrics,
          mediaUrls: tweet.mediaUrls,
        },
      });

      console.log(`[tweetFeed] Imported tweet from @${tweet.authorUsername}`);
      imported++;
    }

    console.log(`[tweetFeed] Imported ${imported} tweets`);
    return { imported, message: `Imported ${imported} tweets` };
  },
});

// -----------------------------------------------------------------------------
// Manual test action (for UI button)
// -----------------------------------------------------------------------------

export const testTweetFeed = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; message: string; tweet?: { text: string; author: string; url: string } }> => {
    // Get X Bearer Token from environment
    const bearerToken = process.env.X_BEARER_TOKEN;
    if (!bearerToken) {
      return { success: false, message: "X_BEARER_TOKEN not configured" };
    }

    // Use the search query
    const query = SEARCH_QUERY;

    try {
      const result = await searchRecentTweets({
        query,
        maxResults: 10,
        bearerToken,
      });

      if (!result.success) {
        return { success: false, message: `X API error: ${result.error}` };
      }

      if (result.tweets.length === 0) {
        return { success: false, message: "No tweets found matching query" };
      }

      // Get the most engaging tweet
      const tweet = result.tweets.sort((a, b) => {
        const engagementA = (a.metrics?.likes ?? 0) + (a.metrics?.retweets ?? 0);
        const engagementB = (b.metrics?.likes ?? 0) + (b.metrics?.retweets ?? 0);
        return engagementB - engagementA;
      })[0];

      const tweetUrl = `https://x.com/${tweet.authorUsername}/status/${tweet.id}`;

      // Import the tweet
      await ctx.runMutation(internal.tweetFeedDb.createTweetPost, {
        content: `${tweet.text}\n\n[View on X](${tweetUrl})`,
        tweetSource: {
          tweetId: tweet.id,
          tweetUrl,
          authorUsername: tweet.authorUsername,
          authorName: tweet.authorName,
          authorProfileImageUrl: tweet.authorProfileImageUrl,
          metrics: tweet.metrics,
          mediaUrls: tweet.mediaUrls,
        },
      });

      return {
        success: true,
        message: `Imported tweet from @${tweet.authorUsername}`,
        tweet: {
          text: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? "..." : ""),
          author: `@${tweet.authorUsername}`,
          url: tweetUrl,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
