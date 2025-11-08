import type { ServerToWorkerEvents, WorkerToServerEvents } from "@cmux/shared";
import { getContainerWorkspacePath } from "@cmux/shared/node/workspace-path";
import type { Socket } from "@cmux/shared/socket";
import { serverLogger } from "./fileLogger";
import { workerExec } from "./workerExec";

const DEFAULT_WORKER_CWD = getContainerWorkspacePath();

interface ResolveWorkerRepoPathParams {
  workerSocket: Socket<WorkerToServerEvents, ServerToWorkerEvents>;
  initialCwd?: string;
  fallbackCwd?: string;
}

export async function resolveWorkerRepoPath({
  workerSocket,
  initialCwd = DEFAULT_WORKER_CWD,
  fallbackCwd,
}: ResolveWorkerRepoPathParams): Promise<string> {
  const detectionScript = [
    "set -euo pipefail",
    "",
    'current_dir="$(pwd)"',
    "",
    "if git rev-parse --show-toplevel >/dev/null 2>&1; then",
    "  git rev-parse --show-toplevel",
    "  exit 0",
    "fi",
    "",
    'git_dirs=$(find "$current_dir" -mindepth 1 -maxdepth 4 -type d -name .git 2>/dev/null | sort)',
    'if [ -n "$git_dirs" ]; then',
    "  first_git_dir=$(printf '%s\n' \"$git_dirs\" | head -n 1)",
    '  repo_dir="$(dirname "$first_git_dir")"',
    '  if git -C "$repo_dir" rev-parse --show-toplevel >/dev/null 2>&1; then',
    '    git -C "$repo_dir" rev-parse --show-toplevel',
    "    exit 0",
    "  fi",
    "fi",
    "",
    'echo "$current_dir"',
  ].join("\n");

  try {
    const { stdout } = await workerExec({
      workerSocket,
      command: "bash",
      args: ["-lc", detectionScript],
      cwd: initialCwd,
      env: {},
      timeout: 15000,
    });

    const resolvedLine = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .reverse()
      .find((line) => !line.includes("=") && line.startsWith("/"));

    if (resolvedLine && resolvedLine.length > 0) {
      if (resolvedLine !== initialCwd) {
        serverLogger.info(
          `[resolveWorkerRepoPath] Resolved repo root ${resolvedLine} from ${initialCwd}`
        );
      }
      return resolvedLine;
    }
  } catch (error) {
    serverLogger.warn(
      `[resolveWorkerRepoPath] Failed to resolve repo root from ${initialCwd}`,
      error
    );
  }

  const fallback = fallbackCwd ?? initialCwd;
  serverLogger.info(
    `[resolveWorkerRepoPath] Falling back to ${fallback} for repo operations`
  );
  return fallback;
}
