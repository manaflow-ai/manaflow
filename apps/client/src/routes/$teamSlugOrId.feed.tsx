import { convexAuthReadyPromise } from "@/contexts/convex/convex-auth-ready";
import { ConvexClientProvider } from "@/contexts/convex/convex-client-provider";
import { convexQueryClient } from "@/contexts/convex/convex-query-client";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import { api } from "@cmux/convex/api";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$teamSlugOrId/feed")({
  component: FeedPageWrapper,
  beforeLoad: async ({ params, location }) => {
    const user = await cachedGetUser(stackClientApp);
    if (!user) {
      throw redirect({
        to: "/sign-in",
        search: {
          after_auth_return_to: location.pathname,
        },
      });
    }

    await convexAuthReadyPromise;

    const { teamSlugOrId } = params;
    const teamMemberships = await convexQueryClient.convexClient.query(
      api.teams.listTeamMemberships
    );
    const teamMembership = teamMemberships.find((membership) => {
      const team = membership.team;
      const membershipTeamId = team?.teamId ?? membership.teamId;
      const membershipSlug = team?.slug;
      return (
        membershipSlug === teamSlugOrId || membershipTeamId === teamSlugOrId
      );
    });
    if (!teamMembership) {
      throw redirect({ to: "/team-picker" });
    }
  },
});

function FeedPageWrapper() {
  return (
    <ConvexClientProvider>
      <FeedPage />
    </ConvexClientProvider>
  );
}

function FeedPage() {
  const { teamSlugOrId } = Route.useParams();

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-950">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-6">
          Feed
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Team: {teamSlugOrId}
        </p>
      </div>
    </div>
  );
}
