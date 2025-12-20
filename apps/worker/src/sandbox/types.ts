/**
 * Sandbox types matching the sandboxd API model
 */

export interface SandboxNetwork {
  hostInterface: string;
  sandboxInterface: string;
  hostIp: string;
  sandboxIp: string;
  cidr: number;
}

export type SandboxStatus = "creating" | "running" | "exited" | "failed" | "unknown";

export interface SandboxSummary {
  id: string;
  index: number;
  name: string;
  createdAt: string;
  workspace: string;
  status: SandboxStatus;
  network: SandboxNetwork;
  pid?: number;
  correlationId?: string;
}

export interface CreateSandboxRequest {
  name?: string;
  workspace?: string;
  tabId?: string;
  env?: Array<{ key: string; value: string }>;
  command?: string[];
}

export interface ExecRequest {
  command: string[];
  workdir?: string;
  env?: Array<{ key: string; value: string }>;
}

export interface ExecResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}
