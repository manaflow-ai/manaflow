#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const API_ROOT = "https://api.github.com";
const REPO = "manaflow-ai/manaflow" as const;
const OUTPUT_DIR = resolve(import.meta.dirname, "data");
const CHECKPOINT_FILE = resolve(OUTPUT_DIR, "checkpoint.json");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "bot-comments.jsonl");
const PER_PAGE = 100;
const API_VERSION = "2022-11-28";
const CONCURRENCY = 4;

// Bot user logins for the GitHub Apps
// Format: {app-slug}[bot]
const BOT_LOGINS = [
  "cmux-agent-internal-dev[bot]",
  "cmux-agent[bot]",
];

type PullRequestListItem = {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  merge_commit_sha: string | null;
  created_at: string;
  updated_at: string;
};

type IssueComment = {
  id: number;
  user: { login: string; type: string } | null;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
};

type ReviewComment = {
  id: number;
  user: { login: string; type: string } | null;
  body: string;
  path: string;
  commit_id: string;
  original_commit_id: string;
  diff_hunk: string;
  position: number | null;
  original_position: number | null;
  created_at: string;
  updated_at: string;
  html_url: string;
};

type Review = {
  id: number;
  user: { login: string; type: string } | null;
  body: string | null;
  state: string;
  commit_id: string;
  submitted_at: string;
  html_url: string;
};

type StoredComment = {
  type: "issue_comment" | "review_comment" | "review";
  id: number;
  prNumber: number;
  botLogin: string;
  body: string;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  // Extra fields for review comments
  path?: string;
  diffHunk?: string;
  position?: number | null;
  // Extra fields for reviews
  reviewState?: string;
};

type StoredPR = {
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  createdAt: string;
  updatedAt: string;
  diff: string;
  comments: StoredComment[];
};

type Checkpoint = {
  processedPRs: number[];
  lastUpdatedAt: string;
};

type OutputData = {
  prs: StoredPR[];
};

type Paginated<T> = {
  data: T;
  next: string | null;
};

async function main() {
  const token = await resolveToken();
  const headers = buildHeaders(token);

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Load checkpoint for resumability
  const checkpoint = await loadCheckpoint();
  const existingData = await loadExistingData();

  console.error(`Fetching all pull requests for ${REPO}...`);
  const allPulls = await fetchAllPulls(headers);
  console.error(`Found ${allPulls.length} total PRs`);

  // Filter out already processed PRs
  const processedSet = new Set(checkpoint.processedPRs);
  const pullsToProcess = allPulls.filter((pr) => !processedSet.has(pr.number));
  console.error(`${pullsToProcess.length} PRs to process (${processedSet.size} already done)`);

  const existingPRsMap = new Map(existingData.prs.map((pr) => [pr.number, pr]));
  let processed = 0;

  // Process PRs with concurrency
  await mapWithConcurrency(pullsToProcess, CONCURRENCY, async (pull) => {
    const storedPR = await processPR(pull, headers);
    processed += 1;

    // Update checkpoint after each PR
    checkpoint.processedPRs.push(pull.number);
    checkpoint.lastUpdatedAt = new Date().toISOString();

    if (storedPR) {
      existingPRsMap.set(pull.number, storedPR);
    }

    // Save checkpoint periodically
    if (processed % 10 === 0 || processed === pullsToProcess.length) {
      await saveCheckpoint(checkpoint);
      await saveOutput({
        prs: Array.from(existingPRsMap.values()).sort((a, b) => b.number - a.number),
      });
      console.error(`Progress: ${processed}/${pullsToProcess.length} PRs processed, checkpoint saved`);
    }

    return storedPR;
  });

  // Final save
  const finalPRs = Array.from(existingPRsMap.values()).sort((a, b) => b.number - a.number);
  const prsWithComments = finalPRs.filter((pr) => pr.comments.length > 0);

  await saveOutput({
    prs: prsWithComments,
  });

  console.error(`\nDone! Found ${prsWithComments.length} PRs with bot comments`);
  console.error(`Total comments: ${prsWithComments.reduce((sum, pr) => sum + pr.comments.length, 0)}`);
  console.error(`Output saved to ${OUTPUT_FILE}`);
}

async function processPR(
  pull: PullRequestListItem,
  headers: Record<string, string>,
): Promise<StoredPR | undefined> {
  // Fetch all comment types in parallel
  const [issueComments, reviewComments, reviews] = await Promise.all([
    fetchIssueComments(pull.number, headers),
    fetchReviewComments(pull.number, headers),
    fetchReviews(pull.number, headers),
  ]);

  // Filter to only bot comments
  const botIssueComments = issueComments.filter(
    (c) => c.user && BOT_LOGINS.includes(c.user.login),
  );
  const botReviewComments = reviewComments.filter(
    (c) => c.user && BOT_LOGINS.includes(c.user.login),
  );
  const botReviews = reviews.filter(
    (r) => r.user && BOT_LOGINS.includes(r.user.login) && r.body,
  );

  const hasBotComments =
    botIssueComments.length > 0 ||
    botReviewComments.length > 0 ||
    botReviews.length > 0;

  if (!hasBotComments) {
    return undefined;
  }

  // Fetch the PR diff
  const diff = await fetchPRDiff(pull.number, headers);

  // Convert to stored format
  const comments: StoredComment[] = [];

  for (const c of botIssueComments) {
    comments.push({
      type: "issue_comment",
      id: c.id,
      prNumber: pull.number,
      botLogin: c.user!.login,
      body: c.body,
      commitSha: pull.head.sha, // Issue comments don't have commit_id, use head sha
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      htmlUrl: c.html_url,
    });
  }

  for (const c of botReviewComments) {
    comments.push({
      type: "review_comment",
      id: c.id,
      prNumber: pull.number,
      botLogin: c.user!.login,
      body: c.body,
      commitSha: c.commit_id,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      htmlUrl: c.html_url,
      path: c.path,
      diffHunk: c.diff_hunk,
      position: c.position,
    });
  }

  for (const r of botReviews) {
    comments.push({
      type: "review",
      id: r.id,
      prNumber: pull.number,
      botLogin: r.user!.login,
      body: r.body!,
      commitSha: r.commit_id,
      createdAt: r.submitted_at,
      updatedAt: r.submitted_at,
      htmlUrl: r.html_url,
      reviewState: r.state,
    });
  }

  // Sort comments by creation time
  comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  console.error(`  PR #${pull.number}: ${comments.length} bot comments`);

  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    htmlUrl: pull.html_url,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    baseRef: pull.base.ref,
    baseSha: pull.base.sha,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    diff,
    comments,
  };
}

async function fetchAllPulls(headers: Record<string, string>): Promise<PullRequestListItem[]> {
  // Fetch both open and closed PRs
  const [openPulls, closedPulls] = await Promise.all([
    fetchPullsByState("open", headers),
    fetchPullsByState("closed", headers),
  ]);
  return [...openPulls, ...closedPulls];
}

async function fetchPullsByState(
  state: "open" | "closed",
  headers: Record<string, string>,
): Promise<PullRequestListItem[]> {
  const search = new URLSearchParams();
  search.set("state", state);
  search.set("per_page", PER_PAGE.toString());
  search.set("sort", "created");
  search.set("direction", "desc");
  let url: string | null = buildUrl(`/repos/${REPO}/pulls`, search);
  const out: PullRequestListItem[] = [];
  while (url) {
    const page: Paginated<PullRequestListItem[]> = await requestJson<PullRequestListItem[]>(url, headers);
    out.push(...page.data);
    url = page.next;
  }
  return out;
}

async function fetchIssueComments(
  prNumber: number,
  headers: Record<string, string>,
): Promise<IssueComment[]> {
  const search = new URLSearchParams();
  search.set("per_page", PER_PAGE.toString());
  let url: string | null = buildUrl(`/repos/${REPO}/issues/${prNumber}/comments`, search);
  const out: IssueComment[] = [];
  while (url) {
    const page: Paginated<IssueComment[]> = await requestJson<IssueComment[]>(url, headers);
    out.push(...page.data);
    url = page.next;
  }
  return out;
}

async function fetchReviewComments(
  prNumber: number,
  headers: Record<string, string>,
): Promise<ReviewComment[]> {
  const search = new URLSearchParams();
  search.set("per_page", PER_PAGE.toString());
  let url: string | null = buildUrl(`/repos/${REPO}/pulls/${prNumber}/comments`, search);
  const out: ReviewComment[] = [];
  while (url) {
    const page: Paginated<ReviewComment[]> = await requestJson<ReviewComment[]>(url, headers);
    out.push(...page.data);
    url = page.next;
  }
  return out;
}

async function fetchReviews(
  prNumber: number,
  headers: Record<string, string>,
): Promise<Review[]> {
  const search = new URLSearchParams();
  search.set("per_page", PER_PAGE.toString());
  let url: string | null = buildUrl(`/repos/${REPO}/pulls/${prNumber}/reviews`, search);
  const out: Review[] = [];
  while (url) {
    const page: Paginated<Review[]> = await requestJson<Review[]>(url, headers);
    out.push(...page.data);
    url = page.next;
  }
  return out;
}

async function fetchPRDiff(prNumber: number, headers: Record<string, string>): Promise<string> {
  const url = buildUrl(`/repos/${REPO}/pulls/${prNumber}`);
  const diffHeaders = {
    ...headers,
    Accept: "application/vnd.github.diff",
  };
  const response = await fetch(url, { headers: diffHeaders });
  if (!response.ok) {
    console.error(`Warning: Failed to fetch diff for PR #${prNumber}: ${response.status}`);
    return "";
  }
  return response.text();
}

async function loadCheckpoint(): Promise<Checkpoint> {
  try {
    const content = await readFile(CHECKPOINT_FILE, "utf8");
    return JSON.parse(content) as Checkpoint;
  } catch {
    return {
      processedPRs: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }
}

async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  await writeFile(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2), "utf8");
}

async function loadExistingData(): Promise<OutputData> {
  try {
    const content = await readFile(OUTPUT_FILE, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const prs = lines.map((line) => JSON.parse(line) as StoredPR);
    return { prs };
  } catch {
    return { prs: [] };
  }
}

async function saveOutput(data: OutputData): Promise<void> {
  const jsonl = data.prs.map((pr) => JSON.stringify(pr)).join("\n");
  await writeFile(OUTPUT_FILE, jsonl + "\n", "utf8");
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "cmux-scripts",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

async function resolveToken(): Promise<string> {
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (envToken && envToken.trim().length > 0) {
    return envToken.trim();
  }
  const spawned = spawn("gh", ["auth", "token"], { stdio: ["ignore", "pipe", "inherit"] });
  const chunks: Buffer[] = [];
  for await (const chunk of spawned.stdout) {
    chunks.push(Buffer.from(chunk));
  }
  const { code } = await new Promise<{ code: number | null }>((resolvePromise) => {
    spawned.on("close", (closeCode) => resolvePromise({ code: closeCode }));
  });
  if (code !== 0) {
    throw new Error("Failed to resolve GitHub token. Set GITHUB_TOKEN env var or run 'gh auth login'.");
  }
  const token = Buffer.concat(chunks).toString("utf8").trim();
  if (!token) {
    throw new Error("GitHub token command returned empty output.");
  }
  return token;
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<U | undefined>,
): Promise<U[]> {
  if (items.length === 0) {
    return [];
  }
  const max = Math.max(1, Math.min(limit, items.length));
  const results: (U | undefined)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      if (current >= items.length) {
        break;
      }
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: max }, () => worker());
  await Promise.all(workers);
  return results.filter((value): value is U => value !== undefined);
}

async function requestJson<T>(endpoint: string, headers: Record<string, string>): Promise<Paginated<T>> {
  const url = endpoint.startsWith("http") ? endpoint : buildUrl(endpoint);
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText}): ${text}`);
  }
  const json = (await response.json()) as T;
  const linkHeader = response.headers.get("link");
  const parsed = parseLinkHeader(linkHeader);
  return { data: json, next: parsed.next };
}

function buildUrl(path: string, params?: URLSearchParams): string {
  const cleanedPath = path.startsWith("http") ? path : `${API_ROOT}${path}`;
  const url = new URL(cleanedPath);
  if (params) {
    params.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

function parseLinkHeader(header: string | null): { next: string | null } {
  if (!header) {
    return { next: null };
  }
  const parts = header.split(",");
  let next: string | null = null;
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      const [, url, rel] = match;
      if (rel === "next") {
        next = url;
      }
    }
  }
  return { next };
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
