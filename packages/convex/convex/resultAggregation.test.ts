import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for resultAggregation module.
 *
 * Tests the pure functions that build completion messages for the
 * parent agent's mailbox when child task runs complete.
 *
 * Note: Integration tests with actual sandbox providers (Morph/PVE-LXC)
 * require running sandboxes and are handled separately in E2E tests.
 */

// We can't directly import the module because it requires Convex runtime,
// so we test the core logic by replicating the pure functions here.

function generateMessageId(): string {
  return "msg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

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

describe("resultAggregation", () => {
  describe("generateMessageId", () => {
    it("generates unique message IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^msg_[a-f0-9]{12}$/);
      expect(id2).toMatch(/^msg_[a-f0-9]{12}$/);
    });
  });

  describe("buildCompletionMessage", () => {
    it("builds a success message for a completed child run", () => {
      const message = buildCompletionMessage(
        {
          _id: "run_123",
          agentName: "claude/opus-4",
          status: "completed",
          exitCode: 0,
          pullRequestUrl: "https://github.com/owner/repo/pull/42",
          summary: "Added new feature X with tests",
        },
        { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
        2
      );

      expect(message.from).toBe("claude/opus-4");
      expect(message.to).toBe("*");
      expect(message.type).toBe("status");
      expect(message.read).toBe(false);
      expect(message.message).toContain("completed successfully");
      expect(message.message).toContain("PR: https://github.com/owner/repo/pull/42");
      expect(message.message).toContain("Added new feature X with tests");
      expect(message.message).toContain("Team progress: 1/2 completed");
    });

    it("builds a failure message for a failed child run", () => {
      const message = buildCompletionMessage(
        {
          _id: "run_456",
          agentName: "codex/gpt-5",
          status: "failed",
          exitCode: 1,
        },
        { pending: 1, running: 0, completed: 0, failed: 1, skipped: 0 },
        3
      );

      expect(message.from).toBe("codex/gpt-5");
      expect(message.message).toContain("failed");
      expect(message.message).not.toContain("completed successfully");
      expect(message.message).toContain("Team progress: 0/3 completed, 1 failed");
    });

    it("uses 'unknown-agent' when agentName is not provided", () => {
      const message = buildCompletionMessage(
        {
          _id: "run_789",
          status: "completed",
        },
        { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
        1
      );

      expect(message.from).toBe("unknown-agent");
    });

    it("truncates long summaries to 200 chars", () => {
      const longSummary = "A".repeat(300);
      const message = buildCompletionMessage(
        {
          _id: "run_abc",
          agentName: "test-agent",
          status: "completed",
          summary: longSummary,
        },
        { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
        1
      );

      expect(message.message).toContain("A".repeat(200) + "...");
      expect(message.message).not.toContain("A".repeat(201));
    });

    it("treats undefined exitCode as success for completed status", () => {
      const message = buildCompletionMessage(
        {
          _id: "run_def",
          agentName: "test-agent",
          status: "completed",
          // exitCode is undefined
        },
        { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
        1
      );

      expect(message.message).toContain("completed successfully");
    });

    it("treats non-zero exitCode as failure even with completed status", () => {
      const message = buildCompletionMessage(
        {
          _id: "run_ghi",
          agentName: "test-agent",
          status: "completed",
          exitCode: 2,
        },
        { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
        1
      );

      expect(message.message).toContain("failed");
      expect(message.message).not.toContain("completed successfully");
    });

    it("includes all team progress metrics", () => {
      const message = buildCompletionMessage(
        {
          _id: "run_jkl",
          agentName: "test-agent",
          status: "completed",
        },
        { pending: 2, running: 1, completed: 3, failed: 1, skipped: 1 },
        8
      );

      expect(message.message).toContain("Team progress: 3/8 completed");
      expect(message.message).toContain("1 failed");
      expect(message.message).toContain("1 running");
      expect(message.message).toContain("2 pending");
    });
  });
});
