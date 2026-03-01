"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import {
  DEFAULT_VERCEL_TEMPLATE_ID,
  getVercelTemplateByPresetId,
} from "@cmux/shared/vercel-templates";
import { VercelClient, type VercelInstance } from "@cmux/vercel-client";

/**
 * Get Vercel Sandbox client using env credentials.
 */
function getVercelClient(): VercelClient {
  const token = env.VERCEL_ACCESS_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  const teamId = env.VERCEL_TEAM_ID;

  if (!token) {
    throw new Error("VERCEL_ACCESS_TOKEN not configured");
  }
  if (!projectId) {
    throw new Error("VERCEL_PROJECT_ID not configured");
  }
  if (!teamId) {
    throw new Error("VERCEL_TEAM_ID not configured");
  }

  return new VercelClient({ token, projectId, teamId });
}

/**
 * Extract networking URLs from a Vercel Sandbox instance.
 * Vercel Sandbox exposes ports via sandbox.domain(port) which returns
 * a public URL like https://{subdomain}.vercel.run
 */
function extractNetworkingUrls(instance: VercelInstance) {
  const httpServices = instance.networking.httpServices;

  // Map well-known service ports if exposed
  const findService = (port: number) =>
    httpServices.find((s) => s.port === port)?.url;

  return {
    // Vercel Sandbox doesn't come with VNC/VSCode/Jupyter pre-installed,
    // but we map ports if they're exposed
    workerUrl: findService(39377),
    vscodeUrl: findService(39378),
    vncUrl: findService(39380),
    jupyterUrl: findService(8888),
    // Dev server ports
    devUrl3000: findService(3000),
    devUrl5173: findService(5173),
    devUrl8080: findService(8080),
  };
}

/**
 * Start a new Vercel Sandbox instance.
 */
export const startInstance = internalAction({
  args: {
    templateId: v.optional(v.string()),
    runtime: v.optional(v.string()),
    vcpus: v.optional(v.number()),
    ttlSeconds: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.string())),
    ports: v.optional(v.array(v.number())),
    gitUrl: v.optional(v.string()),
    gitRevision: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const client = getVercelClient();

    // Resolve template preset to get runtime config
    const presetId = args.templateId ?? DEFAULT_VERCEL_TEMPLATE_ID;
    const preset = getVercelTemplateByPresetId(presetId);
    const runtime = args.runtime ?? preset?.runtime ?? "node24";

    // Default ports to expose — common dev server ports
    const ports = args.ports ?? [3000, 5173, 8080, 8888];

    try {
      console.log(
        `[vercel_actions] Starting sandbox (runtime=${runtime}, vcpus=${args.vcpus ?? "default"})`,
      );

      const source = args.gitUrl
        ? {
            type: "git" as const,
            url: args.gitUrl,
            ...(args.gitRevision ? { revision: args.gitRevision } : {}),
          }
        : undefined;

      const instance = await client.instances.start({
        runtime,
        timeout: (args.ttlSeconds ?? 300) * 1000, // Convert to ms
        vcpus: args.vcpus,
        ports,
        source,
        metadata: args.metadata,
      });

      const urls = extractNetworkingUrls(instance);

      return {
        instanceId: instance.id,
        status: "running",
        runtime,
        ...urls,
      };
    } catch (err) {
      console.error("[vercel_actions.startInstance] Error:", err);
      throw err;
    }
  },
});

/**
 * Get Vercel Sandbox instance status.
 */
export const getInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const client = getVercelClient();
      const instance = await client.instances.get({
        instanceId: args.instanceId,
      });
      const rawStatus = instance.getStatus();
      const urls = extractNetworkingUrls(instance);

      // Vercel SDK returns "pending" | "running" | "stopping" | "stopped" | "failed"
      // Map to CloudRouter's "running" | "stopped" model
      const status =
        rawStatus === "running" || rawStatus === "pending"
          ? "running"
          : "stopped";

      return {
        instanceId: args.instanceId,
        status,
        ...urls,
      };
    } catch {
      return {
        instanceId: args.instanceId,
        status: "stopped",
        workerUrl: null,
        vscodeUrl: null,
        vncUrl: null,
        jupyterUrl: null,
      };
    }
  },
});

/**
 * Execute a command in a Vercel Sandbox.
 * Returns result even for non-zero exit codes.
 */
export const execCommand = internalAction({
  args: {
    instanceId: v.string(),
    command: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const client = getVercelClient();
      const instance = await client.instances.get({
        instanceId: args.instanceId,
      });
      const result = await instance.exec(args.command);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
      };
    } catch (err) {
      console.error("[vercel_actions.execCommand] Error:", err);
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  },
});

/**
 * Extend timeout for a Vercel Sandbox.
 */
export const extendTimeout = internalAction({
  args: {
    instanceId: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const client = getVercelClient();
    const instance = await client.instances.get({
      instanceId: args.instanceId,
    });
    const timeoutMs = args.timeoutMs ?? 60 * 60 * 1000;
    await instance.extendTimeout(timeoutMs);

    return { extended: true, timeoutMs };
  },
});

/**
 * Stop a Vercel Sandbox.
 */
export const stopInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getVercelClient();
    await client.instances.stop(args.instanceId);

    return { stopped: true };
  },
});

/**
 * List all Vercel Sandboxes.
 */
export const listInstances = internalAction({
  args: {},
  handler: async () => {
    const client = getVercelClient();
    const sandboxes = await client.instances.list();

    return sandboxes.map((s) => ({
      sandboxId: s.sandboxId,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    }));
  },
});
