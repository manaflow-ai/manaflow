import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
  anthropicProxyEffect,
  anthropicCountTokensEffect,
  anthropicEventLoggingEffect,
  CLOUDFLARE_ANTHROPIC_BASE_URL,
} from "./anthropic_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer, makeHttpClientLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";

const baseBody = {
  model: "claude-3-5-sonnet",
  messages: [],
};

describe("anthropic_http", () => {
  it("proxies with user API key", async () => {
    const calls: Array<{ input: RequestInfo | URL }> = [];
    const httpLayer = makeHttpClientLayer(async (input) => {
      calls.push({ input });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const envLayer = makeEnvLayer({
      ANTHROPIC_API_KEY: "",
      AWS_BEARER_TOKEN_BEDROCK: "",
      CMUX_TASK_RUN_JWT_SECRET: "test",
    } satisfies EnvValues);

    const req = new Request("http://localhost/api/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "sk-ant-test",
      },
      body: JSON.stringify(baseBody),
    });

    const response = await runHttpEffect(
      anthropicProxyEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    const url = String(calls[0]?.input);
    expect(url).toBe(`${CLOUDFLARE_ANTHROPIC_BASE_URL}/v1/messages`);
  });

  it("returns 503 when Bedrock token missing", async () => {
    const httpLayer = makeHttpClientLayer(async () => {
      throw new Error("fetch should not be called");
    });
    const envLayer = makeEnvLayer({
      AWS_BEARER_TOKEN_BEDROCK: undefined,
      CMUX_TASK_RUN_JWT_SECRET: "test",
    });

    const req = new Request("http://localhost/api/anthropic/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseBody),
    });

    const response = await runHttpEffect(
      anthropicProxyEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
    );

    expect(response.status).toBe(503);
  });

  it("count_tokens requires API key", async () => {
    const httpLayer = makeHttpClientLayer(async () => {
      throw new Error("fetch should not be called");
    });
    const envLayer = makeEnvLayer({
      ANTHROPIC_API_KEY: undefined,
      CMUX_TASK_RUN_JWT_SECRET: "test",
    });

    const req = new Request("http://localhost/api/anthropic/v1/messages/count_tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseBody),
    });

    const response = await runHttpEffect(
      anthropicCountTokensEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
    );

    expect(response.status).toBe(503);
  });

  it("accepts event logging", async () => {
    const response = await runHttpEffect(
      anthropicEventLoggingEffect.pipe(
        Effect.provide(makeEnvLayer({})),
        Effect.provide(makeHttpClientLayer(async () => new Response()))
      )
    );

    expect(response.status).toBe(200);
  });
});
