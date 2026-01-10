/**
 * Dashboard TUI - Replicates the web dashboard experience in the terminal
 */

import * as readline from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import chalk from "chalk";
import { search, input } from "@inquirer/prompts";
import { LocalRunner, DEFAULT_MODEL } from "./local.js";
import { type Task, type Question, type ActivityEntry } from "./types.js";
import { extractCurrentActivity } from "./extractor.js";

// Track MCP questions we've already seen (by their MCP ID)
const mcpQuestionsSeen: Set<string> = new Set();

// Track which questions are MCP-based (so we know to write answers to filesystem)
const mcpQuestionIds: Map<string, { taskId: string; mcpId: string }> = new Map();

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const BOX = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
};

// Common directories where developers keep their projects
const PROJECT_DIRS = [
  "~/Projects",
  "~/projects",
  "~/Code",
  "~/code",
  "~/Development",
  "~/development",
  "~/Dev",
  "~/dev",
  "~/repos",
  "~/Repos",
  "~/src",
  "~/work",
  "~/Work",
  "~/github",
  "~/GitHub",
  "~/git",
];

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const runner = new LocalRunner();
let tasks: Task[] = [];
const questions: Map<string, { question: Question; taskId: string }> = new Map();
const _decisions: Map<string, { decision: unknown; taskId: string }> = new Map();
const _assumptions: Map<string, { assumption: unknown; taskId: string }> = new Map();
const activity: ActivityEntry[] = [];
const taskCurrentActivity: Map<string, string> = new Map(); // Track what each task is doing
const _taskFocus: Map<string, string> = new Map(); // Track current focus per task
let questionCounter = 0;
let isRunning = true;
let recentRepos: string[] = [];
let discoveredRepos: Array<{ path: string; name: string; lastModified: number }> = [];

// ─────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function loadRecentRepos(): void {
  const configPath = path.join(os.homedir(), ".cmux-local", "recent-repos.json");
  try {
    if (fs.existsSync(configPath)) {
      recentRepos = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch {
    recentRepos = [];
  }
}

function saveRecentRepos(): void {
  const configDir = path.join(os.homedir(), ".cmux-local");
  const configPath = path.join(configDir, "recent-repos.json");
  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(recentRepos.slice(0, 20)));
  } catch {
    // Ignore save errors
  }
}

function addRecentRepo(repoPath: string): void {
  const absolute = path.resolve(repoPath);
  recentRepos = [absolute, ...recentRepos.filter((r) => r !== absolute)].slice(0, 20);
  saveRecentRepos();
}

/**
 * Discover git repositories from common project directories
 */
function discoverGitRepos(): Array<{ path: string; name: string; lastModified: number }> {
  const repos: Array<{ path: string; name: string; lastModified: number }> = [];
  const seen = new Set<string>();

  // Add current directory if it's a git repo
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, ".git"))) {
    repos.push({
      path: cwd,
      name: path.basename(cwd),
      lastModified: Date.now(), // Current dir gets priority
    });
    seen.add(cwd);
  }

  // Add recent repos first (they have higher priority)
  for (const repoPath of recentRepos) {
    if (!seen.has(repoPath) && fs.existsSync(repoPath)) {
      try {
        const stat = fs.statSync(repoPath);
        repos.push({
          path: repoPath,
          name: path.basename(repoPath),
          lastModified: stat.mtimeMs,
        });
        seen.add(repoPath);
      } catch {
        // Skip inaccessible paths
      }
    }
  }

  // Scan common project directories
  for (const dir of PROJECT_DIRS) {
    const expanded = expandPath(dir);
    if (!fs.existsSync(expanded)) continue;

    try {
      const entries = fs.readdirSync(expanded, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;

        const fullPath = path.join(expanded, entry.name);
        if (seen.has(fullPath)) continue;

        // Check if it's a git repo
        const gitPath = path.join(fullPath, ".git");
        if (fs.existsSync(gitPath)) {
          try {
            const stat = fs.statSync(fullPath);
            repos.push({
              path: fullPath,
              name: entry.name,
              lastModified: stat.mtimeMs,
            });
            seen.add(fullPath);
          } catch {
            // Skip inaccessible
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  // Sort by last modified (most recent first)
  repos.sort((a, b) => b.lastModified - a.lastModified);

  return repos;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function boxLine(content: string, width: number): string {
  // eslint-disable-next-line no-control-regex
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = width - stripped.length - 2;
  return `${BOX.vertical} ${content}${" ".repeat(Math.max(0, padding))}${BOX.vertical}`;
}

// ─────────────────────────────────────────────────────────────
// Display Functions
// ─────────────────────────────────────────────────────────────

function printDashboard(): void {
  const width = 70;

  console.log();
  console.log(chalk.cyan(`  ${BOX.topLeft}${BOX.horizontal.repeat(width - 2)}${BOX.topRight}`));
  console.log(chalk.cyan(`  ${boxLine(chalk.bold("CMUX Local Dashboard"), width)}`));
  console.log(chalk.cyan(`  ${boxLine(chalk.gray("Local Claude Code Orchestrator"), width)}`));
  console.log(chalk.cyan(`  ${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`));

  // Categorize tasks
  const inProgress = tasks.filter((t) => t.status === "running" || t.status === "starting");
  const _withQuestions = tasks.filter((t) => {
    return Array.from(questions.values()).some((q) => q.taskId === t.id);
  });
  const completed = tasks.filter((t) => t.status === "done");

  // In Progress Section
  console.log(chalk.bold.green(`\n  ● In Progress`) + chalk.gray(` (${inProgress.length})`));
  console.log(chalk.gray("  " + "─".repeat(60)));
  if (inProgress.length === 0) {
    console.log(chalk.gray("    No tasks in progress"));
  } else {
    for (const task of inProgress) {
      printTaskRow(task);
    }
  }

  // Inbox Section - compact summary, non-blocking
  if (questions.size > 0) {
    console.log(chalk.bold.yellow(`\n  ✉ Inbox`) + chalk.gray(` (${questions.size} pending)`));
    console.log(chalk.gray("  " + "─".repeat(60)));
    // Show compact list - just IDs and first few words
    const questionList = Array.from(questions.entries()).slice(0, 5);
    for (const [key, { question, taskId }] of questionList) {
      const task = tasks.find((t) => t.id === taskId);
      const preview = question.question.slice(0, 40) + (question.question.length > 40 ? "..." : "");
      console.log(
        chalk.yellow(`    [${key}]`) +
        chalk.gray(` ${task?.repoName || "?"}: `) +
        chalk.white(preview)
      );
    }
    if (questions.size > 5) {
      console.log(chalk.gray(`    ... and ${questions.size - 5} more`));
    }
    console.log(chalk.gray(`\n    Type 'inbox' to view all, 'view ${questionList[0]?.[0] || "q1"}' for details`));
  }

  // Completed Section
  if (completed.length > 0) {
    console.log(chalk.bold.gray(`\n  ○ Completed`) + chalk.gray(` (${completed.length})`));
    console.log(chalk.gray("  " + "─".repeat(60)));
    for (const task of completed.slice(0, 3)) {
      printTaskRow(task, true);
    }
    if (completed.length > 3) {
      console.log(chalk.gray(`    ... and ${completed.length - 3} more`));
    }
  }

  // Activity Log
  if (activity.length > 0) {
    console.log(chalk.bold(`\n  Activity`));
    console.log(chalk.gray("  " + "─".repeat(60)));
    for (const entry of activity.slice(0, 3)) {
      const time = entry.timestamp.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const color = entry.type === "question" ? chalk.yellow : entry.type === "error" ? chalk.red : chalk.gray;
      console.log(chalk.gray(`    ${time} `) + color(entry.message.slice(0, 50)));
    }
  }

  console.log();
}

function printTaskRow(task: Task, dim = false): void {
  const color = dim ? chalk.gray : chalk.white;
  const icon = task.status === "running" ? chalk.green("●") : task.status === "starting" ? chalk.yellow("◌") : chalk.gray("○");
  const time = task.startedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const currentActivity = taskCurrentActivity.get(task.id);

  console.log(
    `    ${chalk.gray(task.number.toString().padStart(2))} ${icon} ` +
      color(task.repoName.padEnd(15).slice(0, 15)) +
      chalk.gray(` "${task.prompt.slice(0, 30)}${task.prompt.length > 30 ? "..." : ""}" `) +
      chalk.gray(`${time}`)
  );

  // Show current activity on next line if available
  if (currentActivity && !dim) {
    console.log(chalk.gray(`       └─ ${chalk.blue(currentActivity)}`));
  }
}

function printQuickHelp(): void {
  const inboxBadge = questions.size > 0 ? chalk.yellow(` [${questions.size} pending]`) : "";
  console.log(chalk.gray("  Commands: ") +
    chalk.cyan("new") + chalk.gray(" | ") +
    chalk.cyan("inbox") + inboxBadge + chalk.gray(" | ") +
    chalk.cyan("open <n>") + chalk.gray(" | ") +
    chalk.cyan("stop <n>") + chalk.gray(" | ") +
    chalk.cyan("help")
  );
}

function printInbox(): void {
  console.log(chalk.bold.yellow("\n  ✉ Inbox"));
  console.log(chalk.gray("  " + "─".repeat(60)));

  if (questions.size === 0) {
    console.log(chalk.gray("    No pending questions."));
    console.log();
    return;
  }

  for (const [key, { question, taskId }] of questions.entries()) {
    const task = tasks.find((t) => t.id === taskId);
    const age = formatTimeAgo(question.askedAt.getTime());
    const preview = question.question.slice(0, 50) + (question.question.length > 50 ? "..." : "");

    console.log(
      chalk.yellow(`  [${key}]`) +
      chalk.gray(` ${task?.repoName || "unknown"} `) +
      chalk.gray(`(${age})`)
    );
    console.log(chalk.white(`       ${preview}`));
    if (question.suggestion) {
      console.log(chalk.blue(`       → Suggestion: ${question.suggestion}`));
    }
  }

  console.log(chalk.gray("\n  Commands:"));
  console.log(chalk.gray("    view <q#>    - See full question details"));
  console.log(chalk.gray("    q# <answer>  - Answer question (e.g., q1 yes)"));
  console.log(chalk.gray("    dismiss <q#> - Dismiss without answering"));
  console.log();
}

function printQuestionDetail(key: string, entry: { question: Question; taskId: string }): void {
  const task = tasks.find((t) => t.id === entry.taskId);
  const age = formatTimeAgo(entry.question.askedAt.getTime());

  console.log(chalk.bold.yellow(`\n  ╭─────────────────────────────────────────────────────────────╮`));
  console.log(chalk.bold.yellow(`  │`) + chalk.bold(` Question ${key}`) + chalk.gray(` from ${task?.repoName || "unknown"} (${age})`) + chalk.bold.yellow(`          │`));
  console.log(chalk.bold.yellow(`  ╰─────────────────────────────────────────────────────────────╯`));

  // Word wrap the question
  console.log(chalk.bold("\n  Question:"));
  const maxLen = 55;
  const words = entry.question.question.split(" ");
  let line = "    ";
  for (const word of words) {
    if (line.length + word.length + 1 > maxLen) {
      console.log(chalk.white(line));
      line = "    " + word;
    } else {
      line += (line.length > 4 ? " " : "") + word;
    }
  }
  if (line.length > 4) console.log(chalk.white(line));

  if (entry.question.options && entry.question.options.length > 0) {
    console.log(chalk.bold("\n  Options:"));
    for (const opt of entry.question.options) {
      console.log(chalk.cyan(`    • ${opt}`));
    }
  }

  if (entry.question.suggestion) {
    console.log(chalk.bold("\n  Suggestion:"));
    console.log(chalk.blue(`    → ${entry.question.suggestion}`));
  }

  console.log(chalk.gray("\n  Reply:"));
  console.log(chalk.gray(`    ${key} <your answer>`) + chalk.gray("  or  ") + chalk.gray(`dismiss ${key}`));
  console.log();
}

// ─────────────────────────────────────────────────────────────
// Interactive Task Creation with Inquirer
// ─────────────────────────────────────────────────────────────

async function handleNewTask(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  ╭─────────────────────────────────────────────────────────────╮"));
  console.log(chalk.bold.cyan("  │                    Start New Task                           │"));
  console.log(chalk.bold.cyan("  ╰─────────────────────────────────────────────────────────────╯"));

  // Refresh discovered repos
  discoveredRepos = discoverGitRepos();

  // Step 1: Select Project with interactive search
  console.log(chalk.bold("\n  1. Select Project"));
  console.log(chalk.gray("  " + "─".repeat(60)));

  let selectedRepo: string;

  try {
    // Build choices for the search prompt
    const repoChoices = discoveredRepos.map((repo) => {
      const timeAgo = formatTimeAgo(repo.lastModified);
      const isCurrent = repo.path === process.cwd();
      const isRecent = recentRepos.includes(repo.path);

      let prefix = "  ";
      if (isCurrent) prefix = chalk.green("→ ");
      else if (isRecent) prefix = chalk.yellow("★ ");

      return {
        name: `${prefix}${repo.name}`,
        value: repo.path,
        description: `${repo.path} ${chalk.gray(`(${timeAgo})`)}`,
      };
    });

    // Add option to enter custom path
    repoChoices.push({
      name: chalk.gray("  Enter custom path..."),
      value: "__custom__",
      description: "Type a path to a git repository",
    });

    selectedRepo = await search({
      message: "Select project (type to filter):",
      source: async (term) => {
        if (!term) {
          return repoChoices;
        }
        const lower = term.toLowerCase();
        return repoChoices.filter((choice) => {
          const searchable = `${choice.name} ${choice.value}`.toLowerCase();
          return searchable.includes(lower);
        });
      },
    });

    if (selectedRepo === "__custom__") {
      selectedRepo = await input({
        message: "Enter path:",
        default: process.cwd(),
        validate: (value) => {
          const expanded = expandPath(value);
          if (!fs.existsSync(expanded)) {
            return "Path does not exist";
          }
          return true;
        },
      });
      selectedRepo = expandPath(selectedRepo);
    }
  } catch {
    // User cancelled (Ctrl+C)
    console.log(chalk.yellow("\n  Cancelled."));
    return;
  }

  // Validate repo exists
  if (!fs.existsSync(selectedRepo)) {
    console.log(chalk.red(`  Path not found: ${selectedRepo}`));
    return;
  }

  const repoName = path.basename(selectedRepo);
  console.log(chalk.green(`  ✓ Selected: ${repoName}`) + chalk.gray(` (${selectedRepo})`));

  // Step 2: Enter Task Description
  console.log(chalk.bold("\n  2. Task Description"));
  console.log(chalk.gray("  " + "─".repeat(60)));
  console.log(chalk.gray("     What should Claude do? Be specific."));

  let taskPrompt: string;
  try {
    taskPrompt = await input({
      message: ">",
      validate: (value) => {
        if (!value.trim()) {
          return "Task description is required";
        }
        return true;
      },
    });
  } catch {
    console.log(chalk.yellow("\n  Cancelled."));
    return;
  }

  // Auto-start immediately (no confirmation needed)
  console.log(chalk.gray("\n  Starting with Opus 4.5..."));
  try {
    const task = await runner.startTask(selectedRepo, taskPrompt, DEFAULT_MODEL);
    addRecentRepo(selectedRepo);

    activity.unshift({
      timestamp: new Date(),
      taskId: task.id,
      taskName: repoName,
      type: "info",
      message: `Started: "${taskPrompt.slice(0, 30)}..."`,
    });

    console.log(chalk.green(`\n  ✓ Started task #${task.number}`));
    console.log(chalk.gray(`    Attach to session: `) + chalk.cyan(`tmux attach -t cmux-${task.id}`));
    console.log(chalk.gray(`    Or run: `) + chalk.cyan(`open ${task.number}`));

    await refreshTasks();
  } catch (err) {
    console.error(chalk.red("  Failed to start task:"), err);
  }
}

// ─────────────────────────────────────────────────────────────
// Polling & Updates
// ─────────────────────────────────────────────────────────────

async function refreshTasks(): Promise<void> {
  try {
    tasks = await runner.listTasks();

    for (const task of tasks) {
      if (task.status === "running" || task.status === "starting") {
        // Update current activity from tmux output
        try {
          const output = await runner.readOutput(task.id);
          const currentAct = extractCurrentActivity(output);
          if (currentAct) {
            taskCurrentActivity.set(task.id, currentAct);
          }
        } catch {
          // Container might not be ready
        }

        // Poll inbox questions from the filesystem (primary method)
        try {
          const inboxQuestions = runner.readInboxQuestions(task);
          for (const iq of inboxQuestions) {
            // Skip questions we've already seen
            if (mcpQuestionsSeen.has(iq.id)) continue;

            // Only surface high and medium importance questions
            if (iq.importance === "low") {
              mcpQuestionsSeen.add(iq.id);
              continue;
            }

            mcpQuestionsSeen.add(iq.id);
            questionCounter++;
            const key = `q${questionCounter}`;

            // Track this as an inbox question
            mcpQuestionIds.set(key, { taskId: task.id, mcpId: iq.id });

            // Convert to our Question format
            const question: Question = {
              id: iq.id,
              taskId: task.id,
              question: iq.question,
              suggestion: iq.context, // context contains suggestion
              options: iq.options,
              status: "open",
              askedAt: new Date(iq.timestamp),
            };

            questions.set(key, { question, taskId: task.id });

            activity.unshift({
              timestamp: new Date(),
              taskId: task.id,
              taskName: task.repoName,
              type: "question",
              message: `[${iq.importance.toUpperCase()}] ${iq.question.slice(0, 30)}...`,
            });

            // Silent update - no console output during polling
            // Questions will be shown in inbox section on next dashboard refresh
          }
        } catch {
          // Inbox files might not exist yet
        }

        // Keep activity list manageable
        while (activity.length > 30) {
          activity.pop();
        }
      }
    }
  } catch (err) {
    console.error(chalk.red("  Error refreshing tasks:"), err);
  }
}

// ─────────────────────────────────────────────────────────────
// Command Handler
// ─────────────────────────────────────────────────────────────

async function handleCommand(inputStr: string, rl: readline.Interface): Promise<void> {
  const parts = inputStr.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (!command) {
    // On empty input, refresh and show dashboard
    await refreshTasks();
    clearScreen();
    printDashboard();
    printQuickHelp();
    return;
  }

  switch (command) {
    case "new":
    case "n":
      // Pause readline while inquirer takes over
      rl.pause();
      try {
        await handleNewTask();
      } finally {
        rl.resume();
      }
      // Refresh dashboard after task creation
      await refreshTasks();
      clearScreen();
      printDashboard();
      printQuickHelp();
      break;

    case "list":
    case "ls":
    case "dashboard":
    case "d":
      await refreshTasks();
      clearScreen();
      printDashboard();
      printQuickHelp();
      break;

    case "open":
    case "o": {
      const taskNum = parseInt(parts[1] || "", 10);
      const task = tasks.find((t) => t.number === taskNum);
      if (!task) {
        console.log(chalk.red(`  Task ${taskNum} not found.`));
        break;
      }
      try {
        await runner.openTerminal(task.id);
        console.log(chalk.green(`  Opened terminal for task #${taskNum}`));
      } catch (err) {
        console.log(chalk.yellow(`  ${err instanceof Error ? err.message : String(err)}`));
      }
      break;
    }

    case "stop": {
      const taskNum = parseInt(parts[1] || "", 10);
      const task = tasks.find((t) => t.number === taskNum);
      if (!task) {
        console.log(chalk.red(`  Task ${taskNum} not found.`));
        break;
      }
      await runner.stopTask(task.id);
      console.log(chalk.green(`  Stopped task #${taskNum}`));
      await refreshTasks();
      break;
    }

    case "stop-all":
      await runner.stopAllTasks();
      console.log(chalk.green("  Stopped all tasks."));
      await refreshTasks();
      break;

    case "tell": {
      const taskNum = parseInt(parts[1] || "", 10);
      const message = parts.slice(2).join(" ");
      const task = tasks.find((t) => t.number === taskNum);
      if (!task || !message) {
        console.log(chalk.red("  Usage: tell <task-number> <message>"));
        break;
      }
      const success = await runner.injectMessage(task.id, message);
      console.log(success ? chalk.green("  Sent.") : chalk.red("  Failed."));
      break;
    }

    case "help":
    case "h":
    case "?":
      printHelp();
      break;

    case "quit":
    case "exit":
    case "q":
      isRunning = false;
      break;

    case "clear":
    case "c":
      clearScreen();
      printDashboard();
      printQuickHelp();
      break;

    case "inbox":
    case "i":
      printInbox();
      break;

    case "view":
    case "v": {
      const qKey = parts[1]?.toLowerCase();
      if (!qKey) {
        console.log(chalk.red("  Usage: view <q1>"));
        break;
      }
      const entry = questions.get(qKey);
      if (!entry) {
        console.log(chalk.red(`  Question ${qKey} not found.`));
        break;
      }
      printQuestionDetail(qKey, entry);
      break;
    }

    case "dismiss":
    case "skip": {
      const qKey = parts[1]?.toLowerCase();
      if (!qKey) {
        console.log(chalk.red("  Usage: dismiss <q1>"));
        break;
      }
      if (questions.has(qKey)) {
        questions.delete(qKey);
        console.log(chalk.gray(`  Dismissed ${qKey}`));
      } else {
        console.log(chalk.red(`  Question ${qKey} not found.`));
      }
      break;
    }

    default: {
      // Check if answering a question
      if (/^q\d+$/.test(command)) {
        const answer = parts.slice(1).join(" ");
        if (!answer) {
          console.log(chalk.red(`  Usage: ${command} <answer>`));
          break;
        }

        const entry = questions.get(command);
        if (!entry) {
          console.log(chalk.red(`  Question ${command} not found.`));
          break;
        }

        const task = tasks.find((t) => t.id === entry.taskId);
        if (!task) {
          console.log(chalk.red("  Task not found."));
          break;
        }

        const success = await runner.injectMessage(task.id, answer);
        if (success) {
          questions.delete(command);
          activity.unshift({
            timestamp: new Date(),
            taskId: task.id,
            taskName: task.repoName,
            type: "info",
            message: `Answered: "${answer.slice(0, 30)}..."`,
          });
          console.log(chalk.green("  Answer sent."));
        } else {
          // Task has ended, clean up the question
          questions.delete(command);
          console.log(chalk.yellow("  Task has ended. Question dismissed."));
        }
        break;
      }

      console.log(chalk.red(`  Unknown command: ${command}. Type 'help' for commands.`));
    }
  }
}

function printHelp(): void {
  console.log(chalk.bold("\n  Dashboard Commands"));
  console.log(chalk.gray("  " + "─".repeat(55)));

  console.log(chalk.bold("\n  Tasks"));
  console.log(`  ${chalk.cyan("new")} / ${chalk.cyan("n")}              Start a new task`);
  console.log(`  ${chalk.cyan("open <n>")}             Attach to terminal for task n`);
  console.log(`  ${chalk.cyan("tell <n> <msg>")}       Send message to task n`);
  console.log(`  ${chalk.cyan("stop <n>")}             Stop task n`);
  console.log(`  ${chalk.cyan("stop-all")}             Stop all tasks`);

  console.log(chalk.bold("\n  Inbox (Questions)"));
  console.log(`  ${chalk.cyan("inbox")} / ${chalk.cyan("i")}            View all pending questions`);
  console.log(`  ${chalk.cyan("view <q#>")}            See full question details`);
  console.log(`  ${chalk.cyan("q# <answer>")}          Answer question (e.g., q1 yes)`);
  console.log(`  ${chalk.cyan("dismiss <q#>")}         Dismiss question without answering`);

  console.log(chalk.bold("\n  General"));
  console.log(`  ${chalk.cyan("list")} / ${chalk.cyan("d")}             Refresh dashboard`);
  console.log(`  ${chalk.cyan("clear")} / ${chalk.cyan("c")}            Clear screen`);
  console.log(`  ${chalk.cyan("help")} / ${chalk.cyan("?")}             Show this help`);
  console.log(`  ${chalk.cyan("quit")}                 Exit`);

  console.log(chalk.gray("\n  Model: ") + chalk.cyan(DEFAULT_MODEL));
  console.log(chalk.gray("  Tip: Press Enter to refresh the dashboard"));
  console.log();
}

// ─────────────────────────────────────────────────────────────
// Main Entry
// ─────────────────────────────────────────────────────────────

export async function runDashboard(): Promise<void> {
  loadRecentRepos();
  discoveredRepos = discoverGitRepos();

  // Check requirements
  const { ok, missing } = await runner.checkRequirements();
  if (!ok) {
    console.error(chalk.red("\n  Missing requirements:"));
    for (const m of missing) {
      console.error(chalk.red(`    - ${m}`));
    }
    console.error();
    process.exit(1);
  }

  // Suggest running inside tmux for split pane support
  if (!process.env.TMUX) {
    console.log(chalk.yellow("\n  Tip: Run inside tmux for split-pane task viewing"));
    console.log(chalk.gray("       tmux new-session -s cmux-dashboard"));
    console.log();
  }

  // Initial load
  await refreshTasks();
  clearScreen();
  printDashboard();
  printQuickHelp();

  // Set up polling
  const pollInterval = setInterval(() => {
    refreshTasks().catch(console.error);
  }, 5000);

  // Interactive prompt with single-key shortcuts
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Enable keypress events for single-key shortcuts
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  let inputBuffer = "";
  let isPrompting = true;

  process.stdin.on("keypress", async (str, key) => {
    if (!isPrompting) return;

    // Handle Ctrl+C
    if (key?.ctrl && key.name === "c") {
      isRunning = false;
      clearInterval(pollInterval);
      rl.close();
      console.log(chalk.gray("\n  Goodbye!\n"));
      process.exit(0);
    }

    // Single-key shortcuts (only when buffer is empty)
    if (inputBuffer === "" && str) {
      if (str === "c") {
        process.stdout.write("\n");
        await refreshTasks();
        clearScreen();
        printDashboard();
        printQuickHelp();
        process.stdout.write(chalk.cyan("  > "));
        return;
      }
      if (str === "q") {
        isRunning = false;
        clearInterval(pollInterval);
        rl.close();
        console.log(chalk.gray("\n  Goodbye!\n"));
        process.exit(0);
      }
    }

    // Handle Enter
    if (key?.name === "enter") {
      process.stdout.write("\n");
      isPrompting = false;
      try {
        await handleCommand(inputBuffer, rl);
      } catch (err) {
        console.error(chalk.red("  Error:"), err);
      }
      inputBuffer = "";
      isPrompting = true;
      process.stdout.write(chalk.cyan("  > "));
      return;
    }

    // Handle backspace
    if (key?.name === "backspace") {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        process.stdout.write("\b \b");
      }
      return;
    }

    // Regular character input
    if (str && !key?.ctrl && !key?.meta) {
      inputBuffer += str;
      process.stdout.write(str);
    }
  });

  // Initial prompt
  process.stdout.write(chalk.cyan("  > "));

  rl.on("close", () => {
    isRunning = false;
    clearInterval(pollInterval);
    console.log(chalk.gray("\n  Goodbye!\n"));
    process.exit(0);
  });
}
