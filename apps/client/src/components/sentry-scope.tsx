import * as Sentry from "@sentry/react";
import { useEffect, useMemo } from "react";
import { useUser, type Team } from "@stackframe/react";
import { useLocation } from "@tanstack/react-router";

type TeamWithMetadata = Team & { clientMetadata?: unknown };

function getTeamSlug(team: Team): string | null {
  const maybeSlug = (team as { slug?: unknown }).slug;
  if (typeof maybeSlug === "string" && maybeSlug.trim().length > 0) {
    return maybeSlug.trim();
  }

  const metadata = (team as TeamWithMetadata).clientMetadata;
  if (metadata && typeof metadata === "object") {
    const slugValue = (metadata as { slug?: unknown }).slug;
    if (typeof slugValue === "string" && slugValue.trim().length > 0) {
      return slugValue.trim();
    }
  }

  return null;
}

function resolveTeamId(teamSlugOrId: string | null, teams: Team[], selectedTeamId: string | undefined): string | null {
  if (!teamSlugOrId) return selectedTeamId ?? null;

  const trimmed = teamSlugOrId.trim();
  if (trimmed.length === 0) return selectedTeamId ?? null;

  const directMatch = teams.find((team) => team.id === trimmed || getTeamSlug(team) === trimmed);
  if (directMatch) return directMatch.id;

  return selectedTeamId ?? null;
}

function extractTeamSlugOrId(pathname: string): string | null {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) return null;
  if (segments[0] !== "_layout") return null;
  return segments[1] ?? null;
}

export function SentryScope() {
  const user = useUser({ or: "return-null" });
  const location = useLocation();

  const teams = user?.useTeams() ?? [];
  const selectedTeamId = user?.selectedTeam?.id;

  const teamSlugOrId = useMemo(
    () => extractTeamSlugOrId(location.pathname),
    [location.pathname]
  );

  const teamId = resolveTeamId(teamSlugOrId, teams, selectedTeamId);

  const userId = user?.id;
  const userEmail = user?.primaryEmail ?? undefined;

  useEffect(() => {
    if (userId) {
      Sentry.setUser({ id: userId, email: userEmail });
    } else {
      Sentry.setUser(null);
    }

    Sentry.setTag("team_id", teamId ?? "unknown");
  }, [teamId, userEmail, userId]);

  return null;
}
