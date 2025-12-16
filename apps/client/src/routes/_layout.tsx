import { convexAuthReadyPromise } from "@/contexts/convex/convex-auth-ready";
import { ConvexClientProvider } from "@/contexts/convex/convex-client-provider";
import { RealSocketProvider } from "@/contexts/socket/real-socket-provider";
import {
  identifyPosthogUser,
  initPosthog,
  resetPosthog,
} from "@/lib/analytics/posthog";
import { cachedGetUser } from "@/lib/cachedGetUser";
import { stackClientApp } from "@/lib/stack";
import {
  localVSCodeServeWebQueryOptions,
  useLocalVSCodeServeWebQuery,
} from "@/queries/local-vscode-serve-web";
import { api } from "@cmux/convex/api";
import { PostHogProvider } from "@posthog/react";
import { useUser } from "@stackframe/react";
import { useMatch } from "@tanstack/react-router";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async ({ context }) => {
    const user = await cachedGetUser(stackClientApp);
    if (!user) {
      throw redirect({
        to: "/sign-in",
        search: {
          after_auth_return_to: location.pathname,
        },
      });
    }
    const convexAuthReady = await convexAuthReadyPromise;
    if (!convexAuthReady) {
      console.log("[Route.beforeLoad] convexAuthReady:", convexAuthReady);
    }
    void context.queryClient
      .ensureQueryData(localVSCodeServeWebQueryOptions())
      .catch(() => undefined);
  },
});

function PosthogTracking() {
  const user = useUser({ or: "return-null" });
  const previousUserId = useRef<string | null>(null);
  const match = useMatch({
    from: "/_layout/$teamSlugOrId",
    shouldThrow: false,
  });
  const teamSlugOrId = match?.params.teamSlugOrId;
  const team = useQuery(
    api.teams.get,
    teamSlugOrId ? { teamSlugOrId } : "skip"
  );
  const teamId = team?.uuid;

  useEffect(() => {
    if (!user) {
      if (previousUserId.current) {
        resetPosthog();
        previousUserId.current = null;
      }
      return;
    }

    identifyPosthogUser(user.id, {
      email: user.primaryEmail ?? undefined,
      name: user.displayName ?? undefined,
      team_id: teamId ?? undefined,
    });
    previousUserId.current = user.id;
  }, [teamId, user]);

  return null;
}

function MaybePosthogProvider({ children }: { children: React.ReactNode }) {
  const posthogClient = useMemo(() => initPosthog(), []);
  if (!posthogClient) {
    return children;
  }
  return <PostHogProvider client={posthogClient}>{children}</PostHogProvider>;
}

function Layout() {
  useLocalVSCodeServeWebQuery();

  return (
    <ConvexClientProvider>
      <RealSocketProvider>
        <MaybePosthogProvider>
          <PosthogTracking />
          <Outlet />
        </MaybePosthogProvider>
      </RealSocketProvider>
    </ConvexClientProvider>
  );
}
