import { redirect } from "next/navigation";
import { isRepoPublic } from "@/lib/github/check-repo-visibility";
import { stackServerApp } from "@/lib/utils/stack";
import { PublicRepoAnonymousPrompt } from "../../../_components/public-repo-anonymous-prompt";
import { PrivateRepoPrompt } from "../../../_components/private-repo-prompt";
import { AnonymousToSignInPrompt } from "../../../_components/anonymous-to-signin-prompt";
import { env } from "@/lib/utils/www-env";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  pullNumber: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

function parsePullNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const numericValue = Number.parseInt(raw, 10);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

export default async function AuthPage({ params }: PageProps) {
  const resolvedParams = await params;
  const {
    teamSlugOrId: githubOwner,
    repo,
    pullNumber: pullNumberRaw,
  } = resolvedParams;

  const pullNumber = parsePullNumber(pullNumberRaw);
  if (pullNumber === null) {
    redirect(`/${githubOwner}/${repo}/pull/${pullNumberRaw}`);
  }

  // Check if repository is public
  const repoIsPublic = await isRepoPublic(githubOwner, repo);

  // Always use return-null to handle redirects manually (so we can preserve return URL)
  const user = await stackServerApp.getUser({
    or: "return-null"
  });

  // For private repos without authenticated user, show sign-in prompt
  if (!repoIsPublic && (!user || !user.primaryEmail)) {
    console.log("[AuthPage] Private repo requires authentication, showing sign-in prompt");
    return (
      <AnonymousToSignInPrompt
        returnUrl={`/${githubOwner}/${repo}/pull/${pullNumber}`}
      />
    );
  }

  // If user exists and has email, they're authenticated - redirect back to PR page
  if (user && user.primaryEmail) {
    console.log("[AuthPage] User already authenticated, redirecting to PR page");
    redirect(`/${githubOwner}/${repo}/pull/${pullNumber}`);
  }

  // For public repos with anonymous users or no user, show anonymous auth prompt
  if (repoIsPublic) {
    return (
      <PublicRepoAnonymousPrompt
        repo={repo}
        githubOwner={githubOwner}
        pullNumber={pullNumber}
      />
    );
  }

  // Fallback: show GitHub app install prompt (shouldn't reach here normally)
  return (
    <PrivateRepoPrompt
      teamSlugOrId={githubOwner}
      repo={repo}
      githubOwner={githubOwner}
      githubAppSlug={env.NEXT_PUBLIC_GITHUB_APP_SLUG}
    />
  );
}
