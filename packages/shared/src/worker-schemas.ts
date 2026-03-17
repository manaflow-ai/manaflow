import type { Id } from "@cmux/convex/dataModel";
import { z } from "zod";
import { typedZid } from "./utils/typed-zid";

// Auth file schema for file uploads and environment setup
export const AuthFileSchema = z.object({
  destinationPath: z.string(),
  contentBase64: z.string(), // base64 encoded
  mode: z.string().optional(),
});

// Post-start command schema for commands that run after TUI starts
export const PostStartCommandSchema = z.object({
  description: z.string(),
  command: z.string(),
  timeoutMs: z.number().optional(),
  continueOnError: z.boolean().optional(),
});

// PTY session metadata for cmux-pty terminals
// Used to control terminal location and type in VSCode extension
export const PtyMetadataSchema = z.object({
  // Where the terminal should open: 'editor' (editor pane) or 'panel' (normal terminal panel)
  location: z.enum(["editor", "panel"]).optional(),
  // Type of terminal for identification
  type: z.enum(["agent", "dev", "maintenance", "shell"]).optional(),
  // Whether this terminal is managed by cmux (for cleanup on close)
  managed: z.boolean().optional(),
});

// Worker Registration
export const WorkerRegisterSchema = z.object({
  workerId: z.string(),
  capabilities: z.object({
    maxConcurrentTerminals: z.number().int().positive(),
    supportedLanguages: z.array(z.string()).optional(),
    gpuAvailable: z.boolean().optional(),
    memoryMB: z.number().int().positive(),
    cpuCores: z.number().int().positive(),
  }),
  containerInfo: z
    .object({
      image: z.string(),
      version: z.string(),
      platform: z.string(),
    })
    .optional(),
});

export const WorkerHeartbeatSchema = z.object({
  workerId: z.string(),
  timestamp: z.number(),
  stats: z.object({
    cpuUsage: z.number().min(0).max(100),
    memoryUsage: z.number().min(0).max(100),
  }),
});

// Terminal Routing
export const TerminalAssignmentSchema = z.object({
  terminalId: z.string(),
  workerId: z.string(),
  taskId: typedZid("tasks").optional(),
});

// Worker Status
export const WorkerStatusSchema = z.object({
  workerId: z.string(),
  status: z.enum(["online", "offline", "busy", "error"]),
  lastSeen: z.number(),
});

export const WorkerTaskRunContextSchema = z.object({
  taskRunToken: z.string(),
  prompt: z.string(),
  convexUrl: z.string(),
  isPreviewJob: z.boolean().optional(),
});

// Terminal operation schemas for server<>worker communication
export const WorkerCreateTerminalSchema = z.object({
  terminalId: z.string(),
  cols: z.number().int().positive().default(80),
  rows: z.number().int().positive().default(24),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  taskRunContext: WorkerTaskRunContextSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  taskId: typedZid("tasks").optional(),
  taskRunId: typedZid("taskRuns").optional(),
  // Validation happens on the server where configs can be updated without
  // rebuilding the worker image.
  agentModel: z.string().optional(),
  authFiles: z.array(AuthFileSchema).optional(),
  startupCommands: z.array(z.string()).optional(),
  // Commands to run AFTER the TUI/agent process has started
  postStartCommands: z.array(PostStartCommandSchema).optional(),
  // Terminal backend: "tmux" (default) or "cmux-pty" (cmux-pty server)
  backend: z.enum(["tmux", "cmux-pty"]).optional().default("tmux"),
  // cmux-pty specific: command to run in the PTY (used when backend is "cmux-pty")
  ptyCommand: z.string().optional(),
  ptyArgs: z.array(z.string()).optional(),
});

export const WorkerTerminalInputSchema = z.object({
  terminalId: z.string(),
  data: z.string(),
});

export const WorkerResizeTerminalSchema = z.object({
  terminalId: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const WorkerCloseTerminalSchema = z.object({
  terminalId: z.string(),
});

// Worker terminal event schemas
export const WorkerTerminalOutputSchema = z.object({
  workerId: z.string(),
  terminalId: z.string(),
  data: z.string(),
});

export const WorkerTerminalExitSchema = z.object({
  workerId: z.string(),
  terminalId: z.string(),
  exitCode: z.number().int(),
  signal: z.number().int().optional(),
});

export const WorkerTerminalCreatedSchema = z.object({
  workerId: z.string(),
  terminalId: z.string(),
});

export const WorkerTerminalClosedSchema = z.object({
  workerId: z.string(),
  terminalId: z.string(),
});

export const WorkerTerminalIdleSchema = z.object({
  workerId: z.string(),
  terminalId: z.string(),
  taskRunId: typedZid("taskRuns").optional(),
  elapsedMs: z.number(),
});

// Task completion detected from project files (e.g., Claude Code)
export const WorkerTaskCompleteSchema = z.object({
  workerId: z.string(),
  taskRunId: typedZid("taskRuns"),
  agentModel: z.string().optional(),
  elapsedMs: z.number(),
});

// Terminal failure event (e.g., tmux spawn/agent command failed)
export const WorkerTerminalFailedSchema = z.object({
  workerId: z.string(),
  terminalId: z.string(),
  taskRunId: typedZid("taskRuns").optional(),
  errorMessage: z.string(),
  elapsedMs: z.number().optional(),
});

// File upload schema for authentication files
export const WorkerUploadFileSchema = z
  .object({
    sourcePath: z.string().optional(), // Path on host (for logging/debugging)
    destinationPath: z.string(), // Path in container (relative to workspace root)
    action: z.enum(["write", "delete"]).optional(),
    contentBase64: z.string().optional(), // Base64 encoded file content
    mode: z.string().optional(), // File permissions (e.g., "644")
  })
  .superRefine((value, ctx) => {
    const action = value.action ?? "write";
    if (action === "write" && !value.contentBase64) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "contentBase64 is required for write actions",
      });
    }
  });

export const WorkerUploadFilesSchema = z.object({
  files: z.array(WorkerUploadFileSchema),
  terminalId: z.string().optional(), // Optional terminal context
});

// Git configuration schema
export const WorkerConfigureGitSchema = z.object({
  githubToken: z.string().optional(),
  gitConfig: z.record(z.string(), z.string()).optional(), // Key-value pairs for git config
  sshKeys: z
    .object({
      privateKey: z.string().optional(), // Base64 encoded
      publicKey: z.string().optional(), // Base64 encoded
      knownHosts: z.string().optional(), // Base64 encoded
    })
    .optional(),
});

// Execute command schema for one-off commands
export const WorkerExecSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(), // Timeout in milliseconds
});

// Execute command result schema
export const WorkerExecResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  signal: z.string().optional(),
});

export const WorkerStartScreenshotCollectionSchema = z.object({
  anthropicApiKey: z.string().min(1).optional(),
  outputPath: z.string().optional(),
  /** Command to install dependencies (e.g., "bun install") */
  installCommand: z.string().optional(),
  /** Command to start the dev server (e.g., "bun run dev") */
  devCommand: z.string().optional(),
});

export const WorkerRunTaskScreenshotsSchema = z.object({
  token: z.string(),
  anthropicApiKey: z.string().optional(),
  convexUrl: z.string().min(1).optional(),
  /** Command to install dependencies (e.g., "bun install") */
  installCommand: z.string().optional(),
  /** Command to start the dev server (e.g., "bun run dev") */
  devCommand: z.string().optional(),
});

// Server to Worker Events
export const ServerToWorkerCommandSchema = z.object({
  command: z.enum(["create-terminal", "destroy-terminal", "execute-command"]),
  payload: z.any(),
});

// Type exports
export type AuthFile = z.infer<typeof AuthFileSchema>;
export type PostStartCommand = z.infer<typeof PostStartCommandSchema>;
export type PtyMetadata = z.infer<typeof PtyMetadataSchema>;
export type WorkerRegister = z.infer<typeof WorkerRegisterSchema>;
export type WorkerHeartbeat = z.infer<typeof WorkerHeartbeatSchema>;
export type TerminalAssignment = z.infer<typeof TerminalAssignmentSchema>;
export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;
export type WorkerTaskRunContext = z.infer<typeof WorkerTaskRunContextSchema>;
export type ServerToWorkerCommand = z.infer<typeof ServerToWorkerCommandSchema>;
export type WorkerCreateTerminal = z.infer<typeof WorkerCreateTerminalSchema>;
export type WorkerTerminalInput = z.infer<typeof WorkerTerminalInputSchema>;
export type WorkerResizeTerminal = z.infer<typeof WorkerResizeTerminalSchema>;
export type WorkerCloseTerminal = z.infer<typeof WorkerCloseTerminalSchema>;
export type WorkerTerminalOutput = z.infer<typeof WorkerTerminalOutputSchema>;
export type WorkerTerminalExit = z.infer<typeof WorkerTerminalExitSchema>;
export type WorkerTerminalCreated = z.infer<typeof WorkerTerminalCreatedSchema>;
export type WorkerTerminalClosed = z.infer<typeof WorkerTerminalClosedSchema>;
export type WorkerTerminalIdle = z.infer<typeof WorkerTerminalIdleSchema>;
export type WorkerTaskComplete = z.infer<typeof WorkerTaskCompleteSchema>;
export type WorkerTerminalFailed = z.infer<typeof WorkerTerminalFailedSchema>;
export type WorkerConfigureGit = z.infer<typeof WorkerConfigureGitSchema>;
export type WorkerExec = z.infer<typeof WorkerExecSchema>;
export type WorkerExecResult = z.infer<typeof WorkerExecResultSchema>;
export type WorkerUploadFile = z.infer<typeof WorkerUploadFileSchema>;
export type WorkerUploadFiles = z.infer<typeof WorkerUploadFilesSchema>;
export type WorkerStartScreenshotCollection = z.infer<
  typeof WorkerStartScreenshotCollectionSchema
>;
export type WorkerRunTaskScreenshots = z.infer<
  typeof WorkerRunTaskScreenshotsSchema
>;

// Socket.io event maps for Server <-> Worker communication
// Docker readiness response type

type ErrorOr<T> = { error: Error; data: null } | { error: null; data: T };
export interface DockerReadinessResponse {
  ready: boolean;
  message?: string;
}

export interface ServerToWorkerEvents {
  // Terminal operations from server to worker
  "worker:create-terminal": (
    data: WorkerCreateTerminal,
    callback: (result: ErrorOr<WorkerTerminalCreated>) => void
  ) => void;

  // Terminal input
  "worker:terminal-input": (data: WorkerTerminalInput) => void;

  // File operations
  "worker:upload-files": (
    data: WorkerUploadFiles,
    callback: (result: ErrorOr<{ success: true }>) => void
  ) => void;

  // Git configuration
  "worker:configure-git": (data: WorkerConfigureGit) => void;

  // Execute one-off commands
  "worker:exec": (
    data: WorkerExec,
    callback: (result: ErrorOr<WorkerExecResult>) => void
  ) => void;

  // File watching events
  "worker:start-file-watch": (data: {
    taskRunId: Id<"taskRuns">;
    worktreePath: string;
  }) => void;
  "worker:stop-file-watch": (data: { taskRunId: Id<"taskRuns"> }) => void;

  // Cloud-to-local sync: start/stop syncing cloud changes back to local
  "worker:start-cloud-sync": (data: {
    taskRunId: Id<"taskRuns">;
    workspacePath: string;
  }) => void;
  "worker:stop-cloud-sync": (data: { taskRunId: Id<"taskRuns"> }) => void;
  // Request a full sync of all existing files from cloud to local
  "worker:request-full-cloud-sync": (
    data: { taskRunId: Id<"taskRuns"> },
    callback: (result: { filesSent: number }) => void
  ) => void;
  "worker:start-screenshot-collection": (
    data: WorkerStartScreenshotCollection | undefined
  ) => void;
  "worker:run-task-screenshots": (
    data: WorkerRunTaskScreenshots,
    callback: (result: ErrorOr<{ success: true }>) => void
  ) => void;

  // Management events
  "worker:terminal-assignment": (data: TerminalAssignment) => void;
  "worker:command": (data: ServerToWorkerCommand) => void;
  "worker:shutdown": () => void;

  // Health check events with acknowledgment
  "worker:check-docker": (
    callback: (response: DockerReadinessResponse) => void
  ) => void;
}

export interface WorkerFileChange {
  type: "added" | "modified" | "deleted";
  path: string;
  timestamp: number;
}

// Cloud-to-local sync schemas
export const WorkerSyncFileSchema = z.object({
  relativePath: z.string(), // Path relative to workspace root
  action: z.enum(["write", "delete"]),
  contentBase64: z.string().optional(), // Base64 encoded content (required for write)
  mode: z.string().optional(), // File permissions (e.g., "644")
});

export const WorkerSyncFilesSchema = z.object({
  taskRunId: typedZid("taskRuns"),
  files: z.array(WorkerSyncFileSchema),
  timestamp: z.number(),
});

export type WorkerSyncFile = z.infer<typeof WorkerSyncFileSchema>;
export type WorkerSyncFiles = z.infer<typeof WorkerSyncFilesSchema>;

export interface WorkerFileDiff {
  path: string;
  type: "added" | "modified" | "deleted";
  oldContent: string;
  newContent: string;
  patch: string;
}

export interface WorkerToServerEvents {
  // Registration and health
  "worker:register": (data: WorkerRegister) => void;
  "worker:heartbeat": (data: WorkerHeartbeat) => void;

  // Terminal events from worker to server
  "worker:terminal-created": (data: WorkerTerminalCreated) => void;
  "worker:terminal-output": (data: WorkerTerminalOutput) => void;
  "worker:terminal-exit": (data: WorkerTerminalExit) => void;
  "worker:terminal-closed": (data: WorkerTerminalClosed) => void;
  "worker:terminal-idle": (data: WorkerTerminalIdle) => void;
  "worker:task-complete": (data: WorkerTaskComplete) => void;
  "worker:terminal-failed": (data: WorkerTerminalFailed) => void;

  // File change events
  "worker:file-changes": (data: {
    workerId: string;
    taskRunId: Id<"taskRuns">;
    changes: WorkerFileChange[];
    gitDiff: string;
    fileDiffs: WorkerFileDiff[];
    timestamp: number;
  }) => void;

  // Cloud-to-local sync: worker sends file changes to be written locally
  "worker:sync-files": (data: WorkerSyncFiles) => void;

  // Error reporting
  "worker:error": (data: { workerId: string; error: string }) => void;
}
export type WorkerToServerEventNames = keyof WorkerToServerEvents;

// For worker's internal socket server (client connections)
export interface WorkerSocketData {
  workerId: string;
  assignedTerminals: Set<string>;
}
