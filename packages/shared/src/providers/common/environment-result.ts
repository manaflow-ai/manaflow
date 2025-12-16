import type { AuthFile } from "../../worker-schemas";

export interface EnvironmentResult {
  files: AuthFile[];
  env: Record<string, string>;
  startupCommands?: string[];
  unsetEnv?: string[];
}

export type EnvironmentContext = {
  taskRunId: string;
  prompt: string;
  taskRunJwt: string;
  apiKeys?: Record<string, string>;
};
