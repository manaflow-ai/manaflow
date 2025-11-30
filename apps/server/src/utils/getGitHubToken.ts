import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getAuthHeaderJson } from "./requestContext";
import { env, getWwwBaseUrl } from "./server-env";

const execAsync = promisify(exec);

/**
 * Get GitHub OAuth token from Stack Auth via the www API.
 * This uses the current user's connected GitHub account.
 */
async function getGitHubTokenFromStackAuth(): Promise<string | null> {
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
      console.error(`[getGitHubToken] Stack Auth API returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { accessToken: string | null; error: string | null };
    if (data.error) {
      console.warn(`[getGitHubToken] Stack Auth error: ${data.error}`);
      return null;
    }

    return data.accessToken;
  } catch (error) {
    console.error("[getGitHubToken] Failed to get token from Stack Auth:", error);
    return null;
  }
}

/**
 * Get GitHub token from local gh CLI.
 * Only used in non-web (Electron) mode.
 */
async function getGitHubTokenFromGhCli(): Promise<string | null> {
  try {
    const { stdout: ghToken } = await execAsync(
      "bash -lc 'gh auth token 2>/dev/null'"
    );
    if (ghToken.trim()) {
      return ghToken.trim();
    }
  } catch {
    // gh not available or not authenticated
  }
  return null;
}

export async function getGitHubTokenFromKeychain(): Promise<string | null> {
  // Always try Stack Auth first (works in both web and electron mode)
  const stackAuthToken = await getGitHubTokenFromStackAuth();
  if (stackAuthToken) {
    return stackAuthToken;
  }

  // In web mode, don't fall back to gh CLI (it won't be available)
  if (env.NEXT_PUBLIC_WEB_MODE) {
    return null;
  }

  // Fall back to gh CLI in non-web mode
  return getGitHubTokenFromGhCli();
}

export async function getGitCredentialsFromHost(): Promise<{
  username?: string;
  password?: string;
} | null> {
  const token = await getGitHubTokenFromKeychain();

  if (token) {
    // GitHub tokens use 'oauth' as username
    return {
      username: "oauth",
      password: token,
    };
  }

  return null;
}
