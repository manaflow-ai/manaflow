import { OpenCmuxClient } from "../handler/after-sign-in/OpenCmuxClient";

export const dynamic = "force-dynamic";

export default function ConnectCompletePage({
  params,
}: {
  params: { teamSlugOrId: string };
}) {
  const href = `manaflow://github-connect-complete?team=${encodeURIComponent(
    params.teamSlugOrId
  )}`;
  return <OpenCmuxClient href={href} />;
}
