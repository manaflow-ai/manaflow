import type { MutationCtx, QueryCtx } from "../convex/_generated/server";

export function isUuid(value: string): boolean {
  // RFC4122 variant UUID v1–v5
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

type AnyCtx = QueryCtx | MutationCtx;

// Resolve a teamSlugOrId to a canonical team UUID string.
// Falls back to the input if no team is found (for backwards compatibility).
// Always enforces team membership when an authenticated user is present.
export async function getTeamId(
  ctx: AnyCtx,
  teamSlugOrId: string
): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  const userId = identity?.subject;

  let teamId: string;

  if (isUuid(teamSlugOrId)) {
    // UUID provided directly - use as-is but still enforce membership below
    teamId = teamSlugOrId;
  } else {
    // Slug provided - resolve to teamId
    const team = await ctx.db
      .query("teams")
      .withIndex("by_slug", (q) => q.eq("slug", teamSlugOrId))
      .first();
    if (team) {
      teamId = team.teamId;
    } else {
      // Back-compat: allow legacy string teamIds (e.g., "default")
      teamId = teamSlugOrId;
    }
  }

  // Always enforce membership when user is authenticated
  if (userId) {
    const membership = await ctx.db
      .query("teamMemberships")
      .withIndex("by_team_user", (q) =>
        q.eq("teamId", teamId).eq("userId", userId)
      )
      .first();
    if (!membership) {
      throw new Error("Forbidden: Not a member of this team");
    }
  }

  return teamId;
}

// Resolve a teamSlugOrId to a team UUID without enforcing membership.
// Use this when the caller already scopes by userId and does not need
// team membership guarantees (e.g., per-user comments).
export async function resolveTeamIdLoose(
  ctx: AnyCtx,
  teamSlugOrId: string
): Promise<string> {
  if (isUuid(teamSlugOrId)) return teamSlugOrId;

  const team = await ctx.db
    .query("teams")
    .withIndex("by_slug", (q) => q.eq("slug", teamSlugOrId))
    .first();
  if (team) {
    return team.teamId;
  }

  // Back-compat: allow legacy string teamIds (e.g., "default").
  return teamSlugOrId;
}
