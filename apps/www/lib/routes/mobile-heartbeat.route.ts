import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { verifyMachineSessionToken } from "./mobile-machine-session.route";

const HeartbeatWorkspace = z.object({
  workspaceId: z.string(),
  taskId: z.string().optional(),
  taskRunId: z.string().optional(),
  title: z.string(),
  preview: z.string().optional(),
  phase: z.string(),
  tmuxSessionName: z.string(),
  lastActivityAt: z.number(),
  latestEventSeq: z.number(),
  lastEventAt: z.number().optional(),
});

const HeartbeatBody = z
  .object({
    machineId: z.string(),
    displayName: z.string(),
    tailscaleHostname: z.string().optional(),
    tailscaleIPs: z.array(z.string()),
    status: z.enum(["online", "offline", "unknown"]),
    lastSeenAt: z.number().optional(),
    lastWorkspaceSyncAt: z.number().optional(),
    workspaces: z.array(HeartbeatWorkspace),
  })
  .openapi("MobileHeartbeatBody");

function getConvexHeartbeatConfig() {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  const jwtSecret = process.env.MOBILE_MACHINE_JWT_SECRET;

  if (!convexUrl || !deployKey || !jwtSecret) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL, CONVEX_DEPLOY_KEY, and MOBILE_MACHINE_JWT_SECRET are required",
    );
  }

  return { convexUrl, deployKey, jwtSecret };
}

export async function publishMobileHeartbeatToConvex(args: {
  teamId: string;
  userId: string;
  machineId: string;
  displayName: string;
  tailscaleHostname?: string;
  tailscaleIPs: string[];
  status: "online" | "offline" | "unknown";
  lastSeenAt: number;
  lastWorkspaceSyncAt?: number;
  workspaces: Array<z.infer<typeof HeartbeatWorkspace>>;
}) {
  const { convexUrl, deployKey } = getConvexHeartbeatConfig();
  const endpoint = convexUrl.replace(
    ".convex.cloud",
    ".convex.site",
  ).replace(/\/$/, "");
  const response = await fetch(`${endpoint}/api/mobile/heartbeat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deployKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    throw new Error(`Convex heartbeat publish failed: ${response.status}`);
  }
}

export function createMobileHeartbeatRouter(options?: {
  verifyToken?: (token: string) => Promise<{
    teamId: string;
    userId: string;
    machineId: string;
  }>;
  publishHeartbeat?: (
    args: Parameters<typeof publishMobileHeartbeatToConvex>[0],
  ) => Promise<void>;
  now?: () => number;
}) {
  const router = new OpenAPIHono();
  const verifyToken =
    options?.verifyToken ??
    (async (token: string) =>
      await verifyMachineSessionToken(
        token,
        getConvexHeartbeatConfig().jwtSecret,
      ));
  const publishHeartbeat =
    options?.publishHeartbeat ?? publishMobileHeartbeatToConvex;
  const now = options?.now ?? (() => Date.now());

  router.openapi(
    createRoute({
      method: "post",
      path: "/mobile/heartbeat",
      summary: "Accept a machine heartbeat snapshot",
      tags: ["Mobile"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: HeartbeatBody,
            },
          },
          required: true,
        },
      },
      responses: {
        202: { description: "Heartbeat accepted" },
        401: { description: "Unauthorized" },
      },
    }),
    async (c) => {
      const authHeader = c.req.raw.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return c.text("Unauthorized", 401);
      }

      const claims = await verifyToken(authHeader.slice(7));
      const body = c.req.valid("json");
      if (claims.machineId !== body.machineId) {
        return c.text("Unauthorized", 401);
      }

      await publishHeartbeat({
        teamId: claims.teamId,
        userId: claims.userId,
        machineId: body.machineId,
        displayName: body.displayName,
        tailscaleHostname: body.tailscaleHostname,
        tailscaleIPs: body.tailscaleIPs,
        status: body.status,
        lastSeenAt: body.lastSeenAt ?? now(),
        lastWorkspaceSyncAt: body.lastWorkspaceSyncAt ?? now(),
        workspaces: body.workspaces,
      });

      return c.json({ accepted: true }, 202);
    },
  );

  return router;
}

export const mobileHeartbeatRouter = createMobileHeartbeatRouter();
