import { notFound, redirect } from "next/navigation";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  pullNumber: string;
  segments: string[];
};

type PageProps = {
  params: Promise<PageParams>;
};

export const dynamic = "force-dynamic";

export default async function PullRequestCatchallPage({
  params,
}: PageProps): Promise<never> {
  const { teamSlugOrId, repo, pullNumber } = await params;

  if (!/^\d+$/.test(pullNumber)) {
    notFound();
  }

  redirect(
    `/${encodeURIComponent(teamSlugOrId)}/${encodeURIComponent(
      repo
    )}/pull/${encodeURIComponent(pullNumber)}`
  );
}
