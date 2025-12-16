import { Octokit } from "octokit";

const USER_AGENT = "cmux-www-pr-viewer";

// Load GitHub tokens from environment variables
function loadGitHubTokensFromEnv(): string[] {
  return [
    process.env.GITHUB_TOKEN_1,
    process.env.GITHUB_TOKEN_2,
    process.env.GITHUB_TOKEN_3,
    process.env.GITHUB_TOKEN,
  ].filter((t): t is string => Boolean(t));
}

let currentTokenIndex = 0;

function getNextGitHubToken(): string | null {
  const tokens = loadGitHubTokensFromEnv();
  if (tokens.length === 0) {
    return null;
  }
  const token = tokens[currentTokenIndex % tokens.length];
  currentTokenIndex = (currentTokenIndex + 1) % tokens.length;
  return token;
}

export function createGitHubClient(
  authToken?: string | null,
  options?: { useTokenRotation?: boolean }
): Octokit {
  const useRotation = options?.useTokenRotation ?? false;

  let normalizedToken: string | null | undefined;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    // Explicit token provided
    normalizedToken = authToken;
  } else if (authToken === null) {
    // Explicitly no auth
    normalizedToken = undefined;
  } else if (useRotation) {
    // No explicit token, but rotation is enabled
    normalizedToken = getNextGitHubToken();
  } else {
    // No explicit token and rotation disabled - use single token or undefined
    normalizedToken = process.env.GITHUB_TOKEN || undefined;
  }

  return new Octokit({
    auth: normalizedToken,
    userAgent: USER_AGENT,
    request: {
      timeout: 20_000,
    },
  });
}
