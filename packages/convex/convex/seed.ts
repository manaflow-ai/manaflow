"use node";

import {
  StackAdminApp,
  type ServerTeam,
  type ServerUser,
} from "@stackframe/js";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { env } from "../_shared/convex-env";

function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required env: ${String(name)}`);
  return String(value);
}

export const init = internalAction({
  args: {},
  handler: async (ctx) => {
    const projectId = requireEnv("NEXT_PUBLIC_STACK_PROJECT_ID");
    const publishableClientKey = requireEnv(
      "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"
    );
    const secretServerKey = requireEnv("STACK_SECRET_SERVER_KEY");
    const superSecretAdminKey = requireEnv("STACK_SUPER_SECRET_ADMIN_KEY");

    const admin = new StackAdminApp({
      tokenStore: "memory",
      projectId,
      publishableClientKey,
      secretServerKey,
      superSecretAdminKey,
    });

    const summary = {
      usersProcessed: 0,
      teamsProcessed: 0,
      membershipsProcessed: 0,
    };

    const teamSyncPromise = (async () => {
      const teams = (await admin.listTeams()) as ServerTeam[];
      await Promise.all(
        teams.map((team) =>
          ctx.runMutation(internal.stack.upsertTeam, {
            id: team.id,
            displayName: team.displayName ?? undefined,
            profileImageUrl: team.profileImageUrl ?? undefined,
            clientMetadata: team.clientMetadata,
            clientReadOnlyMetadata: team.clientReadOnlyMetadata,
            serverMetadata: (team as unknown as { serverMetadata?: unknown })
              .serverMetadata,
            createdAtMillis: team.createdAt.getTime(),
          })
        )
      );
      return teams.length;
    })();

    let cursor: string | undefined = undefined;
    for (;;) {
      const page = (await admin.listUsers({
        cursor,
        limit: 200,
        includeAnonymous: false,
      })) as ServerUser[] & { nextCursor: string | null };

      const membershipsForPage = await Promise.all(
        page.map(async (user) => {
          const teams = await user.listTeams();
          const ensureMembershipsPromise = Promise.all(
            teams.map((team) =>
              ctx.runMutation(internal.stack.ensureMembership, {
                teamId: team.id,
                userId: user.id,
              })
            )
          );
          const upsertUserPromise = ctx.runMutation(internal.stack.upsertUser, {
            id: user.id,
            primaryEmail: user.primaryEmail ?? undefined,
            primaryEmailVerified: user.primaryEmailVerified,
            primaryEmailAuthEnabled:
              (user as unknown as { emailAuthEnabled?: boolean })
                .emailAuthEnabled ?? false,
            displayName: user.displayName ?? undefined,
            selectedTeamId: user.selectedTeam?.id ?? undefined,
            selectedTeamDisplayName:
              user.selectedTeam?.displayName ?? undefined,
            selectedTeamProfileImageUrl:
              user.selectedTeam?.profileImageUrl ?? undefined,
            profileImageUrl: user.profileImageUrl ?? undefined,
            signedUpAtMillis: user.signedUpAt.getTime(),
            lastActiveAtMillis: user.lastActiveAt.getTime(),
            hasPassword: user.hasPassword,
            otpAuthEnabled: user.otpAuthEnabled,
            passkeyAuthEnabled: user.passkeyAuthEnabled,
            clientMetadata: user.clientMetadata,
            clientReadOnlyMetadata: user.clientReadOnlyMetadata,
            serverMetadata: (user as unknown as { serverMetadata?: unknown })
              .serverMetadata,
            isAnonymous: user.isAnonymous,
            oauthProviders: undefined,
          });
          await Promise.all([ensureMembershipsPromise, upsertUserPromise]);
          return teams.length;
        })
      );
      summary.usersProcessed += page.length;
      summary.membershipsProcessed += membershipsForPage.reduce(
        (total, count) => total + count,
        0
      );

      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    summary.teamsProcessed += await teamSyncPromise;

    return summary;
  },
});

export default init;
