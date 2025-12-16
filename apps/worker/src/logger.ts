import { promises, mkdirSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Use /var/log/cmux if we have permissions, otherwise use temp dir
let LOG_FILE = "/var/log/cmux/worker.log";
let canWriteToVarLog = false;

try {
  mkdirSync("/var/log/cmux", { recursive: true });
  canWriteToVarLog = true;
} catch {
  // Fallback to temp directory for local development
  const tempLogDir = path.join(os.tmpdir(), "cmux-logs");
  mkdirSync(tempLogDir, { recursive: true });
  LOG_FILE = path.join(tempLogDir, "worker.log");
}

export function log(
  level: string,
  message: string,
  data?: unknown,
  workerId?: string
) {
  const timestamp = new Date().toISOString();
  const workerIdStr = workerId ? `[${workerId}]` : "";
  const logEntry = `[${timestamp}]${workerIdStr} [${level}] ${message}${data ? ` ${JSON.stringify(data, null, 2)}` : ""}\n`;

  // Console log immediately
  console.log(logEntry.trim());

  // File log in background (fire and forget)
  promises.appendFile(LOG_FILE, logEntry).catch((error) => {
    console.error("Failed to write to log file:", error);
  });
}
