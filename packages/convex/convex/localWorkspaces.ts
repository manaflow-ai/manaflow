import { workspaceSequenceToName } from "@cmux/shared/utils/generate-workspace-name";
import { v } from "convex/values";
import { resolveTeamIdLoose } from "../_shared/team";
import { authMutation } from "./users/utils";

export const reserve = authMutation({
  args: {
    teamSlugOrId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = ctx.identity.subject;
    const teamId = await resolveTeamIdLoose(ctx, args.teamSlugOrId);

    const existing = await ctx.db
      .query("workspaceSettings")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();

    const now = Date.now();
    const sequence = existing?.nextLocalWorkspaceSequence ?? 0;
    const name = workspaceSequenceToName(sequence);

    if (existing) {
      await ctx.db.patch(existing._id, {
        nextLocalWorkspaceSequence: sequence + 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("workspaceSettings", {
        worktreePath: undefined,
        autoPrEnabled: undefined,
        nextLocalWorkspaceSequence: sequence + 1,
        createdAt: now,
        updatedAt: now,
        userId,
        teamId,
      });
    }

    return { name, sequence };
  },
});
