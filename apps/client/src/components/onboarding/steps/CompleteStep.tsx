import { Button } from "@/components/ui/button";
import { Check, CheckCircle2 } from "lucide-react";
import { api } from "@cmux/convex/api";
import { useQuery } from "convex/react";

interface CompleteStepProps {
  onComplete: () => void;
  teamSlugOrId: string;
  hasGitHubConnection: boolean;
}

export function CompleteStep({
  onComplete,
  teamSlugOrId,
  hasGitHubConnection,
}: CompleteStepProps) {
  // Query for synced repos
  const reposByOrg = useQuery(api.github.getReposByOrg, { teamSlugOrId });
  const repoCount = reposByOrg
    ? Object.values(reposByOrg).reduce((sum, repos) => sum + repos.length, 0)
    : 0;

  return (
    <div className="flex flex-col items-center text-center">
      {/* Success Icon */}
      <div className="mb-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-500/20">
          <CheckCircle2 className="h-12 w-12 text-green-500" />
        </div>
      </div>

      {/* Header */}
      <div className="mb-12">
        <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-white">
          You're all set!
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-md mx-auto">
          Your workspace is ready. Start running agents across multiple coding CLIs in parallel.
        </p>
      </div>

      {/* Setup Summary */}
      {hasGitHubConnection && (
        <div className="mb-12 w-full max-w-md">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6 space-y-3 backdrop-blur">
            {hasGitHubConnection && (
              <div className="flex items-center gap-3">
                <Check className="h-5 w-5 text-green-500" />
                <span className="text-base text-neutral-900 dark:text-white">GitHub connected</span>
              </div>
            )}
            {repoCount > 0 && (
              <div className="flex items-center gap-3">
                <Check className="h-5 w-5 text-green-500" />
                <span className="text-base text-neutral-900 dark:text-white">{repoCount} {repoCount === 1 ? "repository" : "repositories"} synced</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Launch Button */}
      <Button
        onClick={onComplete}
        className="h-12 px-8 text-base bg-blue-600 hover:bg-blue-700 text-white"
      >
        Go to Dashboard
      </Button>
    </div>
  );
}
