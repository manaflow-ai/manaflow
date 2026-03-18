import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { MobileMarkReadRequestSchema } from "@cmux/shared/mobile-contracts";
import { createMobileMarkReadRouter } from "./mobile-mark-read.route";

describe("mobileMarkReadRouter", () => {
  it("marks a workspace read through the HTTP boundary", async () => {
    const markRead = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileMarkReadRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        verifyTeam: async () => ({ uuid: "team_123" }),
        markRead,
      }),
    );

    const response = await app.request("/mobile/workspaces/mark-read", {
      method: "POST",
      headers: {
        authorization: "Bearer user-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(MobileMarkReadRequestSchema.parse({
        teamSlugOrId: "team_123",
        workspaceId: "ws_123",
        latestEventSeq: 6,
      })),
    });

    expect(response.status).toBe(200);
    expect(markRead).toHaveBeenCalledWith({
      teamId: "team_123",
      userId: "user_123",
      workspaceId: "ws_123",
      latestEventSeq: 6,
    });
  });
});
