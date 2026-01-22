import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { CLOUDFLARE_OPENAI_BASE_URL, openaiProxyEffect } from "./openai_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer, makeHttpClientLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";

describe("openai_http", () => {
  it("returns 500 when API key missing", async () => {
    const envLayer = makeEnvLayer({
      OPENAI_API_KEY: undefined,
      CMUX_TASK_RUN_JWT_SECRET: "test",
    } satisfies EnvValues);
    const httpLayer = makeHttpClientLayer(async () => {
      throw new Error("fetch should not be called");
    });

    const req = new Request("http://localhost/api/openai/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-4.1" }),
    });

    const response = await runHttpEffect(
      openaiProxyEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
    );

    expect(response.status).toBe(500);
  });

  it("rewrites path to Cloudflare gateway", async () => {
    const calls: string[] = [];
    const envLayer = makeEnvLayer({
      OPENAI_API_KEY: "sk-test",
      CMUX_TASK_RUN_JWT_SECRET: "test",
    } satisfies EnvValues);
    const httpLayer = makeHttpClientLayer(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const req = new Request(
      "http://localhost/api/openai/v1/responses?foo=bar",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-4.1" }),
      }
    );

    const response = await runHttpEffect(
      openaiProxyEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
    );

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${CLOUDFLARE_OPENAI_BASE_URL}/v1/responses?foo=bar`);
  });
});
