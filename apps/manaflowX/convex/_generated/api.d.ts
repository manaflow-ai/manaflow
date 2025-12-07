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
import type * as actions from "../actions.js";
import type * as github from "../github.js";
import type * as github_app from "../github_app.js";
import type * as http from "../http.js";
import type * as myFunctions from "../myFunctions.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_shared/crypto": typeof _shared_crypto;
  "_shared/encoding": typeof _shared_encoding;
  "_shared/githubApp": typeof _shared_githubApp;
  actions: typeof actions;
  github: typeof github;
  github_app: typeof github_app;
  http: typeof http;
  myFunctions: typeof myFunctions;
  users: typeof users;
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
