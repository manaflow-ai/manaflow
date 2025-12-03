/**
 * GitHub Provider Implementation
 *
 * Reference implementation of the GitProvider interface for GitHub.com
 * and GitHub Enterprise.
 *
 * ## Authentication Flow
 *
 * GitHub uses a multi-step authentication process for GitHub Apps:
 * 1. Create a JWT signed with the app's private key
 * 2. Exchange JWT for an installation access token
 * 3. Use installation token for API calls (scoped to installation)
 *
 * ## Supported URL Formats
 *
 * - Simple: owner/repo
 * - HTTPS: https://github.com/owner/repo
 * - SSH: git@github.com:owner/repo.git
 *
 * ## Webhook Events
 *
 * Supports all major GitHub webhook events:
 * - installation, installation_repositories
 * - push, pull_request
 * - workflow_run, workflow_job
 * - check_run, check_suite
 * - deployment, deployment_status
 * - status (commit status)
 */

import type {
  GitProvider,
  GitProviderId,
  ParsedRepo,
  ProviderAppConfig,
  ProviderToken,
  ProviderRepository,
  ProviderPullRequest,
  ProviderWebhookEvent,
  WebhookEventType,
  WebhookRequest,
  WebhookVerificationResult,
  OwnerType,
} from "../types.js";
import { GitProviderError } from "../types.js";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * GitHub webhook event to normalized event type mapping.
 */
const GITHUB_EVENT_MAP: Record<string, WebhookEventType | undefined> = {
  installation: "installation",
  installation_repositories: "installation_repositories",
  push: "push",
  pull_request: "pull_request",
  workflow_run: "workflow_run",
  workflow_job: "workflow_job",
  check_run: "check_run",
  check_suite: "check_suite",
  deployment: "deployment",
  deployment_status: "deployment_status",
  status: "commit_status",
};

/**
 * GitHub provider implementation.
 */
export const githubProvider: GitProvider = {
  id: "github" as GitProviderId,
  displayName: "GitHub",
  domain: "github.com",

  // ─────────────────────────────────────────────────────────────────────────────
  // URL Parsing
  // ─────────────────────────────────────────────────────────────────────────────

  parseRepoUrl(input: string): ParsedRepo | null {
    if (!input) {
      return null;
    }

    const trimmed = input.trim();

    // Try matching against different patterns
    // Simple: owner/repo
    const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    // HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git
    const httpsMatch = trimmed.match(
      /^https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:\/)?$/i
    );
    // SSH: git@github.com:owner/repo.git
    const sshMatch = trimmed.match(
      /^git@github\.com:([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i
    );

    const match = simpleMatch || httpsMatch || sshMatch;
    if (!match) {
      return null;
    }

    const [, owner, repo] = match;
    if (!owner || !repo) {
      return null;
    }

    const cleanRepo = repo.replace(/\.git$/, "");
    return {
      owner,
      name: cleanRepo,
      fullName: `${owner}/${cleanRepo}`,
      url: this.buildRepoUrl(owner, cleanRepo),
      gitUrl: this.buildGitUrl(owner, cleanRepo),
      provider: "github",
    };
  },

  buildRepoUrl(owner: string, name: string): string {
    return `https://github.com/${owner}/${name}`;
  },

  buildGitUrl(owner: string, name: string): string {
    return `https://github.com/${owner}/${name}.git`;
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Authentication
  // ─────────────────────────────────────────────────────────────────────────────

  async createAppToken(config: ProviderAppConfig): Promise<string | null> {
    // GitHub App JWT creation
    // JWT is signed with the app's private key and has a 10-minute expiry
    //
    // Implementation note: This requires crypto operations that may need
    // to be implemented differently in browser vs Node.js environments.
    // The actual JWT signing is done in the consuming code (www, server)
    // using their crypto implementations.
    //
    // The JWT claims are:
    // - iss: GitHub App ID
    // - iat: Current time - 60 seconds (clock drift buffer)
    // - exp: Current time + 10 minutes
    // - alg: RS256

    // For now, this method documents the pattern but actual implementation
    // lives in environment-specific code (www/lib/utils/github-app-token.ts)
    throw new GitProviderError(
      "createAppToken should be called on environment-specific implementation",
      "validation",
      "github"
    );
  },

  async fetchInstallationToken(
    installationId: string | number,
    config: ProviderAppConfig,
    permissions?: Record<string, string>
  ): Promise<ProviderToken | null> {
    // This method creates an installation access token by:
    // 1. Creating a JWT using createAppToken
    // 2. POSTing to /app/installations/{id}/access_tokens
    // 3. Returning the token with expiry info
    //
    // Implementation note: Like createAppToken, the actual implementation
    // lives in environment-specific code that has access to crypto APIs.

    throw new GitProviderError(
      "fetchInstallationToken should be called on environment-specific implementation",
      "validation",
      "github"
    );
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Repository Discovery
  // ─────────────────────────────────────────────────────────────────────────────

  async *listRepositories(
    installationId: string | number,
    token: string
  ): AsyncIterable<ProviderRepository[]> {
    // Paginate through installation repositories
    // GET /installation/repositories
    let page = 1;
    const perPage = 100;

    while (true) {
      const response = await fetch(
        `${GITHUB_API_BASE}/installation/repositories?per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!response.ok) {
        throw new GitProviderError(
          `Failed to list repositories: ${response.status} ${response.statusText}`,
          response.status === 401 ? "authentication" : "unknown",
          "github"
        );
      }

      const data = (await response.json()) as {
        repositories: Array<{
          id: number;
          full_name: string;
          name: string;
          owner: {
            login: string;
            type: string;
          };
          html_url: string;
          private: boolean;
          default_branch: string;
          pushed_at: string | null;
        }>;
        total_count: number;
      };

      if (data.repositories.length === 0) {
        break;
      }

      const repos: ProviderRepository[] = data.repositories.map((repo) => ({
        id: repo.id,
        fullName: repo.full_name,
        owner: repo.owner.login,
        ownerType: mapGitHubOwnerType(repo.owner.type),
        name: repo.name,
        url: repo.html_url,
        isPrivate: repo.private,
        defaultBranch: repo.default_branch,
        lastPushedAt: repo.pushed_at ? new Date(repo.pushed_at).getTime() : undefined,
      }));

      yield repos;

      if (data.repositories.length < perPage) {
        break;
      }

      page++;
    }
  },

  async getRepository(
    owner: string,
    name: string,
    token: string
  ): Promise<ProviderRepository | null> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${name}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new GitProviderError(
        `Failed to get repository: ${response.status} ${response.statusText}`,
        response.status === 401 ? "authentication" : "unknown",
        "github"
      );
    }

    const repo = (await response.json()) as {
      id: number;
      full_name: string;
      name: string;
      owner: {
        login: string;
        type: string;
      };
      html_url: string;
      private: boolean;
      default_branch: string;
      pushed_at: string | null;
    };

    return {
      id: repo.id,
      fullName: repo.full_name,
      owner: repo.owner.login,
      ownerType: mapGitHubOwnerType(repo.owner.type),
      name: repo.name,
      url: repo.html_url,
      isPrivate: repo.private,
      defaultBranch: repo.default_branch,
      lastPushedAt: repo.pushed_at ? new Date(repo.pushed_at).getTime() : undefined,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Webhook Handling
  // ─────────────────────────────────────────────────────────────────────────────

  async verifyWebhookSignature(
    request: WebhookRequest,
    secret: string
  ): Promise<WebhookVerificationResult> {
    const signature = request.headers["x-hub-signature-256"];

    if (!signature) {
      return {
        isValid: false,
        error: "Missing x-hub-signature-256 header",
      };
    }

    // Verify HMAC-SHA256 signature
    // signature format: sha256=<hex>
    const expectedPrefix = "sha256=";
    if (!signature.startsWith(expectedPrefix)) {
      return {
        isValid: false,
        error: "Invalid signature format",
      };
    }

    const providedSignature = signature.slice(expectedPrefix.length);

    // Use crypto.subtle for HMAC-SHA256
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(request.body);

    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", key, messageData);
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison
    if (providedSignature.length !== expectedSignature.length) {
      return {
        isValid: false,
        error: "Signature mismatch",
      };
    }

    let mismatch = 0;
    for (let i = 0; i < providedSignature.length; i++) {
      mismatch |= providedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }

    if (mismatch !== 0) {
      return {
        isValid: false,
        error: "Signature mismatch",
      };
    }

    return { isValid: true };
  },

  getWebhookEventType(headers: Record<string, string | undefined>): string | null {
    return headers["x-github-event"] ?? null;
  },

  mapWebhookEvent(eventType: string, payload: unknown): ProviderWebhookEvent | null {
    const normalizedType = GITHUB_EVENT_MAP[eventType];
    if (!normalizedType) {
      return null;
    }

    // Type assertion - we trust the webhook payload structure
    const p = payload as Record<string, unknown>;

    // Extract common fields
    const action = typeof p.action === "string" ? p.action : undefined;
    const installationId = (p.installation as { id?: number } | undefined)?.id ?? 0;

    // Extract repository info if present
    const repoPayload = p.repository as {
      id?: number;
      full_name?: string;
      name?: string;
      owner?: { login?: string };
    } | undefined;

    const repository = repoPayload
      ? {
          id: repoPayload.id ?? 0,
          fullName: repoPayload.full_name ?? "",
          name: repoPayload.name ?? "",
          owner: repoPayload.owner?.login ?? "",
        }
      : undefined;

    return {
      type: normalizedType,
      action,
      provider: "github",
      installationId,
      repository,
      deliveryId: undefined, // Set from headers in the handler
      rawPayload: payload,
    };
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Pull Request Operations
  // ─────────────────────────────────────────────────────────────────────────────

  async getPullRequest(
    owner: string,
    repo: string,
    number: number,
    token: string
  ): Promise<ProviderPullRequest | null> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${number}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new GitProviderError(
        `Failed to get pull request: ${response.status} ${response.statusText}`,
        response.status === 401 ? "authentication" : "unknown",
        "github"
      );
    }

    const pr = (await response.json()) as {
      number: number;
      title: string;
      state: string;
      html_url: string;
      head: { ref: string; sha: string };
      base: { ref: string };
      user: { login: string };
      draft: boolean;
      created_at: string;
      updated_at: string;
      merged_at: string | null;
    };

    return {
      number: pr.number,
      title: pr.title,
      state: mapGitHubPrState(pr.state, pr.merged_at),
      url: pr.html_url,
      headRef: pr.head.ref,
      baseRef: pr.base.ref,
      author: pr.user.login,
      isDraft: pr.draft,
      headSha: pr.head.sha,
      createdAt: new Date(pr.created_at).getTime(),
      updatedAt: new Date(pr.updated_at).getTime(),
      mergedAt: pr.merged_at ? new Date(pr.merged_at).getTime() : undefined,
    };
  },

  async createPullRequestComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
    token: string
  ): Promise<string | number> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${number}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!response.ok) {
      throw new GitProviderError(
        `Failed to create comment: ${response.status} ${response.statusText}`,
        response.status === 401 ? "authentication" : "unknown",
        "github"
      );
    }

    const comment = (await response.json()) as { id: number };
    return comment.id;
  },
};

/**
 * Map GitHub owner type to normalized type.
 */
function mapGitHubOwnerType(type: string): OwnerType {
  return type === "Organization" ? "organization" : "user";
}

/**
 * Map GitHub PR state to normalized state.
 */
function mapGitHubPrState(
  state: string,
  mergedAt: string | null
): "open" | "closed" | "merged" {
  if (mergedAt) {
    return "merged";
  }
  return state === "open" ? "open" : "closed";
}
