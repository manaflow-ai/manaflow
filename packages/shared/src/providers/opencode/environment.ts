import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";

async function buildOpencodeEnvironment(
  ctx: EnvironmentContext,
  opts: { skipAuth: boolean; xaiApiKey?: boolean }
): Promise<EnvironmentResult> {
  // These must be lazy since configs are imported into the browser
  const { readFile } = await import("node:fs/promises");
  const { homedir } = await import("node:os");
  const { Buffer } = await import("node:buffer");
  const files: EnvironmentResult["files"] = [];
  const env: Record<string, string> = {};
  const startupCommands: string[] = [];

  // Ensure .local/share/opencode directory exists
  startupCommands.push("mkdir -p ~/.local/share/opencode");
  // Ensure OpenCode plugin directory exists
  startupCommands.push("mkdir -p ~/.config/opencode/plugin");
  // Ensure lifecycle directories exist for completion hooks
  startupCommands.push("mkdir -p /root/lifecycle");
  startupCommands.push("mkdir -p /root/lifecycle/opencode");
  startupCommands.push("rm -f /root/lifecycle/opencode-complete-* 2>/dev/null || true");

  // Copy auth.json unless explicitly skipped (grok-code doesn't need it)
  if (!opts.skipAuth) {
    try {
      const authContent = await readFile(
        `${homedir()}/.local/share/opencode/auth.json`,
        "utf-8"
      );
      files.push({
        destinationPath: "$HOME/.local/share/opencode/auth.json",
        contentBase64: Buffer.from(authContent).toString("base64"),
        mode: "600",
      });
    } catch (error) {
      console.warn("Failed to read opencode auth.json:", error);
    }
  }
  // Install OpenCode lifecycle completion hook script
  const completionHook = `#!/bin/bash
set -euo pipefail

MARKER_DIR="/root/lifecycle"
TASK_ID="\${CMUX_TASK_RUN_ID:-unknown}"
MARKER_FILE="\${MARKER_DIR}/opencode-complete-\${TASK_ID}"
GENERIC_MARKER="\${MARKER_DIR}/done.txt"
LOG_FILE="/root/lifecycle/opencode-hook.log"

mkdir -p "\${MARKER_DIR}"

if command -v date >/dev/null 2>&1; then
  date +%s > "\${MARKER_FILE}"
else
  printf '%s\n' "completed" > "\${MARKER_FILE}"
fi

touch "\${GENERIC_MARKER}"

echo "[CMUX] OpenCode session complete for task \${TASK_ID}" >> "\${LOG_FILE}"
ls -la "\${MARKER_FILE}" >> "\${LOG_FILE}" 2>&1
`;

  files.push({
    destinationPath: "/root/lifecycle/opencode/session-complete-hook.sh",
    contentBase64: Buffer.from(completionHook).toString("base64"),
    mode: "755",
  });

  // Install OpenCode Notification plugin to invoke completion hook
  const pluginContent = `\
export const NotificationPlugin = async ({ project: _project, client: _client, $, directory: _directory, worktree: _worktree }) => {
  return {
    event: async ({ event }) => {
      // Send notification on session completion
      if (event.type === "session.idle") {
        try {
          await $\`/root/lifecycle/opencode/session-complete-hook.sh\`
        } catch (primaryError) {
          try {
            await $\`bash -lc "/root/lifecycle/opencode/session-complete-hook.sh"\`
          } catch (fallbackError) {
            console.error("[CMUX] Failed to run OpenCode completion hook", primaryError, fallbackError);
          }
        }
      }
    },
  }
}
`;

  files.push({
    destinationPath: "$HOME/.config/opencode/plugin/notification.js",
    contentBase64: Buffer.from(pluginContent).toString("base64"),
    mode: "644",
  });

  // Pass XAI_API_KEY if requested and available
  if (opts.xaiApiKey && ctx.apiKeys?.XAI_API_KEY) {
    env.XAI_API_KEY = ctx.apiKeys.XAI_API_KEY;
  }

  return { files, env, startupCommands };
}

export async function getOpencodeEnvironment(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  return buildOpencodeEnvironment(ctx, { skipAuth: false });
}

export async function getOpencodeEnvironmentSkipAuth(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  return buildOpencodeEnvironment(ctx, { skipAuth: true });
}

export async function getOpencodeEnvironmentWithXai(
  ctx: EnvironmentContext
): Promise<EnvironmentResult> {
  return buildOpencodeEnvironment(ctx, { skipAuth: false, xaiApiKey: true });
}
