/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _shared_crypto from "../_shared/crypto.js";
import type * as _shared_encoding from "../_shared/encoding.js";
import type * as _shared_githubApp from "../_shared/githubApp.js";
import type * as _shared_twitterApi from "../_shared/twitterApi.js";
import type * as actions from "../actions.js";
import type * as codingAgent from "../codingAgent.js";
import type * as crons from "../crons.js";
import type * as curator from "../curator.js";
import type * as github from "../github.js";
import type * as githubMonitor from "../githubMonitor.js";
import type * as github_app from "../github_app.js";
import type * as http from "../http.js";
import type * as issues from "../issues.js";
import type * as posts from "../posts.js";
import type * as sessions from "../sessions.js";
import type * as twitter from "../twitter.js";
import type * as users from "../users.js";
import type * as workflowQueue from "../workflowQueue.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/crypto": typeof _shared_crypto;
  "_shared/encoding": typeof _shared_encoding;
  "_shared/githubApp": typeof _shared_githubApp;
  "_shared/twitterApi": typeof _shared_twitterApi;
  actions: typeof actions;
  codingAgent: typeof codingAgent;
  crons: typeof crons;
  curator: typeof curator;
  github: typeof github;
  githubMonitor: typeof githubMonitor;
  github_app: typeof github_app;
  http: typeof http;
  issues: typeof issues;
  posts: typeof posts;
  sessions: typeof sessions;
  twitter: typeof twitter;
  users: typeof users;
  workflowQueue: typeof workflowQueue;
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
  stack_auth: {};
};
