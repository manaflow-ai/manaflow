import type { AuthFile } from "../../worker-schemas";

export interface EnvironmentResult {
  files: AuthFile[];
  env: Record<string, string>;
  startupCommands?: string[];
  /**
   * Commands to run AFTER the TUI/agent process has started.
   * These run in the worker and can interact with the running agent
   * (e.g., polling HTTP endpoints, submitting prompts).
   */
  postStartCommands?: PostStartCommand[];
  unsetEnv?: string[];
}

export interface PostStartCommand {
  /** Human-readable description of what this command does */
  description: string;
  /** The command to run (will be executed via bash -lc) */
  command: string;
  /** Optional timeout in milliseconds (default: 60000) */
  timeoutMs?: number;
  /** If true, continue with next commands even if this one fails */
  continueOnError?: boolean;
}

export type EnvironmentContext = {
  taskRunId: string;
  prompt: string;
  taskRunJwt: string;
  apiKeys?: Record<string, string>;
};
