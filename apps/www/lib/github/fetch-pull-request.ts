import { GithubApiError } from "./errors";
import { createGitHubClient } from "./octokit";
import {
  generateGitHubInstallationToken,
  getInstallationForRepo,
} from "../utils/github-app-token";

type RequestErrorShape = {
  status?: number;
  message?: string;
  documentation_url?: string;
};

type OctokitInstance = ReturnType<typeof createGitHubClient>;

type PullRequestResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["pulls"]["get"]>
>;

type PullRequestFilesResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["pulls"]["listFiles"]>
>;

type CompareCommitsResponse = Awaited<
  ReturnType<OctokitInstance["rest"]["repos"]["compareCommitsWithBasehead"]>
>;

export type GithubPullRequest = PullRequestResponse["data"];

export type GithubPullRequestFile =
  PullRequestFilesResponse["data"][number];

export type GithubComparison = CompareCommitsResponse["data"];

type FetchPullRequestOptions = {
  authToken?: string | null;
};

type FetchPullRequestFilesOptions = {
  authToken?: string | null;
};

function toGithubApiError(error: unknown): GithubApiError {
  if (error instanceof GithubApiError) {
    return error;
  }

  if (isRequestErrorShape(error)) {
    const status = typeof error.status === "number" ? error.status : 500;
    const message =
      typeof error.message === "string"
        ? error.message
        : "Unexpected GitHub API error";
    const documentationUrl =
      typeof error.documentation_url === "string"
        ? error.documentation_url
        : undefined;

    return new GithubApiError(message, { status, documentationUrl });
  }

  return new GithubApiError("Unexpected GitHub API error", {
    status: 500,
  });
}

function isRequestErrorShape(error: unknown): error is RequestErrorShape {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeShape = error as Record<string, unknown>;
  return (
    "status" in maybeShape ||
    "message" in maybeShape ||
    "documentation_url" in maybeShape
  );
}

function buildAuthCandidates(
  token: string | null | undefined,
): (string | undefined)[] {
  const candidates: (string | undefined)[] = [];
  if (typeof token === "string" && token.trim().length > 0) {
    candidates.push(token);
  }
  candidates.push(undefined);
  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex((value) => value === candidate) === index,
  );
}

function shouldRetryWithAlternateAuth(error: unknown): boolean {
  if (!isRequestErrorShape(error)) {
    return false;
  }
  return [401, 403, 404].includes(error.status ?? 0);
}

export async function fetchPullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  options: FetchPullRequestOptions = {},
): Promise<GithubPullRequest> {
  try {
    const authCandidates = buildAuthCandidates(options.authToken);
    let lastError: unknown;

    for (const candidate of authCandidates) {
      try {
        const octokit = createGitHubClient(candidate);
        const response = await octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: pullNumber,
        });
        return response.data;
      } catch (error) {
        lastError = error;
        if (shouldRetryWithAlternateAuth(error)) {
          continue;
        }
        throw toGithubApiError(error);
      }
    }

    if (isRequestErrorShape(lastError) && lastError.status === 404) {
      console.log(
        `[fetchPullRequest] Got 404, trying with GitHub App token for ${owner}/${repo}`,
      );

      const installationId = await getInstallationForRepo(`${owner}/${repo}`);
      if (installationId) {
        const appToken = await generateGitHubInstallationToken({
          installationId,
          permissions: {
            contents: "read",
            metadata: "read",
            pull_requests: "read",
          },
        });

        try {
          const octokit = createGitHubClient(appToken);
          const response = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
          });
          return response.data;
        } catch (appError) {
          throw toGithubApiError(appError);
        }
      }
    }

    if (lastError) {
      throw toGithubApiError(lastError);
    }

    throw new GithubApiError("Unable to fetch pull request", {
      status: 500,
    });
  } catch (error) {
    throw toGithubApiError(error);
  }
}

export async function fetchPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  options: FetchPullRequestFilesOptions = {},
): Promise<GithubPullRequestFile[]> {
  try {
    const authCandidates = buildAuthCandidates(options.authToken);
    let lastError: unknown;

    for (const candidate of authCandidates) {
      try {
        const octokit = createGitHubClient(candidate);
        const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
          owner,
          repo,
          pull_number: pullNumber,
          per_page: 100,
        });
        return files;
      } catch (error) {
        lastError = error;
        if (shouldRetryWithAlternateAuth(error)) {
          continue;
        }
        throw toGithubApiError(error);
      }
    }

    if (isRequestErrorShape(lastError) && lastError.status === 404) {
      console.log(
        `[fetchPullRequestFiles] Got 404, trying with GitHub App token for ${owner}/${repo}`,
      );

      const installationId = await getInstallationForRepo(`${owner}/${repo}`);
      if (installationId) {
        const appToken = await generateGitHubInstallationToken({
          installationId,
          permissions: {
            contents: "read",
            metadata: "read",
            pull_requests: "read",
          },
        });

        try {
          const octokit = createGitHubClient(appToken);
          const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
          });
          return files;
        } catch (appError) {
          throw toGithubApiError(appError);
        }
      }
    }

    if (lastError) {
      throw toGithubApiError(lastError);
    }

    throw new GithubApiError("Unable to fetch pull request files", {
      status: 500,
    });
  } catch (error) {
    throw toGithubApiError(error);
  }
}

type GithubComparisonFile = NonNullable<CompareCommitsResponse["data"]["files"]>[number];

export type GithubFileChange = {
  filename: GithubPullRequestFile["filename"];
  status: GithubPullRequestFile["status"];
  additions: GithubPullRequestFile["additions"];
  deletions: GithubPullRequestFile["deletions"];
  changes: GithubPullRequestFile["changes"];
  previous_filename?: GithubPullRequestFile["previous_filename"];
  patch?: GithubPullRequestFile["patch"];
};

export function toGithubFileChange(
  file: GithubPullRequestFile | GithubComparisonFile,
): GithubFileChange {
  return {
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    previous_filename: file.previous_filename,
    patch: file.patch,
  };
}

export async function fetchComparison(
  owner: string,
  repo: string,
  baseRef: string,
  headRef: string,
): Promise<GithubComparison> {
  try {
    const octokit = createGitHubClient();
    const response = await octokit.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseRef}...${headRef}`,
      per_page: 100,
    });
    return response.data;
  } catch (error) {
    throw toGithubApiError(error);
  }
}
