import type {
  EnvironmentContext,
  EnvironmentResult,
  PostStartCommand,
} from "../common/environment-result";

// Opencode HTTP API configuration
export const OPENCODE_HTTP_HOST = "127.0.0.1";
export const OPENCODE_HTTP_PORT = 4096;

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
  const postStartCommands: PostStartCommand[] = [];

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

  // Add post-start commands to poll the session endpoint and submit the prompt
  // These run after the opencode TUI starts
  const baseUrl = `http://${OPENCODE_HTTP_HOST}:${OPENCODE_HTTP_PORT}`;
  const logFile = "/root/lifecycle/opencode-post-start.log";

  // Command 1: Poll /session until it's ready (with retries)
  postStartCommands.push({
    description: "Wait for opencode session to be ready",
    command: `
      LOG="${logFile}"
      echo "[$(date -Iseconds)] Waiting for opencode session..." >> "$LOG"
      for i in $(seq 1 60); do
        if curl -sf "${baseUrl}/session" >> "$LOG" 2>&1; then
          echo "" >> "$LOG"
          echo "[$(date -Iseconds)] OpenCode session ready after $i attempts" >> "$LOG"
          exit 0
        fi
        sleep 1
      done
      echo "[$(date -Iseconds)] OpenCode session not ready after 60 attempts" >> "$LOG"
      exit 1
    `.trim(),
    timeoutMs: 90000, // 90 seconds total (60 retries * 1 second + overhead)
    continueOnError: false,
  });

  // Command 2: Append the prompt to the TUI's prompt field
  // Use base64 encoding to safely pass through shell without escaping issues
  const promptBase64 = Buffer.from(ctx.prompt).toString("base64");

  postStartCommands.push({
    description: "Append prompt to opencode TUI",
    // Decode base64 prompt, build JSON with jq, then curl
    command: `
      LOG="${logFile}"
      PROMPT=$(echo "${promptBase64}" | base64 -d)
      JSON=$(printf '%s' "$PROMPT" | jq -Rs '{text: .}')
      echo "[$(date -Iseconds)] Appending prompt to TUI..." >> "$LOG"
      echo "JSON payload: $JSON" >> "$LOG"
      RESULT=$(curl -sf -X POST "${baseUrl}/tui/append-prompt" -H "Content-Type: application/json" -d "$JSON" 2>&1)
      echo "[$(date -Iseconds)] append-prompt result: $RESULT" >> "$LOG"
    `.trim(),
    timeoutMs: 30000, // 30 seconds
    continueOnError: false,
  });

  // Command 3: Submit the prompt (triggers execution)
  postStartCommands.push({
    description: "Submit prompt to opencode",
    command: `
      LOG="${logFile}"
      echo "[$(date -Iseconds)] Submitting prompt..." >> "$LOG"
      RESULT=$(curl -sf -X POST "${baseUrl}/tui/submit-prompt" 2>&1)
      echo "[$(date -Iseconds)] submit-prompt result: $RESULT" >> "$LOG"
    `.trim(),
    timeoutMs: 30000, // 30 seconds
    continueOnError: false,
  });

  return { files, env, startupCommands, postStartCommands };
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
