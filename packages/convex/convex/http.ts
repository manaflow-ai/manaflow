import { httpRouter } from "convex/server";
import {
  crownEvaluate,
  crownSummarize,
  crownWorkerCheck,
  crownWorkerFinalize,
  crownWorkerComplete,
} from "./crown_http";
import { agentStopped } from "./notifications_http";
import { syncMemory } from "./agentMemory_http";
import { createScreenshotUploadUrl, uploadScreenshot } from "./screenshots_http";
import {
  codeReviewFileCallback,
  codeReviewJobCallback,
} from "./codeReview_http";
import { githubSetup } from "./github_setup";
import { githubWebhook } from "./github_webhook";
import { reportEnvironmentError } from "./taskRuns_http";
import { stackWebhook } from "./stack_webhook";
import {
  updatePreviewStatus,
  createScreenshotSet,
  dispatchPreviewJob,
  completePreviewJob,
  createTestPreviewTask,
} from "./preview_jobs_http";
import {
  syncRelease as syncHostScreenshotCollectorRelease,
  getLatest as getLatestHostScreenshotCollector,
} from "./hostScreenshotCollector_http";
import {
  anthropicProxy,
  anthropicCountTokens,
  anthropicEventLogging,
} from "./anthropic_http";
import { serveMedia } from "./media_proxy_http";
import {
  createInstance as devboxCreateInstance,
  listInstances as devboxListInstances,
  instanceActionRouter as devboxInstanceActionRouter,
  instanceGetRouter as devboxInstanceGetRouter,
} from "./devbox_http";
import {
  createInstance as cmuxCreateInstance,
  listInstances as cmuxListInstances,
  listSnapshots as cmuxListSnapshots,
  getSnapshot as cmuxGetSnapshot,
  getConfig as cmuxGetConfig,
  getMe as cmuxGetMe,
  listMyTeams as cmuxListMyTeams,
  switchTeam as cmuxSwitchTeam,
  instanceActionRouter as cmuxInstanceActionRouter,
  instanceGetRouter as cmuxInstanceGetRouter,
  instanceDeleteRouter as cmuxInstanceDeleteRouter,
  createStorageUploadUrl as cmuxCreateStorageUploadUrl,
  listTasks as cmuxListTasks,
  createTask as cmuxCreateTask,
  taskGetRouter as cmuxTaskGetRouter,
  taskActionRouter as cmuxTaskActionRouter,
  getTaskRunMemory as cmuxGetTaskRunMemory,
} from "./cmux_http";
import {
  createInstance as devboxV2CreateInstance,
  listInstances as devboxV2ListInstances,
  listTemplates as devboxV2ListTemplates,
  getConfig as devboxV2GetConfig,
  getMe as devboxV2GetMe,
  instanceActionRouter as devboxV2InstanceActionRouter,
  instanceGetRouter as devboxV2InstanceGetRouter,
} from "./devbox_v2_http";
import {
  createTaskAndRun as orchestrationCreateTaskAndRun,
  createOrchestrationTask,
  updateOrchestrationTask,
  getSpawnConfig as orchestrationGetSpawnConfig,
  pullOrchestrationState,
  getOrchestrationResults,
} from "./orchestration_http";

const http = httpRouter();

http.route({
  path: "/github_webhook",
  method: "POST",
  handler: githubWebhook,
});

http.route({
  path: "/stack_webhook",
  method: "POST",
  handler: stackWebhook,
});

http.route({
  path: "/api/crown/evaluate-agents",
  method: "POST",
  handler: crownEvaluate,
});

http.route({
  path: "/api/crown/summarize",
  method: "POST",
  handler: crownSummarize,
});

http.route({
  path: "/api/crown/check",
  method: "POST",
  handler: crownWorkerCheck,
});

http.route({
  path: "/api/crown/finalize",
  method: "POST",
  handler: crownWorkerFinalize,
});

http.route({
  path: "/api/crown/complete",
  method: "POST",
  handler: crownWorkerComplete,
});

http.route({
  path: "/api/notifications/agent-stopped",
  method: "POST",
  handler: agentStopped,
});

http.route({
  path: "/api/memory/sync",
  method: "POST",
  handler: syncMemory,
});

http.route({
  path: "/api/screenshots/upload",
  method: "POST",
  handler: uploadScreenshot,
});

http.route({
  path: "/api/screenshots/upload-url",
  method: "POST",
  handler: createScreenshotUploadUrl,
});

http.route({
  path: "/api/code-review/callback",
  method: "POST",
  handler: codeReviewJobCallback,
});

http.route({
  path: "/api/code-review/file-callback",
  method: "POST",
  handler: codeReviewFileCallback,
});

http.route({
  path: "/github_setup",
  method: "GET",
  handler: githubSetup,
});

http.route({
  path: "/api/task-runs/report-environment-error",
  method: "POST",
  handler: reportEnvironmentError,
});

http.route({
  path: "/api/preview/jobs/dispatch",
  method: "POST",
  handler: dispatchPreviewJob,
});

http.route({
  path: "/api/preview/update-status",
  method: "POST",
  handler: updatePreviewStatus,
});

http.route({
  path: "/api/preview/create-screenshot-set",
  method: "POST",
  handler: createScreenshotSet,
});

http.route({
  path: "/api/preview/complete",
  method: "POST",
  handler: completePreviewJob,
});

http.route({
  path: "/api/preview/test-task",
  method: "POST",
  handler: createTestPreviewTask,
});

http.route({
  path: "/api/host-screenshot-collector/sync",
  method: "POST",
  handler: syncHostScreenshotCollectorRelease,
});

http.route({
  path: "/api/host-screenshot-collector/latest",
  method: "GET",
  handler: getLatestHostScreenshotCollector,
});

http.route({
  path: "/api/anthropic/v1/messages",
  method: "POST",
  handler: anthropicProxy,
});

http.route({
  path: "/api/anthropic/v1/messages/count_tokens",
  method: "POST",
  handler: anthropicCountTokens,
});

http.route({
  path: "/api/anthropic/api/event_logging/batch",
  method: "POST",
  handler: anthropicEventLogging,
});

// Media proxy endpoint for serving storage files with proper Content-Type headers
// This is used for GitHub PR comments where videos need stable URLs ending in .mp4
// Path format: /api/media/{storageId}.{ext}
http.route({
  pathPrefix: "/api/media/",
  method: "GET",
  handler: serveMedia,
});

// =============================================================================
// v1/devbox API - Morph instance management with user authentication
// =============================================================================

http.route({
  path: "/api/v1/devbox/instances",
  method: "POST",
  handler: devboxCreateInstance,
});

http.route({
  path: "/api/v1/devbox/instances",
  method: "GET",
  handler: devboxListInstances,
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v1/devbox/instances/",
  method: "GET",
  handler: devboxInstanceGetRouter,
});

http.route({
  pathPrefix: "/api/v1/devbox/instances/",
  method: "POST",
  handler: devboxInstanceActionRouter,
});

// =============================================================================
// v1/cmux API - Morph instance management for cmux devbox CLI
// =============================================================================

http.route({
  path: "/api/v1/cmux/instances",
  method: "POST",
  handler: cmuxCreateInstance,
});

http.route({
  path: "/api/v1/cmux/instances",
  method: "GET",
  handler: cmuxListInstances,
});

http.route({
  path: "/api/v1/cmux/snapshots",
  method: "GET",
  handler: cmuxListSnapshots,
});

http.route({
  pathPrefix: "/api/v1/cmux/snapshots/",
  method: "GET",
  handler: cmuxGetSnapshot,
});

http.route({
  path: "/api/v1/cmux/config",
  method: "GET",
  handler: cmuxGetConfig,
});

http.route({
  path: "/api/v1/cmux/me",
  method: "GET",
  handler: cmuxGetMe,
});

http.route({
  path: "/api/v1/cmux/me/teams",
  method: "GET",
  handler: cmuxListMyTeams,
});

http.route({
  path: "/api/v1/cmux/me/team",
  method: "POST",
  handler: cmuxSwitchTeam,
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v1/cmux/instances/",
  method: "GET",
  handler: cmuxInstanceGetRouter,
});

http.route({
  pathPrefix: "/api/v1/cmux/instances/",
  method: "POST",
  handler: cmuxInstanceActionRouter,
});

http.route({
  pathPrefix: "/api/v1/cmux/instances/",
  method: "DELETE",
  handler: cmuxInstanceDeleteRouter,
});

http.route({
  path: "/api/v1/cmux/storage/upload-url",
  method: "POST",
  handler: cmuxCreateStorageUploadUrl,
});

// Task management routes
http.route({
  path: "/api/v1/cmux/tasks",
  method: "GET",
  handler: cmuxListTasks,
});

http.route({
  path: "/api/v1/cmux/tasks",
  method: "POST",
  handler: cmuxCreateTask,
});

// Task-specific routes use pathPrefix to capture the task ID
http.route({
  pathPrefix: "/api/v1/cmux/tasks/",
  method: "GET",
  handler: cmuxTaskGetRouter,
});

http.route({
  pathPrefix: "/api/v1/cmux/tasks/",
  method: "POST",
  handler: cmuxTaskActionRouter,
});

// Task run memory endpoint
http.route({
  pathPrefix: "/api/v1/cmux/task-runs/",
  method: "GET",
  handler: cmuxGetTaskRunMemory,
});

// =============================================================================
// v2/devbox API - Unified devbox management with provider selection (Morph/E2B)
// =============================================================================

http.route({
  path: "/api/v2/devbox/instances",
  method: "POST",
  handler: devboxV2CreateInstance,
});

http.route({
  path: "/api/v2/devbox/instances",
  method: "GET",
  handler: devboxV2ListInstances,
});

http.route({
  path: "/api/v2/devbox/config",
  method: "GET",
  handler: devboxV2GetConfig,
});

http.route({
  path: "/api/v2/devbox/templates",
  method: "GET",
  handler: devboxV2ListTemplates,
});

http.route({
  path: "/api/v2/devbox/me",
  method: "GET",
  handler: devboxV2GetMe,
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v2/devbox/instances/",
  method: "GET",
  handler: devboxV2InstanceGetRouter,
});

http.route({
  pathPrefix: "/api/v2/devbox/instances/",
  method: "POST",
  handler: devboxV2InstanceActionRouter,
});

// =============================================================================
// Orchestration API - JWT-authenticated endpoints for sub-agent spawning
// =============================================================================

http.route({
  path: "/api/orchestration/task-and-run",
  method: "POST",
  handler: orchestrationCreateTaskAndRun,
});

http.route({
  path: "/api/orchestration/tasks",
  method: "POST",
  handler: createOrchestrationTask,
});

http.route({
  path: "/api/orchestration/tasks/update",
  method: "POST",
  handler: updateOrchestrationTask,
});

http.route({
  path: "/api/orchestration/spawn-config",
  method: "GET",
  handler: orchestrationGetSpawnConfig,
});

http.route({
  path: "/api/orchestration/pull",
  method: "GET",
  handler: pullOrchestrationState,
});

http.route({
  path: "/api/orchestration/results",
  method: "GET",
  handler: getOrchestrationResults,
});

export default http;
