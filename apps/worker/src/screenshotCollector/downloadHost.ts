import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "../logger";

const GITHUB_REPO = "manaflow-ai/cmux";
const RELEASE_TAG = "screenshot-collector-host-latest";
const ASSET_NAME = "screenshot-collector-host.js";

const CACHE_DIR = path.join(os.tmpdir(), "cmux-screenshot-collector-cache");
const CACHED_SCRIPT_PATH = path.join(CACHE_DIR, "screenshot-collector-host.js");
const CACHE_METADATA_PATH = path.join(CACHE_DIR, "metadata.json");

// Cache for 1 hour
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheMetadata {
  downloadedAt: number;
  etag?: string;
  releaseId?: string;
}

async function readCacheMetadata(): Promise<CacheMetadata | null> {
  try {
    const content = await fs.readFile(CACHE_METADATA_PATH, "utf8");
    return JSON.parse(content) as CacheMetadata;
  } catch {
    return null;
  }
}

async function writeCacheMetadata(metadata: CacheMetadata): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_METADATA_PATH, JSON.stringify(metadata), "utf8");
}

async function isCacheValid(): Promise<boolean> {
  const metadata = await readCacheMetadata();
  if (!metadata) {
    return false;
  }

  const age = Date.now() - metadata.downloadedAt;
  if (age > CACHE_TTL_MS) {
    return false;
  }

  try {
    await fs.access(CACHED_SCRIPT_PATH);
    return true;
  } catch {
    return false;
  }
}

async function downloadAsset(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "cmux-worker",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to download asset: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Download the screenshot collector host script from GitHub releases.
 * Uses caching to avoid re-downloading on every invocation.
 *
 * @returns Path to the downloaded script
 */
export async function downloadScreenshotCollectorHost(): Promise<string> {
  // Check if we have a valid cached version
  if (await isCacheValid()) {
    log("DEBUG", "Using cached screenshot collector host", {
      path: CACHED_SCRIPT_PATH,
    });
    return CACHED_SCRIPT_PATH;
  }

  log("INFO", "Downloading screenshot collector host from GitHub releases", {
    repo: GITHUB_REPO,
    tag: RELEASE_TAG,
  });

  try {
    // Fetch release info to get the asset download URL
    const releaseUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}`;
    const releaseResponse = await fetch(releaseUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "cmux-worker",
      },
    });

    if (!releaseResponse.ok) {
      throw new Error(
        `Failed to fetch release info: ${releaseResponse.status} ${releaseResponse.statusText}`
      );
    }

    const releaseData = (await releaseResponse.json()) as {
      id: number;
      assets: Array<{ name: string; browser_download_url: string }>;
    };

    const asset = releaseData.assets.find((a) => a.name === ASSET_NAME);
    if (!asset) {
      throw new Error(`Asset ${ASSET_NAME} not found in release ${RELEASE_TAG}`);
    }

    // Download the asset
    const scriptContent = await downloadAsset(asset.browser_download_url);

    // Write to cache
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHED_SCRIPT_PATH, scriptContent, "utf8");
    await fs.chmod(CACHED_SCRIPT_PATH, 0o755);

    await writeCacheMetadata({
      downloadedAt: Date.now(),
      releaseId: String(releaseData.id),
    });

    log("INFO", "Screenshot collector host downloaded and cached", {
      path: CACHED_SCRIPT_PATH,
      releaseId: releaseData.id,
    });

    return CACHED_SCRIPT_PATH;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("ERROR", "Failed to download screenshot collector host", { error: message });

    // If download fails but we have a cached version (even expired), use it
    try {
      await fs.access(CACHED_SCRIPT_PATH);
      log("WARN", "Using expired cached screenshot collector host due to download failure", {
        path: CACHED_SCRIPT_PATH,
      });
      return CACHED_SCRIPT_PATH;
    } catch {
      throw new Error(`Failed to download screenshot collector host and no cache available: ${message}`);
    }
  }
}

/**
 * Clear the screenshot collector host cache.
 * Useful for forcing a fresh download.
 */
export async function clearScreenshotCollectorHostCache(): Promise<void> {
  try {
    await fs.rm(CACHE_DIR, { recursive: true, force: true });
    log("INFO", "Screenshot collector host cache cleared");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("WARN", "Failed to clear screenshot collector host cache", { error: message });
  }
}
