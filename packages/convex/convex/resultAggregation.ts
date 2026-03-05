"use node";

/**
 * Result Aggregation for Multi-Agent Orchestration
 *
 * When a child task run completes, this module notifies the parent agent's
 * sandbox by writing a completion message to its MAILBOX.json.
 *
 * Supports both Morph and PVE-LXC sandbox providers.
 */

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { MEMORY_PROTOCOL_DIR } from "@cmux/shared/agent-memory-protocol";
import { PveLxcClient } from "@cmux/pve-lxc-client";
import {
  PVE_LXC_SNAPSHOT_PRESETS,
} from "@cmux/shared/pve-lxc-snapshots";

// Morph API base URL
const MORPH_API_BASE_URL = "https://api.morph.so/v0";

/**
 * Get PVE LXC client with config from env.
 */
function getPveLxcClient(): PveLxcClient {
  const apiUrl = process.env.PVE_API_URL;
  const apiToken = process.env.PVE_API_TOKEN;
  if (!apiUrl || !apiToken) {
    throw new Error("PVE_API_URL and PVE_API_TOKEN not configured");
  }
  return new PveLxcClient({
    apiUrl,
    apiToken,
    node: process.env.PVE_NODE,
    publicDomain: process.env.PVE_PUBLIC_DOMAIN,
    verifyTls: ["true", "1"].includes(process.env.PVE_VERIFY_TLS ?? ""),
    snapshotResolver: resolveSnapshot,
  });
}

/**
 * Resolve a snapshot ID to a template VMID.
 */
function resolveSnapshot(snapshotId: string): { templateVmid: number } {
  if (/^snapshot_[a-z0-9]+$/i.test(snapshotId)) {
    const preset = PVE_LXC_SNAPSHOT_PRESETS.find((p) =>
      p.versions.some((ver) => ver.snapshotId === snapshotId),
    );
    const versionData = preset?.versions.find((ver) => ver.snapshotId === snapshotId);
    if (!versionData) {
      throw new Error(`PVE LXC snapshot not found: ${snapshotId}`);
    }
    return { templateVmid: versionData.templateVmid };
  }
  throw new Error(
    `Invalid PVE snapshot ID: ${snapshotId}. Expected format: snapshot_*`,
  );
}

/**
 * Make an authenticated request to the Morph API.
 */
async function morphFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = process.env.MORPH_API_KEY;
  if (!apiKey) {
    throw new Error("MORPH_API_KEY not configured");
  }

  const url = `${MORPH_API_BASE_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });
}

/**
 * Generate a unique message ID.
 */
function generateMessageId(): string {
  return "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/**
 * Build a completion message for the parent agent's mailbox.
 */
function buildCompletionMessage(
  childRun: {
    _id: string;
    agentName?: string;
    status: string;
    summary?: string;
    pullRequestUrl?: string;
    exitCode?: number;
  },
  statusCounts: Record<string, number>,
  totalChildren: number,
): {
  id: string;
  from: string;
  to: string;
  type: "status";
  message: string;
  timestamp: string;
  read: boolean;
} {
  const childAgent = childRun.agentName ?? "unknown-agent";
  const isSuccess = childRun.status === "completed" && (childRun.exitCode === 0 || childRun.exitCode === undefined);

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Child agent "${childAgent}" ${isSuccess ? "completed successfully" : "failed"}.`);

  if (childRun.pullRequestUrl) {
    summaryParts.push(`PR: ${childRun.pullRequestUrl}`);
  }

  if (childRun.summary) {
    // Include first 200 chars of summary
    const truncatedSummary = childRun.summary.length > 200
      ? childRun.summary.slice(0, 200) + "..."
      : childRun.summary;
    summaryParts.push(`Summary: ${truncatedSummary}`);
  }

  // Add aggregate status
  const completed = statusCounts.completed ?? 0;
  const failed = statusCounts.failed ?? 0;
  const pending = statusCounts.pending ?? 0;
  const running = statusCounts.running ?? 0;
  summaryParts.push(`\nTeam progress: ${completed}/${totalChildren} completed, ${failed} failed, ${running} running, ${pending} pending.`);

  return {
    id: generateMessageId(),
    from: childAgent,
    to: "*", // Broadcast to parent (and any other agents)
    type: "status",
    message: summaryParts.join("\n"),
    timestamp: new Date().toISOString(),
    read: false,
  };
}

/**
 * Execute a command in a Morph sandbox.
 */
async function morphExec(
  instanceId: string,
  command: string[],
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  const response = await morphFetch(`/instance/${instanceId}/exec`, {
    method: "POST",
    body: JSON.stringify({ command, timeout: 30 }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`Morph exec failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exit_code: result.exit_code ?? 0,
  };
}

/**
 * Execute a command in a PVE LXC container.
 */
async function pveLxcExec(
  instanceId: string,
  command: string,
): Promise<{ stdout: string; stderr: string; exit_code: number }> {
  const client = getPveLxcClient();
  const instance = await client.instances.get({ instanceId });
  return instance.exec(command);
}

/**
 * Write a message to a sandbox's MAILBOX.json file.
 */
async function writeMailboxMessage(
  provider: "morph" | "pve-lxc" | "docker" | string,
  instanceId: string,
  message: ReturnType<typeof buildCompletionMessage>,
): Promise<void> {
  const mailboxPath = `${MEMORY_PROTOCOL_DIR}/MAILBOX.json`;

  // Shell command to append message to MAILBOX.json
  // This uses jq to safely append to the messages array
  const messageJson = JSON.stringify(message).replace(/'/g, "'\\''"); // Escape single quotes for shell
  const appendCommand = `
    if [ -f "${mailboxPath}" ]; then
      # File exists - append to messages array
      tmp=$(mktemp)
      jq --argjson msg '${messageJson}' '.messages += [$msg]' "${mailboxPath}" > "$tmp" && mv "$tmp" "${mailboxPath}"
    else
      # File doesn't exist - create with initial message
      echo '{"version":1,"messages":[${messageJson}]}' > "${mailboxPath}"
    fi
  `.trim();

  if (provider === "morph") {
    // Morph uses array of command parts
    await morphExec(instanceId, ["bash", "-c", appendCommand]);
  } else if (provider === "pve-lxc") {
    await pveLxcExec(instanceId, appendCommand);
  } else if (provider === "docker") {
    // Docker containers are local - not supported for cross-run messaging
    console.warn("[resultAggregation] Docker provider not supported for cross-sandbox messaging");
    return;
  } else {
    console.warn(`[resultAggregation] Unknown provider "${provider}", skipping mailbox notification`);
    return;
  }
}

/**
 * Notify the parent agent that a child task run has completed.
 *
 * This action is called after a child task run completes to:
 * 1. Build a completion message with the child's status and results
 * 2. Write the message to the parent sandbox's MAILBOX.json
 *
 * The parent agent (running in its sandbox) can then read this message
 * via the MCP tools to react to child completion.
 */
export const notifyParentOnChildComplete = internalAction({
  args: {
    parentRunId: v.id("taskRuns"),
    childRunId: v.id("taskRuns"),
    childAgentName: v.optional(v.string()),
    childStatus: v.string(),
    childSummary: v.optional(v.string()),
    childPullRequestUrl: v.optional(v.string()),
    childExitCode: v.optional(v.number()),
    // Aggregate status of all children
    statusCounts: v.object({
      pending: v.number(),
      running: v.number(),
      completed: v.number(),
      failed: v.number(),
      skipped: v.number(),
    }),
    totalChildren: v.number(),
    // Parent sandbox info
    parentProvider: v.optional(v.string()),
    parentContainerName: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    // Validate we have sandbox info for the parent
    if (!args.parentProvider || !args.parentContainerName) {
      console.log(
        `[resultAggregation] Parent run ${args.parentRunId} has no sandbox info, skipping notification`
      );
      return { notified: false, reason: "no_sandbox_info" };
    }

    // Check if parent sandbox is still running (basic validation)
    const supportedProviders = ["morph", "pve-lxc"];
    if (!supportedProviders.includes(args.parentProvider)) {
      console.log(
        `[resultAggregation] Provider "${args.parentProvider}" not supported for result aggregation`
      );
      return { notified: false, reason: "unsupported_provider" };
    }

    try {
      // Build the completion message
      const message = buildCompletionMessage(
        {
          _id: args.childRunId,
          agentName: args.childAgentName,
          status: args.childStatus,
          summary: args.childSummary,
          pullRequestUrl: args.childPullRequestUrl,
          exitCode: args.childExitCode,
        },
        args.statusCounts,
        args.totalChildren,
      );

      // Write to parent's mailbox
      await writeMailboxMessage(
        args.parentProvider,
        args.parentContainerName,
        message,
      );

      console.log(
        `[resultAggregation] Notified parent run ${args.parentRunId} about child ${args.childRunId} completion`
      );

      return { notified: true };
    } catch (error) {
      console.error(
        `[resultAggregation] Failed to notify parent ${args.parentRunId}:`,
        error
      );
      // Don't throw - notification failure shouldn't block task completion
      return {
        notified: false,
        reason: "exec_failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
