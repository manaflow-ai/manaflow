/**
 * Handles the GitHub OAuth + App installation flow.
 *
 * Problem: When a user clicks "Add repos from GitHub", we need to:
 * 1. Ensure GitHub OAuth is connected (for private repo access)
 * 2. Then open the GitHub App installation popup
 *
 * But OAuth requires a full page redirect, breaking the flow.
 *
 * Solution: Store the install intent in sessionStorage before OAuth redirect,
 * then check for it after returning and continue the flow.
 */

import { z } from "zod";

const GITHUB_APP_INSTALL_INTENT_KEY = "cmux_github_app_install_intent";

const GitHubAppInstallIntentSchema = z.object({
  action: z.literal("install-github-app"),
  teamSlugOrId: z.string(),
  timestamp: z.number(),
});

export type GitHubAppInstallIntent = z.infer<typeof GitHubAppInstallIntentSchema>;

/**
 * Store the intent to install GitHub App after OAuth completes.
 */
export function setGitHubAppInstallIntent(teamSlugOrId: string): void {
  try {
    const intent: GitHubAppInstallIntent = {
      action: "install-github-app",
      teamSlugOrId,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(GITHUB_APP_INSTALL_INTENT_KEY, JSON.stringify(intent));
  } catch (err) {
    console.error("[GitHubOAuthFlow] Failed to store install intent:", err);
  }
}

/**
 * Get and clear any pending GitHub App install intent.
 * Returns null if no intent or if intent is stale (> 5 minutes old).
 */
export function consumeGitHubAppInstallIntent(): GitHubAppInstallIntent | null {
  const intent = getGitHubAppInstallIntent();
  if (intent) {
    clearGitHubAppInstallIntent();
  }
  return intent;
}

/**
 * Check if there's a pending install intent without consuming it.
 */
export function hasGitHubAppInstallIntent(): boolean {
  try {
    return sessionStorage.getItem(GITHUB_APP_INSTALL_INTENT_KEY) !== null;
  } catch (err) {
    console.error("[GitHubOAuthFlow] Failed to check install intent:", err);
    return false;
  }
}

/**
 * Peek at the install intent without consuming it.
 * Returns null if no intent or if intent is stale (> 5 minutes old).
 * Use this to check if the intent matches before consuming.
 */
export function getGitHubAppInstallIntent(): GitHubAppInstallIntent | null {
  try {
    const raw = sessionStorage.getItem(GITHUB_APP_INSTALL_INTENT_KEY);
    if (!raw) return null;

    const parsed = GitHubAppInstallIntentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      sessionStorage.removeItem(GITHUB_APP_INSTALL_INTENT_KEY);
      return null;
    }

    const intent = parsed.data;

    // Ignore stale intents (> 5 minutes old)
    const MAX_AGE_MS = 5 * 60 * 1000;
    if (Date.now() - intent.timestamp > MAX_AGE_MS) {
      // Clean up stale intent
      sessionStorage.removeItem(GITHUB_APP_INSTALL_INTENT_KEY);
      return null;
    }

    return intent;
  } catch (err) {
    console.error("[GitHubOAuthFlow] Failed to get install intent:", err);
    return null;
  }
}

/**
 * Clear the install intent (use after successfully handling it).
 */
export function clearGitHubAppInstallIntent(): void {
  try {
    sessionStorage.removeItem(GITHUB_APP_INSTALL_INTENT_KEY);
  } catch (err) {
    console.error("[GitHubOAuthFlow] Failed to clear install intent:", err);
  }
}
