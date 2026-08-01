import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { createMobileWorkspaceReadRouter } from "./mobile-workspace-read.route";

describe("mobileWorkspaceReadRouter", () => {
  it("marks a workspace as read", async () => {
    const markRead = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileWorkspaceReadRouter({
        resolveAccessToken: async () => "access-token-123",
        verifyTeam: async () => ({ uuid: "team_123" }),
        markRead,
      }),
    );

    const response = await app.request("/mobile/workspaces/mark-read", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        teamSlugOrId: "cmux",
        workspaceId: "workspace_abc",
        latestEventSeq: 42,
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(markRead).toHaveBeenCalledTimes(1);
    const firstCall = (markRead.mock.calls as unknown[][])[0];
    expect(firstCall?.[0]).toMatchObject({
      accessToken: "access-token-123",
      teamId: "team_123",
      workspaceId: "workspace_abc",
      latestEventSeq: 42,
    });
  });

  it("rejects unauthenticated requests", async () => {
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileWorkspaceReadRouter({
        resolveAccessToken: async () => null,
        verifyTeam: async () => ({ uuid: "team_123" }),
        markRead: async () => {},
      }),
    );

    const response = await app.request("/mobile/workspaces/mark-read", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        teamSlugOrId: "cmux",
        workspaceId: "workspace_abc",
      }),
    });

    expect(response.status).toBe(401);
  });
});
