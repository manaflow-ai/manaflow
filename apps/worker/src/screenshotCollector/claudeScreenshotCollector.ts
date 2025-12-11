/**
 * Screenshot Collector using Hosted Script
 *
 * This module now delegates to a hosted script that is downloaded from GitHub releases.
 * This allows updating the screenshot capture logic without rebuilding the Morph image.
 *
 * The hosted script is located at: packages/screenshot-collector-host
 * It is published to GitHub releases via: .github/workflows/screenshot-collector-host.yml
 */

export {
  SCREENSHOT_STORAGE_ROOT,
  normalizeScreenshotOutputDir,
  captureScreenshotsForBranch,
  claudeCodeCapturePRScreenshots,
  type ClaudeCodeAuthConfig,
  type CaptureScreenshotsOptions,
  type ScreenshotResult,
} from "./runHostedCollector";
