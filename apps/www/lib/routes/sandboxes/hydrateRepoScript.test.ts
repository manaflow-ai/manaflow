import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(
  new URL("./hydrateRepoScript.ts", import.meta.url),
);
const DEFAULT_BRANCH = "main";
const FEATURE_BRANCH = "feature/test-branch";

const tempRoots: string[] = [];

interface RepoContext {
  originDir: string;
  workspaceDir: string;
}

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepoContext(): RepoContext {
  const rootDir = mkdtempSync(join(tmpdir(), "hydrate-repo-script-"));
  tempRoots.push(rootDir);

  const sourceDir = join(rootDir, "source");
  const originDir = join(rootDir, "origin.git");
  const workspaceDir = join(rootDir, "workspace");

  mkdirSync(sourceDir, { recursive: true });
  git(["init", "--initial-branch", DEFAULT_BRANCH], sourceDir);
  git(["config", "user.name", "Hydrate Repo Test"], sourceDir);
  git(["config", "user.email", "hydrate-repo-test@example.com"], sourceDir);

  writeFileSync(join(sourceDir, "README.md"), "main branch\n");
  git(["add", "README.md"], sourceDir);
  git(["commit", "-m", "initial commit"], sourceDir);

  git(["checkout", "-b", FEATURE_BRANCH], sourceDir);
  writeFileSync(join(sourceDir, "feature.txt"), "feature branch\n");
  git(["add", "feature.txt"], sourceDir);
  git(["commit", "-m", "add feature branch file"], sourceDir);
  git(["checkout", DEFAULT_BRANCH], sourceDir);

  git(["init", "--bare", originDir], rootDir);
  git(["remote", "add", "origin", originDir], sourceDir);
  git(["push", "--all", "origin"], sourceDir);
  git(["symbolic-ref", "HEAD", `refs/heads/${DEFAULT_BRANCH}`], originDir);

  return { originDir, workspaceDir };
}

function runHydrateRepoScript({
  originDir,
  workspaceDir,
  baseBranch,
}: {
  originDir: string;
  workspaceDir: string;
  baseBranch?: string;
}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CMUX_WORKSPACE_PATH: workspaceDir,
    CMUX_DEPTH: "1",
    CMUX_OWNER: "karlorz",
    CMUX_REPO: "testing-repo-1",
    CMUX_REPO_FULL: "karlorz/testing-repo-1",
    CMUX_CLONE_URL: originDir,
    CMUX_MASKED_CLONE_URL: originDir,
  };

  if (baseBranch !== undefined) {
    env.CMUX_BASE_BRANCH = baseBranch;
  }

  const result = spawnSync("bun", ["run", SCRIPT_PATH], {
    env,
    encoding: "utf8",
  });

  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function extractCloneCommands(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.includes("Executing: git clone --depth"))
    .map((line) => {
      const commandIndex = line.indexOf("Executing: ");
      return commandIndex >= 0
        ? line.slice(commandIndex + "Executing: ".length).trim()
        : line.trim();
    });
}

afterEach(() => {
  for (const rootDir of tempRoots) {
    rmSync(rootDir, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe("hydrateRepoScript clone behavior", () => {
  it("includes --branch when baseBranch is provided", () => {
    const { originDir, workspaceDir } = createRepoContext();
    const result = runHydrateRepoScript({
      originDir,
      workspaceDir,
      baseBranch: FEATURE_BRANCH,
    });

    expect(result.exitCode).toBe(0);
    const cloneCommands = extractCloneCommands(result.stdout);
    expect(cloneCommands).toHaveLength(1);
    expect(cloneCommands[0]).toContain(`--branch "${FEATURE_BRANCH}"`);

    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], workspaceDir);
    expect(currentBranch).toBe(FEATURE_BRANCH);
  });

  it("omits --branch when baseBranch is not provided", () => {
    const { originDir, workspaceDir } = createRepoContext();
    const result = runHydrateRepoScript({ originDir, workspaceDir });

    expect(result.exitCode).toBe(0);
    const cloneCommands = extractCloneCommands(result.stdout);
    expect(cloneCommands).toHaveLength(1);
    expect(cloneCommands[0]).not.toContain("--branch");

    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], workspaceDir);
    expect(currentBranch).toBe(DEFAULT_BRANCH);
  });

  it("falls back to default branch when target branch does not exist", () => {
    const { originDir, workspaceDir } = createRepoContext();
    const missingBranch = "nonexistent-xyz-branch";
    const result = runHydrateRepoScript({
      originDir,
      workspaceDir,
      baseBranch: missingBranch,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("falling back to default branch");

    const cloneCommands = extractCloneCommands(result.stdout);
    expect(cloneCommands).toHaveLength(2);
    expect(cloneCommands[0]).toContain(`--branch "${missingBranch}"`);
    expect(cloneCommands[1]).not.toContain("--branch");

    const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], workspaceDir);
    expect(currentBranch).toBe(DEFAULT_BRANCH);
  });

  it("rejects shell injection attempts in branch names", () => {
    const { originDir, workspaceDir } = createRepoContext();
    const maliciousBranch = "main;echo pwned";
    const result = runHydrateRepoScript({
      originDir,
      workspaceDir,
      baseBranch: maliciousBranch,
    });

    expect(result.exitCode).toBe(1);
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    expect(combinedOutput).toContain("Invalid branch name");

    const cloneCommands = extractCloneCommands(combinedOutput);
    expect(cloneCommands).toHaveLength(0);
  });
});
