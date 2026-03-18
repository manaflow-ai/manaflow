import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { DaemonTicketRequestSchema } from "@cmux/shared/mobile-contracts";
import {
  createDaemonTicketRouter,
  signDirectDaemonTicket,
} from "./daemon-ticket.route";

describe("daemonTicketRouter", () => {
  it("mints a direct daemon ticket for an authenticated team member", async () => {
    const app = new OpenAPIHono();
    app.route(
      "/",
      createDaemonTicketRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        verifyTeam: async () => ({ uuid: "team_123" }),
        now: () => Date.UTC(2026, 2, 17, 21, 0, 0),
        getDirectConnection: async () => ({
          machineId: "machine_123",
          serverId: "machine_123",
          directHost: "cmux-macmini.tail.ts.net",
          directPort: 9443,
          directTlsPins: ["sha256:pin-a"],
          ticketSecret: "secret-123",
        }),
      }),
    );

    const response = await app.request("/daemon-ticket", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(DaemonTicketRequestSchema.parse({
        server_id: "machine_123",
        team_id: "cmux",
        session_id: "sess-1",
        attachment_id: "att-1",
        capabilities: ["session.attach", "session.open"],
      })),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ticket: string;
      direct_url: string;
      direct_tls_pins: string[];
      session_id: string;
      attachment_id: string;
      expires_at: string;
    };

    expect(body.direct_url).toBe("tls://cmux-macmini.tail.ts.net:9443");
    expect(body.direct_tls_pins).toEqual(["sha256:pin-a"]);
    expect(body.session_id).toBe("sess-1");
    expect(body.attachment_id).toBe("att-1");
    expect(body.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("returns 404 when the machine has no direct connection published", async () => {
    const app = new OpenAPIHono();
    app.route(
      "/",
      createDaemonTicketRouter({
        resolveUser: async () => ({ userId: "user_123" }),
        verifyTeam: async () => ({ uuid: "team_123" }),
        getDirectConnection: async () => null,
      }),
    );

    const response = await app.request("/daemon-ticket", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(DaemonTicketRequestSchema.parse({
        server_id: "machine_123",
        team_id: "cmux",
      })),
    });

    expect(response.status).toBe(404);
  });

  it("signs tickets in the same base64url.hmac format as the Go daemon", () => {
    const ticket = signDirectDaemonTicket(
      {
        server_id: "machine_123",
        team_id: "team_123",
        session_id: "sess-1",
        attachment_id: "att-1",
        capabilities: ["session.attach"],
        exp: 1_700_000_000,
        nonce: "nonce-123",
      },
      "secret-123",
    );

    expect(ticket.split(".")).toHaveLength(2);
    expect(ticket).toBe(
      "eyJzZXJ2ZXJfaWQiOiJtYWNoaW5lXzEyMyIsInRlYW1faWQiOiJ0ZWFtXzEyMyIsInNlc3Npb25faWQiOiJzZXNzLTEiLCJhdHRhY2htZW50X2lkIjoiYXR0LTEiLCJjYXBhYmlsaXRpZXMiOlsic2Vzc2lvbi5hdHRhY2giXSwiZXhwIjoxNzAwMDAwMDAwLCJub25jZSI6Im5vbmNlLTEyMyJ9.c0n4gxeHWRBn61Xyw3t4vd1zgoQvh6ebCSVj3NtNiwg"
    );
  });
});
