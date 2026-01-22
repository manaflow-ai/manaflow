import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { generateTitleEffect } from "./conversationSummary";
import { makeEnvLayer, makeHttpClientLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";
import type { ActionCtx } from "./_generated/server";
import type { Id, TableNames } from "./_generated/dataModel";

type AnyTableName = TableNames | "_scheduled_functions";
const makeId = <TableName extends AnyTableName>(value: string) =>
  value as Id<TableName>;
const conversationId = makeId<"conversations">("conv_1");
const workspaceSettingsId = makeId<"workspaceSettings">("ws_1");

describe("conversationSummary", () => {
  it("skips when OPENAI_API_KEY is missing", async () => {
    const mutations: Array<{ fn: unknown }> = [];
    const runQuery: ActionCtx["runQuery"] = async (_query, ..._args) => ({
      _id: workspaceSettingsId,
      _creationTime: Date.now(),
      conversationTitleStyle: "sentence",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      teamId: "team_1",
      userId: "user_1",
    });
    const runMutation: ActionCtx["runMutation"] = async (mutation, ..._args) => {
      mutations.push({ fn: mutation });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runQuery" | "runMutation"> = {
      runQuery,
      runMutation,
    };

    const envLayer = makeEnvLayer({ OPENAI_API_KEY: undefined } satisfies EnvValues);

    await Effect.runPromise(
      generateTitleEffect(
        ctx,
        {
          conversationId,
          firstMessageText: "Hello",
          teamId: "team_1",
          userId: "user_1",
        },
        () => () => Effect.succeed("unused")
      ).pipe(Effect.provide(Layer.mergeAll(envLayer, makeHttpClientLayer(async () => new Response()))))
    );

    expect(mutations).toHaveLength(0);
  });

  it("writes generated title", async () => {
    const mutations: Array<{ fn: unknown; args: unknown }> = [];
    const runQuery: ActionCtx["runQuery"] = async (query, ..._args) => {
      if (query === internal.workspaceSettings.getByTeamAndUserInternal) {
        return {
          _id: workspaceSettingsId,
          _creationTime: Date.now(),
          conversationTitleStyle: "title",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          teamId: "team_1",
          userId: "user_1",
        };
      }
      return null;
    };
    const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
      mutations.push({ fn: mutation, args: args[0] });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runQuery" | "runMutation"> = {
      runQuery,
      runMutation,
    };

    const envLayer = makeEnvLayer({ OPENAI_API_KEY: "sk-test" } satisfies EnvValues);

    await Effect.runPromise(
      generateTitleEffect(
        ctx,
        {
          conversationId,
          firstMessageText: "Write tests for the payment service",
          teamId: "team_1",
          userId: "user_1",
        },
        () => () => Effect.succeed("Payment Tests")
      ).pipe(Effect.provide(Layer.mergeAll(envLayer, makeHttpClientLayer(async () => new Response()))))
    );

    expect(mutations.length).toBe(1);
    const mutationArgs = mutations[0]?.args;
    expect(mutationArgs).toMatchObject({
      conversationId,
      title: "Payment Tests",
    });
  });
});
