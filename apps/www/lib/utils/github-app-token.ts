import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import { githubPrivateKey } from "./githubPrivateKey";
import { env } from "./www-env";

interface GenerateInstallationTokenOptions {
  installationId: number;
  repositories?: string[];
  permissions?: {
    actions?: "read" | "write";
    checks?: "read" | "write";
    contents?: "read" | "write";
    deployments?: "read" | "write";
    issues?: "read" | "write";
    metadata?: "read";
    pull_requests?: "read" | "write";
    statuses?: "read" | "write";
  };
}

// Cache generated tokens to avoid rate limit exhaustion
// Tokens expire after 1 hour but we refresh 5 minutes early to be safe
const tokenCache = new Map<string, { token: string; expiry: number }>();

function getTokenCacheKey(installationId: number, permissions: GenerateInstallationTokenOptions["permissions"]): string {
  // Create a stable cache key based on installation ID and permissions
  // We don't include repositories in the key because tokens can access all repos in the installation
  return `${installationId}:${JSON.stringify(permissions)}`;
}

export async function generateGitHubInstallationToken({
  installationId,
  repositories,
  permissions = {
    contents: "write",
    metadata: "read",
  },
}: GenerateInstallationTokenOptions): Promise<string> {
  // Check cache first
  const cacheKey = getTokenCacheKey(installationId, permissions);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[GitHub App] Using cached token for installation ${installationId}`);
    return cached.token;
  }

  console.log(`[GitHub App] Generating token for installation ${installationId}`);
  console.log(`[GitHub App] Requested repositories:`, repositories);
  console.log(`[GitHub App] Requested permissions:`, permissions);
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.CMUX_GITHUB_APP_ID,
      privateKey: githubPrivateKey,
      installationId,
    },
  });

  const requestBody: {
    permissions: typeof permissions;
    repositories?: string[];
  } = {
    permissions,
  };

  if (repositories && repositories.length > 0) {
    const repoNames = repositories.map((repo) => {
      const parts = repo.split("/");
      return parts[parts.length - 1];
    });
    requestBody.repositories = repoNames;
    console.log(`[GitHub App] Repository names for token scope:`, repoNames);
  }

  try {
    console.log(`[GitHub App] Requesting token with body:`, JSON.stringify(requestBody, null, 2));

    const { data } = await octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
        ...requestBody,
      }
    );

    console.log(`[GitHub App] Successfully generated token with expiry: ${data.expires_at}`);
    console.log(`[GitHub App] Token has access to ${data.repositories?.length || "all"} repositories`);

    // Cache the token with expiry 5 minutes before actual expiry for safety
    const expiryTime = data.expires_at ? new Date(data.expires_at).getTime() - 5 * 60 * 1000 : Date.now() + 55 * 60 * 1000;
    tokenCache.set(cacheKey, {
      token: data.token,
      expiry: expiryTime,
    });

    return data.token;
  } catch (error) {
    console.error(`[GitHub App] Failed to generate token:`, error);
    if (error && typeof error === 'object' && 'status' in error) {
      const httpError = error as { status: number; response?: { data?: unknown } };
      console.error(`[GitHub App] Error status: ${httpError.status}`);
      console.error(`[GitHub App] Error response:`, httpError.response?.data);
    }
    throw error;
  }
}

// Cache installation lookups to avoid rate limit exhaustion
// Cache entries expire after 5 minutes
const installationCache = new Map<string, { value: number | null; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getInstallationForRepo(
  repository: string
): Promise<number | null> {
  // Extract owner and repo from repository (format: owner/repo)
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) return null;

  // Check cache first
  const cached = installationCache.get(repository);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[GitHub App] Using cached installation for ${repository}:`, cached.value ?? "none");
    return cached.value;
  }

  console.log(`[GitHub App] Looking for installation for repository: ${repository}`);

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.CMUX_GITHUB_APP_ID,
      privateKey: githubPrivateKey,
    },
  });

  try {
    // Get the installation for this specific repository
    const { data } = await octokit.request(
      "GET /repos/{owner}/{repo}/installation",
      { owner, repo }
    );

    console.log(`[GitHub App] Found installation ${data.id} for ${repository}`);
    console.log(`[GitHub App] Installation permissions:`, data.permissions);
    console.log(`[GitHub App] Installation events:`, data.events);

    // Cache the result
    installationCache.set(repository, {
      value: data.id,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    return data.id;
  } catch (error) {
    // 404 is expected when the app is not installed - not an error
    if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
      console.log(`[GitHub App] No installation found for ${repository} (app not installed or no access)`);

      // Cache the null result to avoid repeated lookups
      installationCache.set(repository, {
        value: null,
        expiry: Date.now() + CACHE_TTL_MS,
      });
    } else {
      console.error(`[GitHub App] Unexpected error checking installation for ${repository}:`, error);
    }
    return null;
  }
}