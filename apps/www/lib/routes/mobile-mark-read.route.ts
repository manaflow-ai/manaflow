import { internal } from "@cmux/convex/api";
import {
  MobileMarkReadRequestSchema,
  MobileOkResponseSchema,
} from "@cmux/shared/mobile-contracts";
import {
  type MobileAnalyticsEventName,
  type MobileAnalyticsProperties,
} from "@cmux/shared/mobile-analytics";
import { ConvexHttpClient } from "convex/browser";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { trackMobileEvent } from "../analytics/track-mobile-event";

function getAdminConvexClient(adminToken?: string) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const token = adminToken ?? process.env.CONVEX_DEPLOY_KEY;
  if (!convexUrl || !token) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL and CONVEX_DEPLOY_KEY are required");
  }

  const client = new ConvexHttpClient(convexUrl) as ConvexHttpClient & {
    setAdminAuth(token: string): void;
    mutation(reference: unknown, args: unknown): Promise<unknown>;
  };
  client.setAdminAuth(token);
  return client;
}

export function createMobileMarkReadRouter(options?: {
  resolveUser?: (req: Request) => Promise<{ userId: string } | null>;
  verifyTeam?: (args: {
    req: Request;
    teamSlugOrId: string;
  }) => Promise<{ uuid: string }>;
  trackEvent?: (args: {
    distinctId: string;
    event: MobileAnalyticsEventName;
    properties?: MobileAnalyticsProperties;
  }) => Promise<void>;
  markRead?: (args: {
    teamId: string;
    userId: string;
    workspaceId: string;
    latestEventSeq?: number;
  }) => Promise<void>;
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
  const trackEvent = options?.trackEvent ?? trackMobileEvent;
  const markRead =
    options?.markRead ??
    (async ({
      teamId,
      userId,
      workspaceId,
      latestEventSeq,
    }: {
      teamId: string;
      userId: string;
      workspaceId: string;
      latestEventSeq?: number;
    }) => {
      const convex = getAdminConvexClient();
      await convex.mutation(internal.mobileWorkspaces.markReadInternal, {
        teamId,
        userId,
        workspaceId,
        latestEventSeq,
      });
    });

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/workspaces/mark-read",
      summary: "Mark a mobile workspace row read through the HTTP boundary",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MobileMarkReadRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Workspace marked read",
          content: {
            "application/json": {
              schema: MobileOkResponseSchema,
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

      await markRead({
        teamId: team.uuid,
        userId: user.userId,
        workspaceId: body.workspaceId,
        latestEventSeq: body.latestEventSeq,
      });
      await trackEvent({
        distinctId: user.userId,
        event: "mobile_workspace_mark_read",
        properties: {
          teamId: team.uuid,
          userId: user.userId,
          workspaceId: body.workspaceId,
          source: "http",
        },
      });

      return c.json({ ok: true }, 200);
    },
  );

  return router;
}

export const mobileMarkReadRouter = createMobileMarkReadRouter();
