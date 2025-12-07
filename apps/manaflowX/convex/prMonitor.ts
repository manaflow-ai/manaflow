"use node";

import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { fetchInstallationAccessToken } from "./_shared/githubApp";
import { xai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";

// GitHub PR type from API
type GitHubPR = {
  number: number;
  title: string;
  html_url: string;
  user: {
    login: string;
    avatar_url: string;
  };
  state: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  labels: Array<{ name: string }>;
  head: {
    ref: string;
  };
  base: {
    ref: string;
  };
};

// Fetch PRs from GitHub for a single repo
async function fetchRepoPRs(
  fullName: string,
  accessToken: string
): Promise<GitHubPR[]> {
  const response = await fetch(
    `https://api.github.com/repos/${fullName}/pulls?state=open&per_page=30`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "xagi-pr-monitor",
      },
    }
  );

  if (!response.ok) {
    console.error(
      `[prMonitor] Failed to fetch PRs for ${fullName}: ${response.status}`
    );
    return [];
  }

  return (await response.json()) as GitHubPR[];
}

// Extract PR URLs from post content
function extractPRUrlsFromPosts(posts: Array<{ content: string }>): Set<string> {
  const urls = new Set<string>();
  const prUrlPattern = /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/g;

  for (const post of posts) {
    const matches = post.content.match(prUrlPattern);
    if (matches) {
      for (const match of matches) {
        urls.add(match);
      }
    }
  }

  return urls;
}

// Test action: Fetch PRs from monitored repos and post one to the feed
export const testFetchAndPostPR = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; message: string; pr?: { title: string; url: string; repo: string } }> => {
    // Get monitored repos with installation IDs
    const repos = await ctx.runQuery(
      internal.github.getMonitoredReposWithInstallation
    );

    if (repos.length === 0) {
      return { success: false, message: "No monitored repos found" };
    }

    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      return { success: false, message: "GitHub App credentials not configured" };
    }

    // Get recent Grok posts to avoid duplicates
    const recentPosts = await ctx.runQuery(internal.posts.getRecentGrokPosts, { limit: 10 });
    const alreadyPostedUrls = extractPRUrlsFromPosts(recentPosts);
    console.log(`[prMonitor] Found ${alreadyPostedUrls.size} recently posted PR URLs to avoid`);

    // Group repos by installation ID
    const reposByInstallation = new Map<number, typeof repos>();
    for (const repo of repos) {
      const installId = repo.installationId!;
      if (!reposByInstallation.has(installId)) {
        reposByInstallation.set(installId, []);
      }
      reposByInstallation.get(installId)!.push(repo);
    }

    // Collect all PRs
    const allPRs: Array<{ pr: GitHubPR; repoFullName: string }> = [];

    for (const [installationId, installationRepos] of reposByInstallation) {
      // Get access token for this installation
      const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
      const accessToken = await fetchInstallationAccessToken(
        installationId,
        appId,
        normalizedPrivateKey
      );

      if (!accessToken) {
        console.log(
          `[prMonitor] Could not get access token for installation ${installationId}`
        );
        continue;
      }

      // Fetch PRs for each repo in this installation
      for (const repo of installationRepos) {
        console.log(`[prMonitor] Fetching PRs for ${repo.fullName}`);
        const prs = await fetchRepoPRs(repo.fullName, accessToken);
        console.log(`[prMonitor] Found ${prs.length} open PRs in ${repo.fullName}`);

        for (const pr of prs) {
          allPRs.push({ pr, repoFullName: repo.fullName });
        }
      }
    }

    if (allPRs.length === 0) {
      return { success: false, message: "No open PRs found in monitored repos" };
    }

    // Format PRs for Grok to evaluate
    const prSummaries = allPRs.map((item, index) => ({
      index,
      repo: item.repoFullName,
      number: item.pr.number,
      title: item.pr.title,
      url: item.pr.html_url,
      author: item.pr.user.login,
      labels: item.pr.labels.map((l) => l.name),
      draft: item.pr.draft,
      headBranch: item.pr.head.ref,
      baseBranch: item.pr.base.ref,
      createdAt: item.pr.created_at,
      updatedAt: item.pr.updated_at,
      alreadyPosted: alreadyPostedUrls.has(item.pr.html_url),
    }));

    // Build the list of already posted PRs for the prompt
    const alreadyPostedList = Array.from(alreadyPostedUrls).slice(0, 20);

    console.log(`[prMonitor] Asking Grok to evaluate ${prSummaries.length} PRs`);

    // Have Grok pick the most interesting PR and write the post
    const result = await generateObject({
      model: xai("grok-3-fast"),
      schema: z.object({
        selectedIndex: z.number().describe("The index of the most interesting PR to post about"),
        reasoning: z.string().describe("Brief explanation of why this PR is interesting"),
        tweetContent: z.string().describe("The tweet/post content to share about this PR. Should be engaging and concise. Include the PR title and repo name. Do NOT include the URL - it will be added automatically."),
      }),
      prompt: `You are curating a developer feed. Look at these open Pull Requests and pick the MOST INTERESTING one to share with the community.

IMPORTANT: Do NOT select PRs that have already been posted. PRs marked with "alreadyPosted: true" MUST be skipped.

${alreadyPostedList.length > 0 ? `Recently posted PR URLs to AVOID:\n${alreadyPostedList.join('\n')}\n` : ''}

Consider:
- Is it a significant feature or important bug fix?
- Does the title suggest something notable?
- Is it from an active/interesting project?
- Avoid drafts unless they look really interesting
- Prefer PRs with meaningful labels (bug, feature, enhancement) over chores/docs

PRs to evaluate:
${JSON.stringify(prSummaries, null, 2)}

Pick ONE PR that has NOT been posted yet and write an engaging tweet about it. The tweet should be concise and make developers want to check out the PR.`,
    });

    const selectedIndex = result.object.selectedIndex;
    if (selectedIndex < 0 || selectedIndex >= allPRs.length) {
      // Fallback to random if Grok gave invalid index
      const randomIndex = Math.floor(Math.random() * allPRs.length);
      const selected = allPRs[randomIndex];
      const { pr, repoFullName } = selected;

      const content = `**${repoFullName}**\n\n[${pr.title}](${pr.html_url})\n\nby @${pr.user.login}`;

      await ctx.runMutation(api.posts.createPost, {
        content,
        author: "Grok",
      });

      return {
        success: true,
        message: `Posted PR #${pr.number} from ${repoFullName} (random fallback)`,
        pr: { title: pr.title, url: pr.html_url, repo: repoFullName },
      };
    }

    const selected = allPRs[selectedIndex];
    const { pr, repoFullName } = selected;

    // Add the URL to Grok's tweet content
    const content = `${result.object.tweetContent}\n\n${pr.html_url}`;

    console.log(`[prMonitor] Grok selected PR #${pr.number}: ${result.object.reasoning}`);

    await ctx.runMutation(api.posts.createPost, {
      content,
      author: "Grok",
    });

    return {
      success: true,
      message: `Grok picked PR #${pr.number}: ${result.object.reasoning}`,
      pr: {
        title: pr.title,
        url: pr.html_url,
        repo: repoFullName,
      },
    };
  },
});

// Internal action for cron job - checks if enabled before running
export const cronFetchAndPostPR = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    // Check if PR monitoring is enabled
    const isEnabled = await ctx.runQuery(
      internal.github.getAlgorithmSettingInternal,
      { key: "prMonitorEnabled" }
    );

    if (!isEnabled) {
      console.log("[prMonitor] PR monitoring cron is disabled, skipping");
      return;
    }

    console.log("[prMonitor] Running scheduled PR fetch and post");

    // Get monitored repos with installation IDs
    const repos = await ctx.runQuery(
      internal.github.getMonitoredReposWithInstallation
    );

    if (repos.length === 0) {
      console.log("[prMonitor] No monitored repos found");
      return;
    }

    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

    if (!appId || !privateKey) {
      console.log("[prMonitor] GitHub App credentials not configured");
      return;
    }

    // Get recent Grok posts to avoid duplicates
    const recentPosts = await ctx.runQuery(internal.posts.getRecentGrokPosts, { limit: 10 });
    const alreadyPostedUrls = extractPRUrlsFromPosts(recentPosts);
    console.log(`[prMonitor] Found ${alreadyPostedUrls.size} recently posted PR URLs to avoid`);

    // Group repos by installation ID
    const reposByInstallation = new Map<number, typeof repos>();
    for (const repo of repos) {
      const installId = repo.installationId!;
      if (!reposByInstallation.has(installId)) {
        reposByInstallation.set(installId, []);
      }
      reposByInstallation.get(installId)!.push(repo);
    }

    // Collect all PRs
    const allPRs: Array<{ pr: GitHubPR; repoFullName: string }> = [];

    for (const [installationId, installationRepos] of reposByInstallation) {
      // Get access token for this installation
      const normalizedPrivateKey = privateKey.replace(/\\n/g, "\n");
      const accessToken = await fetchInstallationAccessToken(
        installationId,
        appId,
        normalizedPrivateKey
      );

      if (!accessToken) {
        console.log(
          `[prMonitor] Could not get access token for installation ${installationId}`
        );
        continue;
      }

      // Fetch PRs for each repo in this installation
      for (const repo of installationRepos) {
        console.log(`[prMonitor] Fetching PRs for ${repo.fullName}`);
        const prs = await fetchRepoPRs(repo.fullName, accessToken);
        console.log(`[prMonitor] Found ${prs.length} open PRs in ${repo.fullName}`);

        for (const pr of prs) {
          allPRs.push({ pr, repoFullName: repo.fullName });
        }
      }
    }

    if (allPRs.length === 0) {
      console.log("[prMonitor] No open PRs found in monitored repos");
      return;
    }

    // Format PRs for Grok to evaluate
    const prSummaries = allPRs.map((item, index) => ({
      index,
      repo: item.repoFullName,
      number: item.pr.number,
      title: item.pr.title,
      url: item.pr.html_url,
      author: item.pr.user.login,
      labels: item.pr.labels.map((l) => l.name),
      draft: item.pr.draft,
      headBranch: item.pr.head.ref,
      baseBranch: item.pr.base.ref,
      createdAt: item.pr.created_at,
      updatedAt: item.pr.updated_at,
      alreadyPosted: alreadyPostedUrls.has(item.pr.html_url),
    }));

    // Build the list of already posted PRs for the prompt
    const alreadyPostedList = Array.from(alreadyPostedUrls).slice(0, 20);

    console.log(`[prMonitor] Asking Grok to evaluate ${prSummaries.length} PRs`);

    // Have Grok pick the most interesting PR and write the post
    const result = await generateObject({
      model: xai("grok-3-fast"),
      schema: z.object({
        selectedIndex: z.number().describe("The index of the most interesting PR to post about"),
        reasoning: z.string().describe("Brief explanation of why this PR is interesting"),
        tweetContent: z.string().describe("The tweet/post content to share about this PR. Should be engaging and concise. Include the PR title and repo name. Do NOT include the URL - it will be added automatically."),
      }),
      prompt: `You are curating a developer feed. Look at these open Pull Requests and pick the MOST INTERESTING one to share with the community.

IMPORTANT: Do NOT select PRs that have already been posted. PRs marked with "alreadyPosted: true" MUST be skipped.

${alreadyPostedList.length > 0 ? `Recently posted PR URLs to AVOID:\n${alreadyPostedList.join('\n')}\n` : ''}

Consider:
- Is it a significant feature or important bug fix?
- Does the title suggest something notable?
- Is it from an active/interesting project?
- Avoid drafts unless they look really interesting
- Prefer PRs with meaningful labels (bug, feature, enhancement) over chores/docs

PRs to evaluate:
${JSON.stringify(prSummaries, null, 2)}

Pick ONE PR that has NOT been posted yet and write an engaging tweet about it. The tweet should be concise and make developers want to check out the PR.`,
    });

    const selectedIndex = result.object.selectedIndex;
    if (selectedIndex < 0 || selectedIndex >= allPRs.length) {
      // Fallback to random if Grok gave invalid index
      const randomIndex = Math.floor(Math.random() * allPRs.length);
      const selected = allPRs[randomIndex];
      const { pr, repoFullName } = selected;

      const content = `**${repoFullName}**\n\n[${pr.title}](${pr.html_url})\n\nby @${pr.user.login}`;

      await ctx.runMutation(api.posts.createPost, {
        content,
        author: "Grok",
      });

      console.log(`[prMonitor] Posted PR #${pr.number} from ${repoFullName} (random fallback)`);
      return;
    }

    const selected = allPRs[selectedIndex];
    const { pr, repoFullName } = selected;

    // Add the URL to Grok's tweet content
    const content = `${result.object.tweetContent}\n\n${pr.html_url}`;

    console.log(`[prMonitor] Grok selected PR #${pr.number}: ${result.object.reasoning}`);

    await ctx.runMutation(api.posts.createPost, {
      content,
      author: "Grok",
    });

    console.log(`[prMonitor] Successfully posted PR #${pr.number} from ${repoFullName}`);
  },
});
