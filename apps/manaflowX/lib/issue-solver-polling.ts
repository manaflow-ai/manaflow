// Polls Convex every 30 seconds to find and process open issues
// Uses Grok to intelligently select which issue to work on
import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { xai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";

const POLL_INTERVAL_MS = 60_000; // 1 minute

let isPolling = false;
let pollInterval: NodeJS.Timeout | null = null;

interface RepoConfig {
  fullName: string;
  gitRemote: string;
  branch: string;
  installationId?: number;
}

interface Issue {
  _id: string;
  shortId: string;
  userId?: string; // Owner of the issue
  title: string;
  description?: string;
  status: string;
  priority: number;
  type: string;
  labels: string[];
  // Optional repo config (for issues linked to a specific repo)
  gitRemote?: string;
  gitBranch?: string;
  installationId?: number;
}

interface EnabledUser {
  userId: string;
  prompt: string | null;
}

// Use Grok to select the best issue to work on
async function selectIssueWithGrok(issues: Issue[]): Promise<Issue | null> {
  if (issues.length === 0) return null;
  if (issues.length === 1) return issues[0];

  console.log(`[issue-solver] Asking Grok to select from ${issues.length} issues`);

  const issueSummaries = issues.map((issue, index) => ({
    index,
    shortId: issue.shortId,
    title: issue.title,
    description: issue.description?.slice(0, 500) || null,
    type: issue.type,
    priority: issue.priority, // 0 = highest, 4 = lowest
    labels: issue.labels,
  }));

  try {
    const result = await generateObject({
      model: xai("grok-3-fast"),
      schema: z.object({
        selectedIndex: z.number().describe("The index of the issue to work on"),
        reasoning: z.string().describe("Brief explanation of why this issue was chosen"),
      }),
      prompt: `You are an AI agent that decides which issue to work on next. Select the most valuable and tractable issue.

Consider:
1. Priority (0 = critical, 1 = high, 2 = medium, 3 = low, 4 = lowest)
2. Type (bug, feature, task, epic, chore)
3. Tractability - well-defined issues with clear requirements are easier to solve
4. Value - issues that provide clear impact

Available Issues:
${JSON.stringify(issueSummaries, null, 2)}

Pick the single best issue to work on right now.`,
    });

    const { selectedIndex, reasoning } = result.object;

    if (selectedIndex >= 0 && selectedIndex < issues.length) {
      console.log(`[issue-solver] Grok selected ${issues[selectedIndex].shortId}: ${reasoning}`);
      return issues[selectedIndex];
    }
  } catch (error) {
    console.error("[issue-solver] Grok selection failed, falling back to priority:", error);
  }

  // Fallback: highest priority issue
  return issues.sort((a, b) => a.priority - b.priority)[0];
}

async function processOpenIssues() {
  if (isPolling) {
    console.log("[issue-solver] Already processing, skipping this tick");
    return;
  }

  isPolling = true;

  try {
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      console.log("[issue-solver] NEXT_PUBLIC_CONVEX_URL not set");
      return;
    }

    const convex = new ConvexHttpClient(convexUrl);

    // Get all users who have algorithm enabled
    const enabledUsers = await convex.query(api.github.getEnabledUsersWithSettings, {}) as EnabledUser[];
    if (enabledUsers.length === 0) {
      // No user has algorithm enabled, skip this tick
      return;
    }

    const enabledUserIds = new Set(enabledUsers.map(u => u.userId));
    console.log(`[issue-solver] ${enabledUsers.length} users have algorithm enabled`);

    // Get ALL open issues
    const allOpenIssues = await convex.query(api.issues.listIssues, {
      status: "open",
      limit: 50,
    }) as Issue[];

    // Filter to only issues owned by users who have algorithm enabled
    const openIssues = allOpenIssues.filter(issue =>
      issue.userId && enabledUserIds.has(issue.userId)
    );

    if (openIssues.length === 0) {
      // No issues for enabled users, skip
      return;
    }

    console.log(`[issue-solver] Found ${openIssues.length} open issues for enabled users, asking Grok to select one`);

    // Use Grok to select the best issue
    const selectedIssue = await selectIssueWithGrok(openIssues);
    if (!selectedIssue) {
      console.log("[issue-solver] No issue selected");
      return;
    }

    // Try to claim the selected issue atomically
    const claimed = await convex.mutation(api.issues.claimIssueForProcessing, {
      issueId: selectedIssue._id as Id<"issues">,
    });

    if (!claimed) {
      console.log(`[issue-solver] Issue ${selectedIssue.shortId} already claimed by another process`);
      return;
    }

    const issue = selectedIssue;
    console.log(`[issue-solver] Claimed issue ${issue.shortId}: ${issue.title}`);

    // Determine repo config: use issue's repo if available, otherwise fall back to workspace repo
    let repoConfig: RepoConfig | undefined;

    if (issue.gitRemote) {
      // Issue has its own repo config
      console.log(`[issue-solver] Using issue's repo: ${issue.gitRemote}`);
      repoConfig = {
        fullName: issue.gitRemote.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""),
        gitRemote: issue.gitRemote,
        branch: issue.gitBranch || "main",
        installationId: issue.installationId,
      };
    } else {
      // Fall back to workspace repo (optional)
      const workspaceRepo = await convex.query(api.github.getDefaultMonitoredRepo, {});
      if (workspaceRepo) {
        console.log(`[issue-solver] Using workspace repo: ${workspaceRepo.fullName}`);
        repoConfig = {
          fullName: workspaceRepo.fullName,
          gitRemote: workspaceRepo.gitRemote,
          branch: workspaceRepo.defaultBranch || "main",
          installationId: workspaceRepo.installationId,
        };
      } else {
        console.log("[issue-solver] No repo attached to issue and no workspace repo configured");
        // Continue without repo - the workflow can still handle non-coding tasks
      }
    }

    // Build the task message for the coding agent
    const taskMessage = `Work on issue ${issue.shortId}: ${issue.title}

${issue.description || "No description provided."}

Please analyze this issue and implement a solution.${repoConfig ? " When done, create a PR for review." : ""}`;

    // Create a post for the task
    const postId = await convex.mutation(api.posts.createPost, {
      content: taskMessage,
      author: "Grok",
    });

    console.log(`[issue-solver] Created post ${postId}, starting workflow`);

    // Start the workflow - pass issue ID so it can be closed when done
    const workflowId = await start(handleReplyToPost, [postId, taskMessage, repoConfig, undefined, issue._id]);

    console.log(`[issue-solver] Started workflow ${workflowId} for issue ${issue.shortId}`);
  } catch (error) {
    console.error("[issue-solver] Error processing issues:", error);
  } finally {
    isPolling = false;
  }
}

export function startIssueSolverPolling() {
  if (pollInterval) {
    console.log("[issue-solver] Polling already started");
    return;
  }

  console.log(`[issue-solver] Starting polling every ${POLL_INTERVAL_MS / 1000}s`);

  // Run immediately on startup
  processOpenIssues();

  // Then poll every 30 seconds
  pollInterval = setInterval(processOpenIssues, POLL_INTERVAL_MS);
}

export function stopIssueSolverPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[issue-solver] Polling stopped");
  }
}
