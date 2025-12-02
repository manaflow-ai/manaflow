import { stackServerApp } from "@/lib/utils/stack";
import { getConvex } from "@/lib/utils/get-convex";
import { api } from "@cmux/convex/api";
import { PreviewDashboard } from "@/components/preview/preview-dashboard";
import {
  getTeamDisplayName,
  getTeamSlugOrId,
  type StackTeam,
} from "@/lib/team-utils";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PreviewConfigListItem = {
  id: string;
  repoFullName: string;
  environmentId: string | null;
  repoInstallationId: number | null;
  repoDefaultBranch: string | null;
  status: "active" | "paused" | "disabled";
  lastRunAt: number | null;
  teamSlugOrId: string;
  teamName: string;
};

type TeamOption = {
  slugOrId: string;
  displayName: string;
};

type CreationSuccessContext = {
  configId: string | null;
  repoFullName: string;
  baseBranch: string;
  teamSlugOrId: string;
};

function getSearchValue(
  search: Record<string, string | string[] | undefined> | undefined,
  key: string
): string | null {
  if (!search) {
    return null;
  }
  const value = search[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function serializeProviderConnections(
  connections: Array<{
    installationId: number;
    accountLogin: string | null | undefined;
    accountType: string | null | undefined;
    isActive: boolean;
  }>
) {
  return connections.map((conn) => ({
    installationId: conn.installationId,
    accountLogin: conn.accountLogin ?? null,
    accountType: conn.accountType ?? null,
    isActive: conn.isActive,
  }));
}

export default async function PreviewLandingPage({ searchParams }: PageProps) {
  const user = await stackServerApp.getUser();
  const resolvedSearch = await searchParams;

  if (!user) {
    return (
      <div className="relative isolate min-h-dvh bg-[#05050a] text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(4,120,255,0.3),_transparent_45%)]" />

        <PreviewDashboard
          selectedTeamSlugOrId=""
          teamOptions={[]}
          providerConnectionsByTeam={{}}
          isAuthenticated={false}
          previewConfigs={[]}
        />
      </div>
    );
  }

  const [auth, teamsResult] = await Promise.all([
    user.getAuthJson(),
    user.listTeams(),
  ]);
  const teams: StackTeam[] = teamsResult;
  const { accessToken } = auth;

  if (!accessToken) {
    throw new Error("Missing Stack access token");
  }

  const searchTeam = getSearchValue(resolvedSearch, "team");

  const selectedTeam =
    teams.find((team) => getTeamSlugOrId(team) === searchTeam) ?? teams[0];
  const selectedTeamSlugOrId = selectedTeam ? getTeamSlugOrId(selectedTeam) : "";
  const teamOptions: TeamOption[] = teams.map((team) => ({
    slugOrId: getTeamSlugOrId(team),
    displayName: getTeamDisplayName(team),
  }));

  const convex = getConvex({ accessToken });
  const [providerConnectionsByTeamEntries, previewConfigs] = await Promise.all([
    Promise.all(
      teams.map(async (team) => {
        const teamSlugOrId = getTeamSlugOrId(team);
        const connections = await convex.query(api.github.listProviderConnections, {
          teamSlugOrId,
        });
        const serialized = serializeProviderConnections(connections);
        return [teamSlugOrId, serialized];
      }),
    ),
    Promise.all(
      teams.map(async (team) => {
        const teamSlugOrId = getTeamSlugOrId(team);
        try {
          const configs = await convex.query(api.previewConfigs.listByTeam, {
            teamSlugOrId,
          });
          return configs.map(
            (config): PreviewConfigListItem => ({
              id: config._id,
              repoFullName: config.repoFullName,
              environmentId: config.environmentId ?? null,
              repoInstallationId: config.repoInstallationId ?? null,
              repoDefaultBranch: config.repoDefaultBranch ?? null,
              status: config.status ?? "active",
              lastRunAt: config.lastRunAt ?? null,
              teamSlugOrId,
              teamName: getTeamDisplayName(team),
            })
          );
        } catch (error) {
          console.error("[PreviewLandingPage] Failed to load preview configs", {
            teamSlugOrId,
            error,
          });
          return [];
        }
      })
    ).then((results) => results.flat()),
  ]);
  const providerConnectionsByTeam = Object.fromEntries(
    providerConnectionsByTeamEntries,
  );
  const createdConfigId = getSearchValue(resolvedSearch, "createdConfigId");
  const createdRepo = getSearchValue(resolvedSearch, "createdRepo");
  const createdBranch = getSearchValue(resolvedSearch, "createdBranch");
  const creationSuccess: CreationSuccessContext | null =
    createdConfigId || createdRepo
      ? (() => {
          const matchedConfig =
            previewConfigs.find((config) => config.id === createdConfigId) ??
            previewConfigs.find((config) => config.repoFullName === createdRepo);
          if (matchedConfig) {
            return {
              configId: matchedConfig.id,
              repoFullName: matchedConfig.repoFullName,
              baseBranch: matchedConfig.repoDefaultBranch ?? createdBranch ?? "main",
              teamSlugOrId: matchedConfig.teamSlugOrId,
            };
          }
          if (createdRepo) {
            return {
              configId: createdConfigId,
              repoFullName: createdRepo,
              baseBranch: createdBranch ?? "main",
              teamSlugOrId: selectedTeamSlugOrId,
            };
          }
          return null;
        })()
      : null;

  return (
    <div className="relative isolate min-h-dvh bg-[#05050a] text-white">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(4,120,255,0.3),_transparent_45%)]" />

      <PreviewDashboard
        selectedTeamSlugOrId={selectedTeamSlugOrId}
        teamOptions={teamOptions}
        providerConnectionsByTeam={providerConnectionsByTeam}
        isAuthenticated={true}
        previewConfigs={previewConfigs}
        creationSuccess={creationSuccess ?? undefined}
      />
    </div>
  );
}
