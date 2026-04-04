import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import {
  crownEvaluate,
  crownSummarize,
  crownWorkerCheck,
  crownWorkerFinalize,
  crownWorkerComplete,
} from "./crown_http";
import { agentStopped } from "./notifications_http";
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
  instanceActionRouter as cmuxInstanceActionRouter,
  instanceGetRouter as cmuxInstanceGetRouter,
  instanceDeleteRouter as cmuxInstanceDeleteRouter,
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
import { ingestHeartbeat as mobileIngestHeartbeat } from "./mobile_http";

// =============================================================================
// TEMPORARY DEPRECATION FLAG
// Set to false to restore normal Convex HTTP operation.
// Search for "MANAFLOW_DEPRECATED" across the repo to find all references.
// =============================================================================
const MANAFLOW_DEPRECATED = true;

const deprecatedHandler = httpAction(async () => {
  return new Response(
    JSON.stringify({ error: "Manaflow is temporarily unavailable" }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
});

// Helper: wrap handler with deprecation guard. When MANAFLOW_DEPRECATED is true,
// all routes return 503. To restore: set MANAFLOW_DEPRECATED = false and replace
// `d(handler)` back to `handler` (or just leave it, the wrapper becomes a no-op).
function d(handler: ReturnType<typeof httpAction>) {
  return MANAFLOW_DEPRECATED ? deprecatedHandler : handler;
}

const http = httpRouter();

http.route({
  path: "/github_webhook",
  method: "POST",
  handler: d(githubWebhook),
});

http.route({
  path: "/stack_webhook",
  method: "POST",
  handler: d(stackWebhook),
});

http.route({
  path: "/api/crown/evaluate-agents",
  method: "POST",
  handler: d(crownEvaluate),
});

http.route({
  path: "/api/crown/summarize",
  method: "POST",
  handler: d(crownSummarize),
});

http.route({
  path: "/api/crown/check",
  method: "POST",
  handler: d(crownWorkerCheck),
});

http.route({
  path: "/api/crown/finalize",
  method: "POST",
  handler: d(crownWorkerFinalize),
});

http.route({
  path: "/api/crown/complete",
  method: "POST",
  handler: d(crownWorkerComplete),
});

http.route({
  path: "/api/notifications/agent-stopped",
  method: "POST",
  handler: d(agentStopped),
});

http.route({
  path: "/api/screenshots/upload",
  method: "POST",
  handler: d(uploadScreenshot),
});

http.route({
  path: "/api/screenshots/upload-url",
  method: "POST",
  handler: d(createScreenshotUploadUrl),
});

http.route({
  path: "/api/code-review/callback",
  method: "POST",
  handler: d(codeReviewJobCallback),
});

http.route({
  path: "/api/code-review/file-callback",
  method: "POST",
  handler: d(codeReviewFileCallback),
});

http.route({
  path: "/github_setup",
  method: "GET",
  handler: d(githubSetup),
});

http.route({
  path: "/api/task-runs/report-environment-error",
  method: "POST",
  handler: d(reportEnvironmentError),
});

http.route({
  path: "/api/preview/jobs/dispatch",
  method: "POST",
  handler: d(dispatchPreviewJob),
});

http.route({
  path: "/api/preview/update-status",
  method: "POST",
  handler: d(updatePreviewStatus),
});

http.route({
  path: "/api/preview/create-screenshot-set",
  method: "POST",
  handler: d(createScreenshotSet),
});

http.route({
  path: "/api/preview/complete",
  method: "POST",
  handler: d(completePreviewJob),
});

http.route({
  path: "/api/preview/test-task",
  method: "POST",
  handler: d(createTestPreviewTask),
});

http.route({
  path: "/api/host-screenshot-collector/sync",
  method: "POST",
  handler: d(syncHostScreenshotCollectorRelease),
});

http.route({
  path: "/api/host-screenshot-collector/latest",
  method: "GET",
  handler: d(getLatestHostScreenshotCollector),
});

http.route({
  path: "/api/anthropic/v1/messages",
  method: "POST",
  handler: d(anthropicProxy),
});

http.route({
  path: "/api/anthropic/v1/messages/count_tokens",
  method: "POST",
  handler: d(anthropicCountTokens),
});

http.route({
  path: "/api/anthropic/api/event_logging/batch",
  method: "POST",
  handler: d(anthropicEventLogging),
});

http.route({
  path: "/api/mobile/heartbeat",
  method: "POST",
  handler: d(mobileIngestHeartbeat),
});

// Media proxy endpoint for serving storage files with proper Content-Type headers
// This is used for GitHub PR comments where videos need stable URLs ending in .mp4
// Path format: /api/media/{storageId}.{ext}
http.route({
  pathPrefix: "/api/media/",
  method: "GET",
  handler: d(serveMedia),
});

// =============================================================================
// v1/devbox API - Morph instance management with user authentication
// =============================================================================

http.route({
  path: "/api/v1/devbox/instances",
  method: "POST",
  handler: d(devboxCreateInstance),
});

http.route({
  path: "/api/v1/devbox/instances",
  method: "GET",
  handler: d(devboxListInstances),
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v1/devbox/instances/",
  method: "GET",
  handler: d(devboxInstanceGetRouter),
});

http.route({
  pathPrefix: "/api/v1/devbox/instances/",
  method: "POST",
  handler: d(devboxInstanceActionRouter),
});

// =============================================================================
// v1/cmux API - Morph instance management for cmux devbox CLI
// =============================================================================

http.route({
  path: "/api/v1/cmux/instances",
  method: "POST",
  handler: d(cmuxCreateInstance),
});

http.route({
  path: "/api/v1/cmux/instances",
  method: "GET",
  handler: d(cmuxListInstances),
});

http.route({
  path: "/api/v1/cmux/snapshots",
  method: "GET",
  handler: d(cmuxListSnapshots),
});

http.route({
  pathPrefix: "/api/v1/cmux/snapshots/",
  method: "GET",
  handler: d(cmuxGetSnapshot),
});

http.route({
  path: "/api/v1/cmux/config",
  method: "GET",
  handler: d(cmuxGetConfig),
});

http.route({
  path: "/api/v1/cmux/me",
  method: "GET",
  handler: d(cmuxGetMe),
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v1/cmux/instances/",
  method: "GET",
  handler: d(cmuxInstanceGetRouter),
});

http.route({
  pathPrefix: "/api/v1/cmux/instances/",
  method: "POST",
  handler: d(cmuxInstanceActionRouter),
});

http.route({
  pathPrefix: "/api/v1/cmux/instances/",
  method: "DELETE",
  handler: d(cmuxInstanceDeleteRouter),
});

// =============================================================================
// v2/devbox API - Unified devbox management with provider selection (Morph/E2B)
// =============================================================================

http.route({
  path: "/api/v2/devbox/instances",
  method: "POST",
  handler: d(devboxV2CreateInstance),
});

http.route({
  path: "/api/v2/devbox/instances",
  method: "GET",
  handler: d(devboxV2ListInstances),
});

http.route({
  path: "/api/v2/devbox/config",
  method: "GET",
  handler: d(devboxV2GetConfig),
});

http.route({
  path: "/api/v2/devbox/templates",
  method: "GET",
  handler: d(devboxV2ListTemplates),
});

http.route({
  path: "/api/v2/devbox/me",
  method: "GET",
  handler: d(devboxV2GetMe),
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v2/devbox/instances/",
  method: "GET",
  handler: d(devboxV2InstanceGetRouter),
});

http.route({
  pathPrefix: "/api/v2/devbox/instances/",
  method: "POST",
  handler: d(devboxV2InstanceActionRouter),
});

export default http;
