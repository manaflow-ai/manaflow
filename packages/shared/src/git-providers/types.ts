/**
 * Git Provider Abstraction Layer
 *
 * This module defines the core interfaces for abstracting git providers
 * (GitHub, GitLab, Bitbucket) to enable multi-provider support.
 *
 * ## Architecture Overview
 *
 * The abstraction uses a strategy pattern where each provider implements
 * the GitProvider interface. A central registry manages provider instances
 * and provides factory methods for creating provider-specific clients.
 *
 * ## Key Design Decisions
 *
 * 1. **Provider ID as branded type**: Ensures type safety when passing provider IDs
 * 2. **Async iterators for pagination**: Natural pattern for paginated API responses
 * 3. **Normalized types**: Common types work across all providers while preserving
 *    provider-specific metadata in dedicated fields
 * 4. **Webhook event mapping**: Providers normalize their events to a common format
 * 5. **Pluggable authentication**: Each provider implements its own auth strategy
 *
 * ## Provider Compatibility Matrix
 *
 * | Feature           | GitHub    | GitLab    | Bitbucket |
 * |-------------------|-----------|-----------|-----------|
 * | App Auth          | JWT+Token | OAuth+PAT | OAuth 2.0 |
 * | Webhook Signature | HMAC-SHA256| Header   | HMAC-SHA256|
 * | Repo ID Type      | number    | number    | slug      |
 * | Owner Types       | User/Org  | User/Group| User/Team |
 * | PR Name           | Pull Request | Merge Request | Pull Request |
 */

/**
 * Supported git provider identifiers.
 *
 * - `github`: GitHub.com and GitHub Enterprise
 * - `gitlab`: GitLab.com and self-hosted GitLab
 * - `bitbucket`: Bitbucket Cloud and Bitbucket Server
 */
export type GitProviderId = "github" | "gitlab" | "bitbucket";

/**
 * Owner account types normalized across providers.
 *
 * GitHub: User | Organization
 * GitLab: Individual | Group
 * Bitbucket: User | Team
 */
export type OwnerType = "user" | "organization";

/**
 * Parsed repository information normalized across providers.
 * All URL formats (HTTPS, SSH, simple) are normalized to this structure.
 */
export interface ParsedRepo {
  /** Repository owner (user or organization) */
  owner: string;
  /** Repository name */
  name: string;
  /** Full repository identifier: owner/name */
  fullName: string;
  /** HTTPS URL to the repository */
  url: string;
  /** Git clone URL (HTTPS with .git suffix) */
  gitUrl: string;
  /** Which provider this repository belongs to */
  provider: GitProviderId;
}

/**
 * Repository metadata from the provider's API.
 * Represents a repository accessible through an installation/connection.
 */
export interface ProviderRepository {
  /** Provider-specific repository ID (number for GitHub/GitLab, slug for Bitbucket) */
  id: string | number;
  /** Full repository identifier: owner/name */
  fullName: string;
  /** Repository owner username/login */
  owner: string;
  /** Owner account type */
  ownerType: OwnerType;
  /** Repository name */
  name: string;
  /** HTTPS URL to the repository */
  url: string;
  /** Whether the repository is private */
  isPrivate: boolean;
  /** Default branch name (e.g., "main", "master") */
  defaultBranch?: string;
  /** Timestamp of last push (Unix milliseconds) */
  lastPushedAt?: number;
  /** Provider-specific metadata not covered by standard fields */
  providerMetadata?: Record<string, unknown>;
}

/**
 * Configuration for provider app/OAuth authentication.
 * Structure varies by provider but common fields are extracted here.
 */
export interface ProviderAppConfig {
  /** Application/Client ID */
  appId: string;
  /** Private key (GitHub), client secret, or similar credential */
  privateKeyOrSecret: string;
  /** Webhook signature secret for verification */
  webhookSecret?: string;
  /** Optional API base URL for self-hosted instances */
  apiBaseUrl?: string;
}

/**
 * Token with optional metadata about permissions and expiry.
 */
export interface ProviderToken {
  /** The access token string */
  token: string;
  /** When the token expires (Unix milliseconds) */
  expiresAt?: number;
  /** Permissions/scopes the token has */
  permissions?: Record<string, string>;
}

/**
 * Normalized webhook event types across providers.
 *
 * Maps provider-specific events to common types:
 * - GitHub: installation, push, pull_request, workflow_run, check_run, deployment, status
 * - GitLab: push, merge_request, pipeline, job, deployment
 * - Bitbucket: push, pullrequest, deployment
 */
export type WebhookEventType =
  | "installation"
  | "installation_repositories"
  | "push"
  | "pull_request"
  | "workflow_run"
  | "workflow_job"
  | "check_run"
  | "check_suite"
  | "deployment"
  | "deployment_status"
  | "commit_status";

/**
 * Normalized webhook event structure.
 * Each provider maps their events to this common format.
 */
export interface ProviderWebhookEvent {
  /** Normalized event type */
  type: WebhookEventType;
  /** Event action (e.g., "opened", "closed", "synchronize") */
  action?: string;
  /** Which provider sent this event */
  provider: GitProviderId;
  /** Installation/connection ID that received this event */
  installationId: string | number;
  /** Repository information if event is repo-scoped */
  repository?: {
    fullName: string;
    owner: string;
    name: string;
    id: string | number;
  };
  /** Unique delivery ID from the provider */
  deliveryId?: string;
  /** Raw provider-specific payload for access to all fields */
  rawPayload: unknown;
}

/**
 * Pull request/merge request normalized across providers.
 */
export interface ProviderPullRequest {
  /** Provider-specific PR/MR number */
  number: number;
  /** PR title */
  title: string;
  /** PR state */
  state: "open" | "closed" | "merged";
  /** URL to the PR */
  url: string;
  /** Source branch name */
  headRef: string;
  /** Target branch name */
  baseRef: string;
  /** Author username */
  author: string;
  /** Whether this is a draft PR */
  isDraft: boolean;
  /** Head commit SHA */
  headSha: string;
  /** When the PR was created (Unix milliseconds) */
  createdAt: number;
  /** When the PR was last updated (Unix milliseconds) */
  updatedAt: number;
  /** When the PR was merged, if applicable (Unix milliseconds) */
  mergedAt?: number;
}

/**
 * Webhook verification result.
 */
export interface WebhookVerificationResult {
  /** Whether the signature is valid */
  isValid: boolean;
  /** Error message if verification failed */
  error?: string;
}

/**
 * Request context for webhook handling.
 */
export interface WebhookRequest {
  /** Request headers (normalized to lowercase keys) */
  headers: Record<string, string | undefined>;
  /** Raw request body as string */
  body: string;
}

/**
 * Core interface that all git providers must implement.
 *
 * ## Implementation Notes
 *
 * - Providers should be stateless - configuration is passed to methods
 * - All async operations should handle rate limiting internally
 * - Errors should be thrown as typed errors (see GitProviderError)
 * - Provider-specific features should be exposed through metadata fields
 */
export interface GitProvider {
  /** Unique provider identifier */
  readonly id: GitProviderId;

  /** Human-readable provider name */
  readonly displayName: string;

  /** Domain pattern for URL matching (e.g., "github.com") */
  readonly domain: string;

  // ─────────────────────────────────────────────────────────────────────────────
  // URL Parsing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Parse a repository URL/identifier and extract repository information.
   *
   * Supported formats vary by provider but typically include:
   * - Simple: owner/repo
   * - HTTPS: https://provider.com/owner/repo
   * - SSH: git@provider.com:owner/repo.git
   *
   * @param input - Repository URL or identifier
   * @returns Parsed repository info, or null if not a valid URL for this provider
   */
  parseRepoUrl(input: string): ParsedRepo | null;

  /**
   * Construct the canonical HTTPS URL for a repository.
   *
   * @param owner - Repository owner
   * @param name - Repository name
   * @returns HTTPS URL to the repository
   */
  buildRepoUrl(owner: string, name: string): string;

  /**
   * Construct the git clone URL for a repository.
   *
   * @param owner - Repository owner
   * @param name - Repository name
   * @returns Git clone URL (typically HTTPS with .git suffix)
   */
  buildGitUrl(owner: string, name: string): string;

  // ─────────────────────────────────────────────────────────────────────────────
  // Authentication
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create an app-level authentication token (e.g., GitHub App JWT).
   * Not all providers support this - may return null.
   *
   * @param config - Provider app configuration
   * @returns JWT or app token, or null if not supported
   */
  createAppToken?(config: ProviderAppConfig): Promise<string | null>;

  /**
   * Fetch an installation/connection-scoped access token.
   *
   * @param installationId - Provider-specific installation ID
   * @param config - Provider app configuration
   * @param permissions - Optional permission scopes to request
   * @returns Access token with metadata, or null if failed
   */
  fetchInstallationToken(
    installationId: string | number,
    config: ProviderAppConfig,
    permissions?: Record<string, string>
  ): Promise<ProviderToken | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Repository Discovery
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * List repositories accessible through an installation.
   * Returns an async iterator for efficient pagination handling.
   *
   * @param installationId - Provider-specific installation ID
   * @param token - Access token for API calls
   * @yields Batches of repositories as returned by API pagination
   */
  listRepositories(
    installationId: string | number,
    token: string
  ): AsyncIterable<ProviderRepository[]>;

  /**
   * Get detailed information about a specific repository.
   *
   * @param owner - Repository owner
   * @param name - Repository name
   * @param token - Access token for API calls
   * @returns Repository metadata, or null if not found
   */
  getRepository(
    owner: string,
    name: string,
    token: string
  ): Promise<ProviderRepository | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Webhook Handling
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Verify a webhook signature is authentic.
   *
   * @param request - Webhook request with headers and body
   * @param secret - Webhook secret for verification
   * @returns Verification result with validity and optional error
   */
  verifyWebhookSignature(
    request: WebhookRequest,
    secret: string
  ): Promise<WebhookVerificationResult>;

  /**
   * Extract the event type from webhook headers.
   *
   * @param headers - Request headers (lowercase keys)
   * @returns Provider-specific event type string, or null if not found
   */
  getWebhookEventType(headers: Record<string, string | undefined>): string | null;

  /**
   * Map a raw webhook payload to the normalized event structure.
   *
   * @param eventType - Provider-specific event type
   * @param payload - Raw webhook payload
   * @returns Normalized webhook event, or null if event type is not supported
   */
  mapWebhookEvent(
    eventType: string,
    payload: unknown
  ): ProviderWebhookEvent | null;

  // ─────────────────────────────────────────────────────────────────────────────
  // Pull Request Operations (Optional)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a pull request by number.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param number - PR number
   * @param token - Access token
   * @returns Pull request info, or null if not found
   */
  getPullRequest?(
    owner: string,
    repo: string,
    number: number,
    token: string
  ): Promise<ProviderPullRequest | null>;

  /**
   * Create a comment on a pull request.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param number - PR number
   * @param body - Comment body (markdown)
   * @param token - Access token
   * @returns Comment ID
   */
  createPullRequestComment?(
    owner: string,
    repo: string,
    number: number,
    body: string,
    token: string
  ): Promise<string | number>;
}

/**
 * Error types that can occur during provider operations.
 */
export type GitProviderErrorType =
  | "authentication"
  | "not_found"
  | "rate_limit"
  | "permission"
  | "validation"
  | "network"
  | "unknown";

/**
 * Structured error for git provider operations.
 */
export class GitProviderError extends Error {
  public readonly type: GitProviderErrorType;
  public readonly provider: GitProviderId;

  constructor(
    message: string,
    type: GitProviderErrorType,
    provider: GitProviderId,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = "GitProviderError";
    this.type = type;
    this.provider = provider;
  }
}
