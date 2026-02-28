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
  callbackUrl: string;
  workspaceSettings?: {
    bypassAnthropicProxy?: boolean;
  };
  /**
   * Provider configuration from team overrides (via ProviderRegistry).
   * When present with isOverridden=true, agents should use the custom
   * baseUrl/headers instead of default or proxy routing.
   */
  providerConfig?: {
    baseUrl?: string;
    customHeaders?: Record<string, string>;
    apiFormat?: string;
    isOverridden: boolean;
  };
  /** Previous knowledge content from earlier runs (for cross-run memory seeding) */
  previousKnowledge?: string;
  /** Previous mailbox content with unread messages (for cross-run mailbox seeding) */
  previousMailbox?: string;
  /** Orchestration seed options for multi-agent coordination (hybrid execution) */
  orchestrationOptions?: {
    headAgent: string;
    orchestrationId?: string;
    description?: string;
    previousPlan?: string;    // Raw JSON of PLAN.json
    previousAgents?: string;  // Raw JSON of AGENTS.json
  };
  /**
   * When true, read config files from the host filesystem (e.g., ~/.codex/config.toml).
   * This is safe for desktop/Electron apps where the host IS the user's machine.
   * Should be false for server deployments to prevent credential leakage.
   * @default false
   */
  useHostConfig?: boolean;
};
