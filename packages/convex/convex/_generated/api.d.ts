/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as acp from "../acp.js";
import type * as acpErrors from "../acpErrors.js";
import type * as acpRawEvents from "../acpRawEvents.js";
import type * as acpSandboxes from "../acpSandboxes.js";
import type * as acp_callbacks from "../acp_callbacks.js";
import type * as acp_http from "../acp_http.js";
import type * as acp_storage_http from "../acp_storage_http.js";
import type * as anthropic_http from "../anthropic_http.js";
import type * as apiKeys from "../apiKeys.js";
import type * as backfill from "../backfill.js";
import type * as bedrock_utils from "../bedrock_utils.js";
import type * as bluebubbles from "../bluebubbles.js";
import type * as codeReview from "../codeReview.js";
import type * as codeReviewActions from "../codeReviewActions.js";
import type * as codeReview_http from "../codeReview_http.js";
import type * as codexTokens from "../codexTokens.js";
import type * as codex_oauth_http from "../codex_oauth_http.js";
import type * as comments from "../comments.js";
import type * as containerSettings from "../containerSettings.js";
import type * as conversationMessages from "../conversationMessages.js";
import type * as conversationReads from "../conversationReads.js";
import type * as conversationSummary from "../conversationSummary.js";
import type * as conversationTitle from "../conversationTitle.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as crown from "../crown.js";
import type * as crown_actions from "../crown/actions.js";
import type * as crown_http from "../crown_http.js";
import type * as effect_http from "../effect/http.js";
import type * as effect_observability from "../effect/observability.js";
import type * as effect_runtime from "../effect/runtime.js";
import type * as effect_services from "../effect/services.js";
import type * as effect_testLayers from "../effect/testLayers.js";
import type * as effect_traceContext from "../effect/traceContext.js";
import type * as effect_traced from "../effect/traced.js";
import type * as effect_tracing from "../effect/tracing.js";
import type * as environmentSnapshots from "../environmentSnapshots.js";
import type * as environments from "../environments.js";
import type * as github from "../github.js";
import type * as github_app from "../github_app.js";
import type * as github_check_runs from "../github_check_runs.js";
import type * as github_commit_statuses from "../github_commit_statuses.js";
import type * as github_deployments from "../github_deployments.js";
import type * as github_http from "../github_http.js";
import type * as github_pr_comments from "../github_pr_comments.js";
import type * as github_pr_merge_handler from "../github_pr_merge_handler.js";
import type * as github_pr_queries from "../github_pr_queries.js";
import type * as github_prs from "../github_prs.js";
import type * as github_setup from "../github_setup.js";
import type * as github_webhook from "../github_webhook.js";
import type * as github_workflows from "../github_workflows.js";
import type * as hostScreenshotCollector from "../hostScreenshotCollector.js";
import type * as hostScreenshotCollectorActions from "../hostScreenshotCollectorActions.js";
import type * as hostScreenshotCollector_http from "../hostScreenshotCollector_http.js";
import type * as http from "../http.js";
import type * as localWorkspaces from "../localWorkspaces.js";
import type * as migrations from "../migrations.js";
import type * as morphInstanceMaintenance from "../morphInstanceMaintenance.js";
import type * as morphInstances from "../morphInstances.js";
import type * as notifications_http from "../notifications_http.js";
import type * as openai_http from "../openai_http.js";
import type * as otel_http from "../otel_http.js";
import type * as previewConfigs from "../previewConfigs.js";
import type * as previewRuns from "../previewRuns.js";
import type * as previewScreenshots from "../previewScreenshots.js";
import type * as previewTestJobs from "../previewTestJobs.js";
import type * as preview_jobs from "../preview_jobs.js";
import type * as preview_jobs_http from "../preview_jobs_http.js";
import type * as preview_jobs_worker from "../preview_jobs_worker.js";
import type * as preview_screenshots_http from "../preview_screenshots_http.js";
import type * as pushNotificationsActions from "../pushNotificationsActions.js";
import type * as pushTokens from "../pushTokens.js";
import type * as screenshots_http from "../screenshots_http.js";
import type * as seed from "../seed.js";
import type * as sendblue from "../sendblue.js";
import type * as sms from "../sms.js";
import type * as sms_http from "../sms_http.js";
import type * as sms_llm from "../sms_llm.js";
import type * as sms_notifications from "../sms_notifications.js";
import type * as sms_phone_users from "../sms_phone_users.js";
import type * as sms_queries from "../sms_queries.js";
import type * as spawn_http from "../spawn_http.js";
import type * as stack from "../stack.js";
import type * as stack_webhook from "../stack_webhook.js";
import type * as stack_webhook_actions from "../stack_webhook_actions.js";
import type * as storage from "../storage.js";
import type * as sync from "../sync.js";
import type * as taskComments from "../taskComments.js";
import type * as taskNotifications from "../taskNotifications.js";
import type * as taskRunLogChunks from "../taskRunLogChunks.js";
import type * as taskRuns from "../taskRuns.js";
import type * as taskRuns_http from "../taskRuns_http.js";
import type * as tasks from "../tasks.js";
import type * as teams from "../teams.js";
import type * as userEditorSettings from "../userEditorSettings.js";
import type * as users from "../users.js";
import type * as users_utils_getWorkerAuth from "../users/utils/getWorkerAuth.js";
import type * as users_utils_index from "../users/utils/index.js";
import type * as workspaceConfigs from "../workspaceConfigs.js";
import type * as workspaceSettings from "../workspaceSettings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  acp: typeof acp;
  acpErrors: typeof acpErrors;
  acpRawEvents: typeof acpRawEvents;
  acpSandboxes: typeof acpSandboxes;
  acp_callbacks: typeof acp_callbacks;
  acp_http: typeof acp_http;
  acp_storage_http: typeof acp_storage_http;
  anthropic_http: typeof anthropic_http;
  apiKeys: typeof apiKeys;
  backfill: typeof backfill;
  bedrock_utils: typeof bedrock_utils;
  bluebubbles: typeof bluebubbles;
  codeReview: typeof codeReview;
  codeReviewActions: typeof codeReviewActions;
  codeReview_http: typeof codeReview_http;
  codexTokens: typeof codexTokens;
  codex_oauth_http: typeof codex_oauth_http;
  comments: typeof comments;
  containerSettings: typeof containerSettings;
  conversationMessages: typeof conversationMessages;
  conversationReads: typeof conversationReads;
  conversationSummary: typeof conversationSummary;
  conversationTitle: typeof conversationTitle;
  conversations: typeof conversations;
  crons: typeof crons;
  crown: typeof crown;
  "crown/actions": typeof crown_actions;
  crown_http: typeof crown_http;
  "effect/http": typeof effect_http;
  "effect/observability": typeof effect_observability;
  "effect/runtime": typeof effect_runtime;
  "effect/services": typeof effect_services;
  "effect/testLayers": typeof effect_testLayers;
  "effect/traceContext": typeof effect_traceContext;
  "effect/traced": typeof effect_traced;
  "effect/tracing": typeof effect_tracing;
  environmentSnapshots: typeof environmentSnapshots;
  environments: typeof environments;
  github: typeof github;
  github_app: typeof github_app;
  github_check_runs: typeof github_check_runs;
  github_commit_statuses: typeof github_commit_statuses;
  github_deployments: typeof github_deployments;
  github_http: typeof github_http;
  github_pr_comments: typeof github_pr_comments;
  github_pr_merge_handler: typeof github_pr_merge_handler;
  github_pr_queries: typeof github_pr_queries;
  github_prs: typeof github_prs;
  github_setup: typeof github_setup;
  github_webhook: typeof github_webhook;
  github_workflows: typeof github_workflows;
  hostScreenshotCollector: typeof hostScreenshotCollector;
  hostScreenshotCollectorActions: typeof hostScreenshotCollectorActions;
  hostScreenshotCollector_http: typeof hostScreenshotCollector_http;
  http: typeof http;
  localWorkspaces: typeof localWorkspaces;
  migrations: typeof migrations;
  morphInstanceMaintenance: typeof morphInstanceMaintenance;
  morphInstances: typeof morphInstances;
  notifications_http: typeof notifications_http;
  openai_http: typeof openai_http;
  otel_http: typeof otel_http;
  previewConfigs: typeof previewConfigs;
  previewRuns: typeof previewRuns;
  previewScreenshots: typeof previewScreenshots;
  previewTestJobs: typeof previewTestJobs;
  preview_jobs: typeof preview_jobs;
  preview_jobs_http: typeof preview_jobs_http;
  preview_jobs_worker: typeof preview_jobs_worker;
  preview_screenshots_http: typeof preview_screenshots_http;
  pushNotificationsActions: typeof pushNotificationsActions;
  pushTokens: typeof pushTokens;
  screenshots_http: typeof screenshots_http;
  seed: typeof seed;
  sendblue: typeof sendblue;
  sms: typeof sms;
  sms_http: typeof sms_http;
  sms_llm: typeof sms_llm;
  sms_notifications: typeof sms_notifications;
  sms_phone_users: typeof sms_phone_users;
  sms_queries: typeof sms_queries;
  spawn_http: typeof spawn_http;
  stack: typeof stack;
  stack_webhook: typeof stack_webhook;
  stack_webhook_actions: typeof stack_webhook_actions;
  storage: typeof storage;
  sync: typeof sync;
  taskComments: typeof taskComments;
  taskNotifications: typeof taskNotifications;
  taskRunLogChunks: typeof taskRunLogChunks;
  taskRuns: typeof taskRuns;
  taskRuns_http: typeof taskRuns_http;
  tasks: typeof tasks;
  teams: typeof teams;
  userEditorSettings: typeof userEditorSettings;
  users: typeof users;
  "users/utils/getWorkerAuth": typeof users_utils_getWorkerAuth;
  "users/utils/index": typeof users_utils_index;
  workspaceConfigs: typeof workspaceConfigs;
  workspaceSettings: typeof workspaceSettings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
};
