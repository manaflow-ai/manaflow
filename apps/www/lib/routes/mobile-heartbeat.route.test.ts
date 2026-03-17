import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { createMobileHeartbeatRouter } from "./mobile-heartbeat.route";

describe("mobileHeartbeatRouter", () => {
  it("accepts a workspace heartbeat snapshot", async () => {
    const publishHeartbeat = vi.fn(async () => {});
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileHeartbeatRouter({
        verifyToken: async () => ({
          teamId: "team_123",
          userId: "user_123",
          machineId: "machine_123",
        }),
        publishHeartbeat,
        now: () => 1_700_000_000_000,
      }),
    );

    const response = await app.request("/mobile/heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        machineId: "machine_123",
        displayName: "Orb",
        tailscaleHostname: "orb.tailnet.ts.net",
        tailscaleIPs: ["100.64.0.1"],
        status: "online",
        workspaces: [
          {
            workspaceId: "workspace_123",
            title: "orb / cmux",
            preview: "feature/dogfood",
            phase: "connected",
            tmuxSessionName: "cmux-orb",
            lastActivityAt: 1_700_000_000_000,
            latestEventSeq: 4,
          },
        ],
      }),
    });

    expect(response.status).toBe(202);
    expect(publishHeartbeat).toHaveBeenCalledTimes(1);
    const firstCall = (publishHeartbeat.mock.calls as unknown[][])[0];
    expect(firstCall?.[0]).toMatchObject({
      teamId: "team_123",
      userId: "user_123",
      machineId: "machine_123",
    });
  });

  it("rejects missing machine auth", async () => {
    const app = new OpenAPIHono();
    app.route("/", createMobileHeartbeatRouter());

    const response = await app.request("/mobile/heartbeat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        machineId: "machine_123",
        displayName: "Orb",
        tailscaleIPs: [],
        status: "online",
        workspaces: [],
      }),
    });

    expect(response.status).toBe(401);
  });
});
