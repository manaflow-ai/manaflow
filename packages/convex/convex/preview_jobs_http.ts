import { env } from "../_shared/convex-env";
import { capturePosthogEvent, drainPosthogEvents } from "../_shared/posthog";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { runPreviewJob } from "./preview_jobs_worker";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function markPreviewTaskCompleted(
  ctx: ActionCtx,
  taskRun: Doc<"taskRuns">,
  task: Doc<"tasks">,
): Promise<{
  runStatusUpdated: boolean;
  taskAlreadyCompleted: boolean;
}> {
  const runAlreadyTerminal =
    taskRun.status === "completed" ||
    taskRun.status === "failed" ||
    taskRun.status === "skipped";

  if (!runAlreadyTerminal) {
    await ctx.runMutation(internal.taskRuns.updateStatus, {
      id: taskRun._id,
      status: "completed",
    });
  }

  const taskAlreadyCompleted = task.isCompleted === true;
  if (!taskAlreadyCompleted) {
    await ctx.runMutation(internal.tasks.setCompletedInternal, {
      taskId: task._id,
      isCompleted: true,
      crownEvaluationStatus: "succeeded",
    });
  }

  return {
    runStatusUpdated: !runAlreadyTerminal,
    taskAlreadyCompleted,
  };
}

export const dispatchPreviewJob = httpAction(async (ctx, req) => {
  const workerAuth = await getWorkerAuth(req, { loggerPrefix: "[preview-jobs-http]" });
  if (!workerAuth) {
    console.error("[preview-jobs-http] Unauthorized dispatch request");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { previewRunId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (!body.previewRunId) {
    return jsonResponse({ error: "previewRunId is required" }, 400);
  }

  const previewRunId = body.previewRunId as Id<"previewRuns">;
  console.log("[preview-jobs-http] Dispatching preview job", {
    previewRunId,
  });

  try {
    await ctx.runMutation(internal.previewRuns.markDispatched, {
      previewRunId,
    });
  } catch (error) {
    console.error("[preview-jobs-http] Failed to mark run dispatched", {
      previewRunId,
      error,
    });
    return jsonResponse({ error: "Failed to mark run dispatched" }, 500);
  }

  try {
    await runPreviewJob(ctx, previewRunId);
    return jsonResponse({ success: true }, 200);
  } catch (error) {
    console.error("[preview-jobs-http] Preview job execution failed", {
      previewRunId,
      error,
    });
    return jsonResponse(
      {
        error: "Failed to execute preview job",
        message:
          error instanceof Error ? error.message : String(error ?? "Unknown error"),
      },
      500,
    );
  }
});

/**
 * HTTP action for www API to update preview run status
 */
export const updatePreviewStatus = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[preview-jobs-http]" });
  if (!auth) {
    console.error("[preview-jobs-http] Unauthorized request");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("previewRunId" in body) ||
    !("status" in body)
  ) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }

  const { previewRunId, status, screenshotSetId } = body as {
    previewRunId: string;
    status: string;
    screenshotSetId?: string;
  };

  console.log("[preview-jobs-http] Updating preview run status", {
    previewRunId,
    status,
  });

  // Validate status
  if (!["running", "completed", "failed", "skipped"].includes(status)) {
    return jsonResponse({ error: "Invalid status value" }, 400);
  }

  try {
    await ctx.runMutation(internal.previewRuns.updateStatus, {
      previewRunId: previewRunId as Id<"previewRuns">,
      status: status as "running" | "completed" | "failed" | "skipped",
      screenshotSetId: screenshotSetId as Id<"taskRunScreenshotSets"> | undefined,
    });

    return jsonResponse({ success: true });
  } catch (error) {
    console.error("[preview-jobs-http] Failed to update status", {
      previewRunId,
      error,
    });
    return jsonResponse({ error: "Failed to update status" }, 500);
  }
});

/**
 * HTTP action for www API to create screenshot set
 */
export const createScreenshotSet = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[preview-jobs-http]" });
  if (!auth) {
    console.error("[preview-jobs-http] Unauthorized request");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("previewRunId" in body) ||
    !("status" in body) ||
    !("commitSha" in body)
  ) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }

  const { previewRunId, status, commitSha, error, images } = body as {
    previewRunId: string;
    status: string;
    commitSha: string;
    error?: string;
    images: Array<{
      storageId: string;
      mimeType: string;
      fileName?: string;
      commitSha?: string;
    }>;
  };

  console.log("[preview-jobs-http] Creating screenshot set", {
    previewRunId,
    status,
    imageCount: images?.length ?? 0,
  });

  // Validate status
  if (!["completed", "failed", "skipped"].includes(status)) {
    return jsonResponse({ error: "Invalid status value" }, 400);
  }

  try {
    const screenshotSetId = await ctx.runMutation(
      internal.previewScreenshots.createScreenshotSet,
      {
        previewRunId: previewRunId as Id<"previewRuns">,
        status: status as "completed" | "failed" | "skipped",
        commitSha,
        error,
        images: (images ?? []).map((img) => ({
          storageId: img.storageId as Id<"_storage">,
          mimeType: img.mimeType,
          fileName: img.fileName,
          commitSha: img.commitSha,
        })),
      }
    );

    return jsonResponse({ success: true, screenshotSetId });
  } catch (err) {
    console.error("[preview-jobs-http] Failed to create screenshot set", {
      previewRunId,
      error: err,
    });
    return jsonResponse({ error: "Failed to create screenshot set" }, 500);
  }
});

/**
 * HTTP action called by worker when preview job screenshots are complete
 * Copies screenshots from task run to preview run and posts GitHub comment
 */
export const completePreviewJob = httpAction(async (ctx, req) => {
  const workerAuth = await getWorkerAuth(req, { loggerPrefix: "[preview-jobs-http]" });
  const authHeader = req.headers.get("authorization") ?? "";
  const [, bearerToken] = authHeader.split(" ");
  const bearerAuthorized =
    bearerToken && bearerToken === env.CMUX_TASK_RUN_JWT_SECRET;

  if (!workerAuth && !bearerAuthorized) {
    console.error("[preview-jobs-http] Unauthorized complete request");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("taskRunId" in body)
  ) {
    return jsonResponse({ error: "Missing taskRunId" }, 400);
  }

  const { taskRunId } = body;

  console.log("[preview-jobs-http] Completing preview job", {
    taskRunId,
  });

  let previewRun: Doc<"previewRuns"> | null = null;
  let shouldStopInstance = false;

  try {
    // Find preview run by taskRunId
    previewRun = await ctx.runQuery(internal.previewRuns.getByTaskRunId, {
      taskRunId: taskRunId as Id<"taskRuns">,
    });

    if (!previewRun) {
      console.error("[preview-jobs-http] Preview run not found for task run", {
        taskRunId,
      });
      return jsonResponse({ error: "Preview run not found" }, 404);
    }
    shouldStopInstance = true;

    // Get task run to check for screenshots
    const taskRun = await ctx.runQuery(internal.taskRuns.getById, {
      id: taskRunId as Id<"taskRuns">,
    });

    if (!taskRun) {
      console.error("[preview-jobs-http] Task run not found", {
        taskRunId,
      });
      return jsonResponse({ error: "Task run not found" }, 404);
    }

    const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
      id: taskRun.taskId,
    });

    if (!task) {
      console.error("[preview-jobs-http] Task not found for preview completion", {
        taskRunId,
        taskId: taskRun.taskId,
      });
      return jsonResponse({ error: "Task not found" }, 404);
    }

    // TEMPORARY: Never skip - always proceed regardless of screenshot set status
    // Get the task run screenshot set if one exists
    const taskScreenshotSet = taskRun.latestScreenshotSetId
      ? await ctx.runQuery(internal.github_pr_queries.getScreenshotSet, {
          screenshotSetId: taskRun.latestScreenshotSetId,
        })
      : null;

    const screenshotSetId = taskRun.latestScreenshotSetId;
    const imageCount = taskScreenshotSet?.images.length ?? 0;

    console.log("[preview-jobs-http] Processing task run (never skipping)", {
      taskRunId,
      previewRunId: previewRun._id,
      screenshotSetId,
      imageCount,
      hasScreenshotSet: !!taskScreenshotSet,
    });

    // Post or update GitHub comment if we have installation ID AND a valid screenshot set
    if (previewRun.repoInstallationId && screenshotSetId) {
      const team = await ctx.runQuery(internal.teams.getByTeamIdInternal, {
        teamId: taskRun.teamId,
      });
      const teamSlug = team?.slug ?? taskRun.teamId;
      const workspaceUrl = `https://www.manaflow.com/${teamSlug}/task/${taskRun.taskId}`;
      const devServerUrl = `https://www.manaflow.com/${teamSlug}/task/${taskRun.taskId}/run/${taskRunId}/browser`;

      // Determine which comment to update:
      // 1. Use stored githubCommentId if available - update it
      // 2. Otherwise, create a new comment
      const commentIdToUpdate = previewRun.githubCommentId;

      if (commentIdToUpdate) {
        console.log("[preview-jobs-http] Updating existing GitHub comment", {
          taskRunId,
          previewRunId: previewRun._id,
          commentId: commentIdToUpdate,
        });

        const updateResult = await ctx.runAction(
          internal.github_pr_comments.updatePreviewComment,
          {
            installationId: previewRun.repoInstallationId,
            repoFullName: previewRun.repoFullName,
            prNumber: previewRun.prNumber,
            commentId: commentIdToUpdate,
            screenshotSetId,
            previewRunId: previewRun._id,
            workspaceUrl,
            devServerUrl,
          }
        );

        if (updateResult.ok) {
          console.log("[preview-jobs-http] Successfully updated GitHub comment", {
            taskRunId,
            previewRunId: previewRun._id,
            commentId: commentIdToUpdate,
          });

          // Track comment updated (non-blocking)
          capturePosthogEvent({
            distinctId: taskRun.teamId,
            event: "preview_comment_posted",
            properties: {
              repo_full_name: previewRun.repoFullName,
              pr_number: previewRun.prNumber,
              preview_run_id: previewRun._id,
              comment_type: "update",
              has_screenshots: imageCount > 0,
              screenshot_count: imageCount,
            },
          });

          const taskCompletion = await markPreviewTaskCompleted(ctx, taskRun, task);

          await drainPosthogEvents();
          return jsonResponse({
            success: true,
            commentUrl: previewRun.githubCommentUrl,
            runStatusUpdated: taskCompletion.runStatusUpdated,
            alreadyCompleted: taskCompletion.taskAlreadyCompleted,
          });
        } else {
          console.error("[preview-jobs-http] Failed to update GitHub comment", {
            taskRunId,
            previewRunId: previewRun._id,
            commentId: commentIdToUpdate,
            error: updateResult.error,
          });
          return jsonResponse({
            success: false,
            error: `Failed to update GitHub comment: ${updateResult.error}`,
          }, 500);
        }
      } else {
        // No stored githubCommentId - create a new comment
        console.log("[preview-jobs-http] Posting new GitHub comment (no stored githubCommentId)", {
          taskRunId,
          previewRunId: previewRun._id,
        });

        const commentResult = await ctx.runAction(
          internal.github_pr_comments.postPreviewComment,
          {
            installationId: previewRun.repoInstallationId,
            repoFullName: previewRun.repoFullName,
            prNumber: previewRun.prNumber,
            screenshotSetId,
            previewRunId: previewRun._id,
            workspaceUrl,
            devServerUrl,
          }
        );

        if (commentResult.ok) {
          console.log("[preview-jobs-http] Successfully posted GitHub comment", {
            taskRunId,
            previewRunId: previewRun._id,
            commentUrl: commentResult.commentUrl,
          });

          // Track comment posted (non-blocking)
          capturePosthogEvent({
            distinctId: taskRun.teamId,
            event: "preview_comment_posted",
            properties: {
              repo_full_name: previewRun.repoFullName,
              pr_number: previewRun.prNumber,
              preview_run_id: previewRun._id,
              comment_type: "new",
              has_screenshots: imageCount > 0,
              screenshot_count: imageCount,
            },
          });

          const taskCompletion = await markPreviewTaskCompleted(ctx, taskRun, task);

          await drainPosthogEvents();
          return jsonResponse({
            success: true,
            commentUrl: commentResult.commentUrl,
            runStatusUpdated: taskCompletion.runStatusUpdated,
            alreadyCompleted: taskCompletion.taskAlreadyCompleted,
          });
        } else {
          console.error("[preview-jobs-http] Failed to post GitHub comment", {
            taskRunId,
            previewRunId: previewRun._id,
            error: commentResult.error,
          });
          return jsonResponse({
            success: false,
            error: `Failed to post GitHub comment: ${commentResult.error}`,
          }, 500);
        }
      }
    } else if (!previewRun.repoInstallationId) {
      console.log("[preview-jobs-http] No GitHub installation ID, proceeding without comment", {
        taskRunId,
        previewRunId: previewRun._id,
      });

      // Update preview run status to completed even without posting comment
      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId: previewRun._id,
        status: "completed",
        screenshotSetId: screenshotSetId ?? undefined,
      });

      const taskCompletion = await markPreviewTaskCompleted(ctx, taskRun, task);

      return jsonResponse({
        success: true,
        skipped: false,
        reason: "No GitHub installation ID - proceeding anyway",
        runStatusUpdated: taskCompletion.runStatusUpdated,
        alreadyCompleted: taskCompletion.taskAlreadyCompleted,
      });
    } else {
      // Has installation ID but no screenshot set - still proceed
      console.log("[preview-jobs-http] No screenshot set yet, proceeding without comment", {
        taskRunId,
        previewRunId: previewRun._id,
        hasInstallationId: !!previewRun.repoInstallationId,
      });

      await ctx.runMutation(internal.previewRuns.updateStatus, {
        previewRunId: previewRun._id,
        status: "completed",
      });

      const taskCompletion = await markPreviewTaskCompleted(ctx, taskRun, task);

      return jsonResponse({
        success: true,
        skipped: false,
        reason: "No screenshot set - proceeding anyway",
        runStatusUpdated: taskCompletion.runStatusUpdated,
        alreadyCompleted: taskCompletion.taskAlreadyCompleted,
      });
    }
  } catch (error) {
    console.error("[preview-jobs-http] Failed to complete preview job", {
      taskRunId,
      error,
    });
    return jsonResponse({
      error: "Failed to complete preview job",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  } finally {
    if (shouldStopInstance && previewRun) {
      await ctx.scheduler.runAfter(
        30 * 60 * 1000,
        internal.preview_jobs.stopPreviewInstance,
        { previewRunId: previewRun._id },
      );
    }
  }
});

/**
 * Parse a GitHub PR URL to extract owner, repo, and PR number.
 */
function parsePrUrl(prUrl: string): { owner: string; repo: string; prNumber: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/**
 * HTTP action to create a test preview task run for development/testing.
 * Creates a full chain: previewConfig → previewRun → task → taskRun, returns JWT for worker auth.
 * This ensures the `/api/preview/complete` endpoint can find the previewRun.
 * Authenticated via bearer token (CMUX_TASK_RUN_JWT_SECRET).
 */
export const createTestPreviewTask = httpAction(async (ctx, req) => {
  const authHeader = req.headers.get("authorization") ?? "";
  const [, bearerToken] = authHeader.split(" ");

  if (!bearerToken || bearerToken !== env.CMUX_TASK_RUN_JWT_SECRET) {
    console.error("[preview-jobs-http] Unauthorized test task request");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("teamId" in body) ||
    !("userId" in body) ||
    !("prUrl" in body)
  ) {
    return jsonResponse({
      error: "Missing required fields: teamId, userId, prUrl"
    }, 400);
  }

  const { teamId, userId, prUrl, repoUrl } = body as {
    teamId: string;
    userId: string;
    prUrl: string;
    repoUrl?: string;
  };

  // Parse PR URL to get owner/repo and PR number
  const prInfo = parsePrUrl(prUrl);
  if (!prInfo) {
    return jsonResponse({
      error: "Invalid PR URL format. Expected: https://github.com/<owner>/<repo>/pull/<number>",
    }, 400);
  }

  const repoFullName = `${prInfo.owner}/${prInfo.repo}`.toLowerCase();

  console.log("[preview-jobs-http] Creating test preview task", {
    teamId,
    userId,
    prUrl,
    repoFullName,
    prNumber: prInfo.prNumber,
  });

  try {
    // Step 1: Create or find a preview config for this repo
    const previewConfigId = await ctx.runMutation(internal.previewConfigs.upsertInternal, {
      teamId,
      userId,
      repoFullName,
    });

    // Step 2: Create a preview run (following the webhook flow)
    const testHeadSha = `test-${Date.now()}`; // Use a unique test SHA
    const previewRunId = await ctx.runMutation(internal.previewRuns.enqueueFromWebhook, {
      previewConfigId,
      teamId,
      repoFullName,
      repoInstallationId: undefined,
      prNumber: prInfo.prNumber,
      prUrl,
      prTitle: `Test Preview: ${prUrl}`,
      prDescription: undefined,
      headSha: testHeadSha,
      baseSha: undefined,
      headRef: undefined,
      headRepoFullName: undefined,
      headRepoCloneUrl: undefined,
    });

    // Step 3: Create a test task for this preview run
    const taskId = await ctx.runMutation(internal.tasks.createTestTask, {
      teamId,
      userId,
      name: `Test Preview: ${prUrl}`,
      repoUrl: repoUrl ?? `https://github.com/${repoFullName}`,
    });

    // Step 4: Create the preview task run
    const result = await ctx.runMutation(internal.taskRuns.createForPreview, {
      taskId,
      teamId,
      userId,
      prUrl,
    });

    // Step 5: Link the taskRun to the previewRun
    await ctx.runMutation(internal.previewRuns.linkTaskRun, {
      previewRunId,
      taskRunId: result.taskRunId,
    });

    console.log("[preview-jobs-http] Test preview task created", {
      previewConfigId,
      previewRunId,
      taskId,
      taskRunId: result.taskRunId,
    });

    return jsonResponse({
      success: true,
      previewConfigId,
      previewRunId,
      taskId,
      taskRunId: result.taskRunId,
      jwt: result.jwt,
    });
  } catch (error) {
    console.error("[preview-jobs-http] Failed to create test preview task", {
      error,
    });
    return jsonResponse({
      error: "Failed to create test preview task",
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
