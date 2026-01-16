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

export default http;
