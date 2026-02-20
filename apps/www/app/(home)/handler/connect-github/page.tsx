import { stackServerApp } from "@/lib/utils/stack";
import { ConnectGitHubClient } from "./ConnectGitHubClient";

export const dynamic = "force-dynamic";

type ConnectGitHubPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingleValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

export default async function ConnectGitHubPage({
  searchParams: searchParamsPromise,
}: ConnectGitHubPageProps) {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const searchParams = await searchParamsPromise;
  const teamSlugOrId = getSingleValue(searchParams?.team);

  // Check if GitHub is already connected
  const githubAccount = await user.getConnectedAccount("github");

  if (githubAccount) {
    // Already connected - redirect to deep link immediately
    const deepLinkHref = teamSlugOrId
      ? `manaflow://github-connect-complete?team=${encodeURIComponent(teamSlugOrId)}`
      : `manaflow://github-connect-complete`;

    // Use client component to trigger deep link
    return <ConnectGitHubClient href={deepLinkHref} alreadyConnected />;
  }

  // Not connected - show client component to initiate OAuth
  return <ConnectGitHubClient teamSlugOrId={teamSlugOrId} />;
}
