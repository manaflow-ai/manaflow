import { api } from "@cmux/convex/api";
import type { ConvexHttpClient } from "convex/browser";
import type { Octokit } from "octokit";

type ConvexClient = Pick<ConvexHttpClient, "mutation">;

type SyncPullRequestCommentsArgs = {
  convex: ConvexClient;
  octokit: Octokit;
  teamSlugOrId: string;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  repositoryId?: number;
};

export async function syncPullRequestComments({
  convex,
  octokit,
  teamSlugOrId,
  installationId,
  owner,
  repo,
  prNumber,
  repositoryId,
}: SyncPullRequestCommentsArgs) {
  const repoFullName = `${owner}/${repo}`;

  const [issueComments, reviewComments] = await Promise.all([
    octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    }),
    octokit.paginate(octokit.rest.pulls.listReviewComments, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    }),
  ]);

  for (const comment of issueComments) {
    await convex.mutation(api.github_pr_comments.upsertFromServer, {
      teamSlugOrId,
      installationId,
      repoFullName,
      repositoryId,
      prNumber,
      source: "issue",
      action: "synced",
      comment,
    });
  }

  for (const comment of reviewComments) {
    await convex.mutation(api.github_pr_comments.upsertFromServer, {
      teamSlugOrId,
      installationId,
      repoFullName,
      repositoryId,
      prNumber,
      source: "review",
      action: "synced",
      comment,
    });
  }

  return {
    issueComments: issueComments.length,
    reviewComments: reviewComments.length,
  };
}
