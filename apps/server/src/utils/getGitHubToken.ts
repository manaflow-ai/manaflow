import { getAuthHeaderJson } from "./requestContext";
import { getWwwBaseUrl } from "./server-env";

/**
 * Get GitHub OAuth token from Stack Auth via the www API.
 * This uses the current user's connected GitHub account.
 */
export async function getGitHubOAuthToken(): Promise<string | null> {
  const authHeaderJson = getAuthHeaderJson();
  if (!authHeaderJson) {
    return null;
  }

  try {
    const baseUrl = getWwwBaseUrl();
    const response = await fetch(`${baseUrl}/api/integrations/github/oauth-token`, {
      method: "GET",
      headers: {
        "x-stack-auth": authHeaderJson,
      },
    });

    if (!response.ok) {
      console.error(`[getGitHubOAuthToken] Stack Auth API returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { accessToken: string | null; error: string | null };
    if (data.error) {
      console.warn(`[getGitHubOAuthToken] Stack Auth error: ${data.error}`);
      return null;
    }

    return data.accessToken;
  } catch (error) {
    console.error("[getGitHubOAuthToken] Failed to get token from Stack Auth:", error);
    return null;
  }
}

export async function getGitCredentials(): Promise<{
  username?: string;
  password?: string;
} | null> {
  const token = await getGitHubOAuthToken();

  if (token) {
    // GitHub tokens use 'oauth' as username
    return {
      username: "oauth",
      password: token,
    };
  }

  return null;
}
