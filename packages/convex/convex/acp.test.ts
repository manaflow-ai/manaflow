import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ActionCtx } from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import {
  deliverMessageInternalEffect,
  expireWarmSandboxEffect,
  prewarmSandboxEffect,
  retryMessageEffect,
  sendMessageEffect,
  sendRpcEffect,
  setSandboxProviderResolverForTests,
  spawnSandboxEffect,
  spawnWarmSandboxEffect,
  startConversationEffect,
  stopSandboxInternalEffect,
} from "./acp";

type AnyTableName = TableNames | "_scheduled_functions";
const makeId = <TableName extends AnyTableName>(value: string) =>
  value as Id<TableName>;
const sandboxId = makeId<"acpSandboxes">("sandbox_1");
const conversationId = makeId<"conversations">("conv_1");
const messageId = makeId<"conversationMessages">("msg_1");
const scheduledId = makeId<"_scheduled_functions">("sched_1");
const now = Date.now();

const makeConversation = (
  overrides: Partial<Doc<"conversations">> = {},
): Doc<"conversations"> => ({
  _id: conversationId,
  _creationTime: now,
  teamId: "team_1",
  userId: "user_1",
  sessionId: "session_1",
  providerId: "claude",
  cwd: "/",
  status: "active",
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const makeSandbox = (
  overrides: Partial<Doc<"acpSandboxes">> = {},
): Doc<"acpSandboxes"> => ({
  _id: sandboxId,
  _creationTime: now,
  teamId: "team_1",
  provider: "morph",
  instanceId: "instance_1",
  status: "running",
  callbackJwtHash: "hash",
  lastActivityAt: now,
  conversationCount: 0,
  snapshotId: "snap_1",
  createdAt: now,
  ...overrides,
});

const makeMessage = (
  overrides: Partial<Doc<"conversationMessages">> = {},
): Doc<"conversationMessages"> => ({
  _id: messageId,
  _creationTime: now,
  conversationId,
  role: "user",
  content: [],
  createdAt: now,
  deliveryStatus: "queued",
  ...overrides,
});

const makeScheduler = (onAfter?: () => void): ActionCtx["scheduler"] => ({
  runAfter: async (_delay, _fn, ..._args) => {
    onAfter?.();
    return scheduledId;
  },
  runAt: async (_timestamp, _fn, ..._args) => scheduledId,
  cancel: async (_id) => undefined,
});

const hasKey = (value: unknown, key: string): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && key in value;

setSandboxProviderResolverForTests({
  getDefault: () => ({
    name: "morph",
    spawn: async () => ({
      instanceId: "instance_1",
      sandboxUrl: undefined,
      provider: "morph",
    }),
    getStatus: async () => ({
      status: "running",
      sandboxUrl: undefined,
    }),
    stop: async () => undefined,
  }),
  getByName: () => ({
    name: "morph",
    spawn: async () => ({
      instanceId: "instance_1",
      sandboxUrl: undefined,
      provider: "morph",
    }),
    getStatus: async () => ({
      status: "running",
      sandboxUrl: undefined,
    }),
    stop: async () => undefined,
  }),
});

describe("acp actions", () => {
  it("prewarmSandbox returns reserved sandbox", async () => {
    const scheduled: Array<unknown> = [];
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "teamSlugOrId")) {
        return "team_1";
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ...args) => {
      if (hasKey(args[0], "extendMs")) {
        return { _id: sandboxId };
      }
      return undefined;
    };
    const runAction: ActionCtx["runAction"] = async (_action, ..._args) => ({
      sandboxId: "unused",
    });
    const ctx: Parameters<typeof prewarmSandboxEffect>[0] = {
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          issuer: "https://issuer.test",
          tokenIdentifier: "token_1",
        }),
      },
      runQuery,
      runMutation,
      runAction,
      scheduler: makeScheduler(() => {
        scheduled.push(true);
      }),
    };

    const result = await Effect.runPromise(
      prewarmSandboxEffect(ctx, { teamSlugOrId: "team_1" })
    );
    expect(result.sandboxId).toBe(sandboxId);
    expect(scheduled.length).toBe(1);
  });

  it("startConversation returns existing conversation", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "teamSlugOrId")) {
        return "team_1";
      }
      if (hasKey(args[0], "clientConversationId")) {
        return makeConversation({ acpSandboxId: sandboxId });
      }
      if (hasKey(args[0], "sandboxId")) {
        return makeSandbox({ status: "running" });
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const runAction: ActionCtx["runAction"] = async (_action, ..._args) =>
      undefined;
    const ctx: Parameters<typeof startConversationEffect>[0] = {
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          issuer: "https://issuer.test",
          tokenIdentifier: "token_1",
        }),
      },
      runQuery,
      runMutation,
      runAction,
    };

    const result = await Effect.runPromise(
      startConversationEffect(ctx, {
        teamSlugOrId: "team_1",
        providerId: "claude",
        cwd: "/",
        clientConversationId: "client_1",
      })
    );

    expect(result.conversationId).toBe(conversationId);
    expect(result.status).toBe("ready");
  });

  it("sendMessage returns existing queued message", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "clientMessageId")) {
        return makeMessage({ deliveryStatus: "queued" });
      }
      if (hasKey(args[0], "conversationId")) {
        return makeConversation({ acpSandboxId: sandboxId });
      }
      if (hasKey(args[0], "teamSlugOrId")) {
        return "team_1";
      }
      if (hasKey(args[0], "sandboxId")) {
        return makeSandbox({ status: "running" });
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const runAction: ActionCtx["runAction"] = async (_action, ..._args) =>
      undefined;
    const ctx: Parameters<typeof sendMessageEffect>[0] = {
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          issuer: "https://issuer.test",
          tokenIdentifier: "token_1",
        }),
      },
      runQuery,
      runMutation,
      runAction,
      scheduler: makeScheduler(),
    };

    const result = await Effect.runPromise(
      sendMessageEffect(ctx, {
        conversationId,
        content: [{ type: "text", text: "hi" }],
        clientMessageId: "client_1",
      })
    );

    expect(result.status).toBe("queued");
    expect(result.messageId).toBe(messageId);
  });

  it("retryMessage throws when conversation missing", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "conversationId")) {
        return null;
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const runAction: ActionCtx["runAction"] = async (_action, ..._args) =>
      undefined;
    const ctx: Parameters<typeof retryMessageEffect>[0] = {
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          issuer: "https://issuer.test",
          tokenIdentifier: "token_1",
        }),
      },
      runQuery,
      runMutation,
      runAction,
      scheduler: makeScheduler(),
    };

    await expect(
      Effect.runPromise(
        retryMessageEffect(ctx, {
          conversationId,
          messageId,
        })
      )
    ).rejects.toThrow("Conversation not found");
  });

  it("sendRpc throws when conversation missing", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "conversationId")) {
        return null;
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const ctx: Parameters<typeof sendRpcEffect>[0] = {
      auth: {
        getUserIdentity: async () => ({
          subject: "user_1",
          issuer: "https://issuer.test",
          tokenIdentifier: "token_1",
        }),
      },
      runQuery,
      runMutation,
    };

    await expect(
      Effect.runPromise(
        sendRpcEffect(ctx, { conversationId, payload: "{}" })
      )
    ).rejects.toThrow("Conversation not found");
  });

  it("spawnSandbox returns sandboxId", async () => {
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ...args) => {
      if (hasKey(args[0], "streamSecret")) {
        return sandboxId;
      }
      return undefined;
    };
    const ctx: Parameters<typeof spawnSandboxEffect>[0] = { runMutation };

    const result = await Effect.runPromise(
      spawnSandboxEffect(ctx, { teamId: "team_1" })
    );
    expect(result.sandboxId).toBe(sandboxId);
  });

  it("spawnWarmSandbox returns sandboxId", async () => {
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ...args) => {
      if (hasKey(args[0], "streamSecret")) {
        return sandboxId;
      }
      return undefined;
    };
    const ctx: Parameters<typeof spawnWarmSandboxEffect>[0] = {
      runMutation,
      scheduler: makeScheduler(),
    };

    const result = await Effect.runPromise(
      spawnWarmSandboxEffect(ctx, {
        reservedUserId: "user_1",
        reservedTeamId: "team_1",
      })
    );
    expect(result.sandboxId).toBe(sandboxId);
  });

  it("deliverMessageInternal exits when conversation missing", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "conversationId")) {
        return null;
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const runAction: ActionCtx["runAction"] = async (_action, ..._args) =>
      undefined;
    const ctx: Parameters<typeof deliverMessageInternalEffect>[0] = {
      runQuery,
      runMutation,
      runAction,
      scheduler: makeScheduler(),
    };

    await Effect.runPromise(
      deliverMessageInternalEffect(ctx, {
        conversationId,
        messageId,
        attempt: 0,
      })
    );
  });

  it("expireWarmSandbox exits when sandbox missing", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "sandboxId")) {
        return null;
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const ctx: Parameters<typeof expireWarmSandboxEffect>[0] = {
      runQuery,
      runMutation,
    };

    await Effect.runPromise(expireWarmSandboxEffect(ctx, { sandboxId }));
  });

  it("stopSandboxInternal exits when sandbox missing", async () => {
    const runQuery: ActionCtx["runQuery"] = async (_query, ...args) => {
      if (hasKey(args[0], "sandboxId")) {
        return null;
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (_mutation, ..._args) =>
      undefined;
    const ctx: Parameters<typeof stopSandboxInternalEffect>[0] = {
      runQuery,
      runMutation,
    };

    await Effect.runPromise(stopSandboxInternalEffect(ctx, { sandboxId }));
  });
});
