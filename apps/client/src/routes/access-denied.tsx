import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  reason: z.enum(["team_membership", "not_authenticated"]).optional(),
  teamSlugOrId: z.string().optional(),
  returnTo: z.string().optional(),
});

export const Route = createFileRoute("/access-denied")({
  validateSearch: searchSchema,
  component: AccessDeniedPage,
});

function AccessDeniedPage() {
  const { reason, teamSlugOrId, returnTo } = Route.useSearch();

  const isTeamMembershipIssue = reason === "team_membership";

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 shadow-lg ring-1 ring-neutral-900/5 dark:border-neutral-800 dark:bg-neutral-900 dark:ring-neutral-100/10">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
          <svg
            className="h-6 w-6 text-amber-600 dark:text-amber-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-10V4a1 1 0 00-1-1H9a1 1 0 00-1 1v1m4 0V4a1 1 0 011-1h2a1 1 0 011 1v1m-6 0h6m-6 0H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2h-4"
            />
          </svg>
        </div>

        <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
          Access Required
        </h1>

        <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
          {isTeamMembershipIssue ? (
            <>
              The Workspace and Dev Browser features require access to the team
              configuration for this repository.
              {teamSlugOrId && (
                <>
                  {" "}
                  You are not a member of the team{" "}
                  <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium dark:bg-neutral-800">
                    {teamSlugOrId}
                  </code>
                  .
                </>
              )}
            </>
          ) : (
            <>
              You need to sign in to access this workspace. The Workspace and
              Dev Browser features are only available to authenticated team
              members.
            </>
          )}
        </p>

        <div className="mt-6 rounded-md bg-neutral-50 p-4 dark:bg-neutral-800/50">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            What you can do:
          </h2>
          <ul className="mt-2 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-neutral-400">•</span>
              <span>
                <strong>Diff Heatmap</strong> — Anyone with access to the GitHub
                repository can view the visual diff heatmap (no cmux account
                needed)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-neutral-400">•</span>
              <span>
                <strong>Set up your own</strong> — Configure cmux for your own
                repositories at{" "}
                <a
                  href="https://cmux.sh"
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  cmux.sh
                </a>
              </span>
            </li>
            {isTeamMembershipIssue && (
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-neutral-400">•</span>
                <span>
                  <strong>Request access</strong> — Ask the repository owner to
                  add you to their cmux team
                </span>
              </li>
            )}
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {reason === "not_authenticated" && (
            <Link
              to="/sign-in"
              search={{ after_auth_return_to: returnTo }}
              className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Sign in
            </Link>
          )}
          <a
            href="https://cmux.sh"
            className="inline-flex items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Get started with cmux
          </a>
        </div>
      </div>
    </div>
  );
}
