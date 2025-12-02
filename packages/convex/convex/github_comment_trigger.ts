"use node";

import { v } from "convex/values";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { internalAction } from "./_generated/server";

type PrDetails = {
  prUrl: string;
  headSha: string;
  baseSha: string | undefined;
  headRef: string | undefined;
  headRepoFullName: string | undefined;
  headRepoCloneUrl: string | undefined;
};

type GitHubPrResponse = {
  html_url?: string;
  head?: {
    sha?: string;
    ref?: string;
    repo?: {
      full_name?: string;
      clone_url?: string;
    };
  };
  base?: {
    sha?: string;
  };
};

export const fetchPrDetails = internalAction({
  args: {
    installationId: v.number(),
    repoFullName: v.string(),
    prNumber: v.number(),
  },
  handler: async (_ctx, args): Promise<PrDetails | null> => {
    const accessToken = await fetchInstallationAccessToken(args.installationId);
    if (!accessToken) {
      console.error("[github_comment_trigger] Failed to get access token", {
        installationId: args.installationId,
      });
      return null;
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${args.repoFullName}/pulls/${args.prNumber}`,
        {
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "cmux-github-app",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[github_comment_trigger] Failed to fetch PR details", {
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const data = (await response.json()) as GitHubPrResponse;

      const prUrl = data.html_url;
      const headSha = data.head?.sha;

      if (!prUrl || !headSha) {
        console.error("[github_comment_trigger] Missing required PR data", {
          repoFullName: args.repoFullName,
          prNumber: args.prNumber,
          hasPrUrl: !!prUrl,
          hasHeadSha: !!headSha,
        });
        return null;
      }

      return {
        prUrl,
        headSha,
        baseSha: data.base?.sha ?? undefined,
        headRef: data.head?.ref ?? undefined,
        headRepoFullName: data.head?.repo?.full_name ?? undefined,
        headRepoCloneUrl: data.head?.repo?.clone_url ?? undefined,
      };
    } catch (error) {
      console.error("[github_comment_trigger] Unexpected error fetching PR details", {
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        error,
      });
      return null;
    }
  },
});
