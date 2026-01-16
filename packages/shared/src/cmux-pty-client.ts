/**
 * cmux-pty REST API client
 *
 * Shared client for interacting with the cmux-pty server.
 * Use this instead of defining PTY functions in each service.
 */

import type { PtyMetadata } from "./worker-schemas";

// =============================================================================
// Types
// =============================================================================

export interface PtySessionInfo {
  id: string;
  name: string;
  index: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  created_at: number;
  alive: boolean;
  pid: number;
  metadata?: PtyMetadata;
}

export interface CreatePtySessionOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  name?: string;
  metadata?: PtyMetadata;
}

export interface UpdatePtySessionOptions {
  name?: string;
  index?: number;
  metadata?: Record<string, unknown>;
}

export interface ResizePtyOptions {
  cols: number;
  rows: number;
}

// =============================================================================
// Client Class
// =============================================================================

export class CmuxPtyClient {
  constructor(private baseUrl: string = "http://localhost:39383") {}

  /**
   * Check if the PTY server is healthy
   */
  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * List all PTY sessions
   */
  async listSessions(): Promise<PtySessionInfo[]> {
    const response = await fetch(`${this.baseUrl}/sessions`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list PTY sessions: ${error}`);
    }

    const result = await response.json();
    return result.sessions;
  }

  /**
   * Get a specific PTY session by ID
   */
  async getSession(sessionId: string): Promise<PtySessionInfo | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.id === sessionId) ?? null;
  }

  /**
   * Create a new PTY session
   */
  async createSession(
    options: CreatePtySessionOptions = {},
  ): Promise<PtySessionInfo> {
    const response = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shell: options.shell ?? "/bin/zsh",
        cwd: options.cwd ?? "/root/workspace",
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        env: options.env,
        name: options.name,
        metadata: options.metadata,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create PTY session: ${error}`);
    }

    return response.json();
  }

  /**
   * Update a PTY session (name, index, metadata)
   */
  async updateSession(
    sessionId: string,
    options: UpdatePtySessionOptions,
  ): Promise<PtySessionInfo> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update PTY session: ${error}`);
    }

    return response.json();
  }

  /**
   * Delete a PTY session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete PTY session: ${error}`);
    }
  }

  /**
   * Resize a PTY session
   */
  async resizeSession(
    sessionId: string,
    options: ResizePtyOptions,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/sessions/${sessionId}/resize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to resize PTY session: ${error}`);
    }
  }

  /**
   * Send input to a PTY session (REST endpoint, not WebSocket)
   */
  async sendInput(sessionId: string, data: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/sessions/${sessionId}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send input to PTY session: ${error}`);
    }
  }

  /**
   * Capture terminal screen content
   */
  async captureScreen(sessionId: string): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/sessions/${sessionId}/capture`,
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to capture PTY screen: ${error}`);
    }

    const result = await response.json();
    return result.content;
  }

  /**
   * Check if a session is alive
   */
  async isSessionAlive(sessionId: string): Promise<boolean> {
    try {
      const session = await this.getSession(sessionId);
      return session?.alive ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Find a session by name
   */
  async findSessionByName(name: string): Promise<PtySessionInfo | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.name === name) ?? null;
  }

  /**
   * Get WebSocket URL for a session (for interactive terminal use)
   */
  getSessionWsUrl(sessionId: string): string {
    const wsUrl = this.baseUrl.replace(/^http/, "ws");
    return `${wsUrl}/sessions/${sessionId}/ws`;
  }

  /**
   * Get WebSocket URL for event stream
   */
  getEventsWsUrl(): string {
    const wsUrl = this.baseUrl.replace(/^http/, "ws");
    return `${wsUrl}/ws`;
  }
}

// =============================================================================
// Default instance for convenience
// =============================================================================

/** Default PTY server URL */
export const DEFAULT_PTY_SERVER_URL = "http://localhost:39383";

/**
 * Create a new CmuxPtyClient instance
 */
export function createPtyClient(
  baseUrl: string = DEFAULT_PTY_SERVER_URL,
): CmuxPtyClient {
  return new CmuxPtyClient(baseUrl);
}
