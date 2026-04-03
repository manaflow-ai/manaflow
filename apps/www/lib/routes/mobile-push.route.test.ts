import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { createMobilePushRouter } from "./mobile-push.route";

describe("mobilePushRouter", () => {
  function makeApp(overrides?: Parameters<typeof createMobilePushRouter>[0]) {
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobilePushRouter({
        resolveAccessToken: async () => "access-token-123",
        ...overrides,
      }),
    );
    return app;
  }

  it("registers a push token", async () => {
    const registerToken = vi.fn(async () => {});
    const app = makeApp({ registerToken });

    const response = await app.request("/mobile/push/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "apns-device-token-abc",
        environment: "development",
        platform: "ios",
        bundleId: "dev.cmux.app",
        deviceId: "device-xyz",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(registerToken).toHaveBeenCalledTimes(1);
  });

  it("removes a push token", async () => {
    const removeToken = vi.fn(async () => {});
    const app = makeApp({ removeToken });

    const response = await app.request("/mobile/push/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "apns-device-token-abc" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(removeToken).toHaveBeenCalledTimes(1);
  });

  it("sends a test push", async () => {
    const sendTestPush = vi.fn(async () => 0);
    const app = makeApp({ sendTestPush });

    const response = await app.request("/mobile/push/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "World" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { scheduledCount: number };
    expect(body.scheduledCount).toBe(0);
    expect(sendTestPush).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated requests", async () => {
    const app = makeApp({ resolveAccessToken: async () => null });

    const response = await app.request("/mobile/push/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "apns-device-token-abc",
        environment: "production",
        platform: "ios",
        bundleId: "dev.cmux.app",
      }),
    });

    expect(response.status).toBe(401);
  });
});
