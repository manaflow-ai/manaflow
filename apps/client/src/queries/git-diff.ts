import { env } from "@/client-env";
import { waitForConnectedSocket } from "@/contexts/socket/socket-boot";
import { normalizeGitRef } from "@/lib/refWithOrigin";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import { WWW_ORIGIN } from "@/lib/wwwOrigin";
import type { ReplaceDiffEntry } from "@cmux/shared";
import { queryOptions } from "@tanstack/react-query";

export interface GitDiffQuery {
  repoFullName?: string;
  repoUrl?: string;
  originPathOverride?: string;
  headRef: string;
  baseRef?: string;
  includeContents?: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
  /** Team slug or ID required for web mode API calls */
  teamSlugOrId?: string;
}

/**
 * Fetches git diff using the www API endpoint (for web mode).
 * This talks directly to GitHub API using the user's installation credentials.
 */
async function fetchGitDiffViaApi({
  repoFullName,
  headRef,
  baseRef,
  includeContents,
  maxBytes,
  teamSlugOrId,
}: {
  repoFullName: string;
  headRef: string;
  baseRef: string;
  includeContents: boolean;
  maxBytes?: number;
  teamSlugOrId: string;
}): Promise<ReplaceDiffEntry[]> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${repoFullName}`);
  }

  const user = await cachedGetUser(stackClientApp);
  if (!user) {
    throw new Error("User not authenticated");
  }
  const authHeaders = await user.getAuthHeaders();

  const params = new URLSearchParams({
    team: teamSlugOrId,
    owner,
    repo,
    base: baseRef,
    head: headRef,
    includeContents: includeContents ? "true" : "false",
  });
  if (maxBytes) {
    params.set("maxBytes", String(maxBytes));
  }

  const response = await fetch(
    `${WWW_ORIGIN}/api/integrations/github/compare?${params.toString()}`,
    {
      headers: {
        ...authHeaders,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch diff: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    diffs: ReplaceDiffEntry[];
    error: string | null;
  };

  if (data.error) {
    throw new Error(data.error);
  }

  return data.diffs;
}

/**
 * Fetches git diff using the socket connection (for local/non-web mode).
 */
async function fetchGitDiffViaSocket({
  repoFullName,
  repoUrl,
  originPathOverride,
  headRef,
  baseRef,
  includeContents,
  maxBytes,
  lastKnownBaseSha,
  lastKnownMergeCommitSha,
}: {
  repoFullName?: string;
  repoUrl?: string;
  originPathOverride?: string;
  headRef: string;
  baseRef?: string;
  includeContents: boolean;
  maxBytes?: number;
  lastKnownBaseSha?: string;
  lastKnownMergeCommitSha?: string;
}): Promise<ReplaceDiffEntry[]> {
  const socket = await waitForConnectedSocket();
  return await new Promise<ReplaceDiffEntry[]>((resolve, reject) => {
    socket.emit(
      "git-diff",
      {
        repoFullName,
        repoUrl,
        originPathOverride,
        headRef,
        baseRef: baseRef || undefined,
        includeContents,
        maxBytes,
        lastKnownBaseSha,
        lastKnownMergeCommitSha,
      },
      (
        resp:
          | { ok: true; diffs: ReplaceDiffEntry[] }
          | { ok: false; error: string; diffs?: [] }
      ) => {
        if (resp.ok) {
          resolve(resp.diffs);
        } else {
          reject(new Error(resp.error || "Failed to load repository diffs"));
        }
      }
    );
  });
}

export function gitDiffQueryOptions({
  repoFullName,
  repoUrl,
  originPathOverride,
  headRef,
  baseRef,
  includeContents = true,
  maxBytes,
  lastKnownBaseSha,
  lastKnownMergeCommitSha,
  teamSlugOrId,
}: GitDiffQuery) {
  const repoKey = repoFullName ?? repoUrl ?? originPathOverride ?? "";

  const canonicalHeadRef = normalizeGitRef(headRef) || headRef?.trim() || "";
  const canonicalBaseRef = normalizeGitRef(baseRef) || baseRef?.trim() || "";

  // In web mode, we need teamSlugOrId and repoFullName
  const canUseWebMode =
    env.NEXT_PUBLIC_WEB_MODE && Boolean(teamSlugOrId) && Boolean(repoFullName);

  return queryOptions({
    queryKey: [
      "git-diff",
      repoKey,
      canonicalHeadRef,
      canonicalBaseRef,
      includeContents ? "with-contents" : "no-contents",
      maxBytes ?? "",
      lastKnownBaseSha ?? "",
      lastKnownMergeCommitSha ?? "",
      teamSlugOrId ?? "",
    ],
    queryFn: async () => {
      // In web mode with proper params, use the www API endpoint
      if (canUseWebMode && repoFullName && canonicalBaseRef) {
        return fetchGitDiffViaApi({
          repoFullName,
          headRef: canonicalHeadRef,
          baseRef: canonicalBaseRef,
          includeContents,
          maxBytes,
          teamSlugOrId: teamSlugOrId!,
        });
      }

      // Otherwise use the socket-based approach (local mode)
      return fetchGitDiffViaSocket({
        repoFullName,
        repoUrl,
        originPathOverride,
        headRef: canonicalHeadRef,
        baseRef: canonicalBaseRef || undefined,
        includeContents,
        maxBytes,
        lastKnownBaseSha,
        lastKnownMergeCommitSha,
      });
    },
    staleTime: 10_000,
    enabled: Boolean(canonicalHeadRef) && Boolean(repoKey.trim()),
  });
}
