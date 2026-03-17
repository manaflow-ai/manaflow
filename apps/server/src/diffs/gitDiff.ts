import type { ReplaceDiffEntry } from "@cmux/shared/diff-types";

import { gitDiff as nativeGitDiff } from "../native/git";
import { getGitHubOAuthToken } from "../utils/getGitHubToken";
import { serverLogger } from "../utils/fileLogger";

export interface GitDiffRequest {
  headRef: string;
  baseRef?: string;
  repoFullName?: string;
  repoUrl?: string;
  teamSlugOrId?: string;
  originPathOverride?: string;
  includeContents?: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
}

/**
 * Construct an authenticated GitHub URL by embedding the OAuth token.
 * This allows the native git operations to access private repositories.
 */
function buildAuthenticatedGitHubUrl(
  repoFullName: string,
  token: string
): string {
  return `https://oauth:${token}@github.com/${repoFullName}.git`;
}

export async function getGitDiff(
  request: GitDiffRequest
): Promise<ReplaceDiffEntry[]> {
  const headRef = request.headRef.trim();
  if (!headRef) {
    return [];
  }

  const baseRef = request.baseRef?.trim();

  // Determine the final repoUrl to use
  let effectiveRepoUrl = request.repoUrl;
  let effectiveRepoFullName = request.repoFullName;

  // If we have repoFullName but no originPathOverride or explicit repoUrl,
  // try to inject GitHub OAuth credentials for private repo access.
  // This is especially important in web mode where repos need to be cloned.
  if (
    request.repoFullName &&
    !request.originPathOverride &&
    !request.repoUrl
  ) {
    try {
      const token = await getGitHubOAuthToken();
      if (token) {
        effectiveRepoUrl = buildAuthenticatedGitHubUrl(
          request.repoFullName,
          token
        );
        // Clear repoFullName since we're using repoUrl with embedded credentials
        effectiveRepoFullName = undefined;
      }
    } catch (error) {
      // Non-fatal: if token fetch fails, fall back to unauthenticated access
      // This will work for public repos
      serverLogger.warn(
        `[getGitDiff] Failed to get GitHub OAuth token for ${request.repoFullName}: ${String(error)}`
      );
    }
  }

  return await nativeGitDiff({
    headRef,
    baseRef: baseRef ? baseRef : undefined,
    repoFullName: effectiveRepoFullName,
    repoUrl: effectiveRepoUrl,
    teamSlugOrId: request.teamSlugOrId,
    originPathOverride: request.originPathOverride,
    includeContents: request.includeContents,
    maxBytes: request.maxBytes,
    lastKnownBaseSha: request.lastKnownBaseSha,
    lastKnownMergeCommitSha: request.lastKnownMergeCommitSha,
  });
}
