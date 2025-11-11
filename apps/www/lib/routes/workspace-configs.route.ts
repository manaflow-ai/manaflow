import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerAppJs } from "@/lib/utils/stack";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { env } from "@/lib/utils/www-env";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { randomBytes } from "node:crypto";

export const workspaceConfigsRouter = new OpenAPIHono();

const WorkspaceConfigResponse = z
  .object({
    projectFullName: z.string(),
    maintenanceScript: z.string().optional(),
    envVarsContent: z.string(),
    envVarsLoadError: z.boolean().default(false),
    hasEnvVars: z.boolean().default(false),
    updatedAt: z.number().optional(),
  })
  .openapi("WorkspaceConfigResponse");

const WorkspaceConfigQuery = z
  .object({
    teamSlugOrId: z.string(),
    projectFullName: z.string(),
  })
  .openapi("WorkspaceConfigQuery");

const WorkspaceConfigBody = z
  .object({
    teamSlugOrId: z.string(),
    projectFullName: z.string(),
    maintenanceScript: z.string().optional(),
    envVarsContent: z.string().optional(),
  })
  .openapi("WorkspaceConfigBody");

type EnvVarsLoadResult = {
  content: string;
  loadError: boolean;
};

async function loadEnvVarsContent(
  dataVaultKey: string | undefined,
): Promise<EnvVarsLoadResult> {
  if (!dataVaultKey) {
    return { content: "", loadError: false };
  }
  try {
    const store = await stackServerAppJs.getDataVaultStore(
      "cmux-snapshot-envs",
    );
    const value = await store.getValue(dataVaultKey, {
      secret: env.STACK_DATA_VAULT_SECRET,
    });
    return { content: value ?? "", loadError: false };
  } catch (error) {
    console.error(
      "[workspace-configs] Failed to load env vars from Stack",
      error,
    );
    return { content: "", loadError: true };
  }
}

workspaceConfigsRouter.openapi(
  createRoute({
    method: "get",
    path: "/workspace-configs",
    summary: "Get workspace configuration",
    tags: ["WorkspaceConfigs"],
    request: {
      query: WorkspaceConfigQuery,
    },
    responses: {
      200: {
        description: "Configuration retrieved",
        content: {
          "application/json": {
            schema: WorkspaceConfigResponse.nullable(),
          },
        },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const query = c.req.valid("query");

    await verifyTeamAccess({
      req: c.req.raw,
      teamSlugOrId: query.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    const config = await convex.query(api.workspaceConfigs.get, {
      teamSlugOrId: query.teamSlugOrId,
      projectFullName: query.projectFullName,
    });

    if (!config) {
      return c.json(null);
    }

    const { content: envVarsContent, loadError: envVarsLoadError } =
      await loadEnvVarsContent(config.dataVaultKey);

    return c.json({
      projectFullName: config.projectFullName,
      maintenanceScript: config.maintenanceScript ?? undefined,
      envVarsContent,
      envVarsLoadError,
      hasEnvVars: Boolean(config.dataVaultKey),
      updatedAt: config.updatedAt,
    });
  },
);

workspaceConfigsRouter.openapi(
  createRoute({
    method: "post",
    path: "/workspace-configs",
    summary: "Create or update workspace configuration",
    tags: ["WorkspaceConfigs"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: WorkspaceConfigBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Configuration saved",
        content: {
          "application/json": {
            schema: WorkspaceConfigResponse,
          },
        },
      },
      400: { description: "Invalid request" },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const body = c.req.valid("json");

    await verifyTeamAccess({
      req: c.req.raw,
      teamSlugOrId: body.teamSlugOrId,
    });

    const convex = getConvex({ accessToken });
    const existing = await convex.query(api.workspaceConfigs.get, {
      teamSlugOrId: body.teamSlugOrId,
      projectFullName: body.projectFullName,
    });

    const store = await stackServerAppJs.getDataVaultStore(
      "cmux-snapshot-envs",
    );
    let dataVaultKey = existing?.dataVaultKey;
    const hasEnvVarsUpdate = typeof body.envVarsContent === "string";
    let envVarsContentResponse = "";
    let envVarsLoadErrorResponse = false;

    if (hasEnvVarsUpdate) {
      const envVarsContent = body.envVarsContent ?? "";
      envVarsContentResponse = envVarsContent;
      if (!dataVaultKey) {
        dataVaultKey = `workspace_${randomBytes(16).toString("hex")}`;
      }

      try {
        await store.setValue(dataVaultKey, envVarsContent, {
          secret: env.STACK_DATA_VAULT_SECRET,
        });
      } catch (error) {
        throw new HTTPException(500, {
          message: "Failed to persist environment variables",
          cause: error,
        });
      }
    } else if (existing?.dataVaultKey) {
      envVarsLoadErrorResponse = true;
    }

    await convex.mutation(api.workspaceConfigs.upsert, {
      teamSlugOrId: body.teamSlugOrId,
      projectFullName: body.projectFullName,
      maintenanceScript: body.maintenanceScript,
      dataVaultKey,
    });

    return c.json({
      projectFullName: body.projectFullName,
      maintenanceScript: body.maintenanceScript,
      envVarsContent: envVarsContentResponse,
      envVarsLoadError: envVarsLoadErrorResponse,
      hasEnvVars:
        hasEnvVarsUpdate
          ? Boolean(envVarsContentResponse?.trim().length)
          : Boolean(existing?.dataVaultKey),
      updatedAt: Date.now(),
    });
  },
);
