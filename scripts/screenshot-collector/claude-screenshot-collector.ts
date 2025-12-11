#!/usr/bin/env bun
/**
 * Standalone Claude Screenshot Collector
 *
 * This script is released independently to GitHub Releases and fetched at runtime
 * by the worker. This allows updates to the screenshot collection logic without
 * rebuilding the Morph image.
 *
 * Usage:
 *   bun run claude-screenshot-collector.ts --config /path/to/config.json
 *
 * Config JSON format:
 * {
 *   "workspaceDir": "/path/to/repo",
 *   "changedFiles": ["file1.ts", "file2.tsx"],
 *   "prTitle": "PR Title",
 *   "prDescription": "PR Description",
 *   "baseBranch": "main",
 *   "headBranch": "feature-branch",
 *   "outputDir": "/root/screenshots/output",
 *   "pathToClaudeCodeExecutable": "/root/.bun/bin/claude",
 *   "installCommand": "bun install",
 *   "devCommand": "bun run dev",
 *   "auth": { "taskRunJwt": "..." } | { "anthropicApiKey": "..." }
 * }
 *
 * Output: JSON written to stdout with result
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { promises as fs, mkdirSync } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

// ============================================================================
// Configuration Schema
// ============================================================================

const authSchema = z.union([
  z.object({ taskRunJwt: z.string() }),
  z.object({ anthropicApiKey: z.string() }),
]);

const configSchema = z.object({
  workspaceDir: z.string(),
  changedFiles: z.array(z.string()),
  prTitle: z.string(),
  prDescription: z.string(),
  baseBranch: z.string(),
  headBranch: z.string(),
  outputDir: z.string(),
  pathToClaudeCodeExecutable: z.string().optional(),
  installCommand: z.string().optional(),
  devCommand: z.string().optional(),
  auth: authSchema,
});

type Config = z.infer<typeof configSchema>;

// ============================================================================
// Logging
// ============================================================================

const SCREENSHOT_COLLECTOR_LOG_PATH = "/var/log/cmux/screenshot-collector";

function ensureLogDir(): void {
  try {
    mkdirSync("/var/log/cmux", { recursive: true });
  } catch {
    // Ignore - may not have permissions
  }
}

async function logToScreenshotCollector(message: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${message}`;

  // Always log to stderr so stdout can be used for JSON output
  console.error(logMessage);

  // Also write to file
  try {
    await fs.appendFile(SCREENSHOT_COLLECTOR_LOG_PATH, `${logMessage}\n`, {
      encoding: "utf8",
    });
  } catch {
    // Silently fail file logging - we already logged to stderr
  }
}

// ============================================================================
// Message Formatting (from claudeMessageFormatter.ts)
// ============================================================================

function formatClaudeMessage(message: SDKMessage): string {
  switch (message.type) {
    case "assistant": {
      const content = message.message.content;
      const parts: string[] = [];

      for (const block of content) {
        if (block.type === "text") {
          parts.push(`💬 ${block.text}`);
        } else if (block.type === "tool_use") {
          parts.push(formatToolUse(block.name, block.input as Record<string, unknown>));
        }
      }

      if (message.message.usage) {
        parts.push(
          `   └─ tokens: in=${message.message.usage.input_tokens} out=${message.message.usage.output_tokens}`
        );
      }

      return parts.join("\n");
    }

    case "user": {
      const content = message.message.content;
      if (typeof content === "string") {
        return `👤 User: ${content}`;
      }

      if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const block of content) {
          if ("type" in block && block.type === "tool_result") {
            parts.push(formatToolResult(block.tool_use_id, block.content));
          } else if ("type" in block && block.type === "text") {
            parts.push(`👤 User: ${block.text}`);
          }
        }
        return parts.join("\n");
      }

      return `👤 User message (complex content)`;
    }

    case "result": {
      const baseInfo = `${message.num_turns} turns, ${message.duration_ms}ms`;
      if (message.subtype === "success") {
        return `
✅ Success (${baseInfo}, $${message.total_cost_usd.toFixed(4)})
   Result: ${message.result}`;
      }
      return `❌ Error: ${message.subtype} (${baseInfo}, $${message.total_cost_usd.toFixed(4)})`;
    }

    case "system": {
      switch (message.subtype) {
        case "init":
          return `
🔧 System initialized
   Model: ${message.model}
   Tools: ${message.tools.length} available
   MCP Servers: ${message.mcp_servers.map((s) => `${s.name}(${s.status})`).join(", ")}
   Permission Mode: ${message.permissionMode}`;
        case "compact_boundary":
          return `📦 Compacted (${message.compact_metadata.trigger}, ${message.compact_metadata.pre_tokens} tokens)`;
        case "hook_response":
          return `🪝 Hook: ${message.hook_name} (${message.hook_event}) - exit ${message.exit_code ?? "N/A"}`;
        case "status": {
          const status = message.status ?? "idle";
          return `🔄 Status: ${status}`;
        }
        default: {
          return `🔧 System: unknown`;
        }
      }
    }

    case "tool_progress": {
      const parent =
        message.parent_tool_use_id === null
          ? ""
          : ` (child of ${message.parent_tool_use_id})`;
      return `⏳ Tool progress: ${message.tool_name} ${parent} after ${message.elapsed_time_seconds.toFixed(1)}s`;
    }

    case "auth_status": {
      const output =
        message.output.length > 0 ? ` output="${message.output.join(" | ")}"` : "";
      const error = message.error ? ` error="${message.error}"` : "";
      return `🔐 Auth status: ${message.isAuthenticating ? "authenticating" : "idle"}${output}${error}`;
    }

    case "stream_event": {
      return "";
    }

    default: {
      return `❓ Unknown message type`;
    }
  }
}

function formatToolUse(
  toolName: string,
  input: Record<string, unknown>
): string {
  const emoji = getToolEmoji(toolName);
  const formattedInput = formatToolInput(toolName, input);
  return `${emoji} ${toolName}${formattedInput}`;
}

function formatToolResult(_toolUseId: string, content: unknown): string {
  let contentStr: string;

  if (typeof content === "string") {
    contentStr = content;
  } else if (Array.isArray(content)) {
    contentStr = content
      .map((item) => {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "tool_result"
        ) {
          return formatToolResultContent(
            (item as { content?: unknown }).content
          );
        }
        return JSON.stringify(item);
      })
      .join(" ");
  } else {
    contentStr = JSON.stringify(content);
  }

  if (contentStr.length > 200) {
    contentStr = contentStr.slice(0, 200) + "...";
  }

  const isError =
    typeof content === "object" &&
    content !== null &&
    "is_error" in content &&
    content.is_error === true;

  return `   ${isError ? "❌" : "✓"} Result: ${contentStr}`;
}

function formatToolResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(content);
}

function formatToolInput(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Read": {
      const filePath = input.file_path;
      return ` ${filePath}`;
    }
    case "Write": {
      const filePath = input.file_path;
      const lines = String(input.content || "").split("\n").length;
      return ` ${filePath} (${lines} lines)`;
    }
    case "Edit": {
      const filePath = input.file_path;
      return ` ${filePath}`;
    }
    case "Bash": {
      const command = String(input.command || "");
      const truncated = command.length > 50 ? command.slice(0, 50) + "..." : command;
      return ` ${truncated}`;
    }
    case "Glob":
    case "Grep": {
      const pattern = input.pattern;
      return ` "${pattern}"`;
    }
    case "mcp___playwright_mcp__browser_navigate": {
      const url = input.url;
      return ` → ${url}`;
    }
    case "mcp___playwright_mcp__browser_take_screenshot": {
      const name = input.name || "screenshot";
      return ` 📸 ${name}`;
    }
    case "mcp___playwright_mcp__browser_click": {
      const selector = input.selector;
      return ` ${selector}`;
    }
    case "TodoWrite": {
      const todos = input.todos as Array<{ content: string; status: string }>;
      if (!todos || todos.length === 0) {
        return " (0 items)";
      }
      const statusEmoji = (status: string) => {
        switch (status) {
          case "completed":
            return "✅";
          case "in_progress":
            return "⏳";
          case "pending":
            return "⭕";
          default:
            return "❓";
        }
      };
      const todoLines = todos.map(
        (todo) => `\n   ${statusEmoji(todo.status)} ${todo.content}`
      );
      return todoLines.join("");
    }
    default: {
      const keys = Object.keys(input);
      if (keys.length === 0) {
        return "";
      }
      if (keys.length === 1 && keys[0]) {
        const value = input[keys[0]];
        if (typeof value === "string" && value.length < 40) {
          return ` ${value}`;
        }
      }
      return ` {${keys.join(", ")}}`;
    }
  }
}

function getToolEmoji(toolName: string): string {
  if (toolName.startsWith("mcp___playwright_mcp__browser_")) {
    const action = toolName.replace("mcp___playwright_mcp__browser_", "");
    switch (action) {
      case "navigate":
      case "navigate_back":
        return "🌐";
      case "click":
      case "hover":
        return "👆";
      case "take_screenshot":
      case "snapshot":
        return "📸";
      case "type":
      case "fill_form":
        return "⌨️";
      case "close":
        return "❌";
      default:
        return "🎭";
    }
  }

  switch (toolName) {
    case "Read":
      return "📖";
    case "Write":
      return "✍️";
    case "Edit":
      return "✏️";
    case "Bash":
      return "🔨";
    case "Glob":
      return "🔍";
    case "Grep":
      return "🔎";
    case "TodoWrite":
      return "📝";
    case "Task":
      return "🤖";
    case "WebFetch":
      return "🌐";
    case "WebSearch":
      return "🔍";
    default:
      return "🔧";
  }
}

// ============================================================================
// Screenshot Collector Core Logic (from claudeScreenshotCollector.ts)
// ============================================================================

const SCREENSHOT_STORAGE_ROOT = "/root/screenshots";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function isScreenshotFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

const screenshotOutputSchema = z.object({
  hasUiChanges: z.boolean(),
  images: z
    .array(
      z.object({
        path: z.string().min(1),
        description: z.string().min(1),
      })
    )
    .default([]),
});

type ScreenshotStructuredOutput = z.infer<typeof screenshotOutputSchema>;

const screenshotOutputJsonSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  additionalProperties: false,
  required: ["hasUiChanges", "images"],
  properties: {
    hasUiChanges: { type: "boolean" },
    images: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "description"],
        properties: {
          path: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

async function collectScreenshotFiles(
  directory: string
): Promise<{ files: string[]; hasNestedDirectories: boolean }> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  let hasNestedDirectories = false;

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      hasNestedDirectories = true;
      const nested = await collectScreenshotFiles(fullPath);
      files.push(...nested.files);
    } else if (entry.isFile() && isScreenshotFile(entry.name)) {
      files.push(fullPath);
    }
  }

  return { files, hasNestedDirectories };
}

function normalizeScreenshotOutputDir(outputDir: string): string {
  if (path.isAbsolute(outputDir)) {
    return path.normalize(outputDir);
  }
  return path.resolve(SCREENSHOT_STORAGE_ROOT, outputDir);
}

function isTaskRunJwtAuth(
  auth: Config["auth"]
): auth is { taskRunJwt: string } {
  return "taskRunJwt" in auth;
}

interface ScreenshotResult {
  status: "completed" | "failed" | "skipped";
  screenshots?: { path: string; description?: string }[];
  hasUiChanges?: boolean;
  error?: string;
  reason?: string;
}

async function captureScreenshotsForBranch(
  config: Config,
  branch: string
): Promise<{
  screenshots: { path: string; description?: string }[];
  hasUiChanges?: boolean;
}> {
  const {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    outputDir: requestedOutputDir,
    auth,
    installCommand,
    devCommand,
  } = config;
  const outputDir = normalizeScreenshotOutputDir(requestedOutputDir);
  const useTaskRunJwt = isTaskRunJwtAuth(auth);
  const providedApiKey = !useTaskRunJwt ? auth.anthropicApiKey : undefined;

  const devInstructions = (() => {
    if (!installCommand && !devCommand) {
      return `
The user did not provide installation or dev commands. You will need to discover them by reading README.md, package.json, .devcontainer.json, or other configuration files.`;
    }
    const parts = ["The user provided the following commands:"];
    if (installCommand) {
      parts.push(`<install_command>\n${installCommand}\n</install_command>`);
    } else {
      parts.push(
        "(No install command provided - check README.md or package.json)"
      );
    }
    if (devCommand) {
      parts.push(`<dev_command>\n${devCommand}\n</dev_command>`);
    } else {
      parts.push(
        "(No dev command provided - check README.md or package.json)"
      );
    }
    return "\n" + parts.join("\n");
  })();

  const prompt = `You are a screenshot collector for pull request reviews. Your job is to determine if a PR contains UI changes and, if so, capture screenshots of those changes.

<PR_CONTEXT>
Title: ${prTitle}
Description: ${prDescription || "No description provided"}
Branch: ${branch}
Files changed:
${changedFiles.map((f) => `- ${f}`).join("\n")}
</PR_CONTEXT>

<ENVIRONMENT>
Working directory: ${workspaceDir}
Screenshot output directory: ${outputDir}
${devInstructions}
</ENVIRONMENT>

<PHASE_1_ANALYSIS>
First, analyze the changed files to determine if this PR contains UI changes.

IMPORTANT: Base your decision on the ACTUAL FILES CHANGED, not the PR title or description. PR descriptions can be misleading or incomplete. If the diff contains UI-affecting code, there ARE UI changes regardless of what the description says.

UI changes ARE present if the PR modifies code that affects what users see in the browser:
- Frontend components or templates (any framework: React, Vue, Rails ERB, PHP Blade, Django templates, etc.)
- Stylesheets (CSS, SCSS, Tailwind, styled-components, etc.)
- Markup or template files (HTML, JSX, ERB, Twig, Jinja, Handlebars, etc.)
- Client-side JavaScript/TypeScript that affects rendering
- UI states like loading indicators, error messages, empty states, or toasts
- Accessibility attributes, ARIA labels, or semantic markup

UI changes are NOT present if the PR only modifies:
- Server-side logic that doesn't change what's rendered (API handlers, database queries, background jobs)
- Configuration files (unless they affect theming or UI behavior)
- Tests, documentation, or build scripts
- Type definitions or interfaces for non-UI code

If no UI changes exist: Set hasUiChanges=false, take ZERO screenshots, and explain why. Do not start the dev server or open a browser.
</PHASE_1_ANALYSIS>

<PHASE_2_CAPTURE>
If UI changes exist, capture screenshots:

1. FIRST, check if the dev server is ALREADY RUNNING:
   - Run \`tmux list-windows\` and \`tmux capture-pane -p -t <window>\` to see running processes and their logs
   - Check if there's a dev server process starting up or already running in any tmux window
   - The dev server is typically started automatically in this environment - BE PATIENT and monitor the logs
   - If you see the server is starting/compiling, WAIT for it to finish - do NOT kill it or restart it
   - Use \`ss -tlnp | grep LISTEN\` to see what ports have servers listening
2. ONLY if no server is running anywhere: Read CLAUDE.md, README.md, or package.json for setup instructions. Install dependencies if needed, then start the dev server.
3. BE PATIENT - servers can take time to compile. Monitor tmux logs to see progress. A response from curl (even 404) means the server is up. Do NOT restart the server if it's still compiling.
4. Navigate to the pages/components modified in the PR
5. Capture screenshots of the changes, including:
   - The default/resting state of changed components
   - Interactive states: hover, focus, active, disabled
   - Conditional states: loading, error, empty, success (if the PR modifies these!)
   - Hidden UI: modals, dropdowns, tooltips, accordions
   - Responsive layouts if the PR includes responsive changes
6. Save screenshots to ${outputDir} with descriptive names like "component-state-${branch}.png"
7. After taking a screenshot, always open the image to verify that the capture is expected
8. If screenshot seems outdated, refresh the page and take the screenshot again.
9. Delete any screenshot files from the filesystem that you do not want included
</PHASE_2_CAPTURE>

<WHAT_TO_CAPTURE>
Screenshot the UI states that the PR actually modifies. Be intentional:

- If the PR changes a loading spinner → screenshot the loading state
- If the PR changes error handling UI → screenshot the error state
- If the PR changes a skeleton loader → screenshot the skeleton
- If the PR changes hover styles → screenshot the hover state
- If the PR changes a modal → open and screenshot the modal

Don't screenshot loading/error states incidentally while waiting for the "real" UI. Screenshot them when they ARE the change.
</WHAT_TO_CAPTURE>

<CRITICAL_MISTAKES>
Avoid these failure modes:

FALSE POSITIVE: Taking screenshots when the PR has no UI changes. Backend-only, config, or test changes = hasUiChanges=false, zero screenshots.

FALSE NEGATIVE: Failing to capture screenshots when UI changes exist. If React components, CSS, or templates changed, you MUST capture them.

FAKE UI: Creating mock HTML files instead of screenshotting the real app. Never fabricate UIs. If the dev server won't start, report the failure.

WRONG PAGE: Screenshotting pages unrelated to the PR. Only capture components/pages that the changed files actually render.

DUPLICATE SCREENSHOTS: Taking multiple identical screenshots. Each screenshot should show something distinct.

INCOMPLETE CAPTURE: Missing important UI elements. Ensure full components are visible and not cut off.
</CRITICAL_MISTAKES>

<OUTPUT_REQUIREMENTS>
- Set hasUiChanges to true only if the PR modifies UI-rendering code AND you captured screenshots
- Set hasUiChanges to false if the PR has no UI changes (with zero screenshots)
- Include every screenshot path with a description of what it shows
- Do not close the browser when done
- Do not create summary documents
</OUTPUT_REQUIREMENTS>`;

  await logToScreenshotCollector(
    `Starting Claude Agent with browser MCP for branch: ${branch}`
  );

  const screenshotPaths: string[] = [];
  let structuredOutput: ScreenshotStructuredOutput | null = null;

  try {
    const hadOriginalApiKey = Object.prototype.hasOwnProperty.call(
      process.env,
      "ANTHROPIC_API_KEY"
    );
    const originalApiKey = process.env.ANTHROPIC_API_KEY;
    if (useTaskRunJwt) {
      delete process.env.ANTHROPIC_API_KEY;
      await logToScreenshotCollector(
        `Using taskRun JWT auth. JWT present: ${!!auth.taskRunJwt}, JWT length: ${auth.taskRunJwt?.length ?? 0}, JWT first 20 chars: ${auth.taskRunJwt?.substring(0, 20) ?? "N/A"}`
      );
      await logToScreenshotCollector(
        `ANTHROPIC_BASE_URL: https://www.cmux.dev/api/anthropic`
      );
    } else if (providedApiKey) {
      process.env.ANTHROPIC_API_KEY = providedApiKey;
      await logToScreenshotCollector(
        `Using API key auth. Key present: ${!!providedApiKey}, Key length: ${providedApiKey?.length ?? 0}`
      );
    }

    await logToScreenshotCollector(
      `Arguments to Claude Code: ${JSON.stringify({
        prompt,
        cwd: workspaceDir,
        pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
      })}`
    );

    try {
      for await (const message of query({
        prompt,
        options: {
          model: "claude-opus-4-5",
          mcpServers: {
            chrome: {
              command: "bunx",
              args: [
                "chrome-devtools-mcp",
                "--browserUrl",
                "http://0.0.0.0:39382",
              ],
            },
          },
          allowDangerouslySkipPermissions: true,
          permissionMode: "bypassPermissions",
          cwd: workspaceDir,
          pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
          outputFormat: {
            type: "json_schema",
            schema: screenshotOutputJsonSchema,
          },
          env: {
            ...process.env,
            IS_SANDBOX: "1",
            CLAUDE_CODE_ENABLE_TELEMETRY: "0",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            ...(useTaskRunJwt
              ? {
                  ANTHROPIC_API_KEY: "sk_placeholder_cmux_anthropic_api_key",
                  ANTHROPIC_BASE_URL: "https://www.cmux.dev/api/anthropic",
                  ANTHROPIC_CUSTOM_HEADERS: `x-cmux-token:${auth.taskRunJwt}`,
                }
              : {}),
          },
          stderr: (data) =>
            logToScreenshotCollector(`[claude-code-stderr] ${data}`),
        },
      })) {
        const formatted = formatClaudeMessage(message);
        if (formatted) {
          await logToScreenshotCollector(formatted);
        }

        if (message.type === "result" && "structured_output" in message) {
          const parsed = screenshotOutputSchema.safeParse(
            message.structured_output
          );
          if (parsed.success) {
            structuredOutput = parsed.data;
            await logToScreenshotCollector(
              `Structured output captured (hasUiChanges=${parsed.data.hasUiChanges}, images=${parsed.data.images.length})`
            );
          } else {
            await logToScreenshotCollector(
              `Structured output validation failed: ${parsed.error.message}`
            );
          }
        }
      }
    } catch (error) {
      await logToScreenshotCollector(
        `Failed to capture screenshots with Claude Agent: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    } finally {
      if (hadOriginalApiKey) {
        if (originalApiKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalApiKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }

    // Find all screenshot files in the output directory
    try {
      const { files, hasNestedDirectories } =
        await collectScreenshotFiles(outputDir);

      if (hasNestedDirectories) {
        await logToScreenshotCollector(
          `Detected nested screenshot folders under ${outputDir}. Please keep all screenshots directly in the output directory.`
        );
      }

      const uniqueScreens = Array.from(
        new Set(files.map((filePath) => path.normalize(filePath)))
      ).sort();
      screenshotPaths.push(...uniqueScreens);
    } catch (readError) {
      await logToScreenshotCollector(
        `Could not read screenshot directory: ${readError instanceof Error ? readError.message : String(readError)}`
      );
    }

    const descriptionByPath = new Map<string, string>();
    const resolvedOutputDir = path.resolve(outputDir);
    if (structuredOutput) {
      for (const image of structuredOutput.images) {
        const absolutePath = path.isAbsolute(image.path)
          ? path.normalize(image.path)
          : path.normalize(path.resolve(resolvedOutputDir, image.path));
        descriptionByPath.set(absolutePath, image.description);
      }
    }

    const screenshotsWithDescriptions = screenshotPaths.map((absolutePath) => {
      const normalized = path.normalize(absolutePath);
      return {
        path: absolutePath,
        description: descriptionByPath.get(normalized),
      };
    });

    if (
      structuredOutput &&
      structuredOutput.images.length > 0 &&
      descriptionByPath.size === 0
    ) {
      await logToScreenshotCollector(
        "Structured output provided image descriptions, but none matched saved files; ensure paths are absolute or relative to the output directory."
      );
    }

    return {
      screenshots: screenshotsWithDescriptions,
      hasUiChanges: structuredOutput?.hasUiChanges,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(
      `Failed to capture screenshots with Claude Agent: ${message}`
    );

    if (error instanceof Error) {
      if (error.stack) {
        await logToScreenshotCollector(`Stack trace: ${error.stack}`);
      }
      const errorObj = error as Error & Record<string, unknown>;
      const additionalProps = Object.keys(errorObj)
        .filter((key) => !["message", "stack", "name"].includes(key))
        .map((key) => `${key}: ${JSON.stringify(errorObj[key])}`)
        .join(", ");
      if (additionalProps) {
        await logToScreenshotCollector(`Error details: ${additionalProps}`);
      }
    }

    throw error;
  }
}

async function captureScreenshots(config: Config): Promise<ScreenshotResult> {
  const {
    workspaceDir,
    changedFiles,
    prTitle,
    prDescription,
    baseBranch,
    headBranch,
    outputDir: requestedOutputDir,
  } = config;
  const outputDir = normalizeScreenshotOutputDir(requestedOutputDir);

  try {
    await logToScreenshotCollector(
      `Starting PR screenshot capture in ${workspaceDir}`
    );

    if (changedFiles.length === 0) {
      const reason = "No files changed in PR";
      await logToScreenshotCollector(reason);
      return { status: "skipped", reason };
    }

    await logToScreenshotCollector(
      `Found ${changedFiles.length} changed files: ${changedFiles.join(", ")}`
    );

    await fs.mkdir(outputDir, { recursive: true });

    const allScreenshots: { path: string; description?: string }[] = [];
    let hasUiChanges: boolean | undefined;

    const CAPTURE_BEFORE = false;

    if (CAPTURE_BEFORE) {
      await logToScreenshotCollector(
        `Capturing 'before' screenshots for base branch: ${baseBranch}`
      );
      const beforeScreenshots = await captureScreenshotsForBranch(
        config,
        baseBranch
      );
      allScreenshots.push(...beforeScreenshots.screenshots);
      if (beforeScreenshots.hasUiChanges !== undefined) {
        hasUiChanges = beforeScreenshots.hasUiChanges;
      }
      await logToScreenshotCollector(
        `Captured ${beforeScreenshots.screenshots.length} 'before' screenshots`
      );
    }

    // Capture screenshots for head branch (after changes)
    await logToScreenshotCollector(
      `Capturing 'after' screenshots for head branch: ${headBranch}`
    );
    const afterScreenshots = await captureScreenshotsForBranch(
      config,
      headBranch
    );
    allScreenshots.push(...afterScreenshots.screenshots);
    if (afterScreenshots.hasUiChanges !== undefined) {
      hasUiChanges = afterScreenshots.hasUiChanges;
    }
    await logToScreenshotCollector(
      `Captured ${afterScreenshots.screenshots.length} 'after' screenshots`
    );

    await logToScreenshotCollector(
      `Screenshot capture completed. Total: ${allScreenshots.length} screenshots saved to ${outputDir}`
    );

    return {
      status: "completed",
      screenshots: allScreenshots,
      hasUiChanges,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    await logToScreenshotCollector(`PR screenshot capture failed: ${message}`);
    return {
      status: "failed",
      error: message,
    };
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  ensureLogDir();

  const { values } = parseArgs({
    options: {
      config: {
        type: "string",
        short: "c",
      },
      version: {
        type: "boolean",
        short: "v",
      },
    },
  });

  if (values.version) {
    // Version is injected during build
    console.log("claude-screenshot-collector v__VERSION__");
    process.exit(0);
  }

  if (!values.config) {
    console.error("Error: --config argument is required");
    console.error("Usage: bun run claude-screenshot-collector.ts --config /path/to/config.json");
    process.exit(1);
  }

  try {
    const configContent = await fs.readFile(values.config, "utf8");
    const rawConfig = JSON.parse(configContent);
    const config = configSchema.parse(rawConfig);

    await logToScreenshotCollector(
      `Loaded config from ${values.config}`
    );

    const result = await captureScreenshots(config);

    // Output result as JSON to stdout
    console.log(JSON.stringify(result, null, 2));

    process.exit(result.status === "failed" ? 1 : 0);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Config validation error:", JSON.stringify(error.errors, null, 2));
    } else {
      console.error(
        "Fatal error:",
        error instanceof Error ? error.message : String(error)
      );
    }
    process.exit(1);
  }
}

main();
