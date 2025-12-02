import { typedZid } from "@cmux/shared/utils/typed-zid";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, GitPullRequest, ExternalLink, ArrowRight } from "lucide-react";
import { z } from "zod";

const searchSchema = z.object({
  environmentId: z.string().optional(),
  environmentName: z.string().optional(),
  selectedRepos: z.array(z.string()).default([]),
});

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/environments/configured"
)({
  component: EnvironmentConfiguredPage,
  validateSearch: searchSchema,
});

function EnvironmentConfiguredPage() {
  const { teamSlugOrId } = Route.useParams();
  const { environmentId, environmentName, selectedRepos } = Route.useSearch();
  const navigate = useNavigate();

  const primaryRepo = selectedRepos[0] ?? null;

  const handleViewEnvironment = () => {
    if (environmentId) {
      const parsedEnvironmentId = typedZid("environments").parse(environmentId);
      navigate({
        to: "/$teamSlugOrId/environments/$environmentId",
        params: { teamSlugOrId, environmentId: parsedEnvironmentId },
        search: {
          step: undefined,
          selectedRepos: undefined,
          connectionLogin: undefined,
          repoSearch: undefined,
          instanceId: undefined,
          snapshotId: undefined,
        },
      });
    } else {
      navigate({
        to: "/$teamSlugOrId/environments",
        params: { teamSlugOrId },
        search: {
          step: undefined,
          selectedRepos: undefined,
          connectionLogin: undefined,
          repoSearch: undefined,
          instanceId: undefined,
          snapshotId: undefined,
        },
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center px-4 py-10 bg-gradient-to-b from-neutral-50 to-white dark:from-neutral-950 dark:to-neutral-900">
      <div className="w-full max-w-lg">
        <div className="relative overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 shadow-xl backdrop-blur-sm">
          <div className="p-8">
            {/* Success Icon */}
            <div className="mx-auto mb-6 grid place-items-center">
              <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 ring-8 ring-emerald-50 dark:ring-emerald-950/50 grid place-items-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-xl font-semibold text-center text-neutral-900 dark:text-neutral-100">
              Preview Environment Configured
            </h1>

            {environmentName && (
              <p className="mt-2 text-center text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {environmentName}
              </p>
            )}

            {/* Description */}
            <p className="mt-3 text-center text-sm text-neutral-600 dark:text-neutral-400">
              Your environment is ready. When you open a pull request on{" "}
              {selectedRepos.length === 1 ? (
                <span className="font-medium text-neutral-800 dark:text-neutral-200">
                  {primaryRepo}
                </span>
              ) : selectedRepos.length > 1 ? (
                "the connected repositories"
              ) : (
                "connected repositories"
              )}
              , cmux will automatically spin up a preview environment.
            </p>

            {/* Info Box */}
            <div className="mt-6 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  <GitPullRequest className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                    Test it out with a PR
                  </p>
                  <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                    Create a pull request to trigger your first preview. Preview
                    jobs typically complete in 2-5 minutes.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex flex-col gap-3">
              {primaryRepo && (
                <a
                  href={`https://github.com/${primaryRepo}/compare`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus:ring-neutral-700 transition-colors"
                >
                  <GitPullRequest className="h-4 w-4" />
                  Create a Test PR
                  <ExternalLink className="h-3.5 w-3.5 ml-0.5 opacity-60" />
                </a>
              )}

              <button
                type="button"
                onClick={handleViewEnvironment}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 transition-colors"
              >
                View Environment
                <ArrowRight className="h-4 w-4" />
              </button>

              <Link
                to="/$teamSlugOrId/environments"
                params={{ teamSlugOrId }}
                search={{
                  step: undefined,
                  selectedRepos: undefined,
                  connectionLogin: undefined,
                  repoSearch: undefined,
                  instanceId: undefined,
                  snapshotId: undefined,
                }}
                className="inline-flex items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
              >
                Back to Environments
              </Link>
            </div>

            {/* Additional Info */}
            <div className="mt-6 pt-4 border-t border-neutral-200 dark:border-neutral-800">
              <p className="text-xs text-neutral-500 dark:text-neutral-500 text-center">
                Once a preview is running, you can view it in the{" "}
                <Link
                  to="/$teamSlugOrId/previews"
                  params={{ teamSlugOrId }}
                  className="text-neutral-700 dark:text-neutral-300 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  Previews
                </Link>{" "}
                tab.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
