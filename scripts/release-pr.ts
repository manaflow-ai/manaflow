#!/usr/bin/env bun

import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptName = basename(scriptPath);
const scriptDir = resolve(scriptPath, "..");
const repoRoot = resolve(scriptDir, "..");

process.chdir(repoRoot);

const semverPattern = /^\d+\.\d+\.\d+$/;

const defaultBaseBranch = "main";

const releaseBranchPrefix = "release/";

type IncrementMode = "major" | "minor" | "patch";

type RunOptions = {
  allowNonZeroExit?: boolean;
  stdio?: "pipe" | "inherit";
};

type RunResult = {
  stdout: string;
  stderr: string;
  status: number;
};

type Repository = {
  owner: string;
  name: string;
};

type PullRequest = {
  html_url: string;
  number: number;
};

function writeGithubOutput(key: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  writeFileSync(outputPath, `${key}=${value}\n`, { flag: "a" });
}

function usage(): never {
  console.error(
    `Usage: ./scripts/${scriptName} [major|minor|patch|<semver>]\nExamples:\n  ./scripts/${scriptName}\n  ./scripts/${scriptName} minor\n  ./scripts/${scriptName} 1.2.3`
  );
  return process.exit(1);
}

function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const spawnOptions: SpawnSyncOptions = {
    cwd: process.cwd(),
    stdio: options.stdio ?? "pipe",
  };

  if ((options.stdio ?? "pipe") === "pipe") {
    spawnOptions.encoding = "utf8";
  }

  const result = spawnSync(command, args, spawnOptions);

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const status = typeof result.status === "number" ? result.status : 0;

  if (status !== 0 && !options.allowNonZeroExit) {
    const errorMessage = stderr.trim() || stdout.trim() || `${command} ${args.join(" ")}`;
    throw new Error(`Command failed (${command} ${args.join(" ")}): ${errorMessage}`);
  }

  return { stdout, stderr, status };
}

function ensureGitAvailable(): void {
  try {
    run("git", ["--version"]);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`git is required to run ${scriptName}: ${error.message}`);
    }
    throw new Error(`git is required to run ${scriptName}`);
  }
}

function isSemver(value: string): boolean {
  return semverPattern.test(value);
}

function parseSemverParts(value: string): [number, number, number] {
  if (!isSemver(value)) {
    throw new Error(`Version "${value}" is not a valid semver (x.y.z).`);
  }
  const [major, minor, patch] = value.split(".").map((part) => Number.parseInt(part, 10));
  return [major, minor, patch];
}

function compareSemver(left: string, right: string): number {
  const [leftMajor, leftMinor, leftPatch] = parseSemverParts(left);
  const [rightMajor, rightMinor, rightPatch] = parseSemverParts(right);

  if (leftMajor !== rightMajor) {
    return leftMajor > rightMajor ? 1 : -1;
  }
  if (leftMinor !== rightMinor) {
    return leftMinor > rightMinor ? 1 : -1;
  }
  if (leftPatch !== rightPatch) {
    return leftPatch > rightPatch ? 1 : -1;
  }
  return 0;
}

function incrementVersion(mode: IncrementMode, base: string): string {
  const [major, minor, patch] = parseSemverParts(base);

  if (mode === "major") {
    return `${major + 1}.0.0`;
  }
  if (mode === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

function loadCurrentVersion(): string {
  interface PackageJson {
    version?: string;
  }

  const packagePath = resolve("apps", "client", "package.json");
  const raw = readFileSync(packagePath, "utf8");
  const parsed: PackageJson = JSON.parse(raw);

  if (typeof parsed.version !== "string" || !parsed.version) {
    throw new Error("Unable to read current version from apps/client/package.json.");
  }

  if (!isSemver(parsed.version)) {
    throw new Error(`Current version "${parsed.version}" is not in the expected x.y.z format.`);
  }

  return parsed.version;
}

function determineHighestTagVersion(): string {
  const tagOutput = run("git", ["tag", "--list", "v[0-9]*"]).stdout.trim();
  if (!tagOutput) {
    return "";
  }

  const versions = tagOutput
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("v") ? tag.slice(1) : tag))
    .filter(isSemver);

  if (versions.length === 0) {
    return "";
  }

  versions.sort((a, b) => compareSemver(a, b));
  return versions[versions.length - 1] ?? "";
}

function updateVersionFile(version: string): void {
  const packagePath = resolve("apps", "client", "package.json");
  const raw = readFileSync(packagePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.version = version;
  writeFileSync(packagePath, `${JSON.stringify(parsed, null, 2)}\n`);
  run("git", ["add", packagePath]);
}

function resolveRepository(): Repository {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if (!repository.includes("/")) {
    throw new Error("GITHUB_REPOSITORY is not set. This script must run in GitHub Actions.");
  }
  const [owner, name] = repository.split("/");
  return { owner, name };
}

function ensureToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to create a pull request.");
  }
  return token;
}

function buildReleaseBranch(version: string): string {
  return `${releaseBranchPrefix}v${version}`;
}

function getBaseBranch(): string {
  return process.env.RELEASE_BASE_BRANCH?.trim() || defaultBaseBranch;
}

async function findExistingPullRequest(branchName: string, repo: Repository, token: string): Promise<PullRequest | null> {
  const url = new URL(`https://api.github.com/repos/${repo.owner}/${repo.name}/pulls`);
  url.searchParams.set("head", `${repo.owner}:${branchName}`);
  url.searchParams.set("state", "open");

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to check for existing pull requests: ${message}`);
  }

  const pulls = (await response.json()) as PullRequest[];
  return pulls[0] ?? null;
}

async function createPullRequest(
  repo: Repository,
  token: string,
  branchName: string,
  version: string,
  baseBranch: string
): Promise<PullRequest> {
  const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/pulls`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: `chore: release v${version}`,
      head: branchName,
      base: baseBranch,
      draft: true,
      body: [
        `Automated release for v${version}.`,
        "- Bumps the app version in apps/client/package.json.",
        "- Please review and merge to publish the release.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to create pull request: ${message}`);
  }

  const pr = (await response.json()) as PullRequest;
  return pr;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 1) {
    usage();
  }

  if (args[0] === "-h" || args[0] === "--help") {
    usage();
  }

  ensureGitAvailable();

  const statusOutput = run("git", ["status", "--porcelain", "--untracked-files=no"]).stdout.trim();
  if (statusOutput) {
    throw new Error("Working tree has tracked changes. Commit or stash them before releasing.");
  }

  const currentBranch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  if (currentBranch === "HEAD") {
    throw new Error("You are in a detached HEAD state. Check out a branch before releasing.");
  }

  const remotes = run("git", ["remote"]).stdout
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);

  if (remotes.length === 0) {
    throw new Error("No git remote configured. Add a remote before releasing.");
  }

  const firstRemote = remotes[0] ?? "";

  run("git", ["fetch", "--tags", firstRemote], { stdio: "inherit" });

  const packageVersion = loadCurrentVersion();
  const highestTagVersion = determineHighestTagVersion();

  let baseVersion = packageVersion;
  if (highestTagVersion && compareSemver(highestTagVersion, baseVersion) > 0) {
    baseVersion = highestTagVersion;
  }

  const bumpTarget = args[0] ?? "";

  let newVersion: string;

  if (!bumpTarget) {
    newVersion = incrementVersion("patch", baseVersion);
  } else if (bumpTarget === "major" || bumpTarget === "minor" || bumpTarget === "patch") {
    newVersion = incrementVersion(bumpTarget, baseVersion);
  } else {
    const manualTarget = bumpTarget.startsWith("v") ? bumpTarget.slice(1) : bumpTarget;
    newVersion = manualTarget;
  }

  if (!isSemver(newVersion)) {
    throw new Error(`Version "${newVersion}" is not a valid semver (x.y.z).`);
  }

  if (compareSemver(newVersion, baseVersion) <= 0) {
    throw new Error(`New version ${newVersion} must be greater than existing version ${baseVersion}.`);
  }

  const localTagCheck = run("git", ["rev-parse", "-q", "--verify", `refs/tags/v${newVersion}`], {
    allowNonZeroExit: true,
  });
  if (localTagCheck.status === 0) {
    throw new Error(`Tag v${newVersion} already exists locally.`);
  }

  const remoteTagCheck = run("git", ["ls-remote", "--tags", firstRemote, `refs/tags/v${newVersion}`], {
    allowNonZeroExit: true,
  });
  if (remoteTagCheck.stdout.trim()) {
    throw new Error(`Tag v${newVersion} already exists on ${firstRemote}.`);
  }

  const branchName = buildReleaseBranch(newVersion);

  const branchCheck = run("git", ["ls-remote", "--heads", firstRemote, branchName], { allowNonZeroExit: true });
  if (branchCheck.stdout.trim()) {
    const repo = resolveRepository();
    const token = ensureToken();
    const existing = await findExistingPullRequest(branchName, repo, token);
    if (existing) {
      console.log(`Release branch ${branchName} already has open PR #${existing.number}: ${existing.html_url}`);
      writeGithubOutput("release_branch", branchName);
      writeGithubOutput("release_version", newVersion);
      writeGithubOutput("release_pr_state", "existing");
      writeGithubOutput("release_pr_number", existing.number.toString());
      writeGithubOutput("release_pr_url", existing.html_url);
      writeGithubOutput("release_branch_created", "false");
      return;
    }
    // Branch exists but no open PR - delete the stale branch and continue
    console.log(`Deleting stale branch ${branchName} (no open PR found)`);
    run("git", ["push", firstRemote, "--delete", branchName], { stdio: "inherit" });
  }

  updateVersionFile(newVersion);

  console.log(`Preparing release ${newVersion} (base was ${baseVersion})`);

  run("git", ["checkout", "-b", branchName], { stdio: "inherit" });

  run("git", ["commit", "-m", `chore: release v${newVersion}`], { stdio: "inherit" });

  run("git", ["push", "-u", firstRemote, branchName], { stdio: "inherit" });

  writeGithubOutput("release_branch", branchName);
  writeGithubOutput("release_version", newVersion);
  writeGithubOutput("release_branch_created", "true");

  const repo = resolveRepository();
  const token = ensureToken();
  const baseBranch = getBaseBranch();

  const pullRequest = await createPullRequest(repo, token, branchName, newVersion, baseBranch);

  writeGithubOutput("release_pr_state", "created");
  writeGithubOutput("release_pr_number", pullRequest.number.toString());
  writeGithubOutput("release_pr_url", pullRequest.html_url);

  console.log(`Created draft release PR #${pullRequest.number}: ${pullRequest.html_url}`);
}

void (async () => {
  try {
    await main();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
})();
