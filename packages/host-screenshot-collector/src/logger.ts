import { promises as fs, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as os from "node:os";
import * as path from "node:path";

// Use /var/log/cmux if we have permissions, otherwise use temp dir
// Write to worker.log to consolidate all worker logs in one place
let WORKER_LOG_PATH = "/var/log/cmux/worker.log";
let SCREENSHOT_COLLECTOR_LOG_PATH = "/var/log/cmux/screenshot-collector";
let SCREENSHOT_COLLECTOR_DIRECTORY_URL =
  "http://localhost:39378/?folder=/var/log/cmux";

try {
  mkdirSync("/var/log/cmux", { recursive: true });
} catch {
  // Fallback to temp directory for local development
  const tempLogDir = path.join(os.tmpdir(), "cmux-logs");
  mkdirSync(tempLogDir, { recursive: true });
  WORKER_LOG_PATH = path.join(tempLogDir, "worker.log");
  SCREENSHOT_COLLECTOR_LOG_PATH = path.join(
    tempLogDir,
    "screenshot-collector"
  );
  SCREENSHOT_COLLECTOR_DIRECTORY_URL = `file://${tempLogDir}`;
}

export { SCREENSHOT_COLLECTOR_LOG_PATH, SCREENSHOT_COLLECTOR_DIRECTORY_URL };

export async function logToScreenshotCollector(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [screenshot-collector] ${message}`;

  // Always log to stdout so user can see it (also goes to worker.log via systemd)
  console.log(logMessage);

  // Also write directly to worker.log file for consolidated logging
  try {
    await fs.mkdir(dirname(WORKER_LOG_PATH), {
      recursive: true,
    });
    await fs.appendFile(WORKER_LOG_PATH, `${logMessage}\n`, {
      encoding: "utf8",
    });
  } catch {
    // Silently fail file logging - we already logged to console
  }
}
