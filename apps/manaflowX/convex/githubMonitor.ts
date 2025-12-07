"use node";

import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { fetchInstallationAccessToken } from "./_shared/githubApp";
import { xai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import { screenshotPullRequest, type PRScreenshotResult } from "../workflows/tools/pr-screenshoter";

// Default system prompt for Grok algorithm
const DEFAULT_GROK_SYSTEM_PROMPT = `You are curating a developer feed and deciding how to engage with the codebase. You have three options:

1. **Post about a PR** - Share an interesting Pull Request with the community (text only)
2. **Screenshot a PR** - Capture screenshots of UI changes in a PR and share with visuals
3. **Solve an Issue** - Pick an issue to work on and delegate to a coding agent

IMPORTANT: Aim for roughly balanced distribution between these actions over time. Alternate between them based on what's most valuable.

For PRs (post_pr), look for:
- Significant features or important bug fixes
- PRs that look ready to merge or need review
- Interesting technical changes
- Backend or non-visual changes
- PRs with valuable comment discussions (check keyCommentInsights)
- PRs that already have screenshots in the description (hasScreenshots: true) - you can reference these!

For PRs with Screenshots (screenshot_pr), look for:
- PRs with UI/frontend changes (check the changedFiles field for .tsx, .jsx, .css, .vue, .svelte files)
- Visual component updates
- Design system changes
- PRs where "hasUiFiles: true" - these are good candidates for screenshots
- PREFER PRs that already have screenshots (hasScreenshots: true) - use the existing screenshots instead of capturing new ones

For Issues, look for:
- Tractable bugs or features that can realistically be solved
- Well-defined issues with clear requirements
- Issues that would provide clear value when fixed

LEVERAGING PR INSIGHTS:
- Use the "description" field to understand what the PR is about
- Check "keyCommentInsights" for valuable discussion points and context from reviewers
- If "hasScreenshots" is true, the PR author provided screenshots - prefer selecting these PRs and include the best screenshot in your post
- The "screenshots" array contains image URLs from the PR description and comments - pick the most relevant one to include

Pick the most interesting item from whichever category you choose. Write engaging content that makes developers want to check it out. If the PR has screenshots, mention what the visual changes show.`;

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

// GitHub PR files type
type GitHubPRFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
};

// GitHub PR comment type
type GitHubPRComment = {
  id: number;
  body: string;
  user: {
    login: string;
  };
  created_at: string;
  updated_at: string;
};


// UI file patterns for detecting frontend changes
const UI_FILE_PATTERNS = [
  /\.(tsx|jsx|vue|svelte)$/,
  /\.(css|scss|sass|less|styl)$/,
  /\.(html|htm|ejs|hbs|pug|jade)$/,
  /components?\//i,
  /styles?\//i,
  /pages?\//i,
  /views?\//i,
];

function hasUiChanges(files: string[]): boolean {
  return files.some((file) =>
    UI_FILE_PATTERNS.some((pattern) => pattern.test(file))
  );
}

// Extract image URLs from markdown text (PR description or comments)
function extractImagesFromMarkdown(text: string | null): string[] {
  if (!text) return [];
  const images: string[] = [];

  // Match markdown images: ![alt](url)
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownImageRegex.exec(text)) !== null) {
    const url = match[2];

    // Skip Vercel status icons (ready/error/building badges)
    if (url.includes('vercel.com/static/status/')) {
      continue;
    }

    // Only include image URLs (filter out non-image links)
    if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ||
        url.includes('user-images.githubusercontent.com') ||
        url.includes('github.com') && url.includes('/assets/') ||
        url.includes('.convex.cloud/api/storage/')) {
      images.push(url);
    }
  }

  // Match HTML img tags: <img src="url">
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((match = htmlImageRegex.exec(text)) !== null) {
    const url = match[1];

    // Skip Vercel status icons
    if (url.includes('vercel.com/static/status/')) {
      continue;
    }

    images.push(url);
  }

  return images;
}

// Extract key insights from PR comments (summarized)
function extractCommentInsights(comments: GitHubPRComment[]): {
  totalComments: number;
  keyInsights: string[];
  allImages: string[];
} {
  const keyInsights: string[] = [];
  const allImages: string[] = [];

  for (const comment of comments) {
    // Extract images from comment
    const images = extractImagesFromMarkdown(comment.body);
    allImages.push(...images);

    // Extract meaningful insights (skip short comments, reactions)
    if (comment.body && comment.body.length > 50) {
      // Take first 200 chars of substantive comments
      const insight = `@${comment.user.login}: ${comment.body.slice(0, 200)}${comment.body.length > 200 ? '...' : ''}`;
      keyInsights.push(insight);
    }
  }

  return {
    totalComments: comments.length,
    keyInsights: keyInsights.slice(0, 3), // Limit to top 3 insights
    allImages,
  };
}

// Fetch changed files for a PR
async function fetchPRFiles(
  fullName: string,
  prNumber: number,
  accessToken: string
): Promise<GitHubPRFile[]> {
  const response = await fetch(
    `https://api.github.com/repos/${fullName}/pulls/${prNumber}/files?per_page=100`,
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
      `[algorithm] Failed to fetch files for PR #${prNumber} in ${fullName}: ${response.status}`
    );
    return [];
  }

  return (await response.json()) as GitHubPRFile[];
}

// Fetch PR comments (issue comments on the PR)
async function fetchPRComments(
  fullName: string,
  prNumber: number,
  accessToken: string
): Promise<GitHubPRComment[]> {
  const response = await fetch(
    `https://api.github.com/repos/${fullName}/issues/${prNumber}/comments?per_page=50`,
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
      `[algorithm] Failed to fetch comments for PR #${prNumber} in ${fullName}: ${response.status}`
    );
    return [];
  }

  return (await response.json()) as GitHubPRComment[];
}

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
  userId: string; // Owner of the repo
  installationId: number;
};

// Shared logic for fetching data and running the algorithm
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runAlgorithm(ctx: any): Promise<{
  success: boolean;
  message: string;
  action?: "post_pr" | "solve_issue" | "screenshot_pr";
  pr?: { title: string; url: string; repo: string };
  issue?: { title: string; url: string; repo: string };
  screenshots?: string[];
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

  // Get the first enabled user's algorithm settings to use their prompt
  const algorithmSettings = await ctx.runQuery(
    internal.github.getFirstEnabledAlgorithmSettings
  );
  const systemPrompt = algorithmSettings?.prompt || DEFAULT_GROK_SYSTEM_PROMPT;
  console.log(`[algorithm] Using ${algorithmSettings?.prompt ? "custom" : "default"} system prompt`);

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
  const allPRs: Array<{
    pr: GitHubPR;
    repoFullName: string;
    gitRemote: string;
    defaultBranch?: string;
    userId: string;
    installationId: number;
    changedFiles: string[];
    hasUiFiles: boolean;
    // New fields for PR insights
    descriptionImages: string[];
    commentInsights: {
      totalComments: number;
      keyInsights: string[];
      allImages: string[];
    };
  }> = [];
  const allIssues: Array<{ issue: GitHubIssue; repoFullName: string; gitRemote: string; defaultBranch?: string; userId: string; installationId: number }> = [];

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

      // Fetch changed files and comments for each PR to detect UI changes and extract insights
      for (const pr of prs) {
        const [prFiles, prComments] = await Promise.all([
          fetchPRFiles(repo.fullName, pr.number, accessToken),
          fetchPRComments(repo.fullName, pr.number, accessToken),
        ]);
        const changedFiles = prFiles.map((f) => f.filename);

        // Extract images from PR description
        const descriptionImages = extractImagesFromMarkdown(pr.body);

        // Extract insights and images from comments
        const commentInsights = extractCommentInsights(prComments);

        allPRs.push({
          pr,
          repoFullName: repo.fullName,
          gitRemote: repo.gitRemote,
          defaultBranch: repo.defaultBranch,
          userId: repo.userId,
          installationId,
          changedFiles,
          hasUiFiles: hasUiChanges(changedFiles),
          descriptionImages,
          commentInsights,
        });
      }

      for (const issue of issues) {
        allIssues.push({
          issue,
          repoFullName: repo.fullName,
          gitRemote: repo.gitRemote,
          defaultBranch: repo.defaultBranch,
          userId: repo.userId,
          installationId,
        });
      }
    }
  }

  if (allPRs.length === 0 && allIssues.length === 0) {
    return { success: false, message: "No open PRs or issues found in monitored repos" };
  }

  // Format PRs for Grok to evaluate
  const prSummaries = allPRs.map((item, index) => {
    // Combine all images from description and comments
    const allImages = [...item.descriptionImages, ...item.commentInsights.allImages];

    return {
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
      changedFiles: item.changedFiles.slice(0, 20), // Limit to 20 files for context
      hasUiFiles: item.hasUiFiles,
      // New fields for PR insights
      commentCount: item.commentInsights.totalComments,
      keyCommentInsights: item.commentInsights.keyInsights,
      screenshots: allImages.slice(0, 5), // Limit to 5 best screenshots
      hasScreenshots: allImages.length > 0,
    };
  });

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
    model: xai("grok-4-1-fast-reasoning"),
    schema: z.object({
      action: z.enum(["post_pr", "screenshot_pr", "solve_issue"]).describe("What action to take: post_pr for text-only PR posts, screenshot_pr for PRs with UI changes worth capturing, solve_issue for issues to delegate"),
      selectedPRIndex: z.number().optional().describe("If action is post_pr or screenshot_pr, the index of the PR"),
      selectedIssueIndex: z.number().optional().describe("If action is solve_issue, the index of the issue to solve"),
      selectedScreenshotUrl: z.string().optional().describe("If the PR has screenshots (hasScreenshots: true), select the best screenshot URL from the 'screenshots' array to include in the post. This is the URL of an existing image from the PR."),
      reasoning: z.string().describe("Brief explanation of why this action/item was chosen. If you're using an existing screenshot, mention what it shows."),
      postContent: z.string().describe("The content for the post. For PRs: an engaging tweet about the PR. For issues: a message announcing you're starting work on this issue. Do NOT include URLs - they will be added automatically. If the PR has screenshots, describe what the visual changes show."),
    }),
    prompt: `${systemPrompt}

IMPORTANT RULES:
1. Do NOT select items marked with "alreadyPosted: true"
2. Do NOT select GitHub issues that are already tracked internally (check "Internal Issues Being Tracked" below)
3. If the PR has "hasScreenshots: true", select the best screenshot URL from the "screenshots" array to include in the post

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

Decide: Should you post about a PR (text only), screenshot a PR (with visuals), or start solving an issue? Pick the most interesting/valuable action. Use screenshot_pr for PRs with UI changes (hasUiFiles: true). NEVER pick a GitHub issue that's already in the internal issues list above. If the PR already has screenshots, prefer using those over capturing new ones.`,
  });

  const { action, selectedPRIndex, selectedIssueIndex, selectedScreenshotUrl, reasoning, postContent } = result.object;

  if (action === "post_pr") {
    // Validate PR index
    if (selectedPRIndex === undefined || selectedPRIndex < 0 || selectedPRIndex >= allPRs.length) {
      return { success: false, message: "Grok selected invalid PR index" };
    }

    const selected = allPRs[selectedPRIndex];
    const { pr, repoFullName } = selected;

    // Create the post about the PR, optionally including a screenshot from the PR
    let content = `${postContent}\n\n${pr.html_url}`;

    // If Grok selected a screenshot from the PR, include it
    if (selectedScreenshotUrl) {
      content += `\n\n![PR Screenshot](${selectedScreenshotUrl})`;
      console.log(`[algorithm] Including screenshot from PR: ${selectedScreenshotUrl}`);
    }

    console.log(`[algorithm] Grok chose to post about PR #${pr.number}: ${reasoning}`);

    await ctx.runMutation(api.posts.createPost, {
      content,
      author: "Grok",
    });

    return {
      success: true,
      message: `Posted about PR #${pr.number}${selectedScreenshotUrl ? ' with screenshot' : ''}: ${reasoning}`,
      action: "post_pr",
      pr: { title: pr.title, url: pr.html_url, repo: repoFullName },
      screenshots: selectedScreenshotUrl ? [selectedScreenshotUrl] : undefined,
    };
  } else if (action === "screenshot_pr") {
    // Validate PR index
    if (selectedPRIndex === undefined || selectedPRIndex < 0 || selectedPRIndex >= allPRs.length) {
      return { success: false, message: "Grok selected invalid PR index for screenshot" };
    }

    const selected = allPRs[selectedPRIndex];
    const { pr, repoFullName, installationId, descriptionImages, commentInsights } = selected;

    // Combine all existing images from PR
    const existingImages = [...descriptionImages, ...commentInsights.allImages];

    console.log(`[algorithm] Grok chose to screenshot PR #${pr.number}: ${reasoning}`);

    // If Grok selected an existing screenshot or the PR already has screenshots, use those
    if (selectedScreenshotUrl || existingImages.length > 0) {
      const screenshotToUse = selectedScreenshotUrl || existingImages[0];
      const content = `${postContent}\n\n${pr.html_url}\n\n![PR Screenshot](${screenshotToUse})`;

      console.log(`[algorithm] Using existing screenshot from PR: ${screenshotToUse}`);

      await ctx.runMutation(api.posts.createPost, {
        content,
        author: "Grok",
      });

      return {
        success: true,
        message: `Posted about PR #${pr.number} with existing screenshot: ${reasoning}`,
        action: "screenshot_pr",
        pr: { title: pr.title, url: pr.html_url, repo: repoFullName },
        screenshots: [screenshotToUse],
      };
    }

    // No existing screenshots - run the PR screenshoter tool to capture new ones
    console.log(`[algorithm] No existing screenshots, running screenshoter tool`);

    // Generate a unique toolCallId for tracking
    const toolCallId = `algorithm-screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Run the PR screenshoter
    const screenshotResult: PRScreenshotResult = await screenshotPullRequest(
      {
        pullRequestUrl: pr.html_url,
        branch: pr.head.ref,
        installationId,
      },
      toolCallId
    );

    if (!screenshotResult.success) {
      console.error(`[algorithm] Screenshot failed: ${screenshotResult.error}`);
      // Fall back to a regular post if screenshot fails
      const content = `${postContent}\n\n${pr.html_url}`;
      await ctx.runMutation(api.posts.createPost, {
        content,
        author: "Grok",
      });
      return {
        success: true,
        message: `Screenshot failed, posted text instead for PR #${pr.number}: ${screenshotResult.error}`,
        action: "post_pr",
        pr: { title: pr.title, url: pr.html_url, repo: repoFullName },
      };
    }

    // Extract screenshot URLs from the response (markdown images)
    const screenshotUrls: string[] = [];
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while ((match = imageRegex.exec(screenshotResult.response || "")) !== null) {
      screenshotUrls.push(match[2]);
    }

    // Create post with screenshots embedded
    let content = `${postContent}\n\n${pr.html_url}`;
    if (screenshotUrls.length > 0) {
      content += "\n\n" + screenshotUrls.map((url, i) => `![Screenshot ${i + 1}](${url})`).join("\n");
    }

    console.log(`[algorithm] Creating post with ${screenshotUrls.length} captured screenshots`);

    await ctx.runMutation(api.posts.createPost, {
      content,
      author: "Grok",
    });

    return {
      success: true,
      message: `Posted about PR #${pr.number} with ${screenshotUrls.length} captured screenshots: ${reasoning}`,
      action: "screenshot_pr",
      pr: { title: pr.title, url: pr.html_url, repo: repoFullName },
      screenshots: screenshotUrls,
    };
  } else if (action === "solve_issue") {
    // Validate issue index
    if (selectedIssueIndex === undefined || selectedIssueIndex < 0 || selectedIssueIndex >= allIssues.length) {
      return { success: false, message: "Grok selected invalid issue index" };
    }

    const selected = allIssues[selectedIssueIndex];
    const { issue, repoFullName, gitRemote, defaultBranch, userId, installationId } = selected;

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
        // Owner of the issue (same as repo owner)
        userId,
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

// Internal action for cron job - checks if ANY user has algorithm enabled
export const cronRunGitHubAlgorithm = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    // Check if any user has algorithm enabled
    const enabledUsers = await ctx.runQuery(
      internal.github.getUsersWithAlgorithmEnabled
    );

    if (enabledUsers.length === 0) {
      console.log("[algorithm] GitHub algorithm cron: no users have it enabled, skipping");
      return;
    }

    console.log(`[algorithm] Running scheduled GitHub algorithm (${enabledUsers.length} users enabled)`);

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
    // Check if any user has algorithm enabled
    const enabledUsers = await ctx.runQuery(
      internal.github.getUsersWithAlgorithmEnabled
    );

    if (enabledUsers.length === 0) {
      console.log("[algorithm] GitHub algorithm cron: no users have it enabled, skipping");
      return;
    }

    console.log(`[algorithm] Running scheduled GitHub algorithm (${enabledUsers.length} users enabled)`);
    const result = await runAlgorithm(ctx);
    console.log(`[algorithm] Result: ${result.message}`);
  },
});
