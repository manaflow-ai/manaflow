import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const PushRegisterBody = z
  .object({
    token: z.string(),
    environment: z.enum(["development", "production"]),
    platform: z.string(),
    bundleId: z.string(),
    deviceId: z.string().optional(),
  })
  .openapi("MobilePushRegisterBody");

const PushRemoveBody = z
  .object({
    token: z.string(),
  })
  .openapi("MobilePushRemoveBody");

const PushTestBody = z
  .object({
    title: z.string(),
    body: z.string(),
  })
  .openapi("MobilePushTestBody");

const OKResponse = z
  .object({
    ok: z.boolean(),
  })
  .openapi("MobilePushOKResponse");

const PushTestResponse = z
  .object({
    scheduledCount: z.number(),
  })
  .openapi("MobilePushTestResponse");

export function createMobilePushRouter(options?: {
  resolveAccessToken?: (req: Request) => Promise<string | null>;
  registerToken?: (args: {
    accessToken: string;
    token: string;
    environment: "development" | "production";
    platform: string;
    bundleId: string;
    deviceId?: string;
  }) => Promise<void>;
  removeToken?: (args: {
    accessToken: string;
    token: string;
  }) => Promise<void>;
  sendTestPush?: (args: {
    accessToken: string;
    title: string;
    body: string;
  }) => Promise<number>;
}) {
  const router = new OpenAPIHono();

  const resolveAccessToken =
    options?.resolveAccessToken ??
    (async (req: Request) => {
      const { getAccessTokenFromRequest } = await import("@/lib/utils/auth");
      return getAccessTokenFromRequest(req);
    });
  const registerToken =
    options?.registerToken ??
    (async (args: {
      token: string;
      environment: string;
      platform: string;
      bundleId: string;
      deviceId?: string;
    }) => {
      console.log("mobile-push: register token", {
        environment: args.environment,
        platform: args.platform,
        bundleId: args.bundleId,
        deviceId: args.deviceId,
        tokenPrefix: args.token.slice(0, 8),
      });
    });
  const removeToken =
    options?.removeToken ??
    (async (args: { token: string }) => {
      console.log("mobile-push: remove token", {
        tokenPrefix: args.token.slice(0, 8),
      });
    });
  const sendTestPush =
    options?.sendTestPush ??
    (async (args: { title: string; body: string }) => {
      console.log("mobile-push: test push requested", {
        title: args.title,
        body: args.body,
      });
      return 0;
    });

  // POST /mobile/push/register
  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/push/register",
      summary: "Register a push notification token",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: PushRegisterBody,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Token registered",
          content: {
            "application/json": {
              schema: OKResponse,
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
      await registerToken({
        accessToken,
        token: body.token,
        environment: body.environment,
        platform: body.platform,
        bundleId: body.bundleId,
        deviceId: body.deviceId,
      });

      return c.json({ ok: true });
    },
  );

  // POST /mobile/push/remove
  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/push/remove",
      summary: "Remove a push notification token",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: PushRemoveBody,
            },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "Token removed",
          content: {
            "application/json": {
              schema: OKResponse,
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
      await removeToken({
        accessToken,
        token: body.token,
      });

      return c.json({ ok: true });
    },
  );

  // POST /mobile/push/test
  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/push/test",
      summary: "Send a test push notification",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: PushTestBody,
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
              schema: PushTestResponse,
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
      const scheduledCount = await sendTestPush({
        accessToken,
        title: body.title,
        body: body.body,
      });

      return c.json({ scheduledCount });
    },
  );

  return router;
}

export const mobilePushRouter = createMobilePushRouter();
