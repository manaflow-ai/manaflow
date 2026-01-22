import { Effect, Layer } from "effect";
import { SignJWT } from "jose";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import { acpCallbackEffect } from "./acp_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";
import type { ActionCtx } from "./_generated/server";

const TEST_SECRET = "acp_test_secret";

async function makeJwt(payload: { sandboxId: string; teamId: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe("acp_http", () => {
  const envLayer = makeEnvLayer({
    ACP_CALLBACK_SECRET: TEST_SECRET,
    CMUX_TASK_RUN_JWT_SECRET: "unused",
  } satisfies EnvValues);

  it("rejects missing bearer token", async () => {
    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const runMutation: ActionCtx["runMutation"] = async () => undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(401);
  });

  it("rejects non-json content-type", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
      },
      body: "hello",
    });

    const runMutation: ActionCtx["runMutation"] = async () => undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(415);
  });

  it("rejects invalid payload", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "message_chunk" }),
    });

    const runMutation: ActionCtx["runMutation"] = async () => undefined;
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(400);
  });

  it("dispatches message_chunk mutations", async () => {
    const token = await makeJwt({ sandboxId: "sandbox-1", teamId: "team-1" });
    const payload = {
      type: "message_chunk",
      conversationId: "conv_1",
      messageId: "msg_1",
      createdAt: 123,
      eventSeq: 1,
      content: { type: "text", text: "hi" },
    };

    const req = new Request("http://localhost/api/acp/callback", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const mutations: Array<{ fn: unknown; args: unknown }> = [];
    const runMutation: ActionCtx["runMutation"] = async (mutation, ...args) => {
      mutations.push({ fn: mutation, args: args[0] });
      return undefined;
    };
    const ctx: Pick<ActionCtx, "runMutation"> = { runMutation };

    const response = await runHttpEffect(
      acpCallbackEffect(ctx, req).pipe(Effect.provide(envLayer))
    );

    expect(response.status).toBe(200);
    expect(mutations).toHaveLength(1);
    const mutationArgs = mutations[0]?.args;
    const parsed = z.object({ conversationId: z.string() }).safeParse(mutationArgs);
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.conversationId : undefined).toBe("conv_1");
  });
});
