import { normalizeGitRef } from "@/lib/refWithOrigin";
import { gitDiffQueryOptions } from "@/queries/git-diff";
import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";

export async function preloadPullRequestDetail({
  queryClient,
  teamSlugOrId,
  owner,
  repo,
  number,
}: {
  queryClient: QueryClient;
  teamSlugOrId: string;
  owner: string;
  repo: string;
  number: string;
}) {
  await queryClient
    .ensureQueryData(
      convexQuery(api.github_prs.listPullRequests, {
        teamSlugOrId,
        state: "all",
      })
    )
    .then(async (prs) => {
      const key = `${owner}/${repo}`;
      const num = Number(number);
      const target = (prs || []).find(
        (p) => p.repoFullName === key && p.number === num
      );
      if (target?.repoFullName && target.baseRef && target.headRef) {
        await queryClient.ensureQueryData(
          gitDiffQueryOptions({
            repoFullName: target.repoFullName,
            baseRef: normalizeGitRef(target.baseRef),
            headRef: normalizeGitRef(target.headRef),
            teamSlugOrId,
          })
        );
      }
    });
}
