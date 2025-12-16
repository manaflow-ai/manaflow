import { promises as fs, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as os from "node:os";
import * as path from "node:path";

// Use /var/log/cmux if we have permissions, otherwise use temp dir
let SCREENSHOT_COLLECTOR_LOG_PATH = "/var/log/cmux/screenshot-collector";
let SCREENSHOT_COLLECTOR_DIRECTORY_URL =
  "http://localhost:39378/?folder=/var/log/cmux";

try {
  mkdirSync("/var/log/cmux", { recursive: true });
} catch {
  // Fallback to temp directory for local development
  const tempLogDir = path.join(os.tmpdir(), "cmux-logs");
  mkdirSync(tempLogDir, { recursive: true });
  SCREENSHOT_COLLECTOR_LOG_PATH = path.join(
    tempLogDir,
    "screenshot-collector"
  );
  SCREENSHOT_COLLECTOR_DIRECTORY_URL = `file://${tempLogDir}`;
}

export { SCREENSHOT_COLLECTOR_LOG_PATH, SCREENSHOT_COLLECTOR_DIRECTORY_URL };

export async function logToScreenshotCollector(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}`;

  // Always log to stdout so user can see it
  console.log(logMessage);

  // Also write to file
  try {
    await fs.mkdir(dirname(SCREENSHOT_COLLECTOR_LOG_PATH), {
      recursive: true,
    });
    await fs.appendFile(SCREENSHOT_COLLECTOR_LOG_PATH, `${logMessage}\n`, {
      encoding: "utf8",
    });
  } catch (error) {
    // Silently fail file logging - we already logged to console
  }
}
