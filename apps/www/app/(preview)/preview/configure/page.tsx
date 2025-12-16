import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { PreviewConfigureClient } from "@/components/preview/preview-configure-client";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerApp } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import {
  getTeamDisplayName,
  getTeamId,
  getTeamSlug,
  getTeamSlugOrId,
  type StackTeam,
} from "@/lib/team-utils";
import { env } from "@/lib/utils/www-env";
import { typedZid } from "@cmux/shared/utils/typed-zid";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

type SearchParams = Record<string, string | string[] | undefined>;

function buildConfigurePath(search: SearchParams | undefined): string {
  const params = new URLSearchParams();
  if (search) {
    Object.entries(search).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          if (entry) params.append(key, entry);
        });
      } else if (value) {
        params.set(key, value);
      }
    });
  }
  const query = params.toString();
  return query ? `/preview/configure?${query}` : "/preview/configure";
}

function getSearchValue(
  search: SearchParams | undefined,
  key: string
): string | null {
  if (!search) {
    return null;
  }
  const value = search[key];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function PreviewConfigurePage({ searchParams }: PageProps) {
  const resolvedSearch = await searchParams;
  const configurePath = buildConfigurePath(resolvedSearch);

  const user = await stackServerApp.getUser();

  // If user is not authenticated, redirect to sign-in
  if (!user) {
    const signInUrl = `/handler/sign-in?after_auth_return_to=${encodeURIComponent(configurePath)}`;
    return redirect(signInUrl);
  }

  const [auth, teamsResult] = await Promise.all([
    user.getAuthJson(),
    user.listTeams(),
  ]);
  const teams: StackTeam[] = teamsResult;
  const { accessToken } = auth;

  if (teams.length === 0) {
    notFound();
  }

  if (!accessToken) {
    throw new Error("Missing Stack access token");
  }

  const repo = getSearchValue(resolvedSearch, "repo");
  const installationId = getSearchValue(resolvedSearch, "installationId");
  const environmentId = getSearchValue(resolvedSearch, "environmentId");

  if (!repo) {
    notFound();
  }

  const searchTeam = getSearchValue(resolvedSearch, "team");

  const selectedTeam =
    teams.find(
      (team) =>
        Boolean(searchTeam) &&
        getTeamDisplayName(team).toLowerCase() === searchTeam?.toLowerCase()
    ) ||
    teams.find((team) => getTeamSlugOrId(team) === searchTeam) ||
    teams[0];
  const selectedTeamSlugOrId = getTeamSlugOrId(selectedTeam);

  const convex = getConvex({ accessToken });
  const providerConnections = await convex.query(api.github.listProviderConnections, {
    teamSlugOrId: selectedTeamSlugOrId,
  });

  const hasGithubAppInstallation = providerConnections.some(
    (connection) => connection.isActive,
  );

  if (!hasGithubAppInstallation) {
    const githubAppSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
    if (!githubAppSlug) {
      throw new Error("GitHub App slug is not configured");
    }

    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const protocol = headerList.get("x-forwarded-proto") ?? "https";
    const returnUrl =
      host && configurePath.startsWith("/")
        ? `${protocol}://${host}${configurePath}`
        : configurePath;

    const { state } = await convex.mutation(api.github_app.mintInstallState, {
      teamSlugOrId: selectedTeamSlugOrId,
      returnUrl,
    });

    const url = new URL(`https://github.com/apps/${githubAppSlug}/installations/new`);
    url.searchParams.set("state", state);
    return redirect(url.toString());
  }

  const clientTeams = teams.map((team) => ({
    id: getTeamId(team),
    slug: getTeamSlug(team),
    slugOrId: getTeamSlugOrId(team),
    displayName: getTeamDisplayName(team),
    name: team.name ?? getTeamDisplayName(team),
  }));

  let initialEnvVarsContent: string | null = null;
  // Scripts will be detected client-side in background, start with null
  let initialMaintenanceScript: string | null = null;
  let initialDevScript: string | null = null;

  if (environmentId) {
    try {
      // Validate and parse environment ID
      const parsedEnvId = typedZid("environments").parse(environmentId);

      // Fetch environment details directly from Convex
      const environment = await convex.query(api.environments.get, {
        teamSlugOrId: selectedTeamSlugOrId,
        id: parsedEnvId,
      });

      if (environment) {
        initialMaintenanceScript = environment.maintenanceScript ?? null;
        initialDevScript = environment.devScript ?? null;

        // Fetch environment variables directly from Stack Data Vault
        try {
          const store = await stackServerApp.getDataVaultStore("cmux-snapshot-envs");
          const varsContent = await store.getValue(environment.dataVaultKey, {
            secret: env.STACK_DATA_VAULT_SECRET,
          });
          if (typeof varsContent === "string") {
            initialEnvVarsContent = varsContent;
          }
        } catch (error) {
          console.error("Failed to fetch environment vars from data vault", error);
        }
      }
    } catch (error) {
      console.error("Failed to fetch environment details", error);
    }
  }

  return (
    <PreviewConfigureClient
      initialTeamSlugOrId={selectedTeamSlugOrId}
      teams={clientTeams}
      repo={repo}
      installationId={installationId}
      initialEnvVarsContent={initialEnvVarsContent}
      initialMaintenanceScript={initialMaintenanceScript}
      initialDevScript={initialDevScript}
      startAtConfigureEnvironment={Boolean(environmentId)}
    />
  );
}
