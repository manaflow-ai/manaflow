import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const AnalyticsBody = z
  .object({
    event: z.string(),
    properties: z.record(z.string(), z.any()).optional(),
  })
  .openapi("MobileAnalyticsBody");

const AnalyticsResponse = z
  .object({
    accepted: z.boolean(),
  })
  .openapi("MobileAnalyticsResponse");

export function createMobileAnalyticsRouter(options?: {
  resolveAccessToken?: (req: Request) => Promise<string | null>;
  ingest?: (args: {
    accessToken: string;
    event: string;
    properties?: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const router = new OpenAPIHono();

  const resolveAccessToken =
    options?.resolveAccessToken ??
    (async (req: Request) => {
      const { getAccessTokenFromRequest } = await import("@/lib/utils/auth");
      return getAccessTokenFromRequest(req);
    });
  const ingest =
    options?.ingest ??
    (async (args: {
      event: string;
      properties?: Record<string, unknown>;
    }) => {
      // Stub: log and accept. Forward to PostHog later.
      console.log("mobile-analytics:", args.event, args.properties ?? {});
    });

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/analytics",
      summary: "Forward mobile analytics events",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: AnalyticsBody,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Event accepted",
          content: {
            "application/json": {
              schema: AnalyticsResponse,
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
      await ingest({
        accessToken,
        event: body.event,
        properties: body.properties as Record<string, unknown> | undefined,
      });

      return c.json({ accepted: true });
    },
  );

  return router;
}

export const mobileAnalyticsRouter = createMobileAnalyticsRouter();
