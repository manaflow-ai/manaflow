import { Octokit } from "octokit";

export interface ParsedPrUrl {
  owner: string;
  repo: string;
  number: number;
}

export interface GithubPrMetadata extends ParsedPrUrl {
  prUrl: string;
  headRefName: string;
  headRepoOwner: string;
  headRepoName: string;
  headSha: string;
  baseRefName: string;
}

type OctokitClient = InstanceType<typeof Octokit>;
type PullRequestGetResponse = Awaited<
  ReturnType<OctokitClient["rest"]["pulls"]["get"]>
>;
type GithubApiPullResponse = PullRequestGetResponse["data"];

export function getGithubToken(): string | null {
  const candidates: Array<string | undefined> = [
    process.env.GITHUB_TOKEN,
    process.env.GH_TOKEN,
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
  ];
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

export function parsePrUrl(prUrl: string): ParsedPrUrl {
  let url: URL;
  try {
    url = new URL(prUrl);
  } catch (_error) {
    throw new Error(`Invalid PR URL: ${prUrl}`);
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length < 4 || pathParts[2] !== "pull") {
    throw new Error(
      `PR URL must be in the form https://github.com/<owner>/<repo>/pull/<number>, received: ${prUrl}`
    );
  }

  const [owner, repo, _pullSegment, prNumberPart] = pathParts;
  const prNumber = Number(prNumberPart);
  if (!Number.isInteger(prNumber)) {
    throw new Error(`Invalid PR number in URL: ${prUrl}`);
  }

  return { owner, repo, number: prNumber };
}

type FetchPrMetadataOptions = {
  accessToken?: string | null;
};

export async function fetchPrMetadata(
  prUrl: string,
  options?: FetchPrMetadataOptions
): Promise<GithubPrMetadata> {
  const parsed = parsePrUrl(prUrl);
  const token = options?.accessToken;
  const octokit = new Octokit(token ? { auth: token } : {});

  let data: GithubApiPullResponse;
  try {
    const response = await octokit.rest.pulls.get({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.number,
    });
    data = response.data;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    throw new Error(
      `Failed to fetch PR metadata via GitHub API: ${message}`.trim()
    );
  }

  const headRefName = data.head?.ref;
  if (typeof headRefName !== "string" || headRefName.length === 0) {
    throw new Error("PR metadata is missing head.ref.");
  }

  const headRepoName = data.head?.repo?.name;
  const headRepoOwner = data.head?.repo?.owner?.login;
  if (
    typeof headRepoName !== "string" ||
    headRepoName.length === 0 ||
    typeof headRepoOwner !== "string" ||
    headRepoOwner.length === 0
  ) {
    throw new Error("PR metadata is missing head repository information.");
  }

  const baseRefName = data.base?.ref;
  if (typeof baseRefName !== "string" || baseRefName.length === 0) {
    throw new Error("PR metadata is missing base.ref.");
  }

  const headSha = data.head?.sha;
  if (typeof headSha !== "string" || headSha.length === 0) {
    throw new Error("PR metadata is missing head.sha.");
  }

  const baseRepoName = data.base?.repo?.name;
  const baseRepoOwner = data.base?.repo?.owner?.login;

  return {
    owner:
      typeof baseRepoOwner === "string" && baseRepoOwner.length > 0
        ? baseRepoOwner
        : parsed.owner,
    repo:
      typeof baseRepoName === "string" && baseRepoName.length > 0
        ? baseRepoName
        : parsed.repo,
    number: parsed.number,
    prUrl,
    headRefName,
    headRepoName,
    headRepoOwner,
    headSha,
    baseRefName,
  };
}
