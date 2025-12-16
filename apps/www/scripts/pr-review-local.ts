#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  INJECT_BUNDLE_FILENAME,
  bundleInjectScript,
  resolveInjectScriptPaths,
} from "./pr-review/shared";
import {
  fetchPrMetadata,
  getGithubToken,
} from "./pr-review/github";
import type {
  DiffArtifactMode,
  PrReviewStrategyId,
} from "./pr-review/core/options";

const DEFAULT_PR_URL = "https://github.com/manaflow-ai/cmux/pull/653";
const DEFAULT_IMAGE_TAG = "cmux-pr-review-local:latest";
const LOGS_SUBDIR = "pr-review";
const WORKSPACE_DIR = "/workspace";
const LOG_FILE_NAME = "pr-review-inject.log";
const DOCKERFILE_NAME = "Dockerfile.local";

interface CliOptions {
  prUrl: string | null;
  imageTag: string | null;
  rebuildImage: boolean;
  logsRoot: string | null;
  teamId: string | null;
  showDiffLineNumbers: boolean | null;
  showContextLineNumbers: boolean | null;
  strategy: PrReviewStrategyId | null;
  diffArtifactMode: DiffArtifactMode | null;
}

interface JobContext {
  jobId: string;
  containerName: string;
  prUrl: string;
  repoFullName: string;
  headRefName: string;
  baseRefName: string;
  commitRef: string;
  imageTag: string;
  logsDir: string;
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    prUrl: null,
    imageTag: null,
    rebuildImage: false,
    logsRoot: null,
    teamId: null,
    showDiffLineNumbers: null,
    showContextLineNumbers: null,
    strategy: null,
    diffArtifactMode: null,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--rebuild-image") {
      options.rebuildImage = true;
      continue;
    }
    if (arg === "--diff-line-numbers") {
      options.showDiffLineNumbers = true;
      continue;
    }
    if (arg === "--no-diff-line-numbers") {
      options.showDiffLineNumbers = false;
      continue;
    }
    if (arg === "--diff-context-line-numbers") {
      options.showContextLineNumbers = true;
      continue;
    }
    if (arg === "--no-diff-context-line-numbers") {
      options.showContextLineNumbers = false;
      continue;
    }
    if (arg === "--strategy") {
      const value = argv[index + 1];
      if (typeof value !== "string") {
        throw new Error("--strategy flag requires a value");
      }
      options.strategy = value as PrReviewStrategyId;
      index += 1;
      continue;
    }
    if (arg.startsWith("--strategy=")) {
      options.strategy = arg.slice("--strategy=".length) as PrReviewStrategyId;
      continue;
    }
    if (arg === "--diff-artifact") {
      const value = argv[index + 1];
      if (typeof value !== "string") {
        throw new Error("--diff-artifact flag requires a value");
      }
      options.diffArtifactMode = value as DiffArtifactMode;
      index += 1;
      continue;
    }
    if (arg.startsWith("--diff-artifact=")) {
      options.diffArtifactMode = arg.slice("--diff-artifact=".length) as DiffArtifactMode;
      continue;
    }
    if (arg === "--image") {
      const value = argv[index + 1];
      if (typeof value !== "string") {
        throw new Error("--image flag requires a value");
      }
      options.imageTag = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--image=")) {
      options.imageTag = arg.slice("--image=".length);
      continue;
    }
    if (arg === "--logs") {
      const value = argv[index + 1];
      if (typeof value !== "string") {
        throw new Error("--logs flag requires a value");
      }
      options.logsRoot = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--logs=")) {
      options.logsRoot = arg.slice("--logs=".length);
      continue;
    }
    if (arg === "--team") {
      const value = argv[index + 1];
      if (typeof value !== "string") {
        throw new Error("--team flag requires a value");
      }
      options.teamId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--team=")) {
      options.teamId = arg.slice("--team=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(
        "Usage: bun run apps/www/scripts/pr-review-local.ts <pr-url> [--rebuild-image] [--image <tag>] [--logs <dir>] [--team <id>] [--diff-line-numbers|--no-diff-line-numbers] [--diff-context-line-numbers|--no-diff-context-line-numbers] [--diff-artifact <single|per-file>] [--strategy <json-lines|line-numbers|openai-responses|inline-phrase|inline-brackets|inline-files>]"
      );
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positional.push(arg);
  }

  options.prUrl = positional[0] ?? null;
  return options;
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string } = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd,
      shell: false,
    });

    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Command "${command} ${args.join(" ")}" exited with ${
            code === null ? `signal ${String(signal)}` : `code ${code}`
          }`
        )
      );
    });
  });
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const prUrl = (options.prUrl ?? DEFAULT_PR_URL).trim();
  if (!prUrl) {
    throw new Error("PR URL cannot be empty.");
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey || openAiApiKey.length === 0) {
    throw new Error("OPENAI_API_KEY environment variable is required.");
  }

  const injectPaths = resolveInjectScriptPaths({
    moduleDir: dirname(fileURLToPath(import.meta.url)),
  });
  const { projectRoot, injectScriptsDir, injectScriptBundlePath } = injectPaths;
  const productionMode =
    process.env.NODE_ENV === "production" ||
    process.env.CMUX_PR_REVIEW_ENV === "production";

  await bundleInjectScript({
    productionMode,
    sourcePath: injectPaths.injectScriptSourcePath,
    bundlePath: injectPaths.injectScriptBundlePath,
    logPrefix: "[local-pr-review]",
  });

  if (!existsSync(injectScriptBundlePath)) {
    throw new Error(
      `Expected inject bundle at ${injectScriptBundlePath}, but it was not found.`
    );
  }

  const metadata = await fetchPrMetadata(prUrl);
  const repoFullName = `${metadata.owner}/${metadata.repo}`;
  const jobId = randomUUID();
  const containerName = `cmux-pr-review-${jobId}`;
  const imageTag = options.imageTag ?? DEFAULT_IMAGE_TAG;

  const logsRoot =
    options.logsRoot !== null
      ? resolve(projectRoot, options.logsRoot)
      : resolve(projectRoot, "logs", LOGS_SUBDIR);
  const jobLogsDir = join(logsRoot, jobId);

  await mkdir(jobLogsDir, { recursive: true });
  const artifactsLogsDir = join(jobLogsDir, "artifacts");
  await mkdir(artifactsLogsDir, { recursive: true });

  const logFileHostPath = join(jobLogsDir, LOG_FILE_NAME);
  const jobContext: JobContext = {
    jobId,
    containerName,
    prUrl,
    repoFullName,
    headRefName: metadata.headRefName,
    baseRefName: metadata.baseRefName,
    commitRef: metadata.headSha,
    imageTag,
    logsDir: jobLogsDir,
  };
  await writeFile(
    join(jobLogsDir, "job-context.json"),
    `${JSON.stringify(jobContext, null, 2)}\n`
  );

  const dockerfilePath = resolve(injectScriptsDir, DOCKERFILE_NAME);
  if (!existsSync(dockerfilePath)) {
    throw new Error(`Dockerfile not found at ${dockerfilePath}`);
  }

  const dockerBuildArgs = [
    "build",
    "-f",
    dockerfilePath,
    "-t",
    imageTag,
    ".",
  ];
  if (options.rebuildImage) {
    dockerBuildArgs.splice(1, 0, "--no-cache");
  }
  console.log(`[local-pr-review] Building image ${imageTag}...`);
  await runCommand("docker", dockerBuildArgs, { cwd: injectScriptsDir });

  const envPairs: Array<[string, string]> = [
    ["WORKSPACE_DIR", WORKSPACE_DIR],
    ["PR_URL", metadata.prUrl],
    [
      "GIT_REPO_URL",
      `https://github.com/${metadata.headRepoOwner}/${metadata.headRepoName}.git`,
    ],
    ["GIT_BRANCH", metadata.headRefName],
    [
      "BASE_REPO_URL",
      `https://github.com/${metadata.owner}/${metadata.repo}.git`,
    ],
    ["BASE_REF_NAME", metadata.baseRefName],
    ["OPENAI_API_KEY", openAiApiKey],
    ["LOG_FILE_PATH", `/logs/${LOG_FILE_NAME}`],
    ["LOG_SYMLINK_PATH", `${WORKSPACE_DIR}/${LOG_FILE_NAME}`],
    ["JOB_ID", jobId],
    ["SANDBOX_INSTANCE_ID", containerName],
    ["REPO_FULL_NAME", repoFullName],
    ["COMMIT_REF", metadata.headSha],
    ["CMUX_PR_REVIEW_ARTIFACTS_DIR", "/logs/artifacts"],
  ];

  const githubToken = getGithubToken();
  if (githubToken) {
    envPairs.push(["GITHUB_TOKEN", githubToken]);
    envPairs.push(["GH_TOKEN", githubToken]);
  }
  if (options.teamId) {
    envPairs.push(["TEAM_ID", options.teamId]);
  }
  if (options.showDiffLineNumbers !== null) {
    envPairs.push([
      "CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS",
      options.showDiffLineNumbers ? "true" : "false",
    ]);
  }
  if (options.showContextLineNumbers !== null) {
    envPairs.push([
      "CMUX_PR_REVIEW_SHOW_CONTEXT_LINE_NUMBERS",
      options.showContextLineNumbers ? "true" : "false",
    ]);
  }
  if (options.strategy !== null) {
    envPairs.push(["CMUX_PR_REVIEW_STRATEGY", options.strategy]);
  }
  if (options.showDiffLineNumbers !== null) {
    envPairs.push([
      "CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS",
      options.showDiffLineNumbers ? "true" : "false",
    ]);
  }

  const dockerRunArgs: string[] = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--workdir",
    "/runner",
    "-v",
    `${injectScriptBundlePath}:/runner/${INJECT_BUNDLE_FILENAME}:ro`,
    "-v",
    `${jobLogsDir}:/logs`,
  ];

  envPairs.forEach(([key, value]) => {
    dockerRunArgs.push("-e", `${key}=${value}`);
  });

  dockerRunArgs.push(imageTag);
  dockerRunArgs.push("bash");
  dockerRunArgs.push("-lc");
  dockerRunArgs.push(
    `set -euo pipefail; bun /runner/${INJECT_BUNDLE_FILENAME} | tee /logs/${LOG_FILE_NAME}`
  );

  console.log(
    `[local-pr-review] Running container ${containerName} (image ${imageTag})...`
  );
  try {
    await runCommand("docker", dockerRunArgs);
  } finally {
    console.log(
      `[local-pr-review] Logs written to ${logFileHostPath}. Container output is preserved even if the run fails.`
    );
  }
}

await main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack ?? error.message : error
  );
  process.exit(1);
});
