"use node";

import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { fetchInstallationAccessToken } from "./_shared/githubApp";
import { xai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";

// Default system prompt for Grok algorithm
const DEFAULT_GROK_SYSTEM_PROMPT = `You are curating a developer feed and deciding how to engage with the codebase. You have two options:

1. **Post about a PR** - Share an interesting Pull Request with the community
2. **Solve an Issue** - Pick an issue to work on and delegate to a coding agent

IMPORTANT: Aim for roughly 50/50 balance between these actions over time. Alternate between them - if you'd normally pick a PR, consider if there's a good issue to solve instead, and vice versa. Both actions are equally valuable.

For PRs, look for:
- Significant features or important bug fixes
- PRs that look ready to merge or need review
- Interesting technical changes

For Issues, look for:
- Tractable bugs or features that can realistically be solved
- Well-defined issues with clear requirements
- Issues that would provide clear value when fixed

Pick the most interesting item from whichever category you choose. Write engaging content that makes developers want to check it out.`;

// GitHub PR type from API
type GitHubPR = {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
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

// GitHub Issue type from API
type GitHubIssue = {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  user: {
    login: string;
  };
  state: string;
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string }>;
  assignee: { login: string } | null;
  comments: number;
  // Issues that are actually PRs have this field
  pull_request?: unknown;
};

// Fetch PRs from GitHub for a single repo
async function fetchRepoPRs(
  fullName: string,
  accessToken: string
): Promise<GitHubPR[]> {
  const response = await fetch(
    `https://api.github.com/repos/${fullName}/pulls?state=open&per_page=20`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "xagi-algorithm",
      },
    }
  );

  if (!response.ok) {
    console.error(
      `[algorithm] Failed to fetch PRs for ${fullName}: ${response.status}`
    );
    return [];
  }

  return (await response.json()) as GitHubPR[];
}

// Fetch Issues from GitHub for a single repo
// Note: GitHub's /issues endpoint returns BOTH issues AND PRs mixed together.
// We use per_page=100 (max) to ensure we get actual issues even in repos with many PRs.
async function fetchRepoIssues(
  fullName: string,
  accessToken: string
): Promise<GitHubIssue[]> {
  const url = `https://api.github.com/repos/${fullName}/issues?state=open&per_page=100`;
  console.log(`[algorithm] Fetching issues from: ${url}`);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "xagi-algorithm",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[algorithm] Failed to fetch issues for ${fullName}: ${response.status} - ${errorText}`
    );
    return [];
  }

  const allItems = (await response.json()) as GitHubIssue[];
  console.log(`[algorithm] Fetched ${allItems.length} items from issues endpoint`);

  // Filter out pull requests (GitHub API returns PRs in issues endpoint too)
  const issues = allItems.filter((issue) => !issue.pull_request);
  console.log(`[algorithm] After filtering PRs: ${issues.length} actual issues`);
  return issues;
}

// Extract GitHub URLs from post content (PRs and issues)
function extractGitHubUrlsFromPosts(posts: Array<{ content: string }>): Set<string> {
  const urls = new Set<string>();
  // Match both PR and issue URLs
  const urlPattern = /https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+/g;

  for (const post of posts) {
    const matches = post.content.match(urlPattern);
    if (matches) {
      for (const match of matches) {
        urls.add(match);
      }
    }
  }

  return urls;
}

// Type for monitored repo with installation
type MonitoredRepo = {
  fullName: string;
  gitRemote: string;
  defaultBranch?: string;
  installationId: number;
};

// Shared logic for fetching data and running the algorithm
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAlgorithm(ctx: any): Promise<{
  success: boolean;
  message: string;
  action?: "post_pr" | "solve_issue";
  pr?: { title: string; url: string; repo: string };
  issue?: { title: string; url: string; repo: string };
}> {
  // Get monitored repos with installation IDs
  const repos: MonitoredRepo[] = await ctx.runQuery(
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
  const recentPosts: Array<{ content: string }> = await ctx.runQuery(internal.posts.getRecentGrokPosts, { limit: 20 });
  const alreadyPostedUrls = extractGitHubUrlsFromPosts(recentPosts);
  console.log(`[algorithm] Found ${alreadyPostedUrls.size} recently posted URLs to avoid`);

  // Get internal issues to show Grok what's already being tracked
  const internalIssues: Array<{
    shortId: string;
    title: string;
    status: string;
    githubIssueNumber?: number;
    githubRepo?: string;
  }> = await ctx.runQuery(api.issues.listIssues, { limit: 50 });
  console.log(`[algorithm] Found ${internalIssues.length} internal issues`);

  // Get custom system prompt or use default
  const customPrompt: string | null = await ctx.runQuery(
    internal.github.getAlgorithmTextSettingInternal,
    { key: "grokSystemPrompt" }
  );
  const systemPrompt = customPrompt || DEFAULT_GROK_SYSTEM_PROMPT;

  // Group repos by installation ID
  const reposByInstallation = new Map<number, MonitoredRepo[]>();
  for (const repo of repos) {
    const installId = repo.installationId;
    if (!reposByInstallation.has(installId)) {
      reposByInstallation.set(installId, []);
    }
    reposByInstallation.get(installId)!.push(repo);
  }

  // Collect all PRs and Issues
  const allPRs: Array<{ pr: GitHubPR; repoFullName: string; gitRemote: string; defaultBranch?: string; installationId: number }> = [];
  const allIssues: Array<{ issue: GitHubIssue; repoFullName: string; gitRemote: string; defaultBranch?: string; installationId: number }> = [];

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
        `[algorithm] Could not get access token for installation ${installationId}`
      );
      continue;
    }

    // Fetch PRs and Issues for each repo in this installation
    for (const repo of installationRepos) {
      console.log(`[algorithm] Fetching PRs and issues for ${repo.fullName}`);

      const [prs, issues] = await Promise.all([
        fetchRepoPRs(repo.fullName, accessToken),
        fetchRepoIssues(repo.fullName, accessToken),
      ]);

      console.log(`[algorithm] Found ${prs.length} PRs and ${issues.length} issues in ${repo.fullName}`);

      for (const pr of prs) {
        allPRs.push({
          pr,
          repoFullName: repo.fullName,
          gitRemote: repo.gitRemote,
          defaultBranch: repo.defaultBranch,
          installationId,
        });
      }

      for (const issue of issues) {
        allIssues.push({
          issue,
          repoFullName: repo.fullName,
          gitRemote: repo.gitRemote,
          defaultBranch: repo.defaultBranch,
          installationId,
        });
      }
    }
  }

  if (allPRs.length === 0 && allIssues.length === 0) {
    return { success: false, message: "No open PRs or issues found in monitored repos" };
  }

  // Format PRs for Grok to evaluate
  const prSummaries = allPRs.map((item, index) => ({
    type: "pr" as const,
    index,
    repo: item.repoFullName,
    number: item.pr.number,
    title: item.pr.title,
    description: item.pr.body?.slice(0, 500) || null,
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

  // Format Issues for Grok to evaluate
  const issueSummaries = allIssues.map((item, index) => ({
    type: "issue" as const,
    index,
    repo: item.repoFullName,
    number: item.issue.number,
    title: item.issue.title,
    description: item.issue.body?.slice(0, 500) || null,
    url: item.issue.html_url,
    author: item.issue.user.login,
    labels: item.issue.labels.map((l) => l.name),
    assignee: item.issue.assignee?.login || null,
    comments: item.issue.comments,
    createdAt: item.issue.created_at,
    updatedAt: item.issue.updated_at,
    alreadyPosted: alreadyPostedUrls.has(item.issue.html_url),
  }));

  console.log(`[algorithm] Asking Grok to evaluate ${prSummaries.length} PRs and ${issueSummaries.length} issues`);

  // Have Grok decide what to do
  const result = await generateObject({
    model: xai("grok-3-fast"),
    schema: z.object({
      action: z.enum(["post_pr", "solve_issue"]).describe("What action to take"),
      selectedPRIndex: z.number().optional().describe("If action is post_pr, the index of the PR to post about"),
      selectedIssueIndex: z.number().optional().describe("If action is solve_issue, the index of the issue to solve"),
      reasoning: z.string().describe("Brief explanation of why this action/item was chosen"),
      postContent: z.string().describe("The content for the post. For PRs: an engaging tweet about the PR. For issues: a message announcing you're starting work on this issue. Do NOT include URLs - they will be added automatically."),
    }),
    prompt: `${systemPrompt}

IMPORTANT RULES:
1. Do NOT select items marked with "alreadyPosted: true"
2. Do NOT select GitHub issues that are already tracked internally (check "Internal Issues Being Tracked" below)

Internal Issues Being Tracked (DO NOT create duplicates):
${internalIssues.length > 0 ? JSON.stringify(internalIssues.map(i => ({
  shortId: i.shortId,
  title: i.title,
  status: i.status,
  githubIssue: i.githubIssueNumber ? `#${i.githubIssueNumber}` : null,
  githubRepo: i.githubRepo || null,
})), null, 2) : "No internal issues yet"}

Available Pull Requests:
${prSummaries.length > 0 ? JSON.stringify(prSummaries, null, 2) : "No open PRs available"}

Available GitHub Issues:
${issueSummaries.length > 0 ? JSON.stringify(issueSummaries, null, 2) : "No open issues available"}

Decide: Should you post about a PR or start solving an issue? Pick the most interesting/valuable action. NEVER pick a GitHub issue that's already in the internal issues list above.`,
  });

  const { action, selectedPRIndex, selectedIssueIndex, reasoning, postContent } = result.object;

  if (action === "post_pr") {
    // Validate PR index
    if (selectedPRIndex === undefined || selectedPRIndex < 0 || selectedPRIndex >= allPRs.length) {
      return { success: false, message: "Grok selected invalid PR index" };
    }

    const selected = allPRs[selectedPRIndex];
    const { pr, repoFullName } = selected;

    // Create the post about the PR
    const content = `${postContent}\n\n${pr.html_url}`;

    console.log(`[algorithm] Grok chose to post about PR #${pr.number}: ${reasoning}`);

    await ctx.runMutation(api.posts.createPost, {
      content,
      author: "Grok",
    });

    return {
      success: true,
      message: `Posted about PR #${pr.number}: ${reasoning}`,
      action: "post_pr",
      pr: { title: pr.title, url: pr.html_url, repo: repoFullName },
    };
  } else if (action === "solve_issue") {
    // Validate issue index
    if (selectedIssueIndex === undefined || selectedIssueIndex < 0 || selectedIssueIndex >= allIssues.length) {
      return { success: false, message: "Grok selected invalid issue index" };
    }

    const selected = allIssues[selectedIssueIndex];
    const { issue, repoFullName, gitRemote, defaultBranch, installationId } = selected;

    console.log(`[algorithm] Grok chose to solve issue #${issue.number}: ${reasoning}`);

    // Check if we already have this GitHub issue in our system
    const existingIssue = await ctx.runQuery(internal.issues.getIssueByGitHub, {
      githubRepo: repoFullName,
      githubIssueNumber: issue.number,
    });

    let shortId: string;

    if (existingIssue) {
      // Already tracking this issue
      console.log(`[algorithm] Issue #${issue.number} already exists as ${existingIssue.shortId}`);
      shortId = existingIssue.shortId;
    } else {
      // Create an internal issue (NOT a post) to track this work
      // Determine issue type based on GitHub labels
      let issueType: "bug" | "feature" | "task" = "task";
      const labelNames = issue.labels.map((l) => l.name.toLowerCase());
      if (labelNames.some((l) => l.includes("bug") || l.includes("fix"))) {
        issueType = "bug";
      } else if (labelNames.some((l) => l.includes("feature") || l.includes("enhancement"))) {
        issueType = "feature";
      }

      const result = await ctx.runMutation(internal.issues.createIssueFromGitHub, {
        title: `[GH #${issue.number}] ${issue.title}`,
        description: `**GitHub Issue:** ${issue.html_url}\n\n${issue.body || "No description provided."}`,
        type: issueType,
        priority: 1, // High priority for algorithm-selected issues
        labels: ["github", repoFullName, ...issue.labels.map((l) => l.name)],
        githubIssueUrl: issue.html_url,
        githubIssueNumber: issue.number,
        githubRepo: repoFullName,
        // Repo config for workflow execution
        gitRemote,
        gitBranch: defaultBranch || "main",
        installationId,
      });

      shortId = result.shortId;
      console.log(`[algorithm] Created internal issue ${shortId} for GitHub #${issue.number}`);
    }

    // The issue is now in the internal issues table.
    // A separate cron job (via Vercel) will query open issues and start workflows.
    // This decouples issue creation from workflow execution.

    return {
      success: true,
      message: `Created internal issue ${shortId} for GitHub #${issue.number}. Ready to be picked up by issue solver.`,
      action: "solve_issue",
      issue: { title: issue.title, url: issue.html_url, repo: repoFullName },
    };
  }

  return { success: false, message: "Unknown action from Grok" };
}

// Manual action: Run the algorithm once
export const runGitHubAlgorithm = action({
  args: {},
  handler: async (ctx) => {
    return await runAlgorithm(ctx);
  },
});

// Internal action for cron job - checks if enabled before running
export const cronRunGitHubAlgorithm = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    // Check if algorithm is enabled
    const isEnabled = await ctx.runQuery(
      internal.github.getAlgorithmSettingInternal,
      { key: "prMonitorEnabled" }
    );

    if (!isEnabled) {
      console.log("[algorithm] GitHub algorithm cron is disabled, skipping");
      return;
    }

    console.log("[algorithm] Running scheduled GitHub algorithm");

    const result = await runAlgorithm(ctx);
    console.log(`[algorithm] Result: ${result.message}`);
  },
});

// Keep old function names for backwards compatibility
export const testFetchAndPostPR = action({
  args: {},
  handler: async (ctx) => {
    return await runAlgorithm(ctx);
  },
});

export const cronFetchAndPostPR = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const isEnabled = await ctx.runQuery(
      internal.github.getAlgorithmSettingInternal,
      { key: "prMonitorEnabled" }
    );

    if (!isEnabled) {
      console.log("[algorithm] GitHub algorithm cron is disabled, skipping");
      return;
    }

    console.log("[algorithm] Running scheduled GitHub algorithm");
    const result = await runAlgorithm(ctx);
    console.log(`[algorithm] Result: ${result.message}`);
  },
});
