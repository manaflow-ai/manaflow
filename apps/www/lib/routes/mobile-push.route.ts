import { internal } from "@cmux/convex/api";
import {
  MobileOkResponseSchema,
  MobilePushRegisterRequestSchema,
  MobilePushRemoveRequestSchema,
  MobilePushTestRequestSchema,
  MobilePushTestResponseSchema,
} from "@cmux/shared/mobile-contracts";
import { ConvexHttpClient } from "convex/browser";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";

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

export function createMobilePushRouter(options?: {
  resolveUser?: (req: Request) => Promise<{ userId: string } | null>;
  upsertPushToken?: (args: {
    userId: string;
    token: string;
    environment: "development" | "production";
    platform: string;
    bundleId: string;
    deviceId?: string;
  }) => Promise<void>;
  removePushToken?: (args: {
    userId: string;
    token: string;
  }) => Promise<void>;
  sendTestPush?: (args: {
    userId: string;
    title: string;
    body: string;
  }) => Promise<{ scheduledCount: number } | void>;
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
  const upsertPushToken =
    options?.upsertPushToken ??
    (async ({
      userId,
      token,
      environment,
      platform,
      bundleId,
      deviceId,
    }: {
      userId: string;
      token: string;
      environment: "development" | "production";
      platform: string;
      bundleId: string;
      deviceId?: string;
    }) => {
      const convex = getAdminConvexClient();
      await convex.mutation(internal.pushTokens.upsertForUserInternal, {
        userId,
        token,
        environment,
        platform,
        bundleId,
        deviceId,
      });
    });
  const removePushToken =
    options?.removePushToken ??
    (async ({ userId, token }: { userId: string; token: string }) => {
      const convex = getAdminConvexClient();
      await convex.mutation(internal.pushTokens.removeForUserInternal, {
        userId,
        token,
      });
    });
  const sendTestPush =
    options?.sendTestPush ??
    (async ({
      userId,
      title,
      body,
    }: {
      userId: string;
      title: string;
      body: string;
    }) => {
      const convex = getAdminConvexClient();
      return (await convex.mutation(internal.pushTokens.sendTestForUserInternal, {
        userId,
        title,
        body,
      })) as { scheduledCount: number };
    });

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/push/register",
      summary: "Register an APNS token through the mobile HTTP boundary",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MobilePushRegisterRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Push token registered",
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
      await upsertPushToken({
        userId: user.userId,
        token: body.token,
        environment: body.environment,
        platform: body.platform,
        bundleId: body.bundleId,
        deviceId: body.deviceId,
      });

      return c.json({ ok: true }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/push/remove",
      summary: "Remove an APNS token through the mobile HTTP boundary",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MobilePushRemoveRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Push token removed",
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
      await removePushToken({
        userId: user.userId,
        token: body.token,
      });

      return c.json({ ok: true }, 200);
    },
  );

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/push/test",
      summary: "Send a test push through the mobile HTTP boundary",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: MobilePushTestRequestSchema,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Test push scheduled",
          content: {
            "application/json": {
              schema: MobilePushTestResponseSchema,
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
      const result = await sendTestPush({
        userId: user.userId,
        title: body.title,
        body: body.body,
      });

      return c.json(result ?? { scheduledCount: 0 }, 200);
    },
  );

  return router;
}

export const mobilePushRouter = createMobilePushRouter();
