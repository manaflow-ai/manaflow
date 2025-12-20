import { z } from "zod";

export type SandboxEnvVar = {
  key: string;
  value: string;
};

export type CreateSandboxRequest = {
  name?: string;
  workspace?: string;
  tabId?: string;
  readOnlyPaths?: string[];
  tmpfs?: string[];
  env?: SandboxEnvVar[];
};

export type ExecRequest = {
  command: string[];
  workdir?: string;
  env?: SandboxEnvVar[];
};

const SandboxStatusSchema = z.enum([
  "Creating",
  "Running",
  "Exited",
  "Failed",
  "Unknown",
]);

const SandboxNetworkSchema = z.object({
  host_interface: z.string(),
  sandbox_interface: z.string(),
  host_ip: z.string(),
  sandbox_ip: z.string(),
  cidr: z.number().int(),
});

const SandboxSummarySchema = z.object({
  id: z.string().uuid(),
  index: z.number().int(),
  name: z.string(),
  created_at: z.string(),
  workspace: z.string(),
  status: SandboxStatusSchema,
  network: SandboxNetworkSchema,
  correlation_id: z.string().optional().nullable(),
});

const ExecResponseSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

const HealthResponseSchema = z.object({
  status: z.string(),
});

export type SandboxSummary = z.infer<typeof SandboxSummarySchema>;
export type ExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export class LocalSandboxClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async health(): Promise<boolean> {
    const response = await fetch(this.buildUrl("/healthz"));
    if (!response.ok) {
      return false;
    }
    const data = await response.json();
    const parsed = HealthResponseSchema.safeParse(data);
    return parsed.success && parsed.data.status === "ok";
  }

  async waitForHealthy(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: string | null = null;
    while (Date.now() < deadline) {
      try {
        const ok = await this.health();
        if (ok) {
          return;
        }
      } catch (error) {
        console.error("[LocalSandboxClient] Health check failed", error);
        lastError =
          error instanceof Error ? error.message : "Unknown health error";
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      lastError
        ? `Sandbox host health check failed: ${lastError}`
        : "Sandbox host health check timed out"
    );
  }

  async createSandbox(
    request: CreateSandboxRequest
  ): Promise<SandboxSummary> {
    const payload = {
      name: request.name,
      workspace: request.workspace,
      tab_id: request.tabId,
      read_only_paths: request.readOnlyPaths ?? [],
      tmpfs: request.tmpfs ?? [],
      env: request.env ?? [],
    };

    return this.requestJson(
      "/sandboxes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      SandboxSummarySchema,
      [201]
    );
  }

  async getSandbox(id: string): Promise<SandboxSummary | null> {
    const response = await fetch(this.buildUrl(`/sandboxes/${id}`));
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Sandbox host request failed (${response.status}): ${text}`
      );
    }
    const data = await response.json();
    return SandboxSummarySchema.parse(data);
  }

  async execSandbox(id: string, request: ExecRequest): Promise<ExecResponse> {
    const payload = {
      command: request.command,
      workdir: request.workdir,
      env: request.env ?? [],
    };

    const response = await this.requestJson(
      `/sandboxes/${id}/exec`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      ExecResponseSchema
    );

    return {
      exitCode: response.exit_code,
      stdout: response.stdout,
      stderr: response.stderr,
    };
  }

  async deleteSandbox(id: string): Promise<SandboxSummary | null> {
    const response = await fetch(this.buildUrl(`/sandboxes/${id}`), {
      method: "DELETE",
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Sandbox host request failed (${response.status}): ${text}`
      );
    }
    const data = await response.json();
    return SandboxSummarySchema.parse(data);
  }

  private buildUrl(pathname: string): string {
    return new URL(pathname, this.baseUrl).toString();
  }

  private async requestJson<T>(
    pathname: string,
    init: RequestInit,
    schema: z.ZodSchema<T>,
    okStatuses: number[] = [200]
  ): Promise<T> {
    const response = await fetch(this.buildUrl(pathname), init);
    if (!okStatuses.includes(response.status)) {
      const text = await response.text();
      throw new Error(
        `Sandbox host request failed (${response.status}): ${text}`
      );
    }
    const data = await response.json();
    return schema.parse(data);
  }
}
