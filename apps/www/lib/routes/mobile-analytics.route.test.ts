import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { MobileAnalyticsCaptureRequestSchema } from "@cmux/shared/mobile-analytics";
import { createMobileAnalyticsRouter } from "./mobile-analytics.route";

describe("mobileAnalyticsRouter", () => {
  it("captures a mobile workspace opened event with team and workspace dimensions", async () => {
    const trackEvent = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileAnalyticsRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        trackEvent,
      }),
    );

    const response = await app.request("/mobile/analytics", {
      method: "POST",
      headers: {
        authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        MobileAnalyticsCaptureRequestSchema.parse({
          event: "mobile_workspace_opened",
          properties: {
            teamId: "team_123",
            teamKind: "personal",
            machineId: "machine_123",
            workspaceId: "ws_123",
            source: "inbox",
          },
        }),
      ),
    });

    expect(response.status).toBe(202);
    expect(trackEvent).toHaveBeenCalledWith({
      distinctId: "user_123",
      event: "mobile_workspace_opened",
      properties: {
        teamId: "team_123",
        teamKind: "personal",
        machineId: "machine_123",
        workspaceId: "ws_123",
        source: "inbox",
        userId: "user_123",
      },
    });
  });
});
