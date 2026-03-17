import { getAccessTokenFromRequest } from "@/lib/utils/auth";
import { getConvex } from "@/lib/utils/get-convex";
import { verifyTeamAccess } from "@/lib/utils/team-verification";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

export const editorSettingsRouter = new OpenAPIHono();

const SnippetSchema = z.object({
  name: z.string(),
  content: z.string(),
});

const EditorSettingsResponse = z
  .object({
    settingsJson: z.string().optional(),
    keybindingsJson: z.string().optional(),
    snippets: z.array(SnippetSchema).optional(),
    extensions: z.string().optional(),
    updatedAt: z.number().optional(),
  })
  .openapi("EditorSettingsResponse");

const EditorSettingsQuery = z
  .object({
    teamSlugOrId: z.string(),
  })
  .openapi("EditorSettingsQuery");

const EditorSettingsBody = z
  .object({
    teamSlugOrId: z.string(),
    settingsJson: z.string().optional(),
    keybindingsJson: z.string().optional(),
    snippets: z.array(SnippetSchema).optional(),
    extensions: z.string().optional(),
  })
  .openapi("EditorSettingsBody");

// GET /editor-settings - Get user's editor settings
editorSettingsRouter.openapi(
  createRoute({
    method: "get",
    path: "/editor-settings",
    summary: "Get user's editor settings",
    tags: ["EditorSettings"],
    request: {
      query: EditorSettingsQuery,
    },
    responses: {
      200: {
        description: "Editor settings retrieved",
        content: {
          "application/json": {
            schema: EditorSettingsResponse.nullable(),
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
    const settings = await convex.query(api.userEditorSettings.get, {
      teamSlugOrId: query.teamSlugOrId,
    });

    if (!settings) {
      return c.json(null);
    }

    return c.json({
      settingsJson: settings.settingsJson ?? undefined,
      keybindingsJson: settings.keybindingsJson ?? undefined,
      snippets: settings.snippets ?? undefined,
      extensions: settings.extensions ?? undefined,
      updatedAt: settings.updatedAt,
    });
  }
);

// POST /editor-settings - Create or update editor settings
editorSettingsRouter.openapi(
  createRoute({
    method: "post",
    path: "/editor-settings",
    summary: "Create or update user's editor settings",
    tags: ["EditorSettings"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: EditorSettingsBody,
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description: "Editor settings saved",
        content: {
          "application/json": {
            schema: EditorSettingsResponse,
          },
        },
      },
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
    await convex.mutation(api.userEditorSettings.upsert, {
      teamSlugOrId: body.teamSlugOrId,
      settingsJson: body.settingsJson,
      keybindingsJson: body.keybindingsJson,
      snippets: body.snippets,
      extensions: body.extensions,
    });

    return c.json({
      settingsJson: body.settingsJson,
      keybindingsJson: body.keybindingsJson,
      snippets: body.snippets,
      extensions: body.extensions,
      updatedAt: Date.now(),
    });
  }
);

// DELETE /editor-settings - Clear editor settings
editorSettingsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/editor-settings",
    summary: "Clear user's editor settings",
    tags: ["EditorSettings"],
    request: {
      query: EditorSettingsQuery,
    },
    responses: {
      204: { description: "Editor settings cleared" },
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
    await convex.mutation(api.userEditorSettings.clear, {
      teamSlugOrId: query.teamSlugOrId,
    });

    return c.body(null, 204);
  }
);
