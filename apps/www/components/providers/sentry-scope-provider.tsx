"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { useStackApp } from "@stackframe/stack";

export function SentryScopeProvider() {
  const stackApp = useStackApp();
  const user = stackApp.useUser({ or: "return-null" });

  useEffect(() => {
    if (user) {
      Sentry.setUser({ id: user.id, email: user.primaryEmail ?? undefined });
      Sentry.setTag("team_id", user.selectedTeam?.id ?? "unknown");
      return;
    }

    Sentry.setUser(null);
    Sentry.setTag("team_id", "unknown");
  }, [user?.id, user?.primaryEmail, user?.selectedTeam?.id]);

  return null;
}
