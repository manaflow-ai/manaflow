"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { env } from "../_shared/convex-env";
import { DEFAULT_E2B_TEMPLATE_ID } from "@cmux/shared/e2b-templates";
import { E2BClient, type E2BInstance } from "@cmux/e2b-client";

/**
 * Get E2B client with API key from env
 */
function getE2BClient(): E2BClient {
  const apiKey = env.E2B_API_KEY;
  if (!apiKey) {
    throw new Error("E2B_API_KEY not configured");
  }
  return new E2BClient({ apiKey });
}

/**
 * Extract networking URLs from E2B instance.
 */
function extractNetworkingUrls(instance: E2BInstance) {
  const httpServices = instance.networking.httpServices;
  const jupyterService = httpServices.find((s) => s.port === 8888);
  const vscodeService = httpServices.find((s) => s.port === 39378);
  const workerService = httpServices.find((s) => s.port === 39377);
  const vncService = httpServices.find((s) => s.port === 39380);

  return {
    jupyterUrl: jupyterService?.url,
    vscodeUrl: vscodeService?.url,
    workerUrl: workerService?.url,
    vncUrl: vncService?.url,
  };
}

/**
 * Start a new E2B sandbox instance.
 */
export const startInstance = internalAction({
  args: {
    templateId: v.optional(v.string()),
    ttlSeconds: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.string())),
    envs: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (_ctx, args) => {
    const client = getE2BClient();

    const instance = await client.instances.start({
      templateId: args.templateId ?? DEFAULT_E2B_TEMPLATE_ID,
      ttlSeconds: args.ttlSeconds ?? 60 * 60,
      metadata: args.metadata,
      envs: args.envs,
    });

    const { jupyterUrl, vscodeUrl, workerUrl, vncUrl } = extractNetworkingUrls(instance);

    return {
      instanceId: instance.id,
      status: "running",
      jupyterUrl,
      vscodeUrl,
      workerUrl,
      vncUrl,
    };
  },
});

/**
 * Get E2B instance status.
 */
export const getInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const client = getE2BClient();
      const instance = await client.instances.get({ instanceId: args.instanceId });
      const isRunning = await instance.isRunning();
      const { jupyterUrl, vscodeUrl, workerUrl, vncUrl } = extractNetworkingUrls(instance);

      return {
        instanceId: args.instanceId,
        status: isRunning ? "running" : "stopped",
        jupyterUrl,
        vscodeUrl,
        workerUrl,
        vncUrl,
      };
    } catch {
      return {
        instanceId: args.instanceId,
        status: "stopped",
        jupyterUrl: null,
        vscodeUrl: null,
        workerUrl: null,
        vncUrl: null,
      };
    }
  },
});

/**
 * Execute a command in an E2B sandbox.
 * Returns result even for non-zero exit codes.
 */
export const execCommand = internalAction({
  args: {
    instanceId: v.string(),
    command: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      const client = getE2BClient();
      const instance = await client.instances.get({ instanceId: args.instanceId });
      const result = await instance.exec(args.command);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exit_code,
      };
    } catch (err) {
      console.error("[e2b_actions.execCommand] Error:", err);
      // Return error as stderr instead of throwing
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exit_code: 1,
      };
    }
  },
});

/**
 * Extend timeout for an E2B sandbox.
 */
export const extendTimeout = internalAction({
  args: {
    instanceId: v.string(),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const client = getE2BClient();
    const instance = await client.instances.get({ instanceId: args.instanceId });
    const timeoutMs = args.timeoutMs ?? 60 * 60 * 1000;
    await instance.setTimeout(timeoutMs);

    return { extended: true, timeoutMs };
  },
});

/**
 * Stop (kill) an E2B sandbox.
 */
export const stopInstance = internalAction({
  args: {
    instanceId: v.string(),
  },
  handler: async (_ctx, args) => {
    const client = getE2BClient();
    await client.instances.kill(args.instanceId);

    return { stopped: true };
  },
});

/**
 * List all running E2B sandboxes.
 */
export const listInstances = internalAction({
  args: {},
  handler: async () => {
    const client = getE2BClient();
    const sandboxes = await client.instances.list();

    return sandboxes.map((s) => ({
      sandboxId: s.sandboxId,
      templateId: s.templateId,
      startedAt: s.startedAt.toISOString(),
    }));
  },
});
