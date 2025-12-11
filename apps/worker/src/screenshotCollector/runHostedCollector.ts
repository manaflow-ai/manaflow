import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { z } from "zod";
import { log } from "../logger";
import { downloadScreenshotCollectorHost } from "./downloadHost";
import { logToScreenshotCollector } from "./logger";

export const SCREENSHOT_STORAGE_ROOT = "/root/screenshots";

export type ClaudeCodeAuthConfig =
  | { auth: { taskRunJwt: string } }
  | { auth: { anthropicApiKey: string } };

type BranchBaseOptions = {
  workspaceDir: string;
  changedFiles: string[];
  prTitle: string;
  prDescription: string;
  outputDir: string;
  pathToClaudeCodeExecutable?: string;
  installCommand?: string;
  devCommand?: string;
};

type BranchCaptureOptions =
  | (BranchBaseOptions & { branch: string; auth: { taskRunJwt: string } })
  | (BranchBaseOptions & { branch: string; auth: { anthropicApiKey: string } });

type CaptureScreenshotsBaseOptions = BranchBaseOptions & {
  baseBranch: string;
  headBranch: string;
};

export type CaptureScreenshotsOptions =
  | (CaptureScreenshotsBaseOptions & { auth: { taskRunJwt: string } })
  | (CaptureScreenshotsBaseOptions & { auth: { anthropicApiKey: string } });

export interface ScreenshotResult {
  status: "completed" | "failed" | "skipped";
  screenshots?: { path: string; description?: string }[];
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

const hostResultSchema = z.object({
  status: z.enum(["completed", "failed"]),
  screenshots: z
    .array(
      z.object({
        path: z.string(),
        description: z.string().optional(),
      })
    )
    .optional(),
  hasUiChanges: z.boolean().optional(),
  error: z.string().optional(),
});

export function normalizeScreenshotOutputDir(outputDir: string): string {
  if (path.isAbsolute(outputDir)) {
    return path.normalize(outputDir);
  }
  return path.resolve(SCREENSHOT_STORAGE_ROOT, outputDir);
}

function isTaskRunJwtAuth(
  auth: ClaudeCodeAuthConfig["auth"]
): auth is { taskRunJwt: string } {
  return "taskRunJwt" in auth;
}

async function runHostedScript(
  scriptPath: string,
  configPath: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", scriptPath, "--config", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      // Also log stderr lines to screenshot collector log
      for (const line of chunk.split("\n").filter((l) => l.trim())) {
        logToScreenshotCollector(`[host-stdout] ${line}`).catch(() => {});
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      for (const line of chunk.split("\n").filter((l) => l.trim())) {
        logToScreenshotCollector(`[host-stderr] ${line}`).catch(() => {});
      }
    });

    proc.on("error", (error) => {
      reject(new Error(`Failed to spawn host script: ${error.message}`));
    });

    proc.on("close", (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Capture screenshots for a specific branch using the hosted collector script.
 */
export async function captureScreenshotsForBranch(
  options: BranchCaptureOptions
): Promise<{
  screenshots: { path: string; description?: string }[];
  hasUiChanges?: boolean;
}> {
  const {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    branch,
    outputDir: requestedOutputDir,
    auth,
    installCommand,
    devCommand,
    pathToClaudeCodeExecutable,
  } = options;

  const outputDir = normalizeScreenshotOutputDir(requestedOutputDir);

  await logToScreenshotCollector(`Downloading screenshot collector host script...`);

  // Download the hosted script
  const hostScriptPath = await downloadScreenshotCollectorHost();

  await logToScreenshotCollector(`Host script downloaded: ${hostScriptPath}`);

  // Create config file for the host script
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "cmux-screenshot-config-"));
  const configPath = path.join(configDir, "config.json");

  const config = {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    branch,
    outputDir,
    auth: isTaskRunJwtAuth(auth)
      ? { taskRunJwt: auth.taskRunJwt }
      : { anthropicApiKey: auth.anthropicApiKey },
    installCommand,
    devCommand,
    pathToClaudeCodeExecutable,
  };

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));

  await logToScreenshotCollector(
    `Starting hosted collector for branch: ${branch}`
  );

  try {
    const { stdout, stderr, exitCode } = await runHostedScript(
      hostScriptPath,
      configPath
    );

    // Clean up config file
    await fs.rm(configDir, { recursive: true, force: true }).catch(() => {});

    if (exitCode !== 0) {
      throw new Error(
        `Host script exited with code ${exitCode}. Stderr: ${stderr}`
      );
    }

    // Parse the JSON result from stdout (last line should be the JSON)
    const lines = stdout.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      throw new Error("No output from host script");
    }

    let result: z.infer<typeof hostResultSchema>;
    try {
      const parsed = JSON.parse(lastLine);
      result = hostResultSchema.parse(parsed);
    } catch (parseError) {
      throw new Error(
        `Failed to parse host script output: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }

    if (result.status === "failed") {
      throw new Error(result.error ?? "Host script reported failure");
    }

    return {
      screenshots: result.screenshots ?? [],
      hasUiChanges: result.hasUiChanges,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(`Hosted collector failed: ${message}`);
    log("ERROR", "Failed to run hosted screenshot collector", {
      error: message,
    });
    throw error;
  }
}

/**
 * Capture screenshots for a PR using the hosted collector script.
 */
export async function claudeCodeCapturePRScreenshots(
  options: CaptureScreenshotsOptions
): Promise<ScreenshotResult> {
  const {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    baseBranch: _baseBranch,
    headBranch,
    outputDir: requestedOutputDir,
    auth,
  } = options;
  const outputDir = normalizeScreenshotOutputDir(requestedOutputDir);

  try {
    await logToScreenshotCollector(
      `Starting PR screenshot capture in ${workspaceDir}`
    );

    if (changedFiles.length === 0) {
      const reason = "No files changed in PR";
      await logToScreenshotCollector(reason);
      return { status: "skipped", reason };
    }

    await logToScreenshotCollector(
      `Found ${changedFiles.length} changed files: ${changedFiles.join(", ")}`
    );

    await fs.mkdir(outputDir, { recursive: true });

    const allScreenshots: { path: string; description?: string }[] = [];
    let hasUiChanges: boolean | undefined;

    // Capture screenshots for head branch (after changes)
    await logToScreenshotCollector(
      `Capturing 'after' screenshots for head branch: ${headBranch}`
    );

    const afterScreenshots = await captureScreenshotsForBranch(
      isTaskRunJwtAuth(auth)
        ? {
            workspaceDir,
            changedFiles,
            prTitle,
            prDescription,
            branch: headBranch,
            outputDir,
            auth: { taskRunJwt: auth.taskRunJwt },
            pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
            installCommand: options.installCommand,
            devCommand: options.devCommand,
          }
        : {
            workspaceDir,
            changedFiles,
            prTitle,
            prDescription,
            branch: headBranch,
            outputDir,
            auth: { anthropicApiKey: auth.anthropicApiKey },
            pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
            installCommand: options.installCommand,
            devCommand: options.devCommand,
          }
    );

    allScreenshots.push(...afterScreenshots.screenshots);
    if (afterScreenshots.hasUiChanges !== undefined) {
      hasUiChanges = afterScreenshots.hasUiChanges;
    }
    await logToScreenshotCollector(
      `Captured ${afterScreenshots.screenshots.length} 'after' screenshots`
    );

    await logToScreenshotCollector(
      `Screenshot capture completed. Total: ${allScreenshots.length} screenshots saved to ${outputDir}`
    );
    log("INFO", "PR screenshot capture completed", {
      screenshotCount: allScreenshots.length,
      outputDir,
    });

    return {
      status: "completed",
      screenshots: allScreenshots,
      hasUiChanges,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(`PR screenshot capture failed: ${message}`);
    log("ERROR", "PR screenshot capture failed", {
      error: message,
    });
    return {
      status: "failed",
      error: message,
    };
  }
}
