/**
 * cmux Memory MCP Server
 *
 * Standalone MCP server that exposes cmux agent memory for external clients
 * like Claude Desktop and Cursor. Can connect to:
 * - Local sandbox memory directory
 * - Remote sandbox via SSH/HTTP
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface MemoryMcpConfig {
  memoryDir: string;
  agentName?: string;
}

const DEFAULT_MEMORY_DIR = "/root/lifecycle/memory";

export function createMemoryMcpServer(config?: Partial<MemoryMcpConfig>) {
  const memoryDir = config?.memoryDir ?? DEFAULT_MEMORY_DIR;
  const resolvedAgentName = config?.agentName ?? process.env.CMUX_AGENT_NAME;
  const agentName = resolvedAgentName ?? "external-client";

  if (!resolvedAgentName) {
    console.error(
      '[devsh-memory-mcp] Warning: no agent identity provided; falling back to "external-client". ' +
        "Pass --agent <name> or set CMUX_AGENT_NAME to preserve mailbox sender identity."
    );
  }

  const knowledgeDir = path.join(memoryDir, "knowledge");
  const dailyDir = path.join(memoryDir, "daily");
  const orchestrationDir = path.join(memoryDir, "orchestration");
  const mailboxPath = path.join(memoryDir, "MAILBOX.json");
  const tasksPath = path.join(memoryDir, "TASKS.json");
  const planPath = path.join(orchestrationDir, "PLAN.json");
  const agentsPath = path.join(orchestrationDir, "AGENTS.json");
  const eventsPath = path.join(orchestrationDir, "EVENTS.jsonl");

  // Helper functions
  function readFile(filePath: string): string | null {
    try {
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  function writeFile(filePath: string, content: string): boolean {
    try {
      fs.writeFileSync(filePath, content, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  interface Mailbox {
    version: number;
    messages: MailboxMessage[];
  }

  interface MailboxMessage {
    id: string;
    from: string;
    to: string;
    type?: "handoff" | "request" | "status";
    message: string;
    timestamp: string;
    read?: boolean;
  }

  interface TaskEntry {
    id: string;
    subject: string;
    description: string;
    status: "pending" | "in_progress" | "completed";
    createdAt: string;
    updatedAt: string;
  }

  interface TasksFile {
    version: number;
    tasks: TaskEntry[];
    metadata?: {
      sandboxId?: string;
      createdAt?: string;
    };
  }

  function readTasks(): TasksFile {
    const content = readFile(tasksPath);
    if (!content) return { version: 1, tasks: [] };
    try {
      return JSON.parse(content) as TasksFile;
    } catch {
      return { version: 1, tasks: [] };
    }
  }

  function writeTasks(tasks: TasksFile): boolean {
    return writeFile(tasksPath, JSON.stringify(tasks, null, 2));
  }

  function generateTaskId(): string {
    return "task_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }

  function getTodayDateString(): string {
    const iso = new Date().toISOString();
    return iso.slice(0, iso.indexOf("T"));
  }

  function ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // Orchestration types and helpers
  interface OrchestrationTask {
    id: string;
    prompt: string;
    agentName: string;
    status: string;
    taskRunId?: string;
    dependsOn?: string[];
    priority?: number;
    result?: string;
    errorMessage?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  }

  interface OrchestrationPlan {
    version: number;
    createdAt: string;
    updatedAt: string;
    status: string;
    headAgent: string;
    orchestrationId: string;
    description?: string;
    tasks: OrchestrationTask[];
    metadata?: Record<string, unknown>;
  }

  interface OrchestrationEvent {
    timestamp: string;
    event: string;
    taskRunId?: string;
    agentName?: string;
    status?: string;
    message?: string;
    from?: string;
    to?: string;
    type?: string;
    metadata?: Record<string, unknown>;
  }

  function readPlan(): OrchestrationPlan | null {
    const content = readFile(planPath);
    if (!content) return null;
    try {
      return JSON.parse(content) as OrchestrationPlan;
    } catch {
      return null;
    }
  }

  function writePlan(plan: OrchestrationPlan): boolean {
    ensureDir(orchestrationDir);
    plan.updatedAt = new Date().toISOString();
    return writeFile(planPath, JSON.stringify(plan, null, 2));
  }

  function appendEvent(event: OrchestrationEvent): boolean {
    ensureDir(orchestrationDir);
    const line = JSON.stringify(event) + "\n";
    try {
      fs.appendFileSync(eventsPath, line, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  function readMailbox(): Mailbox {
    const content = readFile(mailboxPath);
    if (!content) return { version: 1, messages: [] };
    try {
      return JSON.parse(content) as Mailbox;
    } catch {
      return { version: 1, messages: [] };
    }
  }

  function writeMailbox(mailbox: Mailbox): boolean {
    return writeFile(mailboxPath, JSON.stringify(mailbox, null, 2));
  }

  function generateMessageId(): string {
    return "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }

  function listDailyLogs(): string[] {
    try {
      if (!fs.existsSync(dailyDir)) return [];
      const files = fs.readdirSync(dailyDir);
      return files
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(".md", ""))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  interface SearchResult {
    source: string;
    line?: number;
    content: string;
  }

  function searchMemory(query: string): SearchResult[] {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // Search knowledge
    const knowledge = readFile(path.join(knowledgeDir, "MEMORY.md"));
    if (knowledge?.toLowerCase().includes(lowerQuery)) {
      const lines = knowledge.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({
            source: "knowledge/MEMORY.md",
            line: i + 1,
            content: lines[i].trim(),
          });
        }
      }
    }

    // Search tasks
    const tasks = readFile(tasksPath);
    if (tasks?.toLowerCase().includes(lowerQuery)) {
      results.push({ source: "TASKS.json", content: "Match found in tasks file" });
    }

    // Search mailbox
    const mailbox = readFile(mailboxPath);
    if (mailbox?.toLowerCase().includes(lowerQuery)) {
      results.push({ source: "MAILBOX.json", content: "Match found in mailbox file" });
    }

    // Search daily logs (last 7 days)
    const dailyLogs = listDailyLogs();
    for (const date of dailyLogs.slice(0, 7)) {
      const logContent = readFile(path.join(dailyDir, `${date}.md`));
      if (logContent?.toLowerCase().includes(lowerQuery)) {
        const lines = logContent.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({
              source: `daily/${date}.md`,
              line: i + 1,
              content: lines[i].trim(),
            });
          }
        }
      }
    }

    return results;
  }

  // Create MCP server
  const server = new Server(
    {
      name: "devsh-memory",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "read_memory",
        description: 'Read a memory file. Type can be "knowledge", "tasks", or "mailbox".',
        inputSchema: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              enum: ["knowledge", "tasks", "mailbox"],
              description: "The type of memory to read",
            },
          },
          required: ["type"],
        },
      },
      {
        name: "list_daily_logs",
        description: "List available daily log dates (newest first).",
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "read_daily_log",
        description: "Read a specific daily log by date (YYYY-MM-DD format).",
        inputSchema: {
          type: "object" as const,
          properties: {
            date: {
              type: "string",
              description: "The date in YYYY-MM-DD format",
            },
          },
          required: ["date"],
        },
      },
      {
        name: "search_memory",
        description: "Search across all memory files for a query string.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "send_message",
        description: 'Send a message to another agent on the same task. Use "*" to broadcast to all agents.',
        inputSchema: {
          type: "object" as const,
          properties: {
            to: {
              type: "string",
              description: 'Recipient agent name (e.g., "claude/opus-4.5") or "*" for broadcast',
            },
            message: {
              type: "string",
              description: "The message content",
            },
            type: {
              type: "string",
              enum: ["handoff", "request", "status"],
              description: "Message type: handoff (work transfer), request (ask to do something), status (progress update)",
            },
          },
          required: ["to", "message"],
        },
      },
      {
        name: "get_my_messages",
        description: "Get all messages addressed to this agent (including broadcasts). Returns unread messages first.",
        inputSchema: {
          type: "object" as const,
          properties: {
            includeRead: {
              type: "boolean",
              description: "Include messages already marked as read (default: false)",
            },
          },
        },
      },
      {
        name: "mark_read",
        description: "Mark a message as read by its ID.",
        inputSchema: {
          type: "object" as const,
          properties: {
            messageId: {
              type: "string",
              description: "The message ID to mark as read",
            },
          },
          required: ["messageId"],
        },
      },
      // Write tools
      {
        name: "append_daily_log",
        description: "Append content to today's daily log. Creates the file if it doesn't exist.",
        inputSchema: {
          type: "object" as const,
          properties: {
            content: {
              type: "string",
              description: "Content to append to the daily log",
            },
          },
          required: ["content"],
        },
      },
      {
        name: "update_knowledge",
        description: "Update a specific priority section in the knowledge file (MEMORY.md). Appends a new entry with today's date.",
        inputSchema: {
          type: "object" as const,
          properties: {
            section: {
              type: "string",
              enum: ["P0", "P1", "P2"],
              description: "Priority section to update (P0=Core, P1=Active, P2=Reference)",
            },
            content: {
              type: "string",
              description: "Content to add to the section (will be prefixed with today's date)",
            },
          },
          required: ["section", "content"],
        },
      },
      {
        name: "add_task",
        description: "Add a new task to the TASKS.json file.",
        inputSchema: {
          type: "object" as const,
          properties: {
            subject: {
              type: "string",
              description: "Brief title for the task",
            },
            description: {
              type: "string",
              description: "Detailed description of what needs to be done",
            },
          },
          required: ["subject", "description"],
        },
      },
      {
        name: "update_task",
        description: "Update the status of an existing task in TASKS.json.",
        inputSchema: {
          type: "object" as const,
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the task to update",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "New status for the task",
            },
          },
          required: ["taskId", "status"],
        },
      },
      // Orchestration tools
      {
        name: "read_orchestration",
        description: "Read an orchestration file (PLAN.json, AGENTS.json, or EVENTS.jsonl).",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: {
              type: "string",
              enum: ["plan", "agents", "events"],
              description: "Type of orchestration file to read",
            },
          },
          required: ["type"],
        },
      },
      {
        name: "append_event",
        description: "Append an orchestration event to EVENTS.jsonl.",
        inputSchema: {
          type: "object" as const,
          properties: {
            event: {
              type: "string",
              description: "Event type (e.g., agent_spawned, agent_completed, message_sent)",
            },
            message: {
              type: "string",
              description: "Human-readable message describing the event",
            },
            agentName: {
              type: "string",
              description: "Agent name associated with the event (optional)",
            },
            taskRunId: {
              type: "string",
              description: "Task run ID associated with the event (optional)",
            },
          },
          required: ["event", "message"],
        },
      },
      {
        name: "update_plan_task",
        description: "Update the status of a task in the orchestration PLAN.json.",
        inputSchema: {
          type: "object" as const,
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the orchestration task to update",
            },
            status: {
              type: "string",
              description: "New status (pending, assigned, running, completed, failed, cancelled)",
            },
            result: {
              type: "string",
              description: "Result message (for completed tasks)",
            },
            errorMessage: {
              type: "string",
              description: "Error message (for failed tasks)",
            },
          },
          required: ["taskId", "status"],
        },
      },
      {
        name: "pull_orchestration_updates",
        description: "Sync local orchestration state (PLAN.json) with the server. Fetches latest task statuses, messages, and aggregated progress. Requires CMUX_TASK_RUN_JWT environment variable.",
        inputSchema: {
          type: "object" as const,
          properties: {
            orchestrationId: {
              type: "string",
              description: "The orchestration ID to sync. Uses CMUX_ORCHESTRATION_ID env var if not provided.",
            },
          },
        },
      },
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "read_memory": {
        const type = (args as { type: string }).type;
        let content: string | null = null;
        if (type === "knowledge") {
          content = readFile(path.join(knowledgeDir, "MEMORY.md"));
        } else if (type === "tasks") {
          content = readFile(tasksPath);
        } else if (type === "mailbox") {
          content = readFile(mailboxPath);
        }
        return {
          content: [{ type: "text", text: content ?? `No ${type} content found.` }],
        };
      }

      case "list_daily_logs": {
        const dates = listDailyLogs();
        return {
          content: [{ type: "text", text: dates.length > 0 ? dates.join("\n") : "No daily logs found." }],
        };
      }

      case "read_daily_log": {
        const date = (args as { date: string }).date;
        const content = readFile(path.join(dailyDir, `${date}.md`));
        return {
          content: [{ type: "text", text: content ?? `No log found for ${date}.` }],
        };
      }

      case "search_memory": {
        const query = (args as { query: string }).query;
        const results = searchMemory(query);
        if (results.length === 0) {
          return { content: [{ type: "text", text: `No results found for "${query}".` }] };
        }
        const formatted = results
          .map((r) => `[${r.source}${r.line ? `:${r.line}` : ""}] ${r.content}`)
          .join("\n");
        return { content: [{ type: "text", text: formatted }] };
      }

      case "send_message": {
        const { to, message, type } = args as { to: string; message: string; type?: "handoff" | "request" | "status" };
        const mailbox = readMailbox();
        const newMessage: MailboxMessage = {
          id: generateMessageId(),
          from: agentName,
          to,
          type: type ?? "request",
          message,
          timestamp: new Date().toISOString(),
          read: false,
        };
        mailbox.messages.push(newMessage);
        writeMailbox(mailbox);
        return { content: [{ type: "text", text: `Message sent successfully. ID: ${newMessage.id}` }] };
      }

      case "get_my_messages": {
        const includeRead = (args as { includeRead?: boolean }).includeRead ?? false;
        const mailbox = readMailbox();
        const myMessages = mailbox.messages.filter(
          (m) => m.to === agentName || m.to === "*"
        );
        const filtered = includeRead ? myMessages : myMessages.filter((m) => !m.read);
        if (filtered.length === 0) {
          return { content: [{ type: "text", text: "No messages for you." }] };
        }
        const formatted = filtered
          .map((m) => `[${m.id}] ${m.type ?? "message"} from ${m.from}: ${m.message}`)
          .join("\n\n");
        return { content: [{ type: "text", text: formatted }] };
      }

      case "mark_read": {
        const messageId = (args as { messageId: string }).messageId;
        const mailbox = readMailbox();
        const message = mailbox.messages.find((m) => m.id === messageId);
        if (!message) {
          return { content: [{ type: "text", text: `Message ${messageId} not found.` }] };
        }
        message.read = true;
        writeMailbox(mailbox);
        return { content: [{ type: "text", text: `Message ${messageId} marked as read.` }] };
      }

      // Write tool handlers
      case "append_daily_log": {
        const { content } = args as { content: string };
        const today = getTodayDateString();
        ensureDir(dailyDir);
        const logPath = path.join(dailyDir, `${today}.md`);
        const existing = readFile(logPath) ?? `# Daily Log: ${today}\n\n> Session-specific observations. Temporary notes go here.\n\n---\n`;
        const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
        const newContent = existing + `\n- [${timestamp}] ${content}`;
        if (writeFile(logPath, newContent)) {
          return { content: [{ type: "text", text: `Appended to daily/${today}.md` }] };
        }
        return { content: [{ type: "text", text: `Failed to append to daily log` }] };
      }

      case "update_knowledge": {
        const { section, content } = args as { section: "P0" | "P1" | "P2"; content: string };
        ensureDir(knowledgeDir);
        const knowledgePath = path.join(knowledgeDir, "MEMORY.md");
        let existing = readFile(knowledgePath);

        // Create default structure if file doesn't exist
        if (!existing) {
          existing = `# Project Knowledge

> Curated insights organized by priority. Add date tags for TTL tracking.

## P0 - Core (Never Expires)
<!-- Fundamental project facts, configuration, invariants -->

## P1 - Active (90-day TTL)
<!-- Ongoing work context, current strategies, recent decisions -->

## P2 - Reference (30-day TTL)
<!-- Temporary findings, debug notes, one-off context -->

---
*Priority guide: P0 = permanent truth, P1 = active context, P2 = temporary reference*
*Format: - [YYYY-MM-DD] Your insight here*
`;
        }

        const today = getTodayDateString();
        const newEntry = `- [${today}] ${content}`;

        // Find the section header and insert after it
        const sectionHeaders: Record<string, string> = {
          P0: "## P0 - Core (Never Expires)",
          P1: "## P1 - Active (90-day TTL)",
          P2: "## P2 - Reference (30-day TTL)",
        };

        const header = sectionHeaders[section];
        const headerIndex = existing.indexOf(header);

        if (headerIndex === -1) {
          return { content: [{ type: "text", text: `Section ${section} not found in MEMORY.md` }] };
        }

        // Find the next section or end of file
        const afterHeader = existing.slice(headerIndex + header.length);
        const nextSectionMatch = afterHeader.match(/\n## /);
        const insertPoint = nextSectionMatch
          ? headerIndex + header.length + (nextSectionMatch.index ?? afterHeader.length)
          : existing.length;

        // Find the end of the comment line (if any) after the header
        const commentEndMatch = afterHeader.match(/<!--[^>]*-->\n/);
        const commentEnd = commentEndMatch
          ? headerIndex + header.length + (commentEndMatch.index ?? 0) + commentEndMatch[0].length
          : headerIndex + header.length + 1;

        // Insert the new entry after the comment
        const actualInsertPoint = Math.min(commentEnd, insertPoint);
        const updated = existing.slice(0, actualInsertPoint) + newEntry + "\n" + existing.slice(actualInsertPoint);

        if (writeFile(knowledgePath, updated)) {
          return { content: [{ type: "text", text: `Added entry to ${section} section in MEMORY.md` }] };
        }
        return { content: [{ type: "text", text: `Failed to update MEMORY.md` }] };
      }

      case "add_task": {
        const { subject, description } = args as { subject: string; description: string };
        const tasks = readTasks();
        const now = new Date().toISOString();
        const newTask: TaskEntry = {
          id: generateTaskId(),
          subject,
          description,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        };
        tasks.tasks.push(newTask);
        if (writeTasks(tasks)) {
          return { content: [{ type: "text", text: `Task created with ID: ${newTask.id}` }] };
        }
        return { content: [{ type: "text", text: `Failed to create task` }] };
      }

      case "update_task": {
        const { taskId, status } = args as { taskId: string; status: "pending" | "in_progress" | "completed" };
        const tasks = readTasks();
        const task = tasks.tasks.find((t) => t.id === taskId);
        if (!task) {
          return { content: [{ type: "text", text: `Task ${taskId} not found` }] };
        }
        task.status = status;
        task.updatedAt = new Date().toISOString();
        if (writeTasks(tasks)) {
          return { content: [{ type: "text", text: `Task ${taskId} updated to status: ${status}` }] };
        }
        return { content: [{ type: "text", text: `Failed to update task` }] };
      }

      // Orchestration tool handlers
      case "read_orchestration": {
        const type = (args as { type: string }).type;
        let content: string | null = null;
        if (type === "plan") {
          content = readFile(planPath);
        } else if (type === "agents") {
          content = readFile(agentsPath);
        } else if (type === "events") {
          content = readFile(eventsPath);
        }
        return {
          content: [{ type: "text", text: content ?? `No ${type} file found in orchestration directory.` }],
        };
      }

      case "append_event": {
        const { event, message, agentName, taskRunId } = args as {
          event: string;
          message: string;
          agentName?: string;
          taskRunId?: string;
        };
        const eventObj: OrchestrationEvent = {
          timestamp: new Date().toISOString(),
          event,
          message,
        };
        if (agentName) eventObj.agentName = agentName;
        if (taskRunId) eventObj.taskRunId = taskRunId;

        if (appendEvent(eventObj)) {
          return { content: [{ type: "text", text: `Event appended to EVENTS.jsonl` }] };
        }
        return { content: [{ type: "text", text: `Failed to append event` }] };
      }

      case "update_plan_task": {
        const { taskId, status, result, errorMessage } = args as {
          taskId: string;
          status: string;
          result?: string;
          errorMessage?: string;
        };
        const plan = readPlan();
        if (!plan) {
          return { content: [{ type: "text", text: `No PLAN.json found in orchestration directory` }] };
        }
        const task = plan.tasks.find((t) => t.id === taskId);
        if (!task) {
          return { content: [{ type: "text", text: `Task ${taskId} not found in PLAN.json` }] };
        }
        task.status = status;
        if (result !== undefined) task.result = result;
        if (errorMessage !== undefined) task.errorMessage = errorMessage;
        if (status === "running" && !task.startedAt) {
          task.startedAt = new Date().toISOString();
        }
        if (status === "completed" || status === "failed" || status === "cancelled") {
          task.completedAt = new Date().toISOString();
        }

        if (writePlan(plan)) {
          return { content: [{ type: "text", text: `Plan task ${taskId} updated to status: ${status}` }] };
        }
        return { content: [{ type: "text", text: `Failed to update plan task` }] };
      }

      case "pull_orchestration_updates": {
        const { orchestrationId: argOrchId } = args as { orchestrationId?: string };
        const orchestrationId = argOrchId ?? process.env.CMUX_ORCHESTRATION_ID;
        const jwt = process.env.CMUX_TASK_RUN_JWT;
        const apiBaseUrl = process.env.CMUX_API_BASE_URL ?? "https://cmux.sh";

        if (!orchestrationId) {
          return {
            content: [{
              type: "text",
              text: "No orchestration ID provided. Pass orchestrationId parameter or set CMUX_ORCHESTRATION_ID env var.",
            }],
          };
        }

        if (!jwt) {
          return {
            content: [{
              type: "text",
              text: "CMUX_TASK_RUN_JWT environment variable not set. This tool requires JWT authentication.",
            }],
          };
        }

        try {
          // Fetch orchestration tasks from server
          const url = `${apiBaseUrl}/api/v1/cmux/orchestration/${orchestrationId}/sync`;
          const response = await fetch(url, {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${jwt}`,
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            return {
              content: [{
                type: "text",
                text: `Failed to fetch orchestration updates: ${response.status} ${errorText}`,
              }],
            };
          }

          const serverData = await response.json() as {
            tasks: OrchestrationTask[];
            messages: MailboxMessage[];
            aggregatedStatus: {
              total: number;
              completed: number;
              running: number;
              failed: number;
              pending: number;
            };
          };

          // Update local PLAN.json with server data
          let plan = readPlan();
          if (!plan) {
            plan = {
              version: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              status: "running",
              headAgent: agentName,
              orchestrationId,
              tasks: [],
            };
          }

          // Merge server tasks into local plan
          for (const serverTask of serverData.tasks) {
            const localTask = plan.tasks.find((t) => t.id === serverTask.id);
            if (localTask) {
              // Update existing task
              localTask.status = serverTask.status;
              localTask.taskRunId = serverTask.taskRunId;
              localTask.result = serverTask.result;
              localTask.errorMessage = serverTask.errorMessage;
              localTask.startedAt = serverTask.startedAt;
              localTask.completedAt = serverTask.completedAt;
            } else {
              // Add new task from server
              plan.tasks.push(serverTask);
            }
          }

          // Update plan status based on aggregated status
          const agg = serverData.aggregatedStatus;
          if (agg.failed > 0) {
            plan.status = "failed";
          } else if (agg.completed === agg.total && agg.total > 0) {
            plan.status = "completed";
          } else if (agg.running > 0) {
            plan.status = "running";
          } else {
            plan.status = "pending";
          }

          writePlan(plan);

          // Update mailbox with new messages
          const mailbox = readMailbox();
          for (const msg of serverData.messages) {
            if (!mailbox.messages.find((m) => m.id === msg.id)) {
              mailbox.messages.push(msg);
            }
          }
          writeMailbox(mailbox);

          // Append sync event
          appendEvent({
            timestamp: new Date().toISOString(),
            event: "orchestration_synced",
            message: `Synced ${serverData.tasks.length} tasks, ${serverData.messages.length} messages`,
            metadata: serverData.aggregatedStatus,
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                synced: true,
                orchestrationId,
                tasks: serverData.tasks.length,
                messages: serverData.messages.length,
                aggregatedStatus: serverData.aggregatedStatus,
              }, null, 2),
            }],
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            content: [{
              type: "text",
              text: `Error syncing orchestration updates: ${errorMsg}`,
            }],
          };
        }
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  });

  return server;
}

export async function runServer(config?: Partial<MemoryMcpConfig>) {
  const server = createMemoryMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
