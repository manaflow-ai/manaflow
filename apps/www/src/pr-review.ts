import type { Instance } from "morphcloud";
import { MorphCloudClient } from "morphcloud";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codeReviewCallbackSchema,
  type CodeReviewCallbackPayload,
} from "@cmux/shared/codeReview/callback-schemas";
import {
  bundleInjectScript,
  getBunExecutable,
  resolveInjectScriptPaths,
} from "../scripts/pr-review/shared";
import {
  fetchPrMetadata,
  type GithubPrMetadata,
} from "../scripts/pr-review/github";
import { VM_CLEANUP_COMMANDS } from "../lib/routes/sandboxes/cleanup";

const DEFAULT_MORPH_SNAPSHOT_ID = "snapshot_vb7uqz8o";
const OPEN_VSCODE_PORT = 39378;
const REMOTE_WORKSPACE_DIR = "/root/workspace";
const REMOTE_LOG_FILE_PATH = "/root/pr-review-inject.log";
const WORKSPACE_LOG_RELATIVE_PATH = "pr-review-inject.log";
const WORKSPACE_LOG_ABSOLUTE_PATH = `${REMOTE_WORKSPACE_DIR}/${WORKSPACE_LOG_RELATIVE_PATH}`;
const CODE_REVIEW_OUTPUT_FILENAME = "code-review-output.json";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function resolveProductionMode(explicit?: boolean): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CMUX_PR_REVIEW_ENV === "production"
  );
}

const {
  projectRoot,
  injectScriptSourcePath,
  injectScriptBundlePath,
} = resolveInjectScriptPaths({ moduleDir });

let cachedInjectScriptPromise: Promise<string> | null = null;

async function getInjectScriptSource(productionMode: boolean): Promise<string> {
  if (!cachedInjectScriptPromise) {
    cachedInjectScriptPromise = (async () => {
      console.log(
        "[pr-review][debug] getInjectScriptSource ensuring inject script bundle is available"
      );
      console.log("[pr-review][debug] bundleInjectScript resolving paths", {
        moduleDir,
        projectRoot,
        injectScriptSourcePath,
        injectScriptBundlePath,
      });
      await bundleInjectScript({
        productionMode,
        sourcePath: injectScriptSourcePath,
        bundlePath: injectScriptBundlePath,
        bunExecutable: getBunExecutable(),
        logPrefix: "[pr-review]",
      });
      console.log(
        `[pr-review][debug] Reading inject script bundle from ${injectScriptBundlePath}`
      );
      try {
        return await readFile(injectScriptBundlePath, "utf8");
      } catch (error) {
        const maybeCode =
          typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : null;
        if (maybeCode === "ENOENT") {
          throw new Error(
            `[pr-review] Inject script bundle not found at ${injectScriptBundlePath}. Run "bun run build" to generate it before running PR review in production.`
          );
        }
        throw error;
      }
    })().catch((error) => {
      cachedInjectScriptPromise = null;
      throw error;
    });
  }
  return cachedInjectScriptPromise;
}

interface PrReviewCallbackConfig {
  url: string;
  token: string;
}

export interface PrReviewJobContext {
  jobId: string;
  teamId?: string;
  repoFullName: string;
  repoUrl: string;
  prNumber?: number;
  prUrl: string;
  commitRef: string;
  comparison?: ComparisonReviewContext;
  callback?: PrReviewCallbackConfig;
  fileCallback?: PrReviewCallbackConfig;
  morphSnapshotId?: string;
  productionMode?: boolean;
  showDiffLineNumbers?: boolean;
  showContextLineNumbers?: boolean;
  strategy?: string;
  diffArtifactMode?: string;
  githubAccessToken?: string;
}

export interface ComparisonReviewContext {
  slug: string;
  baseOwner: string;
  baseRef: string;
  headOwner: string;
  headRef: string;
}

type PrMetadata = GithubPrMetadata;

function ensureMorphClient(): MorphCloudClient {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY environment variable is required");
  }
  return new MorphCloudClient({ apiKey });
}

async function sendCallback(
  callback: PrReviewCallbackConfig,
  payload: CodeReviewCallbackPayload
): Promise<void> {
  try {
    const validatedPayload = codeReviewCallbackSchema.parse(payload);
    const response = await fetch(callback.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${callback.token}`,
      },
      body: JSON.stringify(validatedPayload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Callback failed with status ${response.status}: ${text.slice(0, 2048)}`
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error(`[pr-review] Failed to send callback: ${message}`);
    throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function startTiming(label: string): () => void {
  const startTime = performance.now();
  let finished = false;
  return () => {
    if (finished) {
      return;
    }
    finished = true;
    const durationMs = performance.now() - startTime;
    const seconds = durationMs / 1000;
    console.log(`[timing] ${label} ${seconds.toFixed(2)}s`);
  };
}

async function execOrThrow(instance: Instance, command: string): Promise<void> {
  console.log("[pr-review][debug] Executing command on Morph instance", {
    commandPreview: command.slice(0, 160),
    instanceId: instance.id,
  });
  const result = await instance.exec(command);
  const exitCode = result.exit_code ?? 0;
  if (exitCode !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    throw new Error(
      [
        `Command failed: ${command}`,
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  }
  if (result.stdout && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  if (result.stderr && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
    if (!result.stderr.endsWith("\n")) {
      process.stderr.write("\n");
    }
  }
}

function describeServices(instance: Instance): void {
  if (!instance.networking?.httpServices?.length) {
    console.log("No HTTP services exposed on the Morph instance yet.");
    return;
  }

  instance.networking.httpServices.forEach((service) => {
    console.log(
      `HTTP service ${service.name ?? `port-${service.port}`} -> ${service.url}`
    );
  });
}

function getOpenVscodeBaseUrl(
  instance: Instance,
  workspacePath: string
): URL | null {
  const services = instance.networking?.httpServices ?? [];
  const vscodeService = services.find(
    (service) =>
      service.port === OPEN_VSCODE_PORT ||
      service.name === `port-${OPEN_VSCODE_PORT}`
  );

  if (!vscodeService) {
    console.warn(
      `Warning: could not find exposed OpenVSCode service on port ${OPEN_VSCODE_PORT}.`
    );
    return null;
  }

  try {
    const vscodeUrl = new URL(vscodeService.url);
    vscodeUrl.searchParams.set("folder", workspacePath);
    return vscodeUrl;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    console.warn(
      `Warning: unable to format OpenVSCode URL for port ${OPEN_VSCODE_PORT}: ${message}`
    );
    return null;
  }
}

function logOpenVscodeUrl(
  instance: Instance,
  workspacePath: string
): URL | null {
  const baseUrl = getOpenVscodeBaseUrl(instance, workspacePath);
  if (!baseUrl) {
    return null;
  }
  console.log(`OpenVSCode (${OPEN_VSCODE_PORT}): ${baseUrl.toString()}`);
  return baseUrl;
}

function logOpenVscodeFileUrl(
  instance: Instance,
  workspacePath: string,
  relativeFilePath: string
): void {
  const baseUrl = getOpenVscodeBaseUrl(instance, workspacePath);
  if (!baseUrl) {
    return;
  }

  const fileUrl = new URL(baseUrl.toString());
  fileUrl.searchParams.set("path", relativeFilePath);
  console.log(
    `OpenVSCode log file (${relativeFilePath}): ${fileUrl.toString()}`
  );
}

function buildMetadata(
  pr: PrMetadata,
  config: PrReviewJobContext
): Record<string, string> {
  return {
    purpose: "pr-review",
    prUrl: pr.prUrl,
    repo: `${pr.owner}/${pr.repo}`,
    head: `${pr.headRepoOwner}/${pr.headRepoName}#${pr.headRefName}`,
    jobId: config.jobId,
    ...(config.teamId ? { teamId: config.teamId } : {}),
    commitRef: config.commitRef,
    ...(config.comparison ? { comparisonSlug: config.comparison.slug } : {}),
  };
}

async function fetchPrMetadataTask(
  prUrl: string,
  accessToken?: string
): Promise<PrMetadata> {
  console.log("Fetching PR metadata...");
  const finishFetchMetadata = startTiming("fetch PR metadata");
  try {
    return await fetchPrMetadata(prUrl, { accessToken });
  } finally {
    finishFetchMetadata();
  }
}

async function startMorphInstanceTask(
  client: MorphCloudClient,
  config: PrReviewJobContext
): Promise<Instance> {
  const snapshotId = config.morphSnapshotId ?? DEFAULT_MORPH_SNAPSHOT_ID;
  console.log(
    "[pr-review][debug] startMorphInstanceTask called",
    {
      snapshotId,
      jobId: config.jobId,
      repoFullName: config.repoFullName,
    }
  );
  console.log(`Starting Morph instance from snapshot ${snapshotId}...`);
  const finishStartInstance = startTiming("start Morph instance");
  try {
    const instance = await client.instances.start({
      snapshotId,
      ttlSeconds: 60 * 30,
      ttlAction: "pause",
      metadata: {
        purpose: "pr-review",
        prUrl: config.prUrl,
        jobId: config.jobId,
        ...(config.teamId ? { teamId: config.teamId } : {}),
        repo: config.repoFullName,
      },
    });
    void (async () => {
      await instance.setWakeOn(true, true);
    })();
    return instance;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    console.error(`[pr-review] Failed to start Morph instance: ${message}`);
    throw error;
  } finally {
    finishStartInstance();
  }
}

export async function startAutomatedPrReview(
  config: PrReviewJobContext
): Promise<void> {
  const productionMode = resolveProductionMode(config.productionMode);
  console.log(
    `[pr-review] Preparing Morph review environment for ${config.prUrl}`
  );
  console.log("[pr-review][debug] startAutomatedPrReview config snapshot", {
    jobId: config.jobId,
    repoFullName: config.repoFullName,
    prUrl: config.prUrl,
    commitRef: config.commitRef,
    hasCallback: Boolean(config.callback),
    hasFileCallback: Boolean(config.fileCallback),
    morphSnapshotId: config.morphSnapshotId,
    productionMode: config.productionMode ?? null,
    resolvedProductionMode: productionMode,
  });
  const morphClient = ensureMorphClient();
  let instance: Instance | null = null;

  try {
    console.log("[pr-review][debug] Starting parallel tasks", {
      jobId: config.jobId,
    });
    const startInstancePromise = startMorphInstanceTask(
      morphClient,
      config
    ).then((startedInstance) => {
      instance = startedInstance;
      return startedInstance;
    });
    const prMetadataPromise = fetchPrMetadataTask(config.prUrl, config.githubAccessToken);

    const [prMetadata, startedInstance] = await Promise.all([
      prMetadataPromise,
      startInstancePromise,
    ]);
    instance = startedInstance;

    const normalizedCommitRef =
      config.commitRef === "unknown" && prMetadata.headSha
        ? prMetadata.headSha
        : config.commitRef;

    const metadataConfig =
      normalizedCommitRef === config.commitRef
        ? config
        : { ...config, commitRef: normalizedCommitRef };

    console.log(
      `[pr-review] Targeting ${prMetadata.headRepoOwner}/${prMetadata.headRepoName}@${prMetadata.headRefName}`
    );
    console.log("[pr-review][debug] Commit context", {
      originalCommitRef: config.commitRef,
      normalizedCommitRef,
      headSha: prMetadata.headSha,
    });

    try {
      await startedInstance.setMetadata(
        buildMetadata(prMetadata, metadataConfig)
      );
    } catch (metadataError) {
      const message =
        metadataError instanceof Error
          ? metadataError.message
          : String(metadataError ?? "unknown error");
      console.warn(
        `[pr-review] Warning: failed to set metadata for instance ${startedInstance.id}: ${message}`
      );
    }

    console.log("[pr-review] Waiting for Morph instance to be ready...");
    const finishWaitReady = startTiming("wait for Morph instance ready");
    try {
      await startedInstance.waitUntilReady();
    } finally {
      finishWaitReady();
    }
    console.log(`[pr-review] Instance ${startedInstance.id} is ready.`);

    describeServices(startedInstance);
    logOpenVscodeUrl(startedInstance, REMOTE_WORKSPACE_DIR);

    const openAiApiKey = process.env.OPENAI_API_KEY;
    if (!openAiApiKey || openAiApiKey.length === 0) {
      throw new Error(
        "OPENAI_API_KEY environment variable is required to run PR review."
      );
    }

    const remoteScriptPath = "/root/pr-review-inject.ts";
    const injectScriptSource = await getInjectScriptSource(productionMode);
    const baseRepoUrl = `https://github.com/${prMetadata.owner}/${prMetadata.repo}.git`;
    const headRepoUrl = `https://github.com/${prMetadata.headRepoOwner}/${prMetadata.headRepoName}.git`;

    const envPairs: Array<[string, string]> = [
      ["WORKSPACE_DIR", REMOTE_WORKSPACE_DIR],
      ["PR_URL", prMetadata.prUrl],
      ["GIT_REPO_URL", headRepoUrl],
      ["GIT_BRANCH", prMetadata.headRefName],
      ["BASE_REPO_URL", baseRepoUrl],
      ["BASE_REF_NAME", prMetadata.baseRefName],
      ["OPENAI_API_KEY", openAiApiKey],
      ["LOG_FILE_PATH", REMOTE_LOG_FILE_PATH],
      ["LOG_SYMLINK_PATH", WORKSPACE_LOG_ABSOLUTE_PATH],
      [
        "CODE_REVIEW_OUTPUT_SYMLINK_PATH",
        `${REMOTE_WORKSPACE_DIR}/${CODE_REVIEW_OUTPUT_FILENAME}`,
      ],
      ["JOB_ID", config.jobId],
      ["SANDBOX_INSTANCE_ID", startedInstance.id],
      ["REPO_FULL_NAME", config.repoFullName],
      ["COMMIT_REF", normalizedCommitRef],
    ];

    if (typeof config.showDiffLineNumbers === "boolean") {
      envPairs.push([
        "CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS",
        config.showDiffLineNumbers ? "true" : "false",
      ]);
    }
    if (typeof config.showContextLineNumbers === "boolean") {
      envPairs.push([
        "CMUX_PR_REVIEW_SHOW_CONTEXT_LINE_NUMBERS",
        config.showContextLineNumbers ? "true" : "false",
      ]);
    }
    if (typeof config.strategy === "string" && config.strategy.length > 0) {
      envPairs.push(["CMUX_PR_REVIEW_STRATEGY", config.strategy]);
    }
    if (
      typeof config.diffArtifactMode === "string" &&
      config.diffArtifactMode.length > 0
    ) {
      envPairs.push([
        "CMUX_PR_REVIEW_DIFF_ARTIFACT_MODE",
        config.diffArtifactMode,
      ]);
    }

    if (config.callback) {
      envPairs.push(["CALLBACK_URL", config.callback.url]);
      envPairs.push(["CALLBACK_TOKEN", config.callback.token]);
    }
    if (config.fileCallback) {
      envPairs.push(["FILE_CALLBACK_URL", config.fileCallback.url]);
      envPairs.push(["FILE_CALLBACK_TOKEN", config.fileCallback.token]);
    }
    if (config.githubAccessToken) {
      envPairs.push(["GITHUB_TOKEN", config.githubAccessToken]);
    }
    if (config.teamId) {
      envPairs.push(["TEAM_ID", config.teamId]);
    }

    const envAssignments = envPairs
      .map(([key, value]) => `${key}=${shellQuote(value)}`)
      .join(" ");
    const injectCommand =
      [
        `cat <<'EOF_PR_REVIEW_INJECT' > ${shellQuote(remoteScriptPath)}`,
        injectScriptSource,
        "EOF_PR_REVIEW_INJECT",
        `chmod +x ${shellQuote(remoteScriptPath)}`,
        `rm -f ${shellQuote(REMOTE_LOG_FILE_PATH)}`,
        `nohup env ${envAssignments} bun ${shellQuote(
          remoteScriptPath
        )} > ${shellQuote(REMOTE_LOG_FILE_PATH)} 2>&1 &`,
      ].join("\n") + "\n";

    const finishPrepareRepo = startTiming("dispatch review script");
    try {
      await execOrThrow(startedInstance, injectCommand);
    } finally {
      finishPrepareRepo();
    }

    console.log(
      `[pr-review] Repository preparation is running in the background. Remote log: ${REMOTE_LOG_FILE_PATH}`
    );
    console.log(
      `[pr-review] Symlinked workspace log (once created): ${WORKSPACE_LOG_ABSOLUTE_PATH}`
    );
    logOpenVscodeFileUrl(
      startedInstance,
      REMOTE_WORKSPACE_DIR,
      WORKSPACE_LOG_RELATIVE_PATH
    );
    console.log(
      `[pr-review] Morph instance ${startedInstance.id} provisioned for PR ${prMetadata.prUrl}`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error(`[pr-review] Failure during setup: ${message}`);

    console.log("[pr-review][debug] Failure context", {
      jobId: config.jobId,
      instanceId: instance?.id ?? null,
      errorMessage: message,
    });

    if (config.callback && instance) {
      try {
        await sendCallback(config.callback, {
          status: "error",
          jobId: config.jobId,
          sandboxInstanceId: instance.id,
          errorCode: "pr_review_setup_failed",
          errorDetail: message,
        });
      } catch (callbackError) {
        const callbackMessage =
          callbackError instanceof Error
            ? callbackError.message
            : String(callbackError ?? "Unknown callback error");
        console.error(
          `[pr-review] Callback dispatch failed: ${callbackMessage}`
        );
      }
    } else if (config.callback && !instance) {
      console.warn(
        "[pr-review][debug] Skipping failure callback because Morph instance was never provisioned",
        { jobId: config.jobId }
      );
    }

    if (instance) {
      try {
        // Kill all dev servers before pausing to avoid port conflicts on resume
        await instance.exec(VM_CLEANUP_COMMANDS);
        await instance.pause();
      } catch (pauseError) {
        const pauseMessage =
          pauseError instanceof Error
            ? pauseError.message
            : String(pauseError ?? "Unknown pause error");
        console.warn(
          `[pr-review] Warning: failed to pause instance ${instance.id}: ${pauseMessage}`
        );
      }
    }
    throw error;
  }
}
