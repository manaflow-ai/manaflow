import { notFound, redirect } from "next/navigation";
import { PreviewConfigureSuccessClient } from "@/components/preview/preview-configure-success-client";
import { getConvex } from "@/lib/utils/get-convex";
import { stackServerApp } from "@/lib/utils/stack";
import { api } from "@cmux/convex/api";
import {
  getTeamSlugOrId,
  type StackTeam,
} from "@/lib/team-utils";
import { typedZid } from "@cmux/shared/utils/typed-zid";

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

type SearchParams = Record<string, string | string[] | undefined>;

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

export default async function PreviewConfigureSuccessPage({ searchParams }: PageProps) {
  const resolvedSearch = await searchParams;

  const user = await stackServerApp.getUser();

  if (!user) {
    return redirect("/handler/sign-in?after_auth_return_to=/preview");
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

  const previewConfigId = getSearchValue(resolvedSearch, "previewConfigId");
  const teamSlugOrId = getSearchValue(resolvedSearch, "team");

  if (!previewConfigId || !teamSlugOrId) {
    return redirect("/preview");
  }

  // Verify team access
  const selectedTeam = teams.find(
    (team) => getTeamSlugOrId(team) === teamSlugOrId
  );

  if (!selectedTeam) {
    return redirect("/preview");
  }

  const convex = getConvex({ accessToken });

  // Fetch the preview config to get repo information
  let previewConfig;
  try {
    previewConfig = await convex.query(api.previewConfigs.get, {
      teamSlugOrId,
      previewConfigId: typedZid("previewConfigs").parse(previewConfigId),
    });
  } catch (error) {
    console.error("Failed to fetch preview config", error);
    return redirect("/preview");
  }

  if (!previewConfig) {
    return redirect("/preview");
  }

  return (
    <PreviewConfigureSuccessClient
      repoFullName={previewConfig.repoFullName}
      previewConfigId={previewConfigId}
      teamSlugOrId={teamSlugOrId}
      repoDefaultBranch={previewConfig.repoDefaultBranch ?? "main"}
    />
  );
}
