/**
 * Dashboard TUI - Replicates the web dashboard experience in the terminal
 */

import * as readline from "node:readline";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import chalk from "chalk";
import { DockerConnector } from "./docker.js";
import { type Task, type Question, type ActivityEntry } from "./types.js";
import { extractQuestionsFromOutput } from "./extractor.js";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const AVAILABLE_MODELS = [
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "Anthropic", default: true },
  { id: "claude-opus-4-5-20251101", name: "Claude Opus 4", provider: "Anthropic" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "Anthropic" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "Anthropic" },
];

const BOX = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
};

// ─────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────

const docker = new DockerConnector();
let tasks: Task[] = [];
const questions: Map<string, { question: Question; taskId: string }> = new Map();
const activity: ActivityEntry[] = [];
let questionCounter = 0;
let isRunning = true;
let recentRepos: string[] = [];

// ─────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────

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
    fs.writeFileSync(configPath, JSON.stringify(recentRepos.slice(0, 10)));
  } catch {
    // Ignore save errors
  }
}

function addRecentRepo(repoPath: string): void {
  const absolute = path.resolve(repoPath);
  recentRepos = [absolute, ...recentRepos.filter((r) => r !== absolute)].slice(0, 10);
  saveRecentRepos();
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function boxLine(content: string, width: number): string {
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
  console.log(chalk.cyan(`  ${boxLine(chalk.gray("Docker-based Claude Code Orchestrator"), width)}`));
  console.log(chalk.cyan(`  ${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`));

  // Categorize tasks
  const inProgress = tasks.filter((t) => t.status === "running" || t.status === "starting");
  const withQuestions = tasks.filter((t) => {
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

  // Questions Section
  if (withQuestions.length > 0 || questions.size > 0) {
    console.log(chalk.bold.yellow(`\n  ? Needs Attention`) + chalk.gray(` (${questions.size} questions)`));
    console.log(chalk.gray("  " + "─".repeat(60)));
    for (const [key, { question, taskId }] of questions.entries()) {
      const task = tasks.find((t) => t.id === taskId);
      console.log(
        chalk.yellow(`    [${key}]`) +
          chalk.gray(` ${task?.repoName || "unknown"}: `) +
          chalk.white(question.question.slice(0, 40) + (question.question.length > 40 ? "..." : ""))
      );
    }
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
  const port = chalk.cyan(`:${task.terminalPort}`);
  const time = task.startedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  console.log(
    `    ${chalk.gray(task.number.toString().padStart(2))} ${icon} ` +
      color(task.repoName.padEnd(15).slice(0, 15)) +
      chalk.gray(` "${task.prompt.slice(0, 25)}${task.prompt.length > 25 ? "..." : ""}" `) +
      port +
      chalk.gray(` ${time}`)
  );
}

function printQuickHelp(): void {
  console.log(chalk.gray("  Commands: ") +
    chalk.cyan("new") + chalk.gray(" | ") +
    chalk.cyan("open <n>") + chalk.gray(" | ") +
    chalk.cyan("q<n> <ans>") + chalk.gray(" | ") +
    chalk.cyan("stop <n>") + chalk.gray(" | ") +
    chalk.cyan("help") + chalk.gray(" | ") +
    chalk.cyan("quit")
  );
}

// ─────────────────────────────────────────────────────────────
// Interactive Task Creation (Dashboard-style)
// ─────────────────────────────────────────────────────────────

async function handleNewTask(rl: readline.Interface): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("  ╭─────────────────────────────────────────────────────────────╮"));
  console.log(chalk.bold.cyan("  │                    Start New Task                           │"));
  console.log(chalk.bold.cyan("  ╰─────────────────────────────────────────────────────────────╯"));

  // Step 1: Select Project/Repo
  console.log(chalk.bold("\n  1. Select Project"));
  console.log(chalk.gray("  " + "─".repeat(60)));

  if (recentRepos.length > 0) {
    console.log(chalk.gray("     Recent:"));
    recentRepos.slice(0, 5).forEach((repo, i) => {
      const name = path.basename(repo);
      console.log(chalk.cyan(`     [${i + 1}]`) + ` ${name}` + chalk.gray(` (${repo})`));
    });
  }
  console.log(chalk.cyan("     [.]") + ` Current directory` + chalk.gray(` (${process.cwd()})`));
  console.log(chalk.cyan("     [p]") + ` Enter custom path`);

  const repoChoice = await question(rl, chalk.cyan("\n  Select project: "));
  let selectedRepo: string;

  if (repoChoice === "." || repoChoice === "") {
    selectedRepo = process.cwd();
  } else if (repoChoice === "p") {
    selectedRepo = await question(rl, chalk.cyan("  Enter path: "));
    if (!selectedRepo) {
      console.log(chalk.red("  Cancelled."));
      return;
    }
  } else {
    const idx = parseInt(repoChoice) - 1;
    if (idx >= 0 && idx < recentRepos.length) {
      selectedRepo = recentRepos[idx];
    } else {
      console.log(chalk.red("  Invalid selection."));
      return;
    }
  }

  // Validate repo exists
  if (!fs.existsSync(selectedRepo)) {
    console.log(chalk.red(`  Path not found: ${selectedRepo}`));
    return;
  }

  const repoName = path.basename(selectedRepo);
  console.log(chalk.green(`  ✓ Selected: ${repoName}`));

  // Step 2: Select Model
  console.log(chalk.bold("\n  2. Select Model"));
  console.log(chalk.gray("  " + "─".repeat(60)));

  AVAILABLE_MODELS.forEach((model, i) => {
    const defaultBadge = model.default ? chalk.green(" (default)") : "";
    console.log(chalk.cyan(`     [${i + 1}]`) + ` ${model.name}` + chalk.gray(` - ${model.provider}`) + defaultBadge);
  });

  const modelChoice = await question(rl, chalk.cyan("\n  Select model [1]: "));
  const modelIdx = modelChoice ? parseInt(modelChoice) - 1 : 0;
  const selectedModel = AVAILABLE_MODELS[modelIdx] || AVAILABLE_MODELS[0];
  console.log(chalk.green(`  ✓ Using: ${selectedModel.name}`));

  // Step 3: Enter Task Description
  console.log(chalk.bold("\n  3. Task Description"));
  console.log(chalk.gray("  " + "─".repeat(60)));
  console.log(chalk.gray("     What should Claude do? Be specific."));

  const taskPrompt = await question(rl, chalk.cyan("\n  > "));
  if (!taskPrompt.trim()) {
    console.log(chalk.red("  Task description is required."));
    return;
  }

  // Confirm and Start
  console.log(chalk.bold("\n  Review"));
  console.log(chalk.gray("  " + "─".repeat(60)));
  console.log(`     Project: ${chalk.cyan(repoName)}`);
  console.log(`     Model:   ${chalk.cyan(selectedModel.name)}`);
  console.log(`     Task:    ${chalk.white(taskPrompt.slice(0, 50))}${taskPrompt.length > 50 ? "..." : ""}`);

  const confirm = await question(rl, chalk.cyan("\n  Start task? [Y/n]: "));
  if (confirm.toLowerCase() === "n") {
    console.log(chalk.yellow("  Cancelled."));
    return;
  }

  // Start the task
  console.log(chalk.gray("\n  Starting task..."));
  try {
    const task = await docker.startTask(selectedRepo, taskPrompt, selectedModel.id);
    addRecentRepo(selectedRepo);

    activity.unshift({
      timestamp: new Date(),
      taskId: task.id,
      taskName: repoName,
      type: "info",
      message: `Started: "${taskPrompt.slice(0, 30)}..."`,
    });

    console.log(chalk.green(`\n  ✓ Started task #${task.number}`));
    console.log(chalk.gray(`    Terminal: `) + chalk.cyan(`http://localhost:${task.terminalPort}`));
    console.log(chalk.gray(`    Open in browser or run: `) + chalk.cyan(`open ${task.number}`));

    await refreshTasks();
  } catch (err) {
    console.error(chalk.red("  Failed to start task:"), err);
  }
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// ─────────────────────────────────────────────────────────────
// Polling & Updates
// ─────────────────────────────────────────────────────────────

async function refreshTasks(): Promise<void> {
  try {
    tasks = await docker.listTasks();

    for (const task of tasks) {
      if (task.status === "running" || task.status === "starting") {
        try {
          const output = await docker.readOutput(task.id);
          const extracted = extractQuestionsFromOutput(output, task.id);

          for (const q of extracted.questions) {
            const alreadyExists = Array.from(questions.values()).some(
              (existing) => existing.question.question === q.question
            );

            if (!alreadyExists) {
              questionCounter++;
              const key = `q${questionCounter}`;
              questions.set(key, { question: q, taskId: task.id });

              activity.unshift({
                timestamp: new Date(),
                taskId: task.id,
                taskName: task.repoName,
                type: "question",
                message: `Question: "${q.question.slice(0, 40)}..."`,
              });

              // Alert user
              console.log(chalk.yellow(`\n  [${key}] New question from ${task.repoName}:`));
              console.log(chalk.white(`       "${q.question}"`));
              if (q.suggestion) {
                console.log(chalk.blue(`       → ${q.suggestion}`));
              }
              console.log(chalk.gray(`       Reply: ${key} <your answer>\n`));
            }
          }
        } catch {
          // Container might not be ready
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

async function handleCommand(input: string, rl: readline.Interface): Promise<void> {
  const parts = input.trim().split(/\s+/);
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
      await handleNewTask(rl);
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
      await docker.openTerminal(task.id);
      console.log(chalk.green(`  Opened http://localhost:${task.terminalPort}`));
      break;
    }

    case "stop": {
      const taskNum = parseInt(parts[1] || "", 10);
      const task = tasks.find((t) => t.number === taskNum);
      if (!task) {
        console.log(chalk.red(`  Task ${taskNum} not found.`));
        break;
      }
      await docker.stopTask(task.id);
      console.log(chalk.green(`  Stopped task #${taskNum}`));
      await refreshTasks();
      break;
    }

    case "stop-all":
      await docker.stopAllTasks();
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
      const success = await docker.injectMessage(task.id, message);
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

        const success = await docker.injectMessage(task.id, answer);
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
          console.log(chalk.red("  Failed to send answer."));
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
  console.log(`  ${chalk.cyan("new")} / ${chalk.cyan("n")}              Start a new task (interactive wizard)`);
  console.log(`  ${chalk.cyan("list")} / ${chalk.cyan("d")}             Refresh dashboard`);
  console.log(`  ${chalk.cyan("open <n>")}             Open terminal for task n in browser`);
  console.log(`  ${chalk.cyan("q<n> <answer>")}        Answer question n (e.g., q1 yes)`);
  console.log(`  ${chalk.cyan("tell <n> <msg>")}       Send message to task n`);
  console.log(`  ${chalk.cyan("stop <n>")}             Stop task n`);
  console.log(`  ${chalk.cyan("stop-all")}             Stop all tasks`);
  console.log(`  ${chalk.cyan("clear")} / ${chalk.cyan("c")}            Clear screen and refresh`);
  console.log(`  ${chalk.cyan("help")} / ${chalk.cyan("?")}             Show this help`);
  console.log(`  ${chalk.cyan("quit")} / ${chalk.cyan("q")}             Exit`);
  console.log();
  console.log(chalk.gray("  Tip: Press Enter to refresh the dashboard"));
}

// ─────────────────────────────────────────────────────────────
// Main Entry
// ─────────────────────────────────────────────────────────────

export async function runDashboard(): Promise<void> {
  loadRecentRepos();

  // Check Docker
  const dockerOk = await docker.checkDocker();
  if (!dockerOk) {
    console.error(chalk.red("\n  Docker is not running. Please start Docker and try again.\n"));
    process.exit(1);
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

  // Interactive prompt
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    if (!isRunning) {
      clearInterval(pollInterval);
      rl.close();
      console.log(chalk.gray("\n  Goodbye!\n"));
      process.exit(0);
    }

    rl.question(chalk.cyan("  > "), async (input) => {
      try {
        await handleCommand(input, rl);
      } catch (err) {
        console.error(chalk.red("  Error:"), err);
      }
      prompt();
    });
  };

  rl.on("close", () => {
    isRunning = false;
    clearInterval(pollInterval);
    console.log(chalk.gray("\n  Goodbye!\n"));
    process.exit(0);
  });

  prompt();
}
