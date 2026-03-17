import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import {
  createMobileMachineSessionRouter,
  verifyMachineSessionToken,
} from "./mobile-machine-session.route";

describe("mobileMachineSessionRouter", () => {
  it("mints a machine session for an authenticated user", async () => {
    const now = Date.now();
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileMachineSessionRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        verifyTeam: async () => ({ uuid: "team_123" }),
        secret: "test-secret",
        now: () => now,
      }),
    );

    const response = await app.request("/mobile/machine-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        teamSlugOrId: "cmux",
        machineId: "machine_123",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      token: string;
      teamId: string;
      userId: string;
      machineId: string;
    };
    const claims = await verifyMachineSessionToken(body.token, "test-secret");
    expect(body.teamId).toBe("team_123");
    expect(body.userId).toBe("user_123");
    expect(claims.machineId).toBe("machine_123");
  });

  it("rejects unauthenticated requests", async () => {
    const app = new OpenAPIHono();
    app.route(
      "/",
      createMobileMachineSessionRouter({
        resolveUser: async () => null,
        verifyTeam: async () => ({ uuid: "team_123" }),
        secret: "test-secret",
      }),
    );

    const response = await app.request("/mobile/machine-session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        teamSlugOrId: "cmux",
        machineId: "machine_123",
      }),
    });

    expect(response.status).toBe(401);
  });
});
