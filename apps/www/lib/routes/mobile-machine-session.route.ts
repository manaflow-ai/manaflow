import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  MobileMachineSessionRequestSchema,
  MobileMachineSessionResponseSchema,
} from "@cmux/shared/mobile-contracts";
import { SignJWT, jwtVerify } from "jose";

type MachineSessionClaims = {
  teamId: string;
  userId: string;
  machineId: string;
};

function getMobileMachineJwtSecret() {
  const secret = process.env.MOBILE_MACHINE_JWT_SECRET;
  if (!secret) {
    throw new Error("MOBILE_MACHINE_JWT_SECRET is required");
  }
  return secret;
}

async function signMachineSessionToken(
  claims: MachineSessionClaims,
  secret: string,
  nowSeconds: number,
) {
  const key = new TextEncoder().encode(secret);
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`mobile-machine:${claims.machineId}`)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 60 * 60)
    .sign(key);
}

export async function verifyMachineSessionToken(
  token: string,
  secret: string,
) {
  const key = new TextEncoder().encode(secret);
  const result = await jwtVerify(token, key);
  const payload = result.payload as typeof result.payload & MachineSessionClaims;
  return {
    teamId: payload.teamId,
    userId: payload.userId,
    machineId: payload.machineId,
  };
}

export function createMobileMachineSessionRouter(options?: {
  resolveUser?: (req: Request) => Promise<{ userId: string } | null>;
  verifyTeam?: (args: {
    req: Request;
    teamSlugOrId: string;
  }) => Promise<{ uuid: string }>;
  secret?: string;
  now?: () => number;
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
  const now = options?.now ?? (() => Date.now());

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/machine-session",
      summary: "Mint a machine session JWT for mobile heartbeat publishing",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MobileMachineSessionRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Machine session minted",
          content: {
            "application/json": {
              schema: MobileMachineSessionResponseSchema,
            },
          },
        },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      const user = await resolveUser(c.req.raw);
      if (!user) {
        return c.text("Unauthorized", 401);
      }

      const body = c.req.valid("json");
      const team = await verifyTeam({
        req: c.req.raw,
        teamSlugOrId: body.teamSlugOrId,
      });
      const secret = options?.secret ?? getMobileMachineJwtSecret();
      const nowMs = now();
      const nowSeconds = Math.floor(nowMs / 1000);
      const token = await signMachineSessionToken(
        {
          teamId: team.uuid,
          userId: user.userId,
          machineId: body.machineId,
        },
        secret,
        nowSeconds,
      );

      return c.json({
        token,
        teamId: team.uuid,
        userId: user.userId,
        machineId: body.machineId,
        expiresAt: (nowSeconds + 60 * 60) * 1000,
      });
    },
  );

  return router;
}

export const mobileMachineSessionRouter = createMobileMachineSessionRouter();
