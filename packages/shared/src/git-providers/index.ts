/**
 * Git Provider Abstraction Layer
 *
 * This module provides a unified interface for interacting with multiple
 * git providers (GitHub, GitLab, Bitbucket).
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   providerRegistry,
 *   type ParsedRepo,
 *   type GitProvider,
 * } from "@cmux/shared/git-providers";
 *
 * // Parse a repo URL (auto-detects provider)
 * const repo = providerRegistry.parseRepoUrl("https://github.com/owner/repo");
 * console.log(repo?.provider); // "github"
 *
 * // Get a specific provider
 * const github = providerRegistry.get("github");
 *
 * // List repositories for an installation
 * for await (const batch of github.listRepositories(installationId, token)) {
 *   console.log(`Got ${batch.length} repos`);
 * }
 * ```
 *
 * ## Architecture
 *
 * - `types.ts` - Core interfaces and type definitions
 * - `registry.ts` - Provider registry (singleton pattern)
 * - `providers/` - Provider implementations
 *
 * ## Adding a New Provider
 *
 * 1. Create a new file in `providers/` (e.g., `gitlab.ts`)
 * 2. Implement the `GitProvider` interface
 * 3. Register the provider in this index file
 *
 * @module
 */

// Re-export all types
export type {
  GitProviderId,
  OwnerType,
  ParsedRepo,
  ProviderRepository,
  ProviderAppConfig,
  ProviderToken,
  WebhookEventType,
  ProviderWebhookEvent,
  ProviderPullRequest,
  WebhookVerificationResult,
  WebhookRequest,
  GitProvider,
  GitProviderErrorType,
} from "./types.js";

export { GitProviderError } from "./types.js";

// Re-export registry
export { providerRegistry, GitProviderRegistry } from "./registry.js";

// Re-export providers
export { githubProvider } from "./providers/github.js";

// ─────────────────────────────────────────────────────────────────────────────
// Auto-register built-in providers
// ─────────────────────────────────────────────────────────────────────────────

import { providerRegistry } from "./registry.js";
import { githubProvider } from "./providers/github.js";

// Register GitHub provider by default
providerRegistry.register(githubProvider);

// Future: Register GitLab and Bitbucket providers when implemented
// providerRegistry.register(gitlabProvider);
// providerRegistry.register(bitbucketProvider);
