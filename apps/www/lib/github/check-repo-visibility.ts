import { createGitHubClient } from "./octokit";

type RepoVisibility = "public" | "private" | "unknown";

// Cache visibility checks to avoid exhausting unauthenticated rate limits (60/hour)
// Cache entries expire after 10 minutes
const visibilityCache = new Map<string, { visibility: RepoVisibility; expiry: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Checks if a GitHub repository is public or private.
 * Uses unauthenticated GitHub API request - if we can fetch the repo without auth, it's public.
 */
export async function checkRepoVisibility(
  owner: string,
  repo: string
): Promise<RepoVisibility> {
  const cacheKey = `${owner}/${repo}`.toLowerCase();

  // Check cache first
  const cached = visibilityCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    console.log(`[checkRepoVisibility] Using cached visibility for ${owner}/${repo}:`, cached.visibility);
    return cached.visibility;
  }

  try {
    // Use rotating tokens for visibility check to get higher rate limits
    // Authenticated: 5,000 req/hour per token (15,000 total with 3 tokens)
    // Unauthenticated: 60 req/hour per IP
    const octokit = createGitHubClient(undefined, { useTokenRotation: true });
    const response = await octokit.rest.repos.get({
      owner,
      repo,
    });

    // Check the 'private' field in the response
    const visibility: RepoVisibility = response.data.private ? "private" : "public";

    // Cache the result
    visibilityCache.set(cacheKey, {
      visibility,
      expiry: Date.now() + CACHE_TTL_MS,
    });

    return visibility;
  } catch (error: unknown) {
    // If we get a 404, the repo either doesn't exist or is private
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      error.status === 404
    ) {
      // We can't distinguish between private and non-existent without auth
      // So we return "unknown" - the caller should attempt authenticated request

      // Cache the "unknown" result to avoid repeated failed lookups
      visibilityCache.set(cacheKey, {
        visibility: "unknown",
        expiry: Date.now() + CACHE_TTL_MS,
      });

      return "unknown";
    }

    // For other errors, also return unknown (but don't cache these)
    console.error("[checkRepoVisibility] Error checking repo visibility:", error);
    return "unknown";
  }
}

/**
 * Checks if a repository is definitely public (accessible without authentication)
 */
export async function isRepoPublic(
  owner: string,
  repo: string
): Promise<boolean> {
  const visibility = await checkRepoVisibility(owner, repo);
  return visibility === "public";
}
