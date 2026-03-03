"use node";

import { v } from "convex/values";
import { Octokit } from "octokit";
import { fetchInstallationAccessToken } from "../_shared/githubApp";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Sync cmux task status to a linked GitHub Project item.
 *
 * Called via scheduler when a task run transitions to completed/failed.
 * Reads the task's GitHub Project linkage fields, fetches the Status field
 * options, maps cmux status -> project status, and updates the item.
 */
export const syncStatusToProject = internalAction({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    // Read the task to get project linkage fields
    const task = await ctx.runQuery(internal.tasks.getInternal, {
      id: args.taskId,
    });

    if (!task) {
      console.error(
        "[githubProjectSync] Task not found:",
        args.taskId,
      );
      return;
    }

    const {
      githubProjectId,
      githubProjectItemId,
      githubProjectInstallationId,
    } = task;

    if (!githubProjectId || !githubProjectItemId || !githubProjectInstallationId) {
      // No project linkage -- nothing to sync
      return;
    }

    // Map cmux task status to project status name
    const cmuxStatus = task.isCompleted ? "completed" : "in_progress";
    const projectStatusName = mapCmuxStatusToProjectStatus(cmuxStatus);

    // Get installation access token
    const token = await fetchInstallationAccessToken(githubProjectInstallationId);
    if (!token) {
      console.error(
        "[githubProjectSync] Failed to get installation token for",
        githubProjectInstallationId,
      );
      return;
    }

    const octokit = new Octokit({ auth: token });

    try {
      // Fetch project fields to find Status field and its option IDs
      const fieldsResult = await octokit.graphql<{
        node: {
          fields: {
            nodes: Array<{
              id: string;
              name: string;
              dataType: string;
              options?: Array<{ id: string; name: string }>;
            } | null>;
          };
        };
      }>(GET_PROJECT_FIELDS_QUERY, { projectId: githubProjectId });

      const fields = fieldsResult.node?.fields?.nodes ?? [];
      const statusField = fields.find(
        (f) => f && f.name === "Status" && f.options && f.options.length > 0,
      );

      if (!statusField || !statusField.options) {
        console.error(
          "[githubProjectSync] Status field not found in project",
          githubProjectId,
        );
        return;
      }

      const targetOption = statusField.options.find(
        (opt) => opt.name === projectStatusName,
      );

      if (!targetOption) {
        console.error(
          "[githubProjectSync] Status option not found:",
          projectStatusName,
          "available:",
          statusField.options.map((o) => o.name).join(", "),
        );
        return;
      }

      // Update the project item's Status field
      await octokit.graphql(UPDATE_ITEM_FIELD_MUTATION, {
        projectId: githubProjectId,
        itemId: githubProjectItemId,
        fieldId: statusField.id,
        value: { singleSelectOptionId: targetOption.id },
      });

      console.log(
        `[githubProjectSync] Updated project item ${githubProjectItemId} status to "${projectStatusName}"`,
      );
    } catch (err) {
      console.error(
        "[githubProjectSync] Failed to sync status:",
        err instanceof Error ? err.message : err,
      );
    }
  },
});

// Status mapping (mirrors apps/www/lib/utils/github-projects.ts)
function mapCmuxStatusToProjectStatus(
  cmuxStatus: "pending" | "in_progress" | "completed" | "failed",
): string {
  const statusMap: Record<string, string> = {
    pending: "Backlog",
    in_progress: "In Progress",
    completed: "Done",
    failed: "Done",
  };
  return statusMap[cmuxStatus] ?? "Backlog";
}

// GraphQL queries (inline to avoid cross-package imports)
const GET_PROJECT_FIELDS_QUERY = `
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
            }
          }
        }
      }
    }
  }
`;

const UPDATE_ITEM_FIELD_MUTATION = `
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
`;
