/**
 * GitHub Projects v2 GraphQL API integration
 *
 * Provides functions to interact with GitHub Projects for roadmap/planning features.
 * Requires GitHub App with "Organization projects: Read and write" permission.
 *
 * @see https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
 */

import { Octokit } from "octokit";
import { createAppAuth } from "@octokit/auth-app";
import { githubPrivateKey } from "./githubPrivateKey";
import { env } from "./www-env";

// GraphQL Queries and Mutations for GitHub Projects v2

export const PROJECT_QUERIES = {
  // Get projects for a user
  getUserProjects: `
    query($login: String!, $first: Int!) {
      user(login: $login) {
        projectsV2(first: $first) {
          nodes {
            id
            title
            number
            url
            shortDescription
            closed
            createdAt
            updatedAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `,

  // Get projects for an organization
  getOrgProjects: `
    query($login: String!, $first: Int!) {
      organization(login: $login) {
        projectsV2(first: $first) {
          nodes {
            id
            title
            number
            url
            shortDescription
            closed
            createdAt
            updatedAt
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `,

  // Get a single project by number
  getProject: `
    query($owner: String!, $number: Int!, $ownerType: String!) {
      node: ${/* dynamic based on ownerType */ ""}
    }
  `,

  // Get project fields (needed for updating items)
  getProjectFields: `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                }
              }
              ... on ProjectV2IterationField {
                id
                name
                dataType
                configuration {
                  iterations {
                    id
                    title
                    startDate
                    duration
                  }
                }
              }
            }
          }
        }
      }
    }
  `,

  // Get project items
  getProjectItems: `
    query($projectId: ID!, $first: Int!, $after: String) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: $first, after: $after) {
            nodes {
              id
              content {
                ... on Issue {
                  id
                  title
                  number
                  state
                  url
                }
                ... on PullRequest {
                  id
                  title
                  number
                  state
                  url
                }
                ... on DraftIssue {
                  id
                  title
                  body
                }
              }
              fieldValues(first: 20) {
                nodes {
                  ... on ProjectV2ItemFieldTextValue {
                    text
                    field { ... on ProjectV2Field { name } }
                  }
                  ... on ProjectV2ItemFieldNumberValue {
                    number
                    field { ... on ProjectV2Field { name } }
                  }
                  ... on ProjectV2ItemFieldDateValue {
                    date
                    field { ... on ProjectV2Field { name } }
                  }
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                  ... on ProjectV2ItemFieldIterationValue {
                    title
                    field { ... on ProjectV2IterationField { name } }
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    }
  `,
} as const;

export const PROJECT_MUTATIONS = {
  // Add an existing issue or PR to a project
  addItemToProject: `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item {
          id
        }
      }
    }
  `,

  // Create a draft issue in a project
  createDraftIssue: `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: {projectId: $projectId, title: $title, body: $body}) {
        projectItem {
          id
        }
      }
    }
  `,

  // Update a field value on a project item
  updateItemFieldValue: `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: $value
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  // Update project settings
  updateProject: `
    mutation($projectId: ID!, $title: String, $shortDescription: String, $closed: Boolean) {
      updateProjectV2(input: {
        projectId: $projectId
        title: $title
        shortDescription: $shortDescription
        closed: $closed
      }) {
        projectV2 {
          id
          title
          shortDescription
          closed
        }
      }
    }
  `,

  // Delete a project item
  deleteItem: `
    mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: {projectId: $projectId, itemId: $itemId}) {
        deletedItemId
      }
    }
  `,
} as const;

// Types

export interface ProjectV2Node {
  id: string;
  title: string;
  number: number;
  url: string;
  shortDescription: string | null;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectV2Field {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
}

export interface ProjectV2Item {
  id: string;
  content: {
    id: string;
    title: string;
    number?: number;
    state?: string;
    url?: string;
    body?: string;
  } | null;
  fieldValues: Record<string, string | number | null>;
}

// Raw GraphQL response types (before flattening)

interface RawProjectV2ItemFieldValue {
  text?: string;
  number?: number;
  date?: string;
  name?: string; // SingleSelectValue
  title?: string; // IterationValue
  field?: { name?: string };
}

interface RawProjectV2ItemContent {
  id?: string;
  title?: string;
  number?: number;
  state?: string;
  url?: string;
  body?: string;
}

interface RawProjectV2ItemNode {
  id: string;
  content: RawProjectV2ItemContent | null;
  fieldValues: { nodes: (RawProjectV2ItemFieldValue | null)[] };
}

// Client functions

/**
 * Create an authenticated Octokit instance for GitHub App
 */
function createGitHubAppOctokit(installationId?: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.CMUX_GITHUB_APP_ID,
      privateKey: githubPrivateKey,
      ...(installationId ? { installationId } : {}),
    },
  });
}

/**
 * Create an authenticated Octokit instance using user's OAuth token.
 * Required for user-owned Projects v2 (GitHub Apps cannot access these).
 */
function createUserOctokit(userOAuthToken: string): Octokit {
  return new Octokit({ auth: userOAuthToken });
}

/**
 * List projects for a user or organization
 *
 * IMPORTANT: For user-owned projects, userOAuthToken with "project" scope is required.
 * GitHub Apps cannot access user-owned Projects v2 (platform limitation).
 * Organization projects can use either GitHub App or OAuth token.
 */
export async function listProjects(
  owner: string,
  ownerType: "user" | "organization",
  installationId: number,
  options?: { first?: number; userOAuthToken?: string }
): Promise<ProjectV2Node[]> {
  const first = options?.first ?? 20;

  // For user-owned projects, prefer OAuth token if available (required for private projects)
  // GitHub Apps cannot access user-owned Projects v2
  const octokit =
    ownerType === "user" && options?.userOAuthToken
      ? createUserOctokit(options.userOAuthToken)
      : createGitHubAppOctokit(installationId);

  const query =
    ownerType === "organization"
      ? PROJECT_QUERIES.getOrgProjects
      : PROJECT_QUERIES.getUserProjects;

  const result = await octokit.graphql<{
    user?: { projectsV2: { nodes: ProjectV2Node[] } };
    organization?: { projectsV2: { nodes: ProjectV2Node[] } };
  }>(query, { login: owner, first });

  return ownerType === "organization"
    ? result.organization?.projectsV2.nodes ?? []
    : result.user?.projectsV2.nodes ?? [];
}

/**
 * Get project fields (needed for updating items)
 */
export async function getProjectFields(
  projectId: string,
  installationId: number,
  options?: { userOAuthToken?: string }
): Promise<ProjectV2Field[]> {
  const octokit = options?.userOAuthToken
    ? createUserOctokit(options.userOAuthToken)
    : createGitHubAppOctokit(installationId);

  const result = await octokit.graphql<{
    node: { fields: { nodes: ProjectV2Field[] } };
  }>(PROJECT_QUERIES.getProjectFields, { projectId });

  return result.node?.fields?.nodes ?? [];
}

/**
 * Get project items with pagination
 */
export async function getProjectItems(
  projectId: string,
  installationId: number,
  options?: { first?: number; after?: string; userOAuthToken?: string }
): Promise<{ items: ProjectV2Item[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }> {
  const first = options?.first ?? 50;

  const octokit = options?.userOAuthToken
    ? createUserOctokit(options.userOAuthToken)
    : createGitHubAppOctokit(installationId);

  const result = await octokit.graphql<{
    node: {
      items: {
        nodes: RawProjectV2ItemNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    };
  }>(PROJECT_QUERIES.getProjectItems, {
    projectId,
    first,
    after: options?.after ?? null,
  });

  const rawItems: RawProjectV2ItemNode[] = result.node?.items?.nodes ?? [];
  const items: ProjectV2Item[] = rawItems.map((raw) => {
    const fieldValues: Record<string, string | number | null> = {};
    for (const fv of raw.fieldValues.nodes) {
      if (!fv) continue; // GitHub GraphQL nodes arrays can contain nulls
      const fieldName = fv.field?.name;
      if (!fieldName) continue;
      if (fv.text !== undefined) fieldValues[fieldName] = fv.text;
      else if (fv.number !== undefined) fieldValues[fieldName] = fv.number;
      else if (fv.date !== undefined) fieldValues[fieldName] = fv.date;
      else if (fv.name !== undefined) fieldValues[fieldName] = fv.name; // SingleSelect
      else if (fv.title !== undefined) fieldValues[fieldName] = fv.title; // Iteration
    }

    return {
      id: raw.id,
      content: raw.content
        ? {
            id: raw.content.id ?? "",
            title: raw.content.title ?? "",
            number: raw.content.number,
            state: raw.content.state,
            url: raw.content.url,
            body: raw.content.body,
          }
        : null,
      fieldValues,
    };
  });

  return {
    items,
    pageInfo: result.node?.items?.pageInfo ?? { hasNextPage: false, endCursor: null },
  };
}

/**
 * Add an issue or PR to a project
 */
export async function addItemToProject(
  projectId: string,
  contentId: string,
  installationId: number,
  options?: { userOAuthToken?: string }
): Promise<string | null> {
  const octokit = options?.userOAuthToken
    ? createUserOctokit(options.userOAuthToken)
    : createGitHubAppOctokit(installationId);

  const result = await octokit.graphql<{
    addProjectV2ItemById: { item: { id: string } | null };
  }>(PROJECT_MUTATIONS.addItemToProject, { projectId, contentId });

  return result.addProjectV2ItemById?.item?.id ?? null;
}

/**
 * Create a draft issue in a project
 */
export async function createDraftIssue(
  projectId: string,
  title: string,
  body: string | undefined,
  installationId: number,
  options?: { userOAuthToken?: string }
): Promise<string | null> {
  const octokit = options?.userOAuthToken
    ? createUserOctokit(options.userOAuthToken)
    : createGitHubAppOctokit(installationId);

  const result = await octokit.graphql<{
    addProjectV2DraftIssue: { projectItem: { id: string } | null };
  }>(PROJECT_MUTATIONS.createDraftIssue, { projectId, title, body });

  return result.addProjectV2DraftIssue?.projectItem?.id ?? null;
}

/**
 * Update a field value on a project item
 *
 * Note: Different field types require different value formats:
 * - Text/Number/Date: { text: "value" } or { number: 5 } or { date: "2024-01-01" }
 * - Single select: { singleSelectOptionId: "option_id" }
 * - Iteration: { iterationId: "iteration_id" }
 */
export async function updateItemField(
  projectId: string,
  itemId: string,
  fieldId: string,
  value: Record<string, string | number>,
  installationId: number,
  options?: { userOAuthToken?: string }
): Promise<string | null> {
  const octokit = options?.userOAuthToken
    ? createUserOctokit(options.userOAuthToken)
    : createGitHubAppOctokit(installationId);

  const result = await octokit.graphql<{
    updateProjectV2ItemFieldValue: { projectV2Item: { id: string } | null };
  }>(PROJECT_MUTATIONS.updateItemFieldValue, {
    projectId,
    itemId,
    fieldId,
    value,
  });

  return result.updateProjectV2ItemFieldValue?.projectV2Item?.id ?? null;
}

/**
 * Map cmux task status to GitHub Project status
 */
export function mapCmuxStatusToProjectStatus(
  cmuxStatus: "pending" | "in_progress" | "completed" | "failed"
): string {
  const statusMap: Record<string, string> = {
    pending: "Backlog",
    in_progress: "In Progress",
    completed: "Done",
    failed: "Done", // Failed tasks are also "done" from workflow perspective
  };
  return statusMap[cmuxStatus] ?? "Backlog";
}

/**
 * Map GitHub Project status to cmux task status
 */
export function mapProjectStatusToCmux(
  projectStatus: string
): "pending" | "in_progress" | "completed" {
  const statusMap: Record<string, "pending" | "in_progress" | "completed"> = {
    Backlog: "pending",
    Todo: "pending",
    Planned: "pending",
    "In Progress": "in_progress",
    Review: "in_progress",
    "In Review": "in_progress",
    Done: "completed",
    Merged: "completed",
    Closed: "completed",
  };
  return statusMap[projectStatus] ?? "pending";
}
