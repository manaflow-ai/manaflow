/**
 * Local Runner for cmux-local
 *
 * Runs Claude Code locally using tmux for session management.
 * No Docker required - runs directly on the host machine.
 */

import { spawn, execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { nanoid } from "nanoid";
import { type Task, type MCPQuestion, type MCPProgress } from "./types.js";

/**
 * Default model - Claude Opus 4.5
 * Full model name for compatibility with all CLI versions
 */
export const DEFAULT_MODEL = "claude-opus-4-5-20250514";

// Alternative model IDs to try if the above doesn't work:
// - "opus" (alias, requires newer CLI)
// - "claude-opus-4-5-20251101" (alternative date)

/**
 * Orchestration Protocol - instructs Claude to write questions to inbox file
 * Keep this minimal to avoid noise in output
 */
const ORCHESTRATION_PROTOCOL = `
When you need human input on important decisions, write a JSON line to $CMUX_INBOX_FILE:
{"id":"q1","question":"Your question?","importance":"medium"}

Only ask about significant decisions. Keep working while waiting for response.
`;

/**
 * Wrap a user prompt with the orchestration protocol
 */
function wrapPromptWithProtocol(userPrompt: string): string {
  return `${ORCHESTRATION_PROTOCOL}

---

## Your Task

${userPrompt}`;
}

/**
 * Execute a command and return stdout
 */
async function exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-c", command]);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    child.on("error", (err) => {
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
}

/**
 * Check if tmux is installed
 */
async function checkTmux(): Promise<boolean> {
  const result = await exec("which tmux");
  return result.code === 0;
}

/**
 * Check if claude CLI is installed
 */
async function checkClaude(): Promise<boolean> {
  const result = await exec("which claude");
  return result.code === 0;
}

/**
 * Get cmux-local state directory
 */
function getStateDir(): string {
  const dir = path.join(os.homedir(), ".cmux-local");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get tasks state file path
 */
function getTasksFilePath(): string {
  return path.join(getStateDir(), "tasks.json");
}

/**
 * Load tasks from state file
 */
function loadTasksState(): Task[] {
  const filePath = getTasksFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data.map((t: Record<string, unknown>) => ({
        ...t,
        startedAt: new Date(t.startedAt as string),
      }));
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Save tasks to state file
 */
function saveTasksState(tasks: Task[]): void {
  const filePath = getTasksFilePath();
  fs.writeFileSync(filePath, JSON.stringify(tasks, null, 2));
}

export class LocalRunner {
  private sessionPrefix = "cmux";

  /**
   * Check if required tools are available
   */
  async checkRequirements(): Promise<{ ok: boolean; missing: string[] }> {
    const missing: string[] = [];

    if (!(await checkTmux())) {
      missing.push("tmux (brew install tmux)");
    }

    if (!(await checkClaude())) {
      missing.push("claude (npm install -g @anthropic-ai/claude-code)");
    }

    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      missing.push("CLAUDE_CODE_OAUTH_TOKEN environment variable");
    }

    return { ok: missing.length === 0, missing };
  }

  /**
   * Get tmux session name for a task
   */
  private getSessionName(taskId: string): string {
    return `${this.sessionPrefix}-${taskId}`;
  }

  /**
   * Check if a tmux session exists
   */
  private async sessionExists(sessionName: string): Promise<boolean> {
    const result = await exec(`tmux has-session -t "${sessionName}" 2>/dev/null`);
    return result.code === 0;
  }

  /**
   * List all cmux tasks
   */
  async listTasks(): Promise<Task[]> {
    const savedTasks = loadTasksState();
    const activeTasks: Task[] = [];

    for (const task of savedTasks) {
      const sessionName = this.getSessionName(task.id);
      const exists = await this.sessionExists(sessionName);

      if (exists) {
        activeTasks.push({
          ...task,
          status: "running",
        });
      } else {
        // Session no longer exists - mark as done
        activeTasks.push({
          ...task,
          status: "done",
        });
      }
    }

    // Update saved state
    saveTasksState(activeTasks);

    return activeTasks.sort((a, b) => a.number - b.number);
  }

  /**
   * Get the next available task number
   */
  async getNextTaskNumber(): Promise<number> {
    const tasks = await this.listTasks();
    if (tasks.length === 0) return 1;
    return Math.max(...tasks.map((t) => t.number)) + 1;
  }

  /**
   * Start a new task
   */
  async startTask(repoPath: string, prompt: string, model?: string): Promise<Task> {
    const taskId = nanoid(8);
    const taskNumber = await this.getNextTaskNumber();
    const sessionName = this.getSessionName(taskId);
    const startedAt = new Date();

    // Resolve absolute path
    const absolutePath = path.resolve(repoPath);
    const repoName = path.basename(absolutePath);

    // Create communication directory
    const cmuxDir = path.join(getStateDir(), "tasks", taskId);
    fs.mkdirSync(cmuxDir, { recursive: true });

    // Wrap prompt with orchestration protocol
    const orchestratedPrompt = wrapPromptWithProtocol(prompt);

    // Use default model if not specified
    const actualModel = model || DEFAULT_MODEL;

    // Write prompt to a file (safer than shell escaping)
    const promptFile = path.join(cmuxDir, "prompt.txt");
    fs.writeFileSync(promptFile, orchestratedPrompt);

    // Create inbox and answers files
    const inboxFile = path.join(cmuxDir, "inbox.jsonl");
    const answersFile = path.join(cmuxDir, "answers.json");
    fs.writeFileSync(inboxFile, ""); // Create empty inbox
    fs.writeFileSync(answersFile, "[]"); // Create empty answers array

    // Create startup script - pass through OAuth token and inbox paths
    const startupScript = path.join(cmuxDir, "start.sh");
    const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || "";
    const scriptContent = `#!/bin/bash
cd "${absolutePath}"
export CMUX_TASK_ID="${taskId}"
export CMUX_PROMPT_FILE="${promptFile}"
# Inbox for human-in-the-loop communication
export CMUX_INBOX_FILE="${inboxFile}"
export CMUX_ANSWERS_FILE="${answersFile}"
# Only use OAuth token - never prompt about API keys
unset ANTHROPIC_API_KEY
export CLAUDE_CODE_OAUTH_TOKEN="${oauthToken}"
claude --model "${actualModel}" --dangerously-skip-permissions "$(cat "${promptFile}")"
`;
    fs.writeFileSync(startupScript, scriptContent);
    fs.chmodSync(startupScript, "755");

    // Start tmux session
    const result = await exec(
      `tmux new-session -d -s "${sessionName}" -c "${absolutePath}" "${startupScript}"`
    );

    if (result.code !== 0) {
      throw new Error(`Failed to start tmux session: ${result.stderr}`);
    }

    const task: Task = {
      id: taskId,
      number: taskNumber,
      containerId: sessionName, // Re-use field for session name
      repoPath: absolutePath,
      repoName,
      prompt,
      terminalPort: 0, // Not used in local mode
      cmuxDir,
      status: "running",
      startedAt,
      questions: [],
    };

    // Save to state
    const tasks = loadTasksState();
    tasks.push(task);
    saveTasksState(tasks);

    return task;
  }

  /**
   * Stop a task
   */
  async stopTask(taskId: string): Promise<void> {
    const sessionName = this.getSessionName(taskId);
    await exec(`tmux kill-session -t "${sessionName}" 2>/dev/null`);

    // Update state
    const tasks = loadTasksState();
    const updated = tasks.map((t) =>
      t.id === taskId ? { ...t, status: "done" as const } : t
    );
    saveTasksState(updated);
  }

  /**
   * Stop all tasks
   */
  async stopAllTasks(): Promise<void> {
    const tasks = await this.listTasks();
    for (const task of tasks) {
      if (task.status === "running") {
        await this.stopTask(task.id);
      }
    }
  }

  /**
   * Read tmux output from a task
   */
  async readOutput(taskId: string, lines: number = 500): Promise<string> {
    const sessionName = this.getSessionName(taskId);
    const result = await exec(
      `tmux capture-pane -t "${sessionName}" -p -S -${lines} 2>/dev/null`
    );
    return result.stdout;
  }

  /**
   * Inject a message into the Claude session
   */
  async injectMessage(taskId: string, message: string): Promise<boolean> {
    const sessionName = this.getSessionName(taskId);

    // Check if session still exists
    const exists = await this.sessionExists(sessionName);
    if (!exists) {
      return false;
    }

    // Escape special characters for tmux send-keys
    const escaped = message.replace(/'/g, "'\"'\"'");
    const result = await exec(
      `tmux send-keys -t "${sessionName}" '${escaped}' Enter`
    );
    return result.code === 0;
  }

  /**
   * Open/attach to a task's tmux session in a split pane
   */
  async openTerminal(taskId: string): Promise<void> {
    const sessionName = this.getSessionName(taskId);
    const exists = await this.sessionExists(sessionName);

    if (!exists) {
      throw new Error(`Task has finished or exited. Use 'new' to start a fresh task.`);
    }

    // Check if we're inside tmux
    const inTmux = process.env.TMUX;

    if (inTmux) {
      // Create a split pane and link to the task session
      // -h for horizontal split (side by side), -l 70% for 70% width
      const result = await exec(
        `tmux split-window -h -l 70% "tmux attach-session -t '${sessionName}'"`
      );
      if (result.code !== 0) {
        throw new Error(`Failed to create split pane: ${result.stderr}`);
      }
    } else {
      // Not in tmux - open in new terminal window (fallback)
      const platform = process.platform;
      let openCmd: string;

      if (platform === "darwin") {
        openCmd = `osascript -e 'tell application "Terminal" to do script "tmux attach-session -t ${sessionName}"'`;
      } else if (platform === "linux") {
        const terminals = [
          `gnome-terminal -- tmux attach-session -t "${sessionName}"`,
          `xterm -e tmux attach-session -t "${sessionName}"`,
          `konsole -e tmux attach-session -t "${sessionName}"`,
        ];
        for (const cmd of terminals) {
          const result = await exec(cmd);
          if (result.code === 0) return;
        }
        throw new Error("Run: tmux attach-session -t " + sessionName);
      } else {
        throw new Error(`Run: tmux attach-session -t ${sessionName}`);
      }

      await exec(openCmd);
    }
  }

  /**
   * Attach to a tmux session in the current terminal
   */
  attachToSession(taskId: string): void {
    const sessionName = this.getSessionName(taskId);
    // This will replace the current process
    execSync(`tmux attach-session -t "${sessionName}"`, { stdio: "inherit" });
  }

  /**
   * Read inbox questions from a task's communication directory (JSONL format)
   */
  readInboxQuestions(task: Task): MCPQuestion[] {
    const inboxFile = path.join(task.cmuxDir, "inbox.jsonl");
    const answersFile = path.join(task.cmuxDir, "answers.json");

    try {
      if (!fs.existsSync(inboxFile)) return [];

      const content = fs.readFileSync(inboxFile, "utf-8").trim();
      if (!content) return [];

      // Read answered question IDs
      const answeredIds = new Set<string>();
      try {
        if (fs.existsSync(answersFile)) {
          const answers = JSON.parse(fs.readFileSync(answersFile, "utf-8")) as Array<{ questionId: string }>;
          answers.forEach((a) => answeredIds.add(a.questionId));
        }
      } catch {
        // Ignore answer file errors
      }

      // Parse JSONL (one JSON object per line)
      const questions: MCPQuestion[] = [];
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const q = JSON.parse(line) as {
            id: string;
            question: string;
            options?: string[];
            suggestion?: string;
            importance?: "high" | "medium" | "low";
          };
          if (q.id && q.question && !answeredIds.has(q.id)) {
            questions.push({
              id: q.id,
              question: q.question,
              options: q.options,
              context: q.suggestion, // Use suggestion as context for display
              importance: q.importance || "medium",
              timestamp: new Date().toISOString(),
              answered: false,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }
      return questions;
    } catch {
      // File doesn't exist or is invalid
    }
    return [];
  }

  /**
   * Read MCP questions from a task's communication directory (legacy)
   */
  readMCPQuestions(task: Task): MCPQuestion[] {
    const questionsFile = path.join(task.cmuxDir, "questions.json");
    try {
      if (fs.existsSync(questionsFile)) {
        const content = fs.readFileSync(questionsFile, "utf-8");
        const questions = JSON.parse(content) as MCPQuestion[];
        return questions.filter((q) => !q.answered);
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return [];
  }

  /**
   * Read MCP progress updates from a task's communication directory
   */
  readMCPProgress(task: Task): MCPProgress[] {
    const progressFile = path.join(task.cmuxDir, "progress.json");
    try {
      if (fs.existsSync(progressFile)) {
        const content = fs.readFileSync(progressFile, "utf-8");
        return JSON.parse(content) as MCPProgress[];
      }
    } catch {
      // File doesn't exist or is invalid
    }
    return [];
  }

  /**
   * Write an answer to an MCP question
   */
  writeMCPAnswer(task: Task, questionId: string, answer: string): void {
    const answersFile = path.join(task.cmuxDir, "answers.json");
    let answers: Array<{ questionId: string; answer: string; timestamp: string }> = [];

    try {
      if (fs.existsSync(answersFile)) {
        answers = JSON.parse(fs.readFileSync(answersFile, "utf-8"));
      }
    } catch {
      // File doesn't exist or is invalid
    }

    answers.push({
      questionId,
      answer,
      timestamp: new Date().toISOString(),
    });

    fs.writeFileSync(answersFile, JSON.stringify(answers, null, 2));
  }
}
