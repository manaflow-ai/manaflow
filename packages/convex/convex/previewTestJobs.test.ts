import { Effect } from "effect";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { dispatchTestJobEffect, retryTestJobEffect } from "./previewTestJobs";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";

type AnyTableName = TableNames | "_scheduled_functions";
const makeId = <TableName extends AnyTableName>(value: string) =>
  value as Id<TableName>;
const previewRunId = makeId<"previewRuns">("preview_run_1");
const previewConfigId = makeId<"previewConfigs">("preview_config_1");
const scheduledId = makeId<"_scheduled_functions">("sched_1");
const now = Date.now();

const makePreviewRun = (
  overrides: Partial<Doc<"previewRuns">> = {},
): Doc<"previewRuns"> => ({
  _id: previewRunId,
  _creationTime: now,
  previewConfigId,
  teamId: "team_1",
  repoFullName: "owner/repo",
  prNumber: 1,
  prUrl: "https://github.com/owner/repo/pull/1",
  headSha: "headsha",
  status: "pending",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const hasKey = (value: unknown, key: string): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && key in value;

function makeCtx(overrides?: Partial<{
  identity: { subject: string } | null;
  previewRun: Doc<"previewRuns"> | null;
  isMember: boolean;
  createRunId: Id<"previewRuns">;
}>) {
  const identity =
    overrides?.identity !== undefined ? overrides.identity : { subject: "user_1" };
  const previewRun =
    overrides?.previewRun !== undefined
      ? overrides.previewRun
      : makePreviewRun();
  const isMember = overrides?.isMember !== undefined ? overrides.isMember : true;
  const createRunId =
    overrides?.createRunId !== undefined
      ? overrides.createRunId
      : makeId<"previewRuns">("preview_run_2");
  const scheduled: Array<{ fn: unknown; args: unknown }> = [];
  const mutations: Array<{ fn: unknown; args: unknown }> = [];

  const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
    if (hasKey(args[0], "id")) {
      return previewRun;
    }
    if (hasKey(args[0], "teamId") && hasKey(args[0], "userId")) {
      return { isMember };
    }
    return null;
  };

  const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
    mutations.push({ fn: mutation, args: args[0] });
    if (hasKey(args[0], "previewRunId")) {
      return undefined;
    }
    if (hasKey(args[0], "prUrl")) {
      return {
        previewRunId: createRunId,
        prNumber: 1,
        repoFullName: "owner/repo",
      };
    }
    return undefined;
  };

  const ctx: Parameters<typeof dispatchTestJobEffect>[0] = {
    auth: {
      getUserIdentity: async () =>
        identity
          ? {
              subject: identity.subject,
              issuer: "https://issuer.test",
              tokenIdentifier: "token_1",
            }
          : null,
    },
    runQuery,
    runMutation,
    scheduler: {
      runAfter: async (_delay, fn, ...args) => {
        scheduled.push({ fn, args: args[0] });
        return scheduledId;
      },
      runAt: async (_timestamp, fn, ...args) => {
        scheduled.push({ fn, args: args[0] });
        return scheduledId;
      },
      cancel: async (_id) => undefined,
    },
  };

  return { ctx, scheduled, mutations };
}

describe("previewTestJobs", () => {
  it("dispatchTestJob requires authentication", async () => {
    const { ctx } = makeCtx({ identity: null });

    await expect(
      Effect.runPromise(
        dispatchTestJobEffect(ctx, {
          teamSlugOrId: "team_1",
          previewRunId,
        })
      )
    ).rejects.toThrow("Authentication required");
  });

  it("dispatchTestJob marks dispatched and schedules job", async () => {
    const { ctx, scheduled, mutations } = makeCtx();

    const result = await Effect.runPromise(
      dispatchTestJobEffect(ctx, {
        teamSlugOrId: "team_1",
        previewRunId,
      })
    );

    expect(result.dispatched).toBe(true);
    expect(mutations.length).toBeGreaterThan(0);
    expect(scheduled).toHaveLength(1);
    const scheduledArgs = scheduled[0]?.args;
    const parsed = z.object({ previewRunId: z.string() }).safeParse(scheduledArgs);
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.previewRunId : undefined).toBe(previewRunId);
  });

  it("retryTestJob creates new run and dispatches", async () => {
    const newRunId = makeId<"previewRuns">("preview_run_3");
    const { ctx, scheduled, mutations } = makeCtx({ createRunId: newRunId });

    const result = await Effect.runPromise(
      retryTestJobEffect(ctx, {
        teamSlugOrId: "team_1",
        previewRunId,
      })
    );

    expect(result.newPreviewRunId).toBe(newRunId);
    expect(result.dispatched).toBe(true);
    expect(mutations.length).toBeGreaterThan(0);
    expect(scheduled).toHaveLength(1);
  });
});
