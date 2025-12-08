import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Repo config to pass to the workflow
interface RepoConfig {
  fullName: string;
  gitRemote: string;
  branch: string;
  installationId?: number;
}

// Process open issues that need work
// This queries the issues table directly - no separate queue needed
export async function POST() {
  console.log("[issue-solver] Looking for open issues to work on...");

  try {
    // Get open issues that have a GitHub link (imported from GitHub)
    const openIssues = await convex.query(api.issues.listIssues, {
      status: "open",
      limit: 10,
    });

    // Filter to issues that came from GitHub and aren't assigned yet
    const githubIssues = openIssues.filter(
      (issue) => issue.githubRepo && issue.githubIssueUrl
    );

    if (githubIssues.length === 0) {
      return NextResponse.json({
        message: "No open GitHub issues to process",
        processed: 0,
      });
    }

    // Filter to issues that have repo config (needed for workflow)
    const readyIssues = githubIssues.filter(
      (issue) => issue.gitRemote && issue.gitBranch
    );

    if (readyIssues.length === 0) {
      console.log(`[issue-solver] Found ${githubIssues.length} GitHub issues but none have repo config`);
      return NextResponse.json({
        message: "No open GitHub issues with repo config to process",
        processed: 0,
      });
    }

    console.log(`[issue-solver] Found ${readyIssues.length} ready issues`);

    // Pick the first one (highest priority since listIssues is sorted)
    const issue = readyIssues[0];

    // Mark issue as in_progress before starting work
    await convex.mutation(api.issues.updateIssue, {
      issueId: issue._id as Id<"issues">,
      status: "in_progress",
    });

    console.log(`[issue-solver] Processing issue ${issue.shortId}: ${issue.title}`);

    // Build the task message for the coding agent
    const taskMessage = `Fix issue ${issue.shortId}: ${issue.title}

${issue.githubIssueUrl ? `GitHub Issue: ${issue.githubIssueUrl}\n\n` : ""}${issue.description || "No description provided."}

Please analyze this issue and implement a fix. When done, create a PR for review.`;

    // Build repo config from issue fields
    const repoConfig: RepoConfig = {
      fullName: issue.githubRepo!,
      gitRemote: issue.gitRemote!,
      branch: issue.gitBranch!,
      installationId: issue.installationId,
    };

    // Create a post for the task (this creates the "User" post that the workflow responds to)
    const postId = await convex.mutation(api.posts.createPost, {
      content: taskMessage,
      author: "User",
    });

    console.log(`[issue-solver] Created post ${postId}, starting workflow`);

    // Start the workflow
    const workflowId = await start(handleReplyToPost, [postId, taskMessage, repoConfig]);

    console.log(`[issue-solver] Started workflow ${workflowId} for issue ${issue.shortId}`);

    return NextResponse.json({
      message: `Started work on issue ${issue.shortId}`,
      processed: 1,
      issue: {
        id: issue._id,
        shortId: issue.shortId,
        title: issue.title,
        githubUrl: issue.githubIssueUrl,
      },
      workflowId: String(workflowId),
    });
  } catch (error) {
    console.error("[issue-solver] Error:", error);
    return NextResponse.json(
      { error: "Failed to process issues" },
      { status: 500 }
    );
  }
}

// GET endpoint to check open issues
export async function GET() {
  try {
    const openIssues = await convex.query(api.issues.listIssues, {
      status: "open",
      limit: 20,
    });

    const githubIssues = openIssues.filter(
      (issue) => issue.githubRepo && issue.githubIssueUrl
    );

    return NextResponse.json({
      openCount: githubIssues.length,
      issues: githubIssues.map((issue) => ({
        id: issue._id,
        shortId: issue.shortId,
        title: issue.title,
        githubRepo: issue.githubRepo,
        githubUrl: issue.githubIssueUrl,
        priority: issue.priority,
        createdAt: issue.createdAt,
      })),
    });
  } catch (error) {
    console.error("[issue-solver] Error:", error);
    return NextResponse.json(
      { error: "Failed to get open issues" },
      { status: 500 }
    );
  }
}
