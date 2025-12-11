import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

import { log } from "../logger";
import { logToScreenshotCollector } from "./logger";

const GITHUB_REPO = "manaflow-ai/cmux";
const RELEASE_TAG = "screenshot-collector-latest";
const SCRIPT_FILENAME = "claude-screenshot-collector.js";
const CACHE_DIR = "/tmp/cmux-screenshot-collector";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Configuration for the screenshot collector script
 */
export interface ScreenshotCollectorConfig {
  workspaceDir: string;
  changedFiles: string[];
  prTitle: string;
  prDescription: string;
  baseBranch: string;
  headBranch: string;
  outputDir: string;
  pathToClaudeCodeExecutable?: string;
  installCommand?: string;
  devCommand?: string;
  auth: { taskRunJwt: string } | { anthropicApiKey: string };
}

/**
 * Result from running the screenshot collector
 */
export interface ScreenshotCollectorResult {
  status: "completed" | "failed" | "skipped";
  screenshots?: { path: string; description?: string }[];
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

const resultSchema = z.object({
  status: z.enum(["completed", "failed", "skipped"]),
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
  reason: z.string().optional(),
});

/**
 * Get the cached script path and check if it's still valid
 */
async function getCachedScript(): Promise<string | null> {
  const scriptPath = path.join(CACHE_DIR, SCRIPT_FILENAME);
  const metaPath = path.join(CACHE_DIR, "meta.json");

  try {
    const [scriptStat, metaContent] = await Promise.all([
      fs.stat(scriptPath),
      fs.readFile(metaPath, "utf8"),
    ]);

    const meta = JSON.parse(metaContent);
    const fetchedAt = new Date(meta.fetchedAt).getTime();
    const now = Date.now();

    if (now - fetchedAt < CACHE_TTL_MS && scriptStat.isFile()) {
      await logToScreenshotCollector(
        `Using cached screenshot collector (fetched ${Math.round((now - fetchedAt) / 1000)}s ago)`
      );
      return scriptPath;
    }
  } catch {
    // Cache doesn't exist or is invalid
  }

  return null;
}

/**
 * Download the latest screenshot collector from GitHub releases
 */
async function downloadLatestScript(): Promise<string> {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const downloadUrl = `https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/${SCRIPT_FILENAME}`;

  await logToScreenshotCollector(
    `Downloading screenshot collector from ${downloadUrl}`
  );

  const response = await fetch(downloadUrl, {
    headers: {
      Accept: "application/octet-stream",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download screenshot collector: ${response.status} ${response.statusText}`
    );
  }

  const scriptContent = await response.text();
  const scriptPath = path.join(CACHE_DIR, SCRIPT_FILENAME);
  const metaPath = path.join(CACHE_DIR, "meta.json");

  await Promise.all([
    fs.writeFile(scriptPath, scriptContent, "utf8"),
    fs.writeFile(
      metaPath,
      JSON.stringify({
        fetchedAt: new Date().toISOString(),
        url: downloadUrl,
      }),
      "utf8"
    ),
  ]);

  await logToScreenshotCollector(
    `Downloaded screenshot collector to ${scriptPath}`
  );

  return scriptPath;
}

/**
 * Get the path to the screenshot collector script, downloading if necessary
 */
async function getScriptPath(): Promise<string> {
  // Check cache first
  const cachedPath = await getCachedScript();
  if (cachedPath) {
    return cachedPath;
  }

  // Download fresh
  return downloadLatestScript();
}

/**
 * Run the screenshot collector script with the given config
 */
export async function fetchAndRunScreenshotCollector(
  config: ScreenshotCollectorConfig
): Promise<ScreenshotCollectorResult> {
  const scriptPath = await getScriptPath();

  // Write config to a temp file
  const configPath = path.join(CACHE_DIR, `config-${Date.now()}.json`);
  await fs.writeFile(configPath, JSON.stringify(config), "utf8");

  await logToScreenshotCollector(
    `Running screenshot collector with config at ${configPath}`
  );

  return new Promise((resolve) => {
    const bunPath = process.env.BUN_PATH || "bun";
    const child = spawn(bunPath, ["run", scriptPath, "--config", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Ensure bun uses the right home directory
        HOME: process.env.HOME || "/root",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log stderr lines as they come (these are the collector's logs)
      const lines = chunk.split("\n").filter((line: string) => line.trim());
      for (const line of lines) {
        logToScreenshotCollector(`[collector] ${line}`);
      }
    });

    child.on("error", (error) => {
      log("ERROR", "Failed to spawn screenshot collector", {
        error: error.message,
      });
      resolve({
        status: "failed",
        error: `Failed to spawn screenshot collector: ${error.message}`,
      });
    });

    child.on("close", async (code) => {
      // Clean up config file
      try {
        await fs.unlink(configPath);
      } catch {
        // Ignore cleanup errors
      }

      if (code !== 0 && code !== null) {
        log("ERROR", "Screenshot collector exited with error", {
          code,
          stderr: stderr.slice(-1000),
        });

        // Try to parse stdout in case it contains a result anyway
        try {
          const result = resultSchema.parse(JSON.parse(stdout.trim()));
          resolve(result);
          return;
        } catch {
          // Fall through to error
        }

        resolve({
          status: "failed",
          error: `Screenshot collector exited with code ${code}`,
        });
        return;
      }

      // Parse the JSON result from stdout
      try {
        const result = resultSchema.parse(JSON.parse(stdout.trim()));
        await logToScreenshotCollector(
          `Screenshot collector completed with status: ${result.status}`
        );
        resolve(result);
      } catch (parseError) {
        log("ERROR", "Failed to parse screenshot collector output", {
          stdout: stdout.slice(-1000),
          error:
            parseError instanceof Error ? parseError.message : String(parseError),
        });
        resolve({
          status: "failed",
          error: `Failed to parse screenshot collector output: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        });
      }
    });
  });
}

/**
 * Force refresh the cached script (useful for testing or when a new version is needed)
 */
export async function refreshCachedScript(): Promise<string> {
  await logToScreenshotCollector("Force refreshing screenshot collector cache");
  return downloadLatestScript();
}
