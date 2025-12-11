/**
 * Dynamic Screenshot Collector Loader
 *
 * This module handles downloading and executing the screenshot collector bundle
 * from Convex storage at runtime. This allows updating the collector without
 * rebuilding the Morph image.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { log } from "../logger";
import { logToScreenshotCollector } from "./logger";

// Default to production unless CMUX_IS_STAGING is explicitly set to "true"
const IS_STAGING = process.env.CMUX_IS_STAGING === "true";

// Directory to cache downloaded collectors
const COLLECTOR_CACHE_DIR = "/tmp/cmux-screenshot-collector";

// WWW API base URL - defaults to production
const WWW_API_URL =
  process.env.CMUX_WWW_API_URL ?? "https://www.cmux.dev/api";

interface ScreenshotCollectorRelease {
  version: string;
  downloadUrl: string;
  sha256: string;
  size: number;
  commitSha: string;
  uploadedAt: number;
}

interface ScreenshotCollectorModule {
  SCREENSHOT_STORAGE_ROOT: string;
  normalizeScreenshotOutputDir: (outputDir: string) => string;
  claudeCodeCapturePRScreenshots: (
    options: CaptureScreenshotsOptions
  ) => Promise<ScreenshotResult>;
}

interface CaptureScreenshotsOptions {
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

interface ScreenshotResult {
  status: "completed" | "failed" | "skipped";
  screenshots?: { path: string; description?: string }[];
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

let cachedModule: ScreenshotCollectorModule | null = null;
let cachedVersion: string | null = null;

/**
 * Fetch the latest screenshot collector release info from the API.
 */
async function fetchLatestRelease(): Promise<ScreenshotCollectorRelease | null> {
  const url = `${WWW_API_URL}/screenshot-collector/latest`;

  await logToScreenshotCollector(
    `Fetching latest screenshot collector from ${url} (staging=${IS_STAGING})`
  );

  try {
    const response = await fetch(url);

    if (response.status === 404) {
      await logToScreenshotCollector(
        "No screenshot collector release found in storage"
      );
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch release: ${response.status}`);
    }

    const release: ScreenshotCollectorRelease = await response.json();
    await logToScreenshotCollector(
      `Found release: version=${release.version}, sha256=${release.sha256.slice(0, 16)}...`
    );

    return release;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(
      `Failed to fetch screenshot collector release: ${message}`
    );
    log("ERROR", "Failed to fetch screenshot collector release", {
      error: message,
      url,
    });
    return null;
  }
}

/**
 * Compute SHA256 hash of a file.
 */
async function computeSha256(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return hash;
}

/**
 * Download and cache the screenshot collector bundle.
 */
async function downloadAndCache(
  release: ScreenshotCollectorRelease
): Promise<string> {
  await fs.mkdir(COLLECTOR_CACHE_DIR, { recursive: true });

  const cachedPath = path.join(
    COLLECTOR_CACHE_DIR,
    `collector-${release.version}.js`
  );

  // Check if already cached with correct hash
  try {
    const stats = await fs.stat(cachedPath);
    if (stats.isFile()) {
      const existingHash = await computeSha256(cachedPath);
      if (existingHash === release.sha256) {
        await logToScreenshotCollector(
          `Using cached collector: ${cachedPath}`
        );
        return cachedPath;
      }
      await logToScreenshotCollector(
        `Cached collector hash mismatch, re-downloading`
      );
    }
  } catch {
    // File doesn't exist, proceed with download
  }

  await logToScreenshotCollector(
    `Downloading collector from ${release.downloadUrl}`
  );

  const response = await fetch(release.downloadUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to download collector: ${response.status} ${response.statusText}`
    );
  }

  const content = await response.arrayBuffer();
  await logToScreenshotCollector(`Downloaded ${content.byteLength} bytes`);

  // Verify size
  if (content.byteLength !== release.size) {
    await logToScreenshotCollector(
      `Warning: Size mismatch - expected ${release.size}, got ${content.byteLength}`
    );
  }

  // Write to temp file first
  const tempPath = `${cachedPath}.tmp`;
  await fs.writeFile(tempPath, Buffer.from(content));

  // Verify hash
  const downloadedHash = await computeSha256(tempPath);
  if (downloadedHash !== release.sha256) {
    await fs.unlink(tempPath);
    throw new Error(
      `SHA256 mismatch: expected ${release.sha256}, got ${downloadedHash}`
    );
  }

  // Move to final location
  await fs.rename(tempPath, cachedPath);
  await logToScreenshotCollector(`Cached collector at ${cachedPath}`);

  return cachedPath;
}

/**
 * Load the screenshot collector module dynamically.
 */
async function loadCollectorModule(
  bundlePath: string
): Promise<ScreenshotCollectorModule> {
  await logToScreenshotCollector(`Loading collector module from ${bundlePath}`);

  // Dynamic import of the ES module
  const module = await import(bundlePath);

  // Validate required exports
  if (typeof module.claudeCodeCapturePRScreenshots !== "function") {
    throw new Error(
      "Invalid collector module: missing claudeCodeCapturePRScreenshots"
    );
  }
  if (typeof module.normalizeScreenshotOutputDir !== "function") {
    throw new Error(
      "Invalid collector module: missing normalizeScreenshotOutputDir"
    );
  }
  if (typeof module.SCREENSHOT_STORAGE_ROOT !== "string") {
    throw new Error(
      "Invalid collector module: missing SCREENSHOT_STORAGE_ROOT"
    );
  }

  return module as ScreenshotCollectorModule;
}

/**
 * Get the screenshot collector module, downloading if necessary.
 * Falls back to the bundled version if download fails.
 */
export async function getScreenshotCollector(): Promise<ScreenshotCollectorModule> {
  // Check if we have a cached module
  if (cachedModule && cachedVersion) {
    await logToScreenshotCollector(
      `Using cached collector module: ${cachedVersion}`
    );
    return cachedModule;
  }

  // Try to fetch and load the latest release
  try {
    const release = await fetchLatestRelease();

    if (release) {
      const bundlePath = await downloadAndCache(release);
      const module = await loadCollectorModule(bundlePath);

      cachedModule = module;
      cachedVersion = release.version;

      await logToScreenshotCollector(
        `Successfully loaded dynamic collector: ${release.version}`
      );
      return module;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(
      `Failed to load dynamic collector: ${message}`
    );
    log("WARN", "Failed to load dynamic screenshot collector, using bundled", {
      error: message,
    });
  }

  // Fall back to bundled version
  await logToScreenshotCollector(
    "Falling back to bundled screenshot collector"
  );
  const bundled = await import("./claudeScreenshotCollector");
  return bundled as ScreenshotCollectorModule;
}

/**
 * Clear the cached module to force re-download on next use.
 */
export function clearCollectorCache(): void {
  cachedModule = null;
  cachedVersion = null;
}

/**
 * Get the current cached version, or null if not cached.
 */
export function getCachedCollectorVersion(): string | null {
  return cachedVersion;
}
