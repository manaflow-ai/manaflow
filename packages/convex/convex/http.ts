import { httpRouter } from "convex/server";
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
  createInstance as e2bCreateInstance,
  listInstances as e2bListInstances,
  listTemplates as e2bListTemplates,
  instanceActionRouter as e2bInstanceActionRouter,
  instanceGetRouter as e2bInstanceGetRouter,
} from "./e2b_http";
import {
  createInstance as devboxV2CreateInstance,
  listInstances as devboxV2ListInstances,
  getConfig as devboxV2GetConfig,
  getMe as devboxV2GetMe,
  instanceActionRouter as devboxV2InstanceActionRouter,
  instanceGetRouter as devboxV2InstanceGetRouter,
} from "./devbox_v2_http";
import { openaiProxy } from "./openai_http";
import { codexOAuthRefresh } from "./codex_oauth_http";
import { otelTracesProxy, otelMetricsStub, otelLogsStub } from "./otel_http";
import { sendblueWebhook, sendblueHealth } from "./sms_http";
import { spawn, message, trajectory } from "./spawn_http";
import { acpCallback } from "./acp_http";
import { acpStorageUploadUrl, acpStorageResolveUrl } from "./acp_storage_http";

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

// OpenAI proxy routes for Codex CLI and other OpenAI-based agents
http.route({
  path: "/api/openai/v1/chat/completions",
  method: "POST",
  handler: openaiProxy,
});

http.route({
  path: "/api/openai/v1/responses",
  method: "POST",
  handler: openaiProxy,
});

http.route({
  path: "/api/openai/v1/responses/compact",
  method: "POST",
  handler: openaiProxy,
});

// OpenAI Responses API routes without /v1/ prefix (newer API format)
// Codex CLI uses these paths when calling the Responses API
http.route({
  path: "/api/openai/responses",
  method: "POST",
  handler: openaiProxy,
});

http.route({
  path: "/api/openai/responses/compact",
  method: "POST",
  handler: openaiProxy,
});

// Codex OAuth refresh proxy endpoint
// Codex CLI can use CODEX_REFRESH_TOKEN_URL_OVERRIDE to point here
http.route({
  path: "/api/oauth/codex/token",
  method: "POST",
  handler: codexOAuthRefresh,
});

// OTel OTLP endpoints - the SDK appends /v1/traces, /v1/metrics, /v1/logs to the base URL
http.route({
  path: "/api/otel/v1/traces",
  method: "POST",
  handler: otelTracesProxy,
});

http.route({
  path: "/api/otel/v1/metrics",
  method: "POST",
  handler: otelMetricsStub,
});

http.route({
  path: "/api/otel/v1/logs",
  method: "POST",
  handler: otelLogsStub,
});

// Sendblue SMS/iMessage webhook endpoints
http.route({
  path: "/api/sendblue/webhook",
  method: "POST",
  handler: sendblueWebhook,
});

http.route({
  path: "/api/sendblue/health",
  method: "GET",
  handler: sendblueHealth,
});

// ACP callback endpoint for sandbox events (messages, tool calls, completion)
http.route({
  path: "/api/acp/callback",
  method: "POST",
  handler: acpCallback,
});

// ACP storage endpoints for file uploads from sandboxes
http.route({
  path: "/api/acp/storage/upload-url",
  method: "POST",
  handler: acpStorageUploadUrl,
});

http.route({
  path: "/api/acp/storage/resolve-url",
  method: "POST",
  handler: acpStorageResolveUrl,
});

// Spawn sandbox with initial prompt
http.route({
  path: "/api/spawn",
  method: "POST",
  handler: spawn,
});

// Send follow-up message to conversation
http.route({
  path: "/api/spawn/message",
  method: "POST",
  handler: message,
});

// Get conversation trajectory (messages)
http.route({
  path: "/api/spawn/trajectory",
  method: "GET",
  handler: trajectory,
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

// =============================================================================
// v1/e2b API - E2B instance management with user authentication
// =============================================================================

http.route({
  path: "/api/v1/e2b/instances",
  method: "POST",
  handler: e2bCreateInstance,
});

http.route({
  path: "/api/v1/e2b/instances",
  method: "GET",
  handler: e2bListInstances,
});

http.route({
  path: "/api/v1/e2b/templates",
  method: "GET",
  handler: e2bListTemplates,
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v1/e2b/instances/",
  method: "GET",
  handler: e2bInstanceGetRouter,
});

http.route({
  pathPrefix: "/api/v1/e2b/instances/",
  method: "POST",
  handler: e2bInstanceActionRouter,
});

// =============================================================================
// v2/cmux API - E2B-based cmux sandboxes (cmux-devbox-2 CLI)
// =============================================================================

http.route({
  path: "/api/v2/cmux/instances",
  method: "POST",
  handler: e2bCreateInstance,
});

http.route({
  path: "/api/v2/cmux/instances",
  method: "GET",
  handler: e2bListInstances,
});

http.route({
  path: "/api/v2/cmux/templates",
  method: "GET",
  handler: e2bListTemplates,
});

http.route({
  path: "/api/v2/cmux/me",
  method: "GET",
  handler: cmuxGetMe,
});

// Instance-specific routes use pathPrefix to capture the instance ID
http.route({
  pathPrefix: "/api/v2/cmux/instances/",
  method: "GET",
  handler: e2bInstanceGetRouter,
});

http.route({
  pathPrefix: "/api/v2/cmux/instances/",
  method: "POST",
  handler: e2bInstanceActionRouter,
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

export default http;
