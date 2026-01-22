import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  anthropicProxyEffect,
  anthropicCountTokensEffect,
  anthropicEventLoggingEffect,
  CLOUDFLARE_ANTHROPIC_BASE_URL,
} from "./anthropic_http";
import { runHttpEffect } from "./effect/http";
import { makeEnvLayer, makeHttpClientLayer } from "./effect/testLayers";
import type { EnvValues } from "./effect/services";
import * as posthog from "../_shared/posthog";

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

  describe("PostHog tracking canary", () => {
    it("tracks non-streaming response with token usage", async () => {
      const capturedEvents: Array<{ event: string; properties?: Record<string, unknown> }> = [];
      vi.spyOn(posthog, "capturePosthogEvent").mockImplementation((payload) => {
        capturedEvents.push({ event: payload.event, properties: payload.properties });
      });
      vi.spyOn(posthog, "drainPosthogEvents").mockResolvedValue();

      const mockResponse = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
        model: "claude-3-5-sonnet-20241022",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 5,
        },
      };

      const httpLayer = makeHttpClientLayer(async () => {
        return new Response(JSON.stringify(mockResponse), {
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
          "x-api-key": "sk-ant-user-key",
        },
        body: JSON.stringify({ ...baseBody, stream: false }),
      });

      const response = await runHttpEffect(
        anthropicProxyEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
      );

      expect(response.status).toBe(200);
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]?.event).toBe("$ai_generation");
      expect(capturedEvents[0]?.properties?.$ai_model).toBe("claude-3-5-sonnet");
      expect(capturedEvents[0]?.properties?.$ai_input_tokens).toBe(100);
      expect(capturedEvents[0]?.properties?.$ai_output_tokens).toBe(50);
      expect(capturedEvents[0]?.properties?.$ai_stream).toBe(false);
      expect(capturedEvents[0]?.properties?.$ai_http_status).toBe(200);

      vi.restoreAllMocks();
    });

    it("tracks streaming response without token usage", async () => {
      const capturedEvents: Array<{ event: string; properties?: Record<string, unknown> }> = [];
      vi.spyOn(posthog, "capturePosthogEvent").mockImplementation((payload) => {
        capturedEvents.push({ event: payload.event, properties: payload.properties });
      });
      vi.spyOn(posthog, "drainPosthogEvents").mockResolvedValue();

      const httpLayer = makeHttpClientLayer(async () => {
        return new Response("data: {}\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
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
          "x-api-key": "sk-ant-user-key",
        },
        body: JSON.stringify({ ...baseBody, stream: true }),
      });

      const response = await runHttpEffect(
        anthropicProxyEffect(req).pipe(Effect.provide(Layer.mergeAll(envLayer, httpLayer)))
      );

      expect(response.status).toBe(200);
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]?.event).toBe("$ai_generation");
      expect(capturedEvents[0]?.properties?.$ai_stream).toBe(true);
      // Streaming doesn't have token usage
      expect(capturedEvents[0]?.properties?.$ai_input_tokens).toBeUndefined();

      vi.restoreAllMocks();
    });

    it("tracks Bedrock 503 error when token missing", async () => {
      const capturedEvents: Array<{ event: string; properties?: Record<string, unknown> }> = [];
      vi.spyOn(posthog, "capturePosthogEvent").mockImplementation((payload) => {
        capturedEvents.push({ event: payload.event, properties: payload.properties });
      });
      vi.spyOn(posthog, "drainPosthogEvents").mockResolvedValue();

      const httpLayer = makeHttpClientLayer(async () => {
        throw new Error("should not be called");
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
      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]?.properties?.$ai_http_status).toBe(503);
      expect(capturedEvents[0]?.properties?.$ai_error).toBe("bedrock_not_configured");

      vi.restoreAllMocks();
    });
  });
});
