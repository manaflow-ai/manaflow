import { validateExposedPorts } from "@cmux/shared/convex-safe";
import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation, authQuery } from "./users/utils";
import { internalQuery } from "./_generated/server";

const normalizeExposedPorts = (
  ports: readonly number[] | undefined
): number[] => {
  if (!ports || ports.length === 0) {
    return [];
  }

  const result = validateExposedPorts(ports);
  if (result.reserved.length > 0) {
    throw new Error(
      `Reserved ports cannot be exposed: ${result.reserved.join(", ")}`
    );
  }
  if (result.invalid.length > 0) {
    throw new Error(`Invalid ports provided: ${result.invalid.join(", ")}`);
  }
  return result.sanitized;
};

export const list = authQuery({
  args: { teamSlugOrId: v.string() },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    return await ctx.db
      .query("environments")
      .withIndex("by_team", (q) => q.eq("teamId", teamId))
      .order("desc")
      .collect();
  },
});

export const get = authQuery({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("environments"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.id);

    if (!environment || environment.teamId !== teamId) {
      return null;
    }

    return environment;
  },
});

export const create = authMutation({
  args: {
    teamSlugOrId: v.string(),
    name: v.string(),
    snapshotId: v.string(),
    snapshotProvider: v.union(
      v.literal("morph"),
      v.literal("pve-lxc"),
      v.literal("pve-vm"),
      v.literal("docker"),
      v.literal("daytona"),
      v.literal("other")
    ),
    templateVmid: v.optional(v.number()),
    dataVaultKey: v.string(),
    selectedRepos: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    maintenanceScript: v.optional(v.string()),
    devScript: v.optional(v.string()),
    exposedPorts: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    if (!userId) {
      throw new Error("Authentication required");
    }
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const sanitizedPorts = normalizeExposedPorts(args.exposedPorts ?? []);
    const createdAt = Date.now();
    const normalizeScript = (
      script: string | undefined
    ): string | undefined => {
      if (script === undefined) {
        return undefined;
      }
      const trimmed = script.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    };
    const maintenanceScript = normalizeScript(args.maintenanceScript);
    const devScript = normalizeScript(args.devScript);
    const templateVmid =
      args.snapshotProvider === "pve-lxc" || args.snapshotProvider === "pve-vm"
        ? args.templateVmid
        : undefined;

    const environmentId = await ctx.db.insert("environments", {
      name: args.name,
      teamId,
      userId,
      snapshotId: args.snapshotId,
      snapshotProvider: args.snapshotProvider,
      templateVmid,
      dataVaultKey: args.dataVaultKey,
      selectedRepos: args.selectedRepos,
      description: args.description,
      maintenanceScript,
      devScript,
      exposedPorts: sanitizedPorts.length > 0 ? sanitizedPorts : undefined,
      createdAt,
      updatedAt: createdAt,
    });

    await ctx.db.insert("environmentSnapshotVersions", {
      environmentId,
      teamId,
      snapshotId: args.snapshotId,
      snapshotProvider: args.snapshotProvider,
      templateVmid,
      version: 1,
      createdAt,
      createdByUserId: userId,
      maintenanceScript,
      devScript,
    });

    return environmentId;
  },
});

export const update = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("environments"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    maintenanceScript: v.optional(v.string()),
    devScript: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.id);

    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }

    const updates: {
      name?: string;
      description?: string;
      maintenanceScript?: string;
      devScript?: string;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updates.name = args.name;
    }

    if (args.description !== undefined) {
      updates.description = args.description;
    }

    if (args.maintenanceScript !== undefined) {
      const trimmedMaintenance = args.maintenanceScript.trim();
      updates.maintenanceScript =
        trimmedMaintenance.length > 0 ? trimmedMaintenance : undefined;
    }

    if (args.devScript !== undefined) {
      const trimmedDevScript = args.devScript.trim();
      updates.devScript =
        trimmedDevScript.length > 0 ? trimmedDevScript : undefined;
    }

    await ctx.db.patch(args.id, updates);

    return args.id;
  },
});

export const updateExposedPorts = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("environments"),
    ports: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.id);

    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }

    const sanitizedPorts = normalizeExposedPorts(args.ports);
    const patch: {
      exposedPorts?: number[];
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (sanitizedPorts.length > 0) {
      patch.exposedPorts = sanitizedPorts;
    } else {
      patch.exposedPorts = undefined;
    }

    await ctx.db.patch(args.id, patch);

    return sanitizedPorts;
  },
});

export const remove = authMutation({
  args: {
    teamSlugOrId: v.string(),
    id: v.id("environments"),
  },
  handler: async (ctx, args) => {
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);
    const environment = await ctx.db.get(args.id);

    if (!environment || environment.teamId !== teamId) {
      throw new Error("Environment not found");
    }

    // Cascade delete snapshot versions for this environment to avoid orphaned records
    const versions = await ctx.db
      .query("environmentSnapshotVersions")
      .withIndex("by_environment_version", (q) =>
        q.eq("environmentId", args.id)
      )
      .collect();

    for (const version of versions) {
      await ctx.db.delete(version._id);
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * Get all template VMIDs that are in use by environment snapshot versions.
 * Used by maintenance cron to avoid deleting templates that are still needed.
 */
export const getUsedTemplateVmidsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const versions = await ctx.db.query("environmentSnapshotVersions").collect();

    const vmids: number[] = [];
    for (const version of versions) {
      if (version.templateVmid !== undefined) {
        vmids.push(version.templateVmid);
      }
    }
    return vmids;
  },
});

export const getByIdInternal = internalQuery({
  args: {
    id: v.id("environments"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByDataVaultKey = authQuery({
  args: {
    dataVaultKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("environments")
      .withIndex("by_dataVaultKey", (q) =>
        q.eq("dataVaultKey", args.dataVaultKey)
      )
      .first();
  },
});
