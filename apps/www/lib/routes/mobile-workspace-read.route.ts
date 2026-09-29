import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const MarkReadBody = z
  .object({
    teamSlugOrId: z.string(),
    workspaceId: z.string(),
    latestEventSeq: z.number().optional(),
  })
  .openapi("MobileMarkReadBody");

const MarkReadResponse = z
  .object({
    ok: z.boolean(),
  })
  .openapi("MobileMarkReadResponse");

export function createMobileWorkspaceReadRouter(options?: {
  resolveAccessToken?: (req: Request) => Promise<string | null>;
  verifyTeam?: (args: {
    req: Request;
    accessToken: string;
    teamSlugOrId: string;
  }) => Promise<{ uuid: string }>;
  markRead?: (args: {
    accessToken: string;
    teamId: string;
    workspaceId: string;
    latestEventSeq?: number;
  }) => Promise<void>;
}) {
  const router = new OpenAPIHono();

  const resolveAccessToken =
    options?.resolveAccessToken ??
    (async (req: Request) => {
      const { getAccessTokenFromRequest } = await import("@/lib/utils/auth");
      return getAccessTokenFromRequest(req);
    });
  const verifyTeam =
    options?.verifyTeam ??
    (async ({
      req,
      teamSlugOrId,
    }: {
      req: Request;
      accessToken: string;
      teamSlugOrId: string;
    }) => {
      const { verifyTeamAccess } = await import(
        "@/lib/utils/team-verification"
      );
      return await verifyTeamAccess({ req, teamSlugOrId });
    });
  const markRead =
    options?.markRead ??
    (async (args: {
      accessToken: string;
      teamId: string;
      workspaceId: string;
      latestEventSeq?: number;
    }) => {
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
      const deployKey = process.env.CONVEX_DEPLOY_KEY;
      if (!convexUrl || !deployKey) {
        throw new Error(
          "NEXT_PUBLIC_CONVEX_URL and CONVEX_DEPLOY_KEY are required",
        );
      }
      const endpoint = convexUrl
        .replace(".convex.cloud", ".convex.site")
        .replace(/\/$/, "");
      // Calls Convex HTTP endpoint to mark the workspace as read.
      const response = await fetch(
        `${endpoint}/api/mobile/workspaces/mark-read`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${deployKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            teamSlugOrId: args.teamId,
            workspaceId: args.workspaceId,
            latestEventSeq: args.latestEventSeq,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Convex markRead failed: ${response.status}`);
      }
    });

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/workspaces/mark-read",
      summary: "Mark a workspace as read",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MarkReadBody,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Workspace marked as read",
          content: {
            "application/json": {
              schema: MarkReadResponse,
            },
          },
        },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      const accessToken = await resolveAccessToken(c.req.raw);
      if (!accessToken) {
        return c.text("Unauthorized", 401);
      }

      const body = c.req.valid("json");
      const team = await verifyTeam({
        req: c.req.raw,
        accessToken,
        teamSlugOrId: body.teamSlugOrId,
      });

      await markRead({
        accessToken,
        teamId: team.uuid,
        workspaceId: body.workspaceId,
        latestEventSeq: body.latestEventSeq,
      });

      return c.json({ ok: true });
    },
  );

  return router;
}

export const mobileWorkspaceReadRouter = createMobileWorkspaceReadRouter();
