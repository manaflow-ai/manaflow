import { Suspense, use } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { waitUntil } from "@vercel/functions";
import { type Team } from "@stackframe/stack";
import type { ModelConfig } from "@/lib/services/code-review/run-simple-anthropic-review";

import {
  DiffViewerSkeleton,
  ErrorPanel,
  ReviewChangeSummary,
  ReviewDiffContent,
  ReviewGitHubLinkButton,
  summarizeFiles,
} from "../../../_components/review-diff-content";
import {
  fetchComparison,
  toGithubFileChange,
  type GithubComparison,
  type GithubFileChange,
} from "@/lib/github/fetch-pull-request";
import { isGithubApiError } from "@/lib/github/errors";
import { cn } from "@/lib/utils";
import { stackServerApp } from "@/lib/utils/stack";
import {
  getConvexHttpActionBaseUrl,
  startCodeReviewJob,
} from "@/lib/services/code-review/start-code-review";
import { buildComparisonJobDetails } from "@/lib/services/code-review/comparison";
import type { ComparisonJobDetails } from "@/lib/services/code-review/comparison";
import { trackRepoPageView } from "@/lib/analytics/track-repo-page-view";
import { parseModelConfigFromRecord } from "@/lib/services/code-review/model-config";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  comparison: string;
  segments?: string[];
};

type PageProps = {
  params: Promise<PageParams>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export const dynamic = "force-dynamic";

async function getFirstTeam(): Promise<Team | null> {
  const teams = await stackServerApp.listTeams();
  const firstTeam = teams[0];
  if (!firstTeam) {
    return null;
  }
  return firstTeam;
}

function parseComparisonSlug(
  raw: string
): { base: string; head: string } | null {
  const tripleSplit = raw.split("...");
  if (tripleSplit.length === 2) {
    const [base, head] = tripleSplit;
    if (base && head) {
      return { base, head };
    }
  }

  const doubleSplit = raw.split("..");
  if (doubleSplit.length === 2) {
    const [base, head] = doubleSplit;
    if (base && head) {
      return { base, head };
    }
  }

  return null;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const selectedTeam = user.selectedTeam || (await getFirstTeam());
  if (!selectedTeam) {
    throw notFound();
  }

  const {
    teamSlugOrId: githubOwner,
    repo,
    comparison,
    segments = [],
  } = await params;
  const comparisonSlug = [comparison, ...segments].filter(Boolean).join("/");
  const refs = parseComparisonSlug(comparisonSlug);

  if (!refs) {
    return {
      title: `Invalid comparison • ${githubOwner}/${repo}`,
    };
  }

  try {
    const data = await fetchComparison(githubOwner, repo, refs.base, refs.head);
    const title = `Compare ${refs.base}…${refs.head} · ${githubOwner}/${repo}`;
    const description = `${data.total_commits} commit${
      data.total_commits === 1 ? "" : "s"
    } between ${refs.base} and ${refs.head}`;

    return {
      title,
      description,
    };
  } catch (error) {
    if (isGithubApiError(error) && error.status === 404) {
      return {
        title: `${githubOwner}/${repo} · ${refs.base}…${refs.head}`,
      };
    }

    throw error;
  }
}

export default async function ComparisonPage({ params, searchParams }: PageProps) {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const selectedTeam = user.selectedTeam || (await getFirstTeam());
  if (!selectedTeam) {
    throw notFound();
  }

  const [resolvedParams, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const {
    teamSlugOrId: githubOwner,
    repo,
    comparison,
    segments = [],
  } = resolvedParams;
  const modelConfig = parseModelConfigFromRecord(resolvedSearchParams);

  const comparisonSlug = [comparison, ...segments].filter(Boolean).join("/");
  const refs = parseComparisonSlug(comparisonSlug);
  if (!refs) {
    notFound();
  }

  const comparisonDetails = buildComparisonJobDetails({
    repoOwner: githubOwner,
    repoName: repo,
    baseRef: refs.base,
    headRef: refs.head,
  });

  const comparisonPromise = fetchComparison(
    githubOwner,
    repo,
    refs.base,
    refs.head
  );
  const comparisonFilesPromise: Promise<GithubFileChange[]> = comparisonPromise
    .then((data) => data.files ?? [])
    .then((files) => files.map(toGithubFileChange));

  scheduleComparisonCodeReviewStart({
    teamSlugOrId: selectedTeam.id,
    comparisonPromise,
    comparisonDetails,
    modelConfig,
  });

  waitUntil(
    trackRepoPageView({
      repo: `${githubOwner}/${repo}`,
      pageType: "comparison",
      comparison: comparisonSlug,
      userId: user.id,
    })
  );

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <div className="flex w-full flex-col gap-8 px-6 pb-16 pt-10 sm:px-8 lg:px-12">
        <Suspense fallback={<ComparisonHeaderSkeleton />}>
          <ComparisonHeader
            promise={comparisonPromise}
            filesPromise={comparisonFilesPromise}
            githubOwner={githubOwner}
            repo={repo}
            baseRef={refs.base}
            headRef={refs.head}
          />
        </Suspense>

        <Suspense fallback={<DiffViewerSkeleton />}>
          <ComparisonDiffSection
            filesPromise={comparisonFilesPromise}
            comparisonPromise={comparisonPromise}
            githubOwner={githubOwner}
            repo={repo}
            teamSlugOrId={selectedTeam.id}
            comparisonDetails={comparisonDetails}
          />
        </Suspense>
      </div>
    </div>
  );
}

type ComparisonPromise = ReturnType<typeof fetchComparison>;
type ComparisonFilesPromise = Promise<GithubFileChange[]>;

function ComparisonHeader({
  promise,
  filesPromise,
  githubOwner,
  repo,
  baseRef,
  headRef,
}: {
  promise: ComparisonPromise;
  filesPromise: ComparisonFilesPromise;
  githubOwner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}) {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- use() in try/catch is valid for RSC error handling
    const comparison = use(promise);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const files = use(filesPromise);
    const totals = summarizeFiles(files);
    return (
      <ComparisonHeaderContent
        comparison={comparison}
        totals={totals}
        githubOwner={githubOwner}
        repo={repo}
        baseRef={baseRef}
        headRef={headRef}
      />
    );
  } catch (error) {
    if (isGithubApiError(error)) {
      const message =
        error.status === 404
          ? "This comparison could not be found or you might not have access to view it."
          : error.message;

      return (
        <ErrorPanel
          title="Unable to load comparison"
          message={message}
          documentationUrl={error.documentationUrl}
        />
      );
    }

    throw error;
  }
}

function ComparisonHeaderContent({
  comparison,
  totals,
  githubOwner,
  repo,
  baseRef,
  headRef,
}: {
  comparison: GithubComparison;
  totals: {
    fileCount: number;
    additions: number;
    deletions: number;
  };
  githubOwner: string;
  repo: string;
  baseRef: string;
  headRef: string;
}) {
  const statusBadge = getComparisonStatusBadge(comparison);
  const commits = comparison.commits ?? [];
  const headCommit = commits.length > 0 ? commits[commits.length - 1] : null;
  const updatedAtSource =
    headCommit?.commit?.committer?.date ??
    headCommit?.commit?.author?.date ??
    null;
  const updatedAtLabel = updatedAtSource
    ? formatRelativeTimeFromNow(new Date(updatedAtSource))
    : null;
  const repoFullName = `${githubOwner}/${repo}`;

  return (
    <section className="border border-neutral-200 bg-white px-5 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ComparisonStatusBadge
              label={statusBadge.label}
              className={statusBadge.className}
            />
            <span className="font-mono text-neutral-500">{repoFullName}</span>
          </div>

          <h1 className="mt-2 text-xl font-semibold leading-tight text-neutral-900">
            Comparing {baseRef} ↔ {headRef}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            <span>
              {comparison.total_commits} commit
              {comparison.total_commits === 1 ? "" : "s"}
            </span>
            {comparison.ahead_by || comparison.behind_by ? (
              <>
                <span className="text-neutral-400">•</span>
                <span>
                  {comparison.ahead_by ? `${comparison.ahead_by} ahead` : null}
                  {comparison.ahead_by && comparison.behind_by ? ", " : ""}
                  {comparison.behind_by
                    ? `${comparison.behind_by} behind`
                    : null}
                </span>
              </>
            ) : null}
            {updatedAtLabel ? (
              <>
                <span className="text-neutral-400">•</span>
                <span>Updated {updatedAtLabel}</span>
              </>
            ) : null}
          </div>
        </div>

        <aside className="flex flex-wrap items-center gap-3 text-xs">
          <ReviewChangeSummary
            changedFiles={totals.fileCount}
            additions={totals.additions}
            deletions={totals.deletions}
          />
          {comparison.html_url ? (
            <ReviewGitHubLinkButton href={comparison.html_url} />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function ComparisonStatusBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={cn(
        "px-2 py-0.5 font-semibold uppercase tracking-wide",
        className
      )}
    >
      {label}
    </span>
  );
}

function ComparisonDiffSection({
  filesPromise,
  comparisonPromise,
  githubOwner,
  repo,
  teamSlugOrId,
  comparisonDetails,
}: {
  filesPromise: ComparisonFilesPromise;
  comparisonPromise: ComparisonPromise;
  githubOwner: string;
  repo: string;
  teamSlugOrId: string;
  comparisonDetails: ComparisonJobDetails;
}) {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- use() in try/catch is valid for RSC error handling
    const files = use(filesPromise);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const comparison = use(comparisonPromise);
    const repoFullName = `${githubOwner}/${repo}`;
    const commits = comparison.commits ?? [];
    const headCommit = commits.length > 0 ? commits[commits.length - 1] : null;
    const commitRef = headCommit?.sha ?? undefined;
    const baseCommitRef =
      comparison.base_commit?.sha ??
      comparison.merge_base_commit?.sha ??
      undefined;

    if (!commitRef || !baseCommitRef) {
      console.warn("[code-review] Comparison diff missing commit refs", {
        repoFullName,
        slug: comparisonDetails.slug,
        commitRefPresent: Boolean(commitRef),
        baseCommitRefPresent: Boolean(baseCommitRef),
      });
    }

    return (
      <ReviewDiffContent
        files={files}
        teamSlugOrId={teamSlugOrId}
        repoFullName={repoFullName}
        reviewTarget={{ type: "comparison", slug: comparisonDetails.slug }}
        commitRef={commitRef}
        baseCommitRef={baseCommitRef}
      />
    );
  } catch (error) {
    if (isGithubApiError(error)) {
      const message =
        error.status === 404
          ? "File changes for this comparison could not be retrieved. The repository or refs may be private or missing."
          : error.message;

      return (
        <ErrorPanel
          title="Unable to load comparison files"
          message={message}
          documentationUrl={error.documentationUrl}
        />
      );
    }

    throw error;
  }
}

function scheduleComparisonCodeReviewStart({
  teamSlugOrId,
  comparisonPromise,
  comparisonDetails,
  modelConfig,
}: {
  teamSlugOrId: string;
  comparisonPromise: ComparisonPromise;
  comparisonDetails: ComparisonJobDetails;
  modelConfig?: ModelConfig;
}): void {
  waitUntil(
    (async () => {
      try {
        const comparison = await comparisonPromise;
        const commits = comparison.commits ?? [];
        const headCommit =
          commits.length > 0 ? commits[commits.length - 1] : null;
        const commitRef = headCommit?.sha ?? undefined;
        const baseCommitRef =
          comparison.base_commit?.sha ??
          comparison.merge_base_commit?.sha ??
          undefined;

        const callbackBaseUrl = getConvexHttpActionBaseUrl();
        if (!callbackBaseUrl) {
          console.error(
            "[code-review] Convex HTTP base URL is not configured for compare view"
          );
          return;
        }

        const user = await stackServerApp.getUser({ or: "return-null" });
        if (!user) {
          return;
        }

        const [{ accessToken }, githubAccount] = await Promise.all([
          user.getAuthJson(),
          user.getConnectedAccount("github"),
        ]);
        if (!accessToken) {
          return;
        }

        let githubAccessToken: string | null = null;
        if (!githubAccount) {
          console.warn(
            "[code-review] GitHub account not connected, proceeding without token"
          );
        } else {
          const tokenResult = await githubAccount.getAccessToken();
          githubAccessToken = tokenResult.accessToken ?? null;
          if (!githubAccessToken) {
            console.warn(
              "[code-review] GitHub access token unavailable, proceeding without token"
            );
          }
        }

        const githubLink =
          comparison.html_url ??
          comparison.permalink_url ??
          comparisonDetails.compareUrl;

        if (!commitRef || !baseCommitRef) {
          console.error(
            "[code-review] Comparison start missing commit refs; skipping",
            {
              repoFullName: comparisonDetails.repoFullName,
              comparisonSlug: comparisonDetails.slug,
              commitRefPresent: Boolean(commitRef),
              baseCommitRefPresent: Boolean(baseCommitRef),
            }
          );
          return;
        }

        const { backgroundTask } = await startCodeReviewJob({
          accessToken,
          githubAccessToken,
          callbackBaseUrl,
          payload: {
            teamSlugOrId,
            githubLink,
            commitRef,
            headCommitRef: commitRef,
            baseCommitRef,
            force: false,
            comparison: {
              slug: comparisonDetails.slug,
              base: comparisonDetails.base,
              head: comparisonDetails.head,
            },
            modelConfig,
          },
        });

        if (backgroundTask) {
          await backgroundTask;
        }
      } catch (error) {
        console.error(
          "[code-review] Skipping auto-start due to comparison fetch error",
          {
            teamSlugOrId,
            repoFullName: comparisonDetails.repoFullName,
            comparisonSlug: comparisonDetails.slug,
          },
          error
        );
      }
    })()
  );
}

function ComparisonHeaderSkeleton() {
  return (
    <div className="border border-neutral-200 bg-white p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-32 bg-neutral-200" />
        <div className="h-8 w-3/4 bg-neutral-200" />
        <div className="h-4 w-1/2 bg-neutral-200" />
        <div className="h-4 w-full bg-neutral-200" />
      </div>
    </div>
  );
}

function getComparisonStatusBadge(comparison: GithubComparison): {
  label: string;
  className: string;
} {
  switch (comparison.status) {
    case "identical":
      return {
        label: "Identical",
        className: "bg-neutral-200 text-neutral-700",
      };
    case "ahead":
      return { label: "Ahead", className: "bg-emerald-100 text-emerald-700" };
    case "behind":
      return { label: "Behind", className: "bg-amber-100 text-amber-700" };
    case "diverged":
      return { label: "Diverged", className: "bg-purple-100 text-purple-700" };
    default:
      return { label: "Unknown", className: "bg-neutral-200 text-neutral-700" };
  }
}

function formatRelativeTimeFromNow(date: Date): string {
  const now = Date.now();
  const diffInSeconds = Math.round((now - date.getTime()) / 1000);

  const segments: {
    threshold: number;
    divisor: number;
    unit: Intl.RelativeTimeFormatUnit;
  }[] = [
    { threshold: 45, divisor: 1, unit: "second" },
    { threshold: 2700, divisor: 60, unit: "minute" },
    { threshold: 64_800, divisor: 3600, unit: "hour" },
    { threshold: 561_600, divisor: 86_400, unit: "day" },
    { threshold: 2_419_200, divisor: 604_800, unit: "week" },
    { threshold: 28_512_000, divisor: 2_629_746, unit: "month" },
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const segment of segments) {
    if (Math.abs(diffInSeconds) < segment.threshold) {
      const value = Math.round(diffInSeconds / segment.divisor);
      return rtf.format(-value, segment.unit);
    }
  }

  const years = Math.round(diffInSeconds / 31_556_952);
  return rtf.format(-years, "year");
}
