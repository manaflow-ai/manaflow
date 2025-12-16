import { stackServerApp } from "@/lib/utils/stack";

export type StackTeam = Awaited<ReturnType<typeof stackServerApp.listTeams>>[number] & {
  slug?: string | null;
  teamId?: string;
  id?: string;
  displayName?: string | null;
  name?: string | null;
};

export function getTeamSlugOrId(team: StackTeam): string {
  return team.slug ?? team.teamId ?? team.id ?? "";
}

export function getTeamId(team: StackTeam): string {
  return team.teamId ?? team.id ?? getTeamSlugOrId(team);
}

export function getTeamSlug(team: StackTeam): string | null {
  return team.slug ?? null;
}

export function getTeamDisplayName(team: StackTeam): string {
  return team.displayName ?? team.name ?? getTeamSlugOrId(team);
}
