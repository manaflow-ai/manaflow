/**
 * Remote screenshot collector that fetches the bundled script from the www server
 * and executes it locally. This eliminates the need to rebuild the Morph worker image
 * when making changes to the screenshot collection logic.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "../logger";
import { logToScreenshotCollector } from "./logger";

const SCRIPT_CACHE_DIR = "/tmp/cmux-scripts";
const SCRIPT_NAME = "screenshot-collector.js";

// Default to production URL, can be overridden via environment variable
const getScriptBaseUrl = (): string => {
  return process.env.CMUX_SCRIPT_BASE_URL || "https://www.cmux.dev";
};

interface FetchScriptResult {
  scriptPath: string;
  fromCache: boolean;
}

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(SCRIPT_CACHE_DIR, { recursive: true });
}

async function getCachedScriptPath(): Promise<string> {
  return path.join(SCRIPT_CACHE_DIR, SCRIPT_NAME);
}

async function getCachedEtag(): Promise<string | null> {
  const etagPath = path.join(SCRIPT_CACHE_DIR, `${SCRIPT_NAME}.etag`);
  try {
    return await fs.readFile(etagPath, "utf-8");
  } catch {
    return null;
  }
}

async function saveCachedEtag(etag: string): Promise<void> {
  const etagPath = path.join(SCRIPT_CACHE_DIR, `${SCRIPT_NAME}.etag`);
  await fs.writeFile(etagPath, etag, "utf-8");
}

/**
 * Fetch the screenshot collector script from the www server.
 * Uses ETag-based caching to avoid re-downloading if the script hasn't changed.
 */
async function fetchScript(): Promise<FetchScriptResult> {
  await ensureCacheDir();
  const scriptPath = await getCachedScriptPath();
  const cachedEtag = await getCachedEtag();
  const baseUrl = getScriptBaseUrl();
  const scriptUrl = `${baseUrl}/api/scripts/screenshot-collector`;

  await logToScreenshotCollector(`Fetching screenshot collector script from ${scriptUrl}`);

  const headers: Record<string, string> = {};
  if (cachedEtag) {
    headers["If-None-Match"] = cachedEtag;
  }

  const response = await fetch(scriptUrl, { headers });

  if (response.status === 304) {
    // Script hasn't changed, use cached version
    await logToScreenshotCollector("Using cached screenshot collector script (304 Not Modified)");
    return { scriptPath, fromCache: true };
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch script: ${response.status} ${response.statusText}: ${errorText}`);
  }

  const scriptContent = await response.text();
  await fs.writeFile(scriptPath, scriptContent, "utf-8");
  await fs.chmod(scriptPath, 0o755); // Make executable

  const etag = response.headers.get("ETag");
  if (etag) {
    await saveCachedEtag(etag);
  }

  await logToScreenshotCollector(`Downloaded new screenshot collector script (${scriptContent.length} bytes)`);
  return { scriptPath, fromCache: false };
}

export type RemoteScreenshotAuth =
  | { taskRunJwt: string }
  | { anthropicApiKey: string };

export interface RemoteScreenshotOptions {
  workspaceDir: string;
  changedFiles: string[];
  prTitle: string;
  prDescription: string;
  branch: string;
  outputDir: string;
  pathToClaudeCodeExecutable?: string;
  installCommand?: string;
  devCommand?: string;
  auth: RemoteScreenshotAuth;
}

export interface RemoteScreenshotResult {
  screenshots: { path: string; description?: string }[];
  hasUiChanges?: boolean;
}

/**
 * Execute the remote screenshot collector script.
 * This function fetches the script from the www server and executes it locally.
 */
export async function executeRemoteScreenshotCollector(
  options: RemoteScreenshotOptions
): Promise<RemoteScreenshotResult> {
  // Fetch the script
  const { scriptPath, fromCache } = await fetchScript();
  await logToScreenshotCollector(`Using script at ${scriptPath} (cached: ${fromCache})`);

  // Prepare the config JSON
  const config = {
    workspaceDir: options.workspaceDir,
    changedFiles: options.changedFiles,
    prTitle: options.prTitle,
    prDescription: options.prDescription,
    branch: options.branch,
    outputDir: options.outputDir,
    pathToClaudeCodeExecutable: options.pathToClaudeCodeExecutable,
    installCommand: options.installCommand,
    devCommand: options.devCommand,
    auth: options.auth,
  };

  const configJson = JSON.stringify(config);

  await logToScreenshotCollector(`Executing screenshot collector with config (${configJson.length} chars)`);

  return new Promise((resolve, reject) => {
    // Execute the script using bun
    const child = spawn("bun", ["run", scriptPath, "--config", configJson], {
      cwd: options.workspaceDir,
      env: {
        ...process.env,
        // Pass through any relevant environment variables
        IS_SANDBOX: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      // Stream stdout to our logger
      for (const line of text.split("\n").filter((l) => l.trim())) {
        logToScreenshotCollector(`[remote-collector] ${line}`).catch(() => {});
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      // Stream stderr to our logger
      for (const line of text.split("\n").filter((l) => l.trim())) {
        logToScreenshotCollector(`[remote-collector-err] ${line}`).catch(() => {});
      }
    });

    child.on("error", (error) => {
      log("ERROR", "Failed to spawn screenshot collector process", { error: error.message });
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (code !== 0) {
        const error = new Error(
          `Screenshot collector exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`
        );
        log("ERROR", "Screenshot collector failed", {
          code,
          signal,
          stderr: stderr.slice(0, 1000),
        });
        reject(error);
        return;
      }

      // Parse the result from stdout
      // The script outputs the result as JSON between markers
      const resultMatch = stdout.match(/---RESULT_START---\s*([\s\S]*?)\s*---RESULT_END---/);
      if (!resultMatch || !resultMatch[1]) {
        const error = new Error("Could not find result in script output");
        log("ERROR", "Screenshot collector did not output valid result", {
          stdout: stdout.slice(0, 1000),
        });
        reject(error);
        return;
      }

      try {
        const result = JSON.parse(resultMatch[1]) as RemoteScreenshotResult;
        resolve(result);
      } catch (parseError) {
        const error = new Error(
          `Failed to parse script result: ${parseError instanceof Error ? parseError.message : String(parseError)}`
        );
        log("ERROR", "Failed to parse screenshot collector result", {
          parseError: parseError instanceof Error ? parseError.message : String(parseError),
          resultText: resultMatch[1].slice(0, 500),
        });
        reject(error);
      }
    });
  });
}

/**
 * Check if the remote script execution mode should be used.
 * Enabled by default in Morph environments, can be overridden via environment variable.
 */
export function shouldUseRemoteScript(): boolean {
  // Can be explicitly enabled/disabled via environment variable
  const envValue = process.env.CMUX_USE_REMOTE_SCREENSHOT_SCRIPT;
  if (envValue !== undefined) {
    return envValue === "1" || envValue === "true";
  }

  // Default: enable in sandbox environments (Morph instances)
  return process.env.IS_SANDBOX === "1";
}
