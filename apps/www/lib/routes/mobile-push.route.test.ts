import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import {
  MobilePushRegisterRequestSchema,
  MobilePushRemoveRequestSchema,
  MobilePushTestRequestSchema,
} from "@cmux/shared/mobile-contracts";
import { createMobilePushRouter } from "./mobile-push.route";

describe("mobilePushRouter", () => {
  it("registers push tokens through the HTTP boundary", async () => {
    const upsert = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobilePushRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        upsertPushToken: upsert,
        removePushToken: async () => {},
        sendTestPush: async () => {},
      }),
    );

    const response = await app.request("/mobile/push/register", {
      method: "POST",
      headers: {
        authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(MobilePushRegisterRequestSchema.parse({
        token: "token_123",
        environment: "development",
        platform: "ios",
        bundleId: "dev.cmux.app.dev",
        deviceId: "device_123",
      })),
    });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("removes push tokens through the HTTP boundary", async () => {
    const remove = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobilePushRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        upsertPushToken: async () => {},
        removePushToken: remove,
        sendTestPush: async () => {},
      }),
    );

    const response = await app.request("/mobile/push/remove", {
      method: "POST",
      headers: {
        authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(MobilePushRemoveRequestSchema.parse({
        token: "token_123",
      })),
    });

    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("sends test pushes through the HTTP boundary", async () => {
    const sendTest = vi.fn(async () => ({ scheduledCount: 1 }));
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobilePushRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        upsertPushToken: async () => {},
        removePushToken: async () => {},
        sendTestPush: sendTest,
      }),
    );

    const response = await app.request("/mobile/push/test", {
      method: "POST",
      headers: {
        authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(MobilePushTestRequestSchema.parse({
        title: "Test Push",
        body: "It works",
      })),
    });

    expect(response.status).toBe(200);
    expect(sendTest).toHaveBeenCalledTimes(1);
  });
});
