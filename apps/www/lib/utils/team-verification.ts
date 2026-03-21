import { api, internal } from "@cmux/convex/api";
import { ConvexHttpClient } from "convex/browser";
import { HTTPException } from "hono/http-exception";
import { getAccessTokenFromRequest, getUserFromRequest } from "./auth";
import { getConvex } from "./get-convex";
import { stackServerAppJs } from "./stack";

type StackLikeTeam = {
  id: string;
  displayName?: string | null;
  profileImageUrl?: string | null;
  clientMetadata?: unknown;
  clientReadOnlyMetadata?: unknown;
  serverMetadata?: unknown;
  createdAt: Date;
};

type StackLikeUser = {
  id: string;
  listTeams(): Promise<StackLikeTeam[]>;
};

type AdminConvexClient = ConvexHttpClient & {
  setAdminAuth(token: string): void;
  mutation(reference: unknown, args: unknown): Promise<unknown>;
};

function getAdminConvexClient(adminToken?: string): AdminConvexClient {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const token = adminToken ?? process.env.CONVEX_DEPLOY_KEY;
  if (!convexUrl || !token) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL and CONVEX_DEPLOY_KEY are required");
  }

  const client = new ConvexHttpClient(convexUrl) as AdminConvexClient;
  client.setAdminAuth(token);
  return client;
}

async function getStackUserForTeamSync({
  req,
  accessToken,
}: {
  req?: Request;
  accessToken?: string | null;
}): Promise<StackLikeUser | null> {
  if (req) {
    return (await getUserFromRequest(req)) as StackLikeUser | null;
  }
  if (!accessToken) {
    return null;
  }

  try {
    return (await stackServerAppJs.getUser({
      tokenStore: { accessToken, refreshToken: accessToken },
    })) as StackLikeUser | null;
  } catch {
    return null;
  }
}

export async function syncMissingTeamFromStack({
  req,
  accessToken,
  teamSlugOrId,
  loadUser = getStackUserForTeamSync,
  getAdminClient = getAdminConvexClient,
}: {
  req?: Request;
  accessToken?: string | null;
  teamSlugOrId: string;
  loadUser?: (args: {
    req?: Request;
    accessToken?: string | null;
  }) => Promise<StackLikeUser | null>;
  getAdminClient?: (adminToken?: string) => AdminConvexClient;
}): Promise<boolean> {
  const user = await loadUser({ req, accessToken });
  if (!user) {
    console.warn("[mobile-team-sync] no stack user for missing team", {
      teamSlugOrId,
    });
    return false;
  }

  const stackTeams = await user.listTeams();
  const matchedTeam = stackTeams.find((team) => team.id === teamSlugOrId);
  if (!matchedTeam) {
    console.warn("[mobile-team-sync] requested team missing from stack memberships", {
      teamSlugOrId,
      userId: user.id,
      stackTeamIDs: stackTeams.map((team) => team.id),
    });
    return false;
  }

  const convex = getAdminClient();
  console.warn("[mobile-team-sync] syncing team into convex", {
    teamSlugOrId,
    userId: user.id,
  });
  await convex.mutation(internal.stack.upsertTeam, {
    id: matchedTeam.id,
    displayName: matchedTeam.displayName ?? undefined,
    profileImageUrl: matchedTeam.profileImageUrl ?? undefined,
    clientMetadata: matchedTeam.clientMetadata,
    clientReadOnlyMetadata: matchedTeam.clientReadOnlyMetadata,
    serverMetadata: matchedTeam.serverMetadata,
    createdAtMillis: matchedTeam.createdAt.getTime(),
  });
  await convex.mutation(internal.stack.ensureMembership, {
    teamId: matchedTeam.id,
    userId: user.id,
  });

  console.warn("[mobile-team-sync] synced team into convex", {
    teamSlugOrId,
    userId: user.id,
  });
  return true;
}

/**
 * Verifies that a user has access to a team and returns the team object.
 * Throws HTTPException if the user doesn't have access.
 */
export async function verifyTeamAccess({
  req,
  accessToken,
  teamSlugOrId,
}: {
  req?: Request;
  accessToken?: string | null;
  teamSlugOrId: string;
}): Promise<{
  uuid: string;
  slug: string | null;
  displayName: string | null;
  name: string | null;
}> {
  let token = accessToken;
  if (!token) {
    if (!req) {
      throw new HTTPException(401, {
        message: "Unauthorized: No access token",
      });
    }
    token = await getAccessTokenFromRequest(req);
  }
  if (!token) {
    throw new HTTPException(401, { message: "Unauthorized: No access token" });
  }

  const convexClient = getConvex({ accessToken: token });

  try {
    // This query will throw if the user doesn't have access to the team
    let team = await convexClient.query(api.teams.get, { teamSlugOrId });

    if (!team) {
      const synced = await syncMissingTeamFromStack({
        req,
        accessToken: token,
        teamSlugOrId,
      });
      if (synced) {
        team = await convexClient.query(api.teams.get, { teamSlugOrId });
      }
    }

    if (!team) {
      throw new HTTPException(404, { message: "Team not found" });
    }

    return team;
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    // If Convex throws a "Forbidden" error, convert to HTTPException
    if (error instanceof Error && error.message.includes("Forbidden")) {
      throw new HTTPException(403, {
        message: "Forbidden: Not a member of this team",
      });
    }
    throw new HTTPException(500, { message: "Failed to verify team access" });
  }
}
