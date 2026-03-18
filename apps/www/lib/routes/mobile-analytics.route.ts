import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { MobileAcceptedResponseSchema } from "@cmux/shared/mobile-contracts";
import {
  MobileAnalyticsCaptureRequestSchema,
  type MobileAnalyticsEventName,
  type MobileAnalyticsProperties,
} from "@cmux/shared/mobile-analytics";
import { trackMobileEvent } from "../analytics/track-mobile-event";

export function createMobileAnalyticsRouter(options?: {
  resolveUser?: (req: Request) => Promise<{ userId: string } | null>;
  trackEvent?: (args: {
    distinctId: string;
    event: MobileAnalyticsEventName;
    properties?: MobileAnalyticsProperties;
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
  const trackEvent = options?.trackEvent ?? trackMobileEvent;

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/analytics",
      summary: "Capture a mobile analytics event through the HTTP boundary",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MobileAnalyticsCaptureRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        202: {
          description: "Analytics event accepted",
          content: {
            "application/json": {
              schema: MobileAcceptedResponseSchema,
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
      await trackEvent({
        distinctId: user.userId,
        event: body.event,
        properties: {
          ...body.properties,
          userId: user.userId,
        },
      });

      return c.json({ accepted: true }, 202);
    },
  );

  return router;
}

export const mobileAnalyticsRouter = createMobileAnalyticsRouter();
