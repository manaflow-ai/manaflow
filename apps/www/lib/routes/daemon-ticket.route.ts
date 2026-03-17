import { internal } from "@cmux/convex/api";
import { ConvexHttpClient } from "convex/browser";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createHmac, randomUUID } from "node:crypto";

const DaemonTicketBody = z
  .object({
    server_id: z.string(),
    team_id: z.string(),
    session_id: z.string().optional(),
    attachment_id: z.string().optional(),
    capabilities: z.array(z.string()).default(["session.attach"]),
  })
  .openapi("DaemonTicketBody");

const DaemonTicketResponse = z
  .object({
    ticket: z.string(),
    direct_url: z.string(),
    direct_tls_pins: z.array(z.string()),
    session_id: z.string(),
    attachment_id: z.string(),
    expires_at: z.string(),
  })
  .openapi("DaemonTicketResponse");

type DirectConnectionRecord = {
  machineId: string;
  serverId: string;
  directHost: string;
  directPort: number;
  directTlsPins: string[];
  ticketSecret: string;
};

type DirectTicketClaims = {
  server_id: string;
  team_id: string;
  session_id: string;
  attachment_id: string;
  capabilities: string[];
  exp: number;
  nonce: string;
};

function base64UrlEncode(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function signDirectDaemonTicket(
  claims: DirectTicketClaims,
  ticketSecret: string,
) {
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signature = createHmac("sha256", ticketSecret)
    .update(encodedPayload)
    .digest();
  return `${encodedPayload}.${base64UrlEncode(signature)}`;
}

function getAdminConvexClient(adminToken?: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const token = adminToken ?? process.env.CONVEX_DEPLOY_KEY;
  if (!convexUrl || !token) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL and CONVEX_DEPLOY_KEY are required");
  }

  const client = new ConvexHttpClient(convexUrl) as ConvexHttpClient & {
    setAdminAuth(token: string): void;
  };
  client.setAdminAuth(token);
  return client;
}

export function createDaemonTicketRouter(options?: {
  resolveUser?: (req: Request) => Promise<{ userId: string } | null>;
  verifyTeam?: (args: {
    req: Request;
    teamSlugOrId: string;
  }) => Promise<{ uuid: string }>;
  getDirectConnection?: (args: {
    teamId: string;
    userId: string;
    serverId: string;
  }) => Promise<DirectConnectionRecord | null>;
  now?: () => number;
  expiresInSeconds?: number;
}) {
  const router = new OpenAPIHono();
  const resolveUser =
    options?.resolveUser ??
    (async (req: Request) => {
      const { getUserFromRequest } = await import("@/lib/utils/auth");
      const user = await getUserFromRequest(req);
      if (!user) {
        return null;
      }
      return { userId: user.id };
    });
  const verifyTeam =
    options?.verifyTeam ??
    (async ({ req, teamSlugOrId }: { req: Request; teamSlugOrId: string }) => {
      const { verifyTeamAccess } = await import("@/lib/utils/team-verification");
      return await verifyTeamAccess({ req, teamSlugOrId });
    });
  const getDirectConnection =
    options?.getDirectConnection ??
    (async ({
      teamId,
      userId,
      serverId,
    }: {
      teamId: string;
      userId: string;
      serverId: string;
    }) => {
      const convex = getAdminConvexClient();
      return await (
        convex as ConvexHttpClient & {
          query(query: unknown, args: unknown): Promise<DirectConnectionRecord | null>;
        }
      ).query(internal.mobileMachineConnections.getForServerInternal, {
        teamId,
        userId,
        serverId,
      });
    });
  const now = options?.now ?? (() => Date.now());
  const expiresInSeconds = options?.expiresInSeconds ?? 5 * 60;

  router.openapi(
    createRoute({
      method: "post",
      path: "/daemon-ticket",
      summary: "Mint a direct daemon ticket for a discovered workspace machine",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: DaemonTicketBody,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Direct daemon ticket minted",
          content: {
            "application/json": {
              schema: DaemonTicketResponse,
            },
          },
        },
        401: { description: "Unauthorized" },
        404: { description: "Machine connection unavailable" },
      },
    }),
    async (c) => {
      const user = await resolveUser(c.req.raw);
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const body = c.req.valid("json");
      const team = await verifyTeam({
        req: c.req.raw,
        teamSlugOrId: body.team_id,
      });
      const connection = await getDirectConnection({
        teamId: team.uuid,
        userId: user.userId,
        serverId: body.server_id,
      });

      if (!connection) {
        return c.json({ error: "Machine connection unavailable" }, 404);
      }

      const issuedAtSeconds = Math.floor(now() / 1000);
      const expiresAtSeconds = issuedAtSeconds + expiresInSeconds;
      const ticket = signDirectDaemonTicket(
        {
          server_id: connection.serverId,
          team_id: team.uuid,
          session_id: body.session_id ?? "",
          attachment_id: body.attachment_id ?? "",
          capabilities: [...body.capabilities].sort(),
          exp: expiresAtSeconds,
          nonce: randomUUID(),
        },
        connection.ticketSecret,
      );

      return c.json({
        ticket,
        direct_url: `tls://${connection.directHost}:${connection.directPort}`,
        direct_tls_pins: connection.directTlsPins,
        session_id: body.session_id ?? "",
        attachment_id: body.attachment_id ?? "",
        expires_at: new Date(expiresAtSeconds * 1000).toISOString(),
      });
    },
  );

  return router;
}

export const daemonTicketRouter = createDaemonTicketRouter();
