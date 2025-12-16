import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";

const normalizeProjectFullName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("projectFullName is required");
  }
  return trimmed;
};

const normalizeScript = (
  script: string | undefined,
): string | undefined => {
  if (script === undefined) {
    return undefined;
  }
  const trimmed = script.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const projectFullName = normalizeProjectFullName(args.projectFullName);

    if (!userId) {
      throw new Error("Authentication required");
    }

    const config = await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_team_user_repo", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("projectFullName", projectFullName),
      )
      .first();

    return config ?? null;
  },
});

export const upsert = authMutation({
  args: {
    teamSlugOrId: v.string(),
    projectFullName: v.string(),
    maintenanceScript: v.optional(v.string()),
    dataVaultKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const projectFullName = normalizeProjectFullName(args.projectFullName);
    const maintenanceScript = normalizeScript(args.maintenanceScript);
    const now = Date.now();

    if (!userId) {
      throw new Error("Authentication required");
    }

    // Check for existing config
    const existing = await ctx.db
      .query("workspaceConfigs")
      .withIndex("by_team_user_repo", (q) =>
        q
          .eq("teamId", teamId)
          .eq("userId", userId)
          .eq("projectFullName", projectFullName),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        maintenanceScript,
        dataVaultKey: args.dataVaultKey ?? existing.dataVaultKey,
        updatedAt: now,
      });
      return existing._id;
    }

    // No existing config, create new
    const id = await ctx.db.insert("workspaceConfigs", {
      projectFullName,
      maintenanceScript,
      dataVaultKey: args.dataVaultKey,
      createdAt: now,
      updatedAt: now,
      userId,
      teamId,
    });

    return id;
  },
});
