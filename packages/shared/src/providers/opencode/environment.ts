import type {
  EnvironmentContext,
  EnvironmentResult,
} from "../common/environment-result";
import {
  getMemoryStartupCommand,
  getMemorySeedFiles,
  getMemoryProtocolInstructions,
  getProjectContextFile,
} from "../../agent-memory-protocol";

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
  // Note: crown/complete is called by the worker after the completion detector resolves,
  // NOT here. This hook only writes marker files for the filesystem watcher.
  // Memory sync runs before marker creation to ensure data is synced before completion.
  const completionHook = `#!/bin/bash
set -euo pipefail

MARKER_DIR="/root/lifecycle"
TASK_ID="\${CMUX_TASK_RUN_ID:-unknown}"
MARKER_FILE="\${MARKER_DIR}/opencode-complete-\${TASK_ID}"
GENERIC_MARKER="\${MARKER_DIR}/done.txt"
LOG_FILE="/root/lifecycle/opencode-hook.log"

mkdir -p "\${MARKER_DIR}"

# Sync memory files to Convex (best-effort, before completion marker)
echo "[CMUX] Syncing memory files..." >> "\${LOG_FILE}"
/root/lifecycle/memory/sync.sh >> "\${LOG_FILE}" 2>&1 || true

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
  // Only fires completion when session is idle AND has assistant messages (not just errors)
  const pluginContent = `\
export const NotificationPlugin = async ({ project: _project, client, $, directory: _directory, worktree: _worktree }) => {
  let completionFired = false;
  const fs = await import("node:fs");
  const path = await import("node:path");
  const log = (msg) => {
    const line = "[" + new Date().toISOString() + "] " + msg + "\\n";
    fs.appendFileSync("/root/lifecycle/opencode-plugin.log", line);
  };

  const normalizeMessage = (raw) => {
    const info = raw?.info || raw || {};
    return {
      id: info.id,
      role: info.role,
      finish: info.finish,
      time: info.time,
      error: info.error,
    };
  };

  // Layer 1: SDK client (OpenCode >= 1.2.2 with working SDK)
  const fetchMessagesViaClient = async () => {
    const sessions = await client.session.list();
    const sessionList = sessions?.data ?? sessions;
    const allSessions = Array.isArray(sessionList) ? sessionList : [sessionList];
    const messages = [];

    for (const session of allSessions) {
      if (!session?.id) continue;
      const result = await client.session.messages({ path: { id: session.id } });
      const msgArray = result?.data ?? result;
      for (const msg of (Array.isArray(msgArray) ? msgArray : [])) {
        messages.push(normalizeMessage(msg));
      }
    }

    // SDK can return soft errors (undefined/empty) without throwing;
    // force fallback to HTTP layer when sessions exist but no messages found
    if (messages.length === 0 && allSessions.length > 0) {
      throw new Error("SDK returned 0 messages for " + allSessions.length + " session(s)");
    }

    return messages;
  };

  // Layer 2: HTTP REST API (OpenCode >= 1.2.2 with HTTP server)
  const fetchMessagesViaHttp = async () => {
    const res = await fetch("http://127.0.0.1:4096/session");
    if (!res.ok) throw new Error("Session API returned " + res.status);
    const sessionData = await res.json();
    const sessions = Array.isArray(sessionData) ? sessionData : [sessionData];
    const messages = [];
    let anyMessageFetchOk = false;

    for (const session of sessions) {
      if (!session?.id) continue;
      const msgRes = await fetch("http://127.0.0.1:4096/session/" + session.id + "/message");
      if (!msgRes.ok) {
        log("HTTP message fetch failed for session " + session.id + ": " + msgRes.status);
        continue;
      }
      anyMessageFetchOk = true;
      const msgData = await msgRes.json();
      for (const msg of (Array.isArray(msgData) ? msgData : [])) {
        messages.push(normalizeMessage(msg));
      }
    }

    // If sessions exist but all message fetches failed, force fallback to filesystem
    if (!anyMessageFetchOk && sessions.length > 0) {
      throw new Error("All HTTP message fetches failed for " + sessions.length + " session(s)");
    }

    return messages;
  };

  // Layer 3: filesystem (OpenCode < 1.2.0 with file-based storage)
  const readMessagesFromStorage = () => {
    const storageBase = path.join(process.env.HOME || "/root", ".local/share/opencode/storage");
    const messageDir = path.join(storageBase, "message");
    const messages = [];

    try {
      // Find all session directories
      const sessionDirs = fs.readdirSync(messageDir).filter(d => d.startsWith("ses_"));
      for (const sessionDir of sessionDirs) {
        const sessionPath = path.join(messageDir, sessionDir);
        const msgFiles = fs.readdirSync(sessionPath).filter(f => f.endsWith(".json"));
        for (const msgFile of msgFiles) {
          try {
            const content = fs.readFileSync(path.join(sessionPath, msgFile), "utf-8");
            messages.push(normalizeMessage(JSON.parse(content)));
          } catch (e) {
            log("Failed to parse message file " + msgFile + ": " + e);
          }
        }
      }
    } catch (e) {
      log("Error reading message storage: " + e);
    }

    return messages;
  };

  return {
    event: async ({ event }) => {
      // Prevent duplicate completion hooks
      if (completionFired) return;

      const props = event?.properties ?? {};
      const statusType =
        props.status?.type ??
        props.status ??
        event?.status?.type ??
        event?.status;
      const isIdle =
        event.type === "session.idle" ||
        (event.type === "session.status" && statusType === "idle");

      if (!isIdle) return;

      log("session.idle event received");

      // Check if the session has actual assistant work (not just errors)
      // This prevents marking errored sessions (e.g., "Forbidden") as completed
      let shouldComplete = false; // Default to NOT completing - must prove success

      try {
        let messages = [];
        let source = "none";
        try {
          messages = await fetchMessagesViaClient();
          source = "sdk-client";
        } catch (sdkErr) {
          log("SDK client failed (" + (sdkErr?.message ?? sdkErr) + "), trying HTTP API");
          try {
            messages = await fetchMessagesViaHttp();
            source = "http-api";
          } catch (httpErr) {
            log("HTTP API failed (" + (httpErr?.message ?? httpErr) + "), trying filesystem");
            messages = readMessagesFromStorage();
            source = "filesystem";
          }
        }
        log("Got " + messages.length + " messages from " + source);

        // Find assistant messages
        const assistantMsgs = messages.filter((m) => m.role === "assistant");
        log("Found " + assistantMsgs.length + " assistant messages");

        // If no assistant messages, don't complete (nothing was done)
        if (assistantMsgs.length === 0) {
          log("No assistant messages found, skipping completion");
          return;
        }

        // Check if ANY assistant message completed successfully
        const hasSuccessfulCompletion = assistantMsgs.some((m) => {
          // Check for explicit error in the message
          const hasExplicitError = m.error != null && typeof m.error === "object";

          // Check for successful finish reason
          const hasFinish = m.finish && m.finish !== "error";

          // Check for completed timestamp
          const hasCompleted = m.time?.completed != null;

          log("Msg " + m.id + ": error=" + (hasExplicitError ? "YES(" + (m.error?.name || "unknown") + ")" : "no") + " finish=" + m.finish + " completed=" + hasCompleted);

          // If there's an explicit error object, this message failed
          if (hasExplicitError) {
            log("Message has error, not counting as success");
            return false;
          }

          // Success if finished or completed without error
          return hasFinish || hasCompleted;
        });

        if (hasSuccessfulCompletion) {
          log("Found successful completion, will fire hook");
          shouldComplete = true;
        } else {
          log("No successful completion found, skipping hook");
        }
      } catch (err) {
        // If anything fails, log it but don't complete
        log("Error in plugin: " + (err?.message ?? err));
        return;
      }

      if (!shouldComplete) {
        return;
      }

      // Set guard before await to prevent duplicate hook fires from concurrent idle events
      completionFired = true;
      try {
        await $\`/root/lifecycle/opencode/session-complete-hook.sh\`
      } catch (primaryError) {
        try {
          await $\`bash -lc "/root/lifecycle/opencode/session-complete-hook.sh"\`
        } catch (fallbackError) {
          console.error("[CMUX] Failed to run OpenCode completion hook", primaryError, fallbackError);
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
  const baseUrl = `http://${OPENCODE_HTTP_HOST}:${OPENCODE_HTTP_PORT}`;
  const promptBase64 = Buffer.from(ctx.prompt).toString("base64");

  const postStartScript = `#!/bin/bash
set -euo pipefail

LOG="/root/lifecycle/opencode-post-start.log"
BASE_URL="${baseUrl}"
PROMPT_BASE64="${promptBase64}"

log() {
  echo "[$(date -Iseconds)] $*" >> "$LOG"
}

wait_for_session() {
  for i in $(seq 1 60); do
    if curl -sf "\${BASE_URL}/session" >> "$LOG" 2>&1; then
      log "OpenCode session ready after \${i} attempts"
      return 0
    fi
    sleep 1
  done
  log "OpenCode session not ready after 60 attempts"
  return 1
}

append_prompt() {
  local prompt json
  prompt=$(echo "\${PROMPT_BASE64}" | base64 -d)
  json=$(printf '%s' "$prompt" | jq -Rs '{text: .}')
  for j in $(seq 1 3); do
    if curl -sf -X POST "\${BASE_URL}/tui/append-prompt" -H "Content-Type: application/json" -d "$json" >> "$LOG" 2>&1; then
      log "append-prompt succeeded on attempt \${j}"
      return 0
    fi
    sleep 1
  done
  log "append-prompt failed after 3 attempts"
  return 1
}

submit_prompt() {
  for j in $(seq 1 3); do
    if curl -sf -X POST "\${BASE_URL}/tui/submit-prompt" >> "$LOG" 2>&1; then
      log "submit-prompt succeeded on attempt \${j}"
      return 0
    fi
    sleep 1
  done
  log "submit-prompt failed after 3 attempts"
  return 1
}

log "Post-start script begin"
if ! wait_for_session; then
  log "Aborting post-start because session never became ready"
  exit 1
fi

prompt=$(echo "\${PROMPT_BASE64}" | base64 -d)
expected_fragment=$(printf '%s' "$prompt" | tr '\n\t' '  ' | sed -E 's/[[:space:]]+/ /g' | sed -E 's/^ +| +$//g' | cut -c1-64)
if [ -z "$expected_fragment" ]; then
  log "Prompt is empty after decode; skipping auto-submit"
  log "Post-start script end"
  exit 0
fi

log "Expected title fragment: \${expected_fragment}"
sleep 2

sent=0

for attempt in $(seq 1 12); do
  if [ "\${sent}" -eq 0 ]; then
    log "Prompt send attempt \${attempt}"
    if append_prompt && submit_prompt; then
      sent=1
      log "Prompt submitted"
    else
      log "Prompt send failed; will retry"
    fi
  else
    log "Prompt already submitted; waiting for title update (attempt \${attempt})"
  fi
  sleep 2
  title=$(curl -sf "\${BASE_URL}/session" | jq -r 'if type == "array" then (.[0].title // "") else (.title // "") end' 2>>"$LOG" || true)
  log "Session title after attempt \${attempt}: \${title}"
  if [ -n "$title" ] && printf '%s' "$title" | grep -Fq "$expected_fragment"; then
    log "Session title matched expected fragment"
    break
  fi
  sleep 5
done
log "Post-start script end"
`;

  files.push({
    destinationPath: "/root/lifecycle/opencode/post-start.sh",
    contentBase64: Buffer.from(postStartScript).toString("base64"),
    mode: "755",
  });

  // Run post-start script in background via nohup in startupCommands.
  // NOTE: Cannot use postStartCommands here because cmux-pty backend sends them
  // as PTY input to the TUI rather than running them as separate processes.
  // The script logs to /root/lifecycle/opencode-post-start.log for debugging.
  startupCommands.push(
    "nohup /root/lifecycle/opencode/post-start.sh >/root/lifecycle/opencode-post-start.log 2>&1 &"
  );

  // Add agent memory protocol support
  startupCommands.push(getMemoryStartupCommand());
  files.push(...getMemorySeedFiles(ctx.taskRunId, ctx.previousKnowledge, ctx.previousMailbox, ctx.orchestrationOptions));

  // Inject GitHub Projects context if task is linked to a project item (Phase 5)
  if (ctx.githubProjectContext) {
    files.push(
      getProjectContextFile({
        ...ctx.githubProjectContext,
        taskRunJwt: ctx.taskRunJwt,
        callbackUrl: ctx.callbackUrl,
      }),
    );
  }

  // Add OPENCODE.md with memory protocol instructions for the project
  const opencodeMdContent = `# cmux Project Instructions

${getMemoryProtocolInstructions()}
`;
  files.push({
    destinationPath: "/root/workspace/OPENCODE.md",
    contentBase64: Buffer.from(opencodeMdContent).toString("base64"),
    mode: "644",
  });

  return { files, env, startupCommands, postStartCommands: [] };
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
