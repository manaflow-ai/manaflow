/**
 * GitHub Projects v2 API routes
 *
 * Provides endpoints for listing and managing GitHub Projects for roadmap/planning.
 *
 * IMPORTANT: GitHub Apps CANNOT access user-owned Projects v2 (platform limitation).
 * For user-owned projects, we must use the user's OAuth token with "project" scope.
 * Organization projects can use either GitHub App or OAuth token.
 *
 * @see https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAccessTokenFromRequest, getUserFromRequest } from "@/lib/utils/auth";
import { api } from "@cmux/convex/api";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { getConvex } from "../utils/get-convex";
import {
  listProjects,
  getProjectFields,
  getProjectItems,
  addItemToProject,
  createDraftIssue,
  updateItemField,
  mapCmuxStatusToProjectStatus,
} from "../utils/github-projects";

export const githubProjectsRouter = new OpenAPIHono();
const execFileAsync = promisify(execFile);

const GITHUB_PROJECT_SCOPES = ["project"] as const;

async function getGitHubUserOAuthToken(
  req: Request,
  options?: { scopes?: string[] },
): Promise<string | undefined> {
  const user = await getUserFromRequest(req);
  if (!user) return undefined;

  try {
    const githubAccount = await user.getConnectedAccount("github", {
      or: "return-null",
      scopes: options?.scopes,
    });
    if (!githubAccount) return undefined;

    const tokenResult = await githubAccount.getAccessToken();
    const token = tokenResult.accessToken?.trim();
    return token || undefined;
  } catch (err) {
    console.error(
      "[github.projects] Failed to get user OAuth token:",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

function isGhCliFallbackEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

function getGhCliEnv(): NodeJS.ProcessEnv {
  const ghEnv = { ...process.env };
  delete ghEnv.GH_TOKEN;
  delete ghEnv.GITHUB_TOKEN;
  delete ghEnv.GH_ENTERPRISE_TOKEN;
  delete ghEnv.GITHUB_ENTERPRISE_TOKEN;
  return ghEnv;
}

async function runGhGraphql(
  query: string,
  variables: Record<string, string | number | boolean | undefined>,
): Promise<Record<string, unknown>> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined) continue;
    args.push("-F", `${key}=${String(value)}`);
  }

  const { stdout } = await execFileAsync("gh", args, {
    env: getGhCliEnv(),
  });

  const parsed = JSON.parse(stdout) as {
    data?: Record<string, unknown>;
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const msg = parsed.errors
      .map((err) => err.message)
      .filter(Boolean)
      .join("; ");
    throw new Error(msg || "gh graphql returned errors");
  }

  return parsed.data ?? {};
}

async function listProjectsViaGhCli(
  owner: string,
  ownerType: "user" | "organization",
  first = 20,
): Promise<
  Array<{
    id: string;
    title: string;
    number: number;
    url: string;
    shortDescription: string | null;
    closed: boolean;
    createdAt: string;
    updatedAt: string;
  }>
> {
  if (!isGhCliFallbackEnabled()) return [];

  const ownerNode = ownerType === "organization" ? "organization" : "user";
  const query = `query($login:String!,$first:Int!){${ownerNode}(login:$login){projectsV2(first:$first){nodes{id title number url shortDescription closed createdAt updatedAt}}}}`;

  try {
    const data = await runGhGraphql(query, {
      login: owner,
      first,
    });

    const parsed = data as {
      user?: { projectsV2?: { nodes?: Array<Record<string, unknown> | null> } };
      organization?: { projectsV2?: { nodes?: Array<Record<string, unknown> | null> } };
    };

    const nodes =
      ownerType === "organization"
        ? parsed.organization?.projectsV2?.nodes
        : parsed.user?.projectsV2?.nodes;

    if (!Array.isArray(nodes)) return [];

    return nodes
      .filter((node): node is Record<string, unknown> => Boolean(node))
      .map((node) => ({
        id: String(node.id ?? ""),
        title: String(node.title ?? ""),
        number: Number(node.number ?? 0),
        url: String(node.url ?? ""),
        shortDescription:
          typeof node.shortDescription === "string"
            ? node.shortDescription
            : null,
        closed: Boolean(node.closed),
        createdAt: String(node.createdAt ?? ""),
        updatedAt: String(node.updatedAt ?? ""),
      }))
      .filter((node) => node.id && node.title && node.url);
  } catch (err) {
    console.warn(
      "[github.projects] gh CLI fallback failed:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function getProjectFieldsViaGhCli(
  projectId: string,
): Promise<Array<{ id: string; name: string; dataType: string; options?: Array<{ id: string; name: string }> }>> {
  if (!isGhCliFallbackEnabled()) return [];

  const query = `query($projectId:ID!){node(id:$projectId){... on ProjectV2{fields(first:50){nodes{... on ProjectV2Field{id name dataType} ... on ProjectV2SingleSelectField{id name dataType options{id name}} ... on ProjectV2IterationField{id name dataType}}}}}}`;

  try {
    const data = await runGhGraphql(query, { projectId });
    const node = data.node as
      | { fields?: { nodes?: Array<Record<string, unknown> | null> } }
      | undefined;
    const nodes = node?.fields?.nodes;
    if (!Array.isArray(nodes)) return [];

    return nodes
      .filter((field): field is Record<string, unknown> => Boolean(field))
      .map((field) => ({
        id: String(field.id ?? ""),
        name: String(field.name ?? ""),
        dataType: String(field.dataType ?? ""),
        options: Array.isArray(field.options)
          ? field.options
              .filter(
                (opt): opt is Record<string, unknown> => Boolean(opt),
              )
              .map((opt) => ({
                id: String(opt.id ?? ""),
                name: String(opt.name ?? ""),
              }))
              .filter((opt) => opt.id && opt.name)
          : undefined,
      }))
      .filter((field) => field.id && field.name && field.dataType);
  } catch (err) {
    console.warn(
      `[github.projects] gh CLI fields fallback failed for ${projectId}:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

async function getProjectItemsViaGhCli(
  projectId: string,
  first = 50,
  after?: string,
): Promise<{
  items: Array<{
    id: string;
    contentType: string;
    title: string;
    status: string | null;
    url: string | null;
    fieldValues: Record<string, string | number | null>;
  }>;
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  if (!isGhCliFallbackEnabled()) return { items: [], hasNextPage: false, endCursor: null };

  const query = `query($projectId:ID!,$first:Int!,$after:String){node(id:$projectId){... on ProjectV2{items(first:$first,after:$after){nodes{id content{... on Issue{id title number state url} ... on PullRequest{id title number state url} ... on DraftIssue{id title body}} fieldValues(first:20){nodes{... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2Field{name}}} ... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2Field{name}}} ... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2Field{name}}} ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2SingleSelectField{name}}} ... on ProjectV2ItemFieldIterationValue{title field{... on ProjectV2IterationField{name}}}}}} pageInfo{hasNextPage endCursor}}}}}`;

  try {
    const data = await runGhGraphql(query, { projectId, first, after });
    const node = data.node as
      | {
          items?: {
            nodes?: Array<Record<string, unknown> | null>;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          };
        }
      | undefined;
    const rawNodes = node?.items?.nodes;
    const pageInfo = node?.items?.pageInfo;
    if (!Array.isArray(rawNodes)) return { items: [], hasNextPage: false, endCursor: null };

    const items = rawNodes
      .filter((n): n is Record<string, unknown> => Boolean(n))
      .map((n) => {
        const content = n.content as Record<string, unknown> | null;
        const fieldValuesObj = n.fieldValues as { nodes?: Array<Record<string, unknown> | null> } | undefined;

        // Determine content type
        let contentType = "DraftIssue";
        if (content) {
          if ("state" in content && "url" in content) {
            const urlStr = String(content.url ?? "");
            contentType = urlStr.includes("/pull/") ? "PullRequest" : "Issue";
          }
        }

        // Flatten field values
        const fieldValues: Record<string, string | number | null> = {};
        for (const fv of fieldValuesObj?.nodes ?? []) {
          if (!fv) continue;
          const field = fv.field as { name?: string } | undefined;
          const fieldName = field?.name;
          if (!fieldName) continue;
          if (typeof fv.text === "string") fieldValues[fieldName] = fv.text;
          else if (typeof fv.number === "number") fieldValues[fieldName] = fv.number;
          else if (typeof fv.date === "string") fieldValues[fieldName] = fv.date;
          else if (typeof fv.name === "string") fieldValues[fieldName] = fv.name;
          else if (typeof fv.title === "string") fieldValues[fieldName] = fv.title;
        }

        return {
          id: String(n.id ?? ""),
          contentType,
          title: content ? String((content.title as string) ?? "") : "",
          status: typeof fieldValues.Status === "string" ? fieldValues.Status : null,
          url: content && typeof content.url === "string" ? content.url : null,
          fieldValues,
        };
      })
      .filter((item) => item.id && item.title);

    return {
      items,
      hasNextPage: pageInfo?.hasNextPage ?? false,
      endCursor: pageInfo?.endCursor ?? null,
    };
  } catch (err) {
    console.warn(
      `[github.projects] gh CLI items fallback failed for ${projectId}:`,
      err instanceof Error ? err.message : err,
    );
    return { items: [], hasNextPage: false, endCursor: null };
  }
}

async function createDraftIssueViaGhCli(
  projectId: string,
  title: string,
  body?: string,
): Promise<string | null> {
  if (!isGhCliFallbackEnabled()) return null;

  const mutation = `mutation($projectId:ID!,$title:String!,$body:String){addProjectV2DraftIssue(input:{projectId:$projectId,title:$title,body:$body}){projectItem{id}}}`;

  try {
    const data = await runGhGraphql(mutation, {
      projectId,
      title,
      body,
    });
    const payload = data.addProjectV2DraftIssue as
      | { projectItem?: { id?: string } | null }
      | undefined;
    return payload?.projectItem?.id ?? null;
  } catch (err) {
    console.warn(
      `[github.projects] gh CLI draft fallback failed for ${projectId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// Schemas

const ListProjectsQuery = z
  .object({
    team: z.string().min(1).openapi({ description: "Team slug or UUID" }),
    installationId: z.coerce
      .number()
      .openapi({ description: "GitHub App installation ID" }),
    owner: z
      .string()
      .min(1)
      .optional()
      .openapi({ description: "GitHub user or org login (optional, inferred from installation if omitted)" }),
    ownerType: z
      .enum(["user", "organization"])
      .optional()
      .openapi({ description: "Owner type" }),
  })
  .openapi("ListProjectsQuery");

const ProjectSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    number: z.number(),
    url: z.string(),
    shortDescription: z.string().nullable(),
    closed: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("GitHubProject");

const ProjectsResponse = z
  .object({
    projects: z.array(ProjectSchema),
    needsReauthorization: z.boolean().optional().openapi({
      description:
        "True if user needs to re-authorize GitHub with 'project' scope to see all projects",
    }),
  })
  .openapi("ProjectsResponse");

const ProjectFieldSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    dataType: z.string(),
    options: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  })
  .openapi("ProjectField");

const ProjectFieldsResponse = z
  .object({
    fields: z.array(ProjectFieldSchema),
  })
  .openapi("ProjectFieldsResponse");

const AddItemBody = z
  .object({
    projectId: z.string().openapi({ description: "GitHub Project node ID" }),
    contentId: z
      .string()
      .openapi({ description: "Issue or PR node ID to add" }),
  })
  .openapi("AddItemBody");

const CreateDraftBody = z
  .object({
    projectId: z.string().openapi({ description: "GitHub Project node ID" }),
    title: z.string().min(1).openapi({ description: "Draft issue title" }),
    body: z.string().optional().openapi({ description: "Draft issue body" }),
  })
  .openapi("CreateDraftBody");

const BatchDraftItemSchema = z
  .object({
    title: z.string().min(1).openapi({ description: "Draft issue title" }),
    body: z.string().optional().openapi({ description: "Draft issue body" }),
  })
  .openapi("BatchDraftItem");

const CreateDraftBatchBody = z
  .object({
    projectId: z.string().openapi({ description: "GitHub Project node ID" }),
    items: z.array(BatchDraftItemSchema).min(1).max(50),
  })
  .openapi("CreateDraftBatchBody");

const UpdateFieldBody = z
  .object({
    projectId: z.string().openapi({ description: "GitHub Project node ID" }),
    itemId: z.string().openapi({ description: "Project item node ID" }),
    fieldId: z.string().openapi({ description: "Field node ID" }),
    value: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .openapi({ description: "Field value (format depends on field type)" }),
  })
  .openapi("UpdateFieldBody");

const ItemResponse = z
  .object({
    itemId: z.string().nullable(),
  })
  .openapi("ItemResponse");

const DraftBatchResultSchema = z
  .object({
    title: z.string(),
    itemId: z.string().nullable(),
    error: z.string().optional(),
  })
  .openapi("DraftBatchResult");

const DraftBatchResponse = z
  .object({
    results: z.array(DraftBatchResultSchema),
  })
  .openapi("DraftBatchResponse");

const ProjectItemContentSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    number: z.number().optional(),
    state: z.string().optional(),
    url: z.string().optional(),
    body: z.string().optional(),
  })
  .nullable()
  .openapi("ProjectItemContent");

const ProjectItemFieldValueSchema = z
  .record(z.string(), z.union([z.string(), z.number()]).nullable())
  .openapi("ProjectItemFieldValues");

const ProjectItemSchema = z
  .object({
    id: z.string(),
    content: ProjectItemContentSchema,
    fieldValues: ProjectItemFieldValueSchema,
  })
  .openapi("ProjectItem");

const ProjectItemsQuery = z
  .object({
    team: z.string().min(1).openapi({ description: "Team slug or UUID" }),
    installationId: z.coerce.number().openapi({ description: "GitHub App installation ID" }),
    projectId: z.string().min(1).openapi({ description: "GitHub Project node ID" }),
    first: z.coerce.number().optional().default(50).openapi({ description: "Number of items to fetch" }),
    after: z.string().optional().openapi({ description: "Pagination cursor" }),
    status: z.string().optional().openapi({ description: "Filter by Status field value (e.g., 'Backlog', 'In Progress')" }),
    noLinkedTask: z.coerce.boolean().optional().openapi({ description: "Only return items without a linked task" }),
  })
  .openapi("ProjectItemsQuery");

const ProjectItemsResponse = z
  .object({
    items: z.array(ProjectItemSchema),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  })
  .openapi("ProjectItemsResponse");

// Routes

// GET /integrations/github/projects - List projects
githubProjectsRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/projects",
    tags: ["Integrations"],
    summary: "List GitHub Projects for a user or organization",
    request: { query: ListProjectsQuery },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ProjectsResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId, owner: ownerInput, ownerType: ownerTypeInput } =
      c.req.valid("query");

    // Verify team membership via Convex
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.json({ projects: [] });
    }

    const owner = ownerInput ?? target.accountLogin ?? undefined;
    if (!owner) {
      console.warn(
        `[github.projects] No owner could be determined for installation ${installationId}`,
      );
      return c.json({ projects: [] });
    }

    const ownerType =
      ownerTypeInput ??
      (target.accountType === "Organization" ? "organization" : "user");

    // For user-owned projects, we need the user's OAuth token with "project" scope.
    // GitHub Apps cannot access user-owned Projects v2 (platform limitation).
    let userOAuthToken: string | undefined;
    let needsReauthorization = false;

    try {
      if (ownerType === "user") {
        userOAuthToken = await getGitHubUserOAuthToken(c.req.raw, {
          scopes: [...GITHUB_PROJECT_SCOPES],
        });
        if (!userOAuthToken) {
          const fallbackProjects = await listProjectsViaGhCli(owner, ownerType);
          if (fallbackProjects.length > 0) {
            return c.json({
              projects: fallbackProjects,
              needsReauthorization: false,
            });
          }
          return c.json({
            projects: [],
            needsReauthorization: true,
          });
        }
      }

      const projects = await listProjects(owner, ownerType, installationId, {
        userOAuthToken,
      });
      return c.json({
        projects,
        needsReauthorization,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If user projects fail with "Resource not accessible", the OAuth token
      // is missing the 'project' scope. Stack Auth's getConnectedAccount with
      // scopes doesn't actually validate them in v2.8.x.
      if (ownerType === "user" && errMsg.includes("Resource not accessible")) {
        const fallbackProjects = await listProjectsViaGhCli(owner, ownerType);
        if (fallbackProjects.length > 0) {
          console.warn(
            `[github.projects] Primary user-project API failed for ${owner}, served via gh CLI fallback`,
          );
          return c.json({
            projects: fallbackProjects,
            needsReauthorization: false,
          });
        }
        needsReauthorization = true;
      }
      console.error(
        `[github.projects] Failed to list projects for ${owner}:`,
        errMsg,
      );
      return c.json({
        projects: [],
        needsReauthorization,
      });
    }
  },
);

// POST /integrations/github/projects/drafts/batch - Create many draft issues
githubProjectsRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/integrations/github/projects/drafts/batch",
    tags: ["Integrations"],
    summary: "Create multiple draft issues in a GitHub Project",
    request: {
      query: z.object({
        team: z.string().min(1),
        installationId: z.coerce.number(),
      }),
      body: {
        content: { "application/json": { schema: CreateDraftBatchBody } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: DraftBatchResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId } = c.req.valid("query");
    const { projectId, items } = c.req.valid("json");

    // Verify team membership
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.text("Installation not found", 400);
    }

    const userOAuthToken =
      target.accountType === "User"
        ? await getGitHubUserOAuthToken(c.req.raw, {
            scopes: [...GITHUB_PROJECT_SCOPES],
          })
        : undefined;

    const results: Array<{
      title: string;
      itemId: string | null;
      error?: string;
    }> = [];

    for (const item of items) {
      let itemId: string | null = null;
      let errorMessage: string | undefined;

      try {
        if (target.accountType !== "User" || userOAuthToken) {
          itemId = await createDraftIssue(
            projectId,
            item.title,
            item.body,
            installationId,
            { userOAuthToken },
          );
        }
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }

      // Local dev fallback: if user-project API path fails, use gh CLI token.
      if (!itemId && target.accountType === "User") {
        itemId = await createDraftIssueViaGhCli(
          projectId,
          item.title,
          item.body,
        );
        if (!itemId && !errorMessage && !userOAuthToken) {
          errorMessage =
            "GitHub OAuth token is missing the required 'project' scope. Re-authorize GitHub and retry.";
        }
      }

      if (itemId) {
        results.push({ title: item.title, itemId });
      } else {
        if (errorMessage) {
          console.error(
            `[github.projects] Failed to create draft issue in batch (${item.title}):`,
            errorMessage,
          );
        }
        results.push({
          title: item.title,
          itemId: null,
          error: errorMessage ?? "Failed to create draft issue",
        });
      }
    }

    return c.json({ results });
  },
);

// GET /integrations/github/projects/fields - Get project fields
githubProjectsRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/projects/fields",
    tags: ["Integrations"],
    summary: "Get fields for a GitHub Project",
    request: {
      query: z.object({
        team: z.string().min(1),
        installationId: z.coerce.number(),
        projectId: z.string().min(1),
      }),
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ProjectFieldsResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId, projectId } = c.req.valid("query");

    // Verify team membership
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.json({ fields: [] });
    }

    try {
      const userOAuthToken =
        target.accountType === "User"
          ? await getGitHubUserOAuthToken(c.req.raw, {
              scopes: [...GITHUB_PROJECT_SCOPES],
            })
          : undefined;

      if (target.accountType === "User" && !userOAuthToken) {
        const fallbackFields = await getProjectFieldsViaGhCli(projectId);
        if (fallbackFields.length > 0) {
          return c.json({ fields: fallbackFields });
        }
        return c.json({ fields: [] });
      }

      const fields = await getProjectFields(projectId, installationId, {
        userOAuthToken,
      });
      return c.json({ fields });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (target.accountType === "User") {
        const fallbackFields = await getProjectFieldsViaGhCli(projectId);
        if (fallbackFields.length > 0) {
          console.warn(
            `[github.projects] Primary project-fields API failed for ${projectId}, served via gh CLI fallback`,
          );
          return c.json({ fields: fallbackFields });
        }
      }
      console.error(
        `[github.projects] Failed to get fields for project ${projectId}:`,
        errMsg,
      );
      return c.json({ fields: [] });
    }
  },
);

// GET /integrations/github/projects/items - List project items
githubProjectsRouter.openapi(
  createRoute({
    method: "get" as const,
    path: "/integrations/github/projects/items",
    tags: ["Integrations"],
    summary: "List items in a GitHub Project",
    request: { query: ProjectItemsQuery },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ProjectItemsResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId, projectId, first, after, status, noLinkedTask } = c.req.valid("query");

    // Verify team membership
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.json({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
    }

    // Helper to filter items by status and linked task
    const filterItems = async <T extends { id: string; fieldValues: Record<string, unknown> }>(
      items: T[],
    ): Promise<T[]> => {
      let filtered = items;

      // Filter by status if specified
      if (status) {
        filtered = filtered.filter((item) => {
          const itemStatus = item.fieldValues?.Status;
          return typeof itemStatus === "string" && itemStatus === status;
        });
      }

      // Filter out items with linked tasks if requested
      if (noLinkedTask && filtered.length > 0) {
        const itemIds = filtered.map((item) => item.id);
        const linkedTaskResults = await Promise.all(
          itemIds.map((itemId) =>
            convex.query(api.tasks.hasLinkedTask, { githubProjectItemId: itemId }),
          ),
        );
        filtered = filtered.filter((_, index) => !linkedTaskResults[index]);
      }

      return filtered;
    };

    try {
      const userOAuthToken =
        target.accountType === "User"
          ? await getGitHubUserOAuthToken(c.req.raw, {
              scopes: [...GITHUB_PROJECT_SCOPES],
            })
          : undefined;

      if (target.accountType === "User" && !userOAuthToken) {
        const fallback = await getProjectItemsViaGhCli(projectId, first, after);
        if (fallback.items.length > 0) {
          // Transform CLI fallback items to match ProjectV2Item shape
          const transformedItems = fallback.items.map((item) => ({
            id: item.id,
            content: {
              id: item.id,
              title: item.title,
              url: item.url ?? undefined,
            },
            fieldValues: item.fieldValues,
          }));
          const filteredItems = await filterItems(transformedItems);
          return c.json({
            items: filteredItems,
            pageInfo: {
              hasNextPage: fallback.hasNextPage,
              endCursor: fallback.endCursor,
            },
          });
        }
        return c.json({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
      }

      const result = await getProjectItems(projectId, installationId, {
        first,
        after,
        userOAuthToken,
      });
      const filteredItems = await filterItems(result.items);
      return c.json({
        items: filteredItems,
        pageInfo: result.pageInfo,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (target.accountType === "User") {
        const fallback = await getProjectItemsViaGhCli(projectId, first, after);
        if (fallback.items.length > 0) {
          console.warn(
            `[github.projects] Primary project-items API failed for ${projectId}, served via gh CLI fallback`,
          );
          const transformedItems = fallback.items.map((item) => ({
            id: item.id,
            content: {
              id: item.id,
              title: item.title,
              url: item.url ?? undefined,
            },
            fieldValues: item.fieldValues,
          }));
          const filteredItems = await filterItems(transformedItems);
          return c.json({
            items: filteredItems,
            pageInfo: {
              hasNextPage: fallback.hasNextPage,
              endCursor: fallback.endCursor,
            },
          });
        }
      }
      console.error(
        `[github.projects] Failed to get items for project ${projectId}:`,
        errMsg,
      );
      return c.json({ items: [], pageInfo: { hasNextPage: false, endCursor: null } });
    }
  },
);

// POST /integrations/github/projects/items - Add item to project
githubProjectsRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/integrations/github/projects/items",
    tags: ["Integrations"],
    summary: "Add an issue or PR to a GitHub Project",
    request: {
      query: z.object({
        team: z.string().min(1),
        installationId: z.coerce.number(),
      }),
      body: {
        content: { "application/json": { schema: AddItemBody } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ItemResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId } = c.req.valid("query");
    const { projectId, contentId } = c.req.valid("json");

    // Verify team membership
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.text("Installation not found", 400);
    }

    try {
      const userOAuthToken =
        target.accountType === "User"
          ? await getGitHubUserOAuthToken(c.req.raw, {
              scopes: [...GITHUB_PROJECT_SCOPES],
            })
          : undefined;

      if (target.accountType === "User" && !userOAuthToken) {
        return c.json({ itemId: null });
      }

      const itemId = await addItemToProject(
        projectId,
        contentId,
        installationId,
        { userOAuthToken },
      );
      return c.json({ itemId });
    } catch (err) {
      console.error(
        `[github.projects] Failed to add item to project:`,
        err instanceof Error ? err.message : err,
      );
      return c.json({ itemId: null });
    }
  },
);

// POST /integrations/github/projects/drafts - Create draft issue
githubProjectsRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/integrations/github/projects/drafts",
    tags: ["Integrations"],
    summary: "Create a draft issue in a GitHub Project",
    request: {
      query: z.object({
        team: z.string().min(1),
        installationId: z.coerce.number(),
      }),
      body: {
        content: { "application/json": { schema: CreateDraftBody } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ItemResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId } = c.req.valid("query");
    const { projectId, title, body } = c.req.valid("json");

    // Verify team membership
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.text("Installation not found", 400);
    }

    try {
      const userOAuthToken =
        target.accountType === "User"
          ? await getGitHubUserOAuthToken(c.req.raw, {
              scopes: [...GITHUB_PROJECT_SCOPES],
            })
          : undefined;

      if (target.accountType === "User" && !userOAuthToken) {
        const fallbackItemId = await createDraftIssueViaGhCli(
          projectId,
          title,
          body,
        );
        if (fallbackItemId) {
          return c.json({ itemId: fallbackItemId });
        }
        return c.json({ itemId: null });
      }

      const itemId = await createDraftIssue(
        projectId,
        title,
        body,
        installationId,
        { userOAuthToken },
      );
      return c.json({ itemId });
    } catch (err) {
      console.error(
        `[github.projects] Failed to create draft issue:`,
        err instanceof Error ? err.message : err,
      );
      if (target.accountType === "User") {
        const fallbackItemId = await createDraftIssueViaGhCli(
          projectId,
          title,
          body,
        );
        if (fallbackItemId) {
          return c.json({ itemId: fallbackItemId });
        }
      }
      return c.json({ itemId: null });
    }
  },
);

// PATCH /integrations/github/projects/items/field - Update item field
githubProjectsRouter.openapi(
  createRoute({
    method: "patch" as const,
    path: "/integrations/github/projects/items/field",
    tags: ["Integrations"],
    summary: "Update a field value on a GitHub Project item",
    request: {
      query: z.object({
        team: z.string().min(1),
        installationId: z.coerce.number(),
      }),
      body: {
        content: { "application/json": { schema: UpdateFieldBody } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ItemResponse } },
      },
      401: { description: "Unauthorized" },
      400: { description: "Bad request" },
    },
  }),
  async (c) => {
    const accessToken = await getAccessTokenFromRequest(c.req.raw);
    if (!accessToken) return c.text("Unauthorized", 401);

    const { team, installationId } = c.req.valid("query");
    const { projectId, itemId, fieldId, value } = c.req.valid("json");

    // Verify team membership
    const convex = getConvex({ accessToken });
    const connections = await convex.query(api.github.listProviderConnections, {
      teamSlugOrId: team,
    });

    const target = connections.find(
      (co) => co.isActive && co.installationId === installationId,
    );

    if (!target) {
      return c.text("Installation not found", 400);
    }

    try {
      const typedValue = value as Record<string, string | number>;
      const userOAuthToken =
        target.accountType === "User"
          ? await getGitHubUserOAuthToken(c.req.raw, {
              scopes: [...GITHUB_PROJECT_SCOPES],
            })
          : undefined;

      if (target.accountType === "User" && !userOAuthToken) {
        return c.json({ itemId: null });
      }

      const updatedItemId = await updateItemField(
        projectId,
        itemId,
        fieldId,
        typedValue,
        installationId,
        { userOAuthToken },
      );
      return c.json({ itemId: updatedItemId });
    } catch (err) {
      console.error(
        `[github.projects] Failed to update item field:`,
        err instanceof Error ? err.message : err,
      );
      return c.json({ itemId: null });
    }
  },
);

// Export status mapping for use in sync logic
export { mapCmuxStatusToProjectStatus };

// Schema for plan-sync endpoint (called from Claude Code plan hook)
const PlanSyncBody = z.object({
  planContent: z.string().min(1).max(100000),
  planFile: z.string().optional(),
});

const PlanSyncResponse = z.object({
  success: z.boolean(),
  itemsCreated: z.number(),
  projectId: z.string().nullable(),
  error: z.string().optional(),
});

/**
 * Simple plan markdown parser - extracts ## headings as items
 * Similar to apps/client/src/lib/parse-plan-markdown.ts
 */
function parsePlanMarkdown(markdown: string): Array<{ title: string; body: string }> {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (normalized.trim().length === 0) return [];

  const lines = normalized.split("\n");
  const items: Array<{ title: string; body: string }> = [];
  let currentTitle: string | null = null;
  let currentBodyLines: string[] = [];

  for (const line of lines) {
    // Check for ## heading
    const trimmed = line.trimStart();
    if (trimmed.startsWith("## ") && !trimmed.startsWith("### ")) {
      // Save previous item
      if (currentTitle !== null) {
        items.push({
          title: currentTitle,
          body: currentBodyLines.join("\n").trim(),
        });
      }
      currentTitle = trimmed.slice(3).trim();
      currentBodyLines = [];
      continue;
    }

    if (currentTitle !== null) {
      currentBodyLines.push(line);
    }
  }

  // Save last item
  if (currentTitle !== null) {
    items.push({
      title: currentTitle,
      body: currentBodyLines.join("\n").trim(),
    });
  }

  return items;
}

// POST /integrations/github/projects/plan-sync - Sync plan from Claude Code hook
// Called by the plan-hook.sh script when ExitPlanMode is used
githubProjectsRouter.openapi(
  createRoute({
    method: "post" as const,
    path: "/integrations/github/projects/plan-sync",
    tags: ["Integrations"],
    summary: "Sync a plan from Claude Code to GitHub Projects",
    description:
      "Called by the Claude Code plan hook when ExitPlanMode is used. " +
      "Parses the plan markdown and creates draft issues in the linked project.",
    request: {
      body: {
        content: { "application/json": { schema: PlanSyncBody } },
        required: true,
      },
    },
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: PlanSyncResponse } },
      },
      401: { description: "Unauthorized" },
    },
  }),
  async (c) => {
    // This endpoint uses task run JWT auth (from x-cmux-token header)
    const cmuxToken = c.req.header("x-cmux-token");
    if (!cmuxToken) {
      return c.json({
        success: false,
        itemsCreated: 0,
        projectId: null,
        error: "Missing x-cmux-token header",
      });
    }

    const { planContent, planFile } = c.req.valid("json");

    // Parse plan into items
    const items = parsePlanMarkdown(planContent);
    if (items.length === 0) {
      return c.json({
        success: true,
        itemsCreated: 0,
        projectId: null,
        error: "No items found in plan",
      });
    }

    // TODO: Get linked project from task run context
    // For now, we just log and return success without creating items
    // Full implementation would:
    // 1. Decode JWT to get taskRunId
    // 2. Query Convex for taskRun -> session -> team -> linked project
    // 3. Create draft issues in the project
    console.log(
      `[github.projects] Plan sync received: ${items.length} items from ${planFile || "unknown"}`,
    );
    console.log(
      `[github.projects] Items:`,
      items.map((i) => i.title),
    );

    return c.json({
      success: true,
      itemsCreated: 0, // Would be items.length after full implementation
      projectId: null,
      error: "Plan sync endpoint ready - full implementation pending project linking",
    });
  },
);
