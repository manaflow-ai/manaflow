import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { createMobileAnalyticsRouter } from "./mobile-analytics.route";

describe("mobileAnalyticsRouter", () => {
  it("accepts an analytics event", async () => {
    const ingest = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileAnalyticsRouter({
        resolveAccessToken: async () => "access-token-123",
        ingest,
      }),
    );

    const response = await app.request("/mobile/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "mobile_workspace_opened",
        properties: { workspaceId: "ws_1", platform: "ios" },
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { accepted: boolean };
    expect(body.accepted).toBe(true);
    expect(ingest).toHaveBeenCalledTimes(1);
    const firstCall = (ingest.mock.calls as unknown[][])[0];
    expect(firstCall?.[0]).toMatchObject({
      accessToken: "access-token-123",
      event: "mobile_workspace_opened",
    });
  });

  it("rejects unauthenticated requests", async () => {
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileAnalyticsRouter({
        resolveAccessToken: async () => null,
      }),
    );

    const response = await app.request("/mobile/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: "mobile_workspace_opened",
      }),
    });

    expect(response.status).toBe(401);
  });
});
