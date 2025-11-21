"use client";

import { useCallback, useState } from "react";
import { AlertCircle, Github } from "lucide-react";

interface PrivateRepoPromptProps {
  teamSlugOrId: string;
  repo: string;
  githubOwner: string;
  githubAppSlug?: string;
}

export function PrivateRepoPrompt({
  teamSlugOrId,
  repo,
  githubOwner,
  githubAppSlug: githubAppSlugProp,
}: PrivateRepoPromptProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstallApp = useCallback(async () => {
    setIsRedirecting(true);
    setError(null);

    try {
      const currentUrl = window.location.href;
      try {
        sessionStorage.setItem("pr_review_return_url", currentUrl);
      } catch (storageError) {
        console.warn(
          "[PrivateRepoPrompt] Failed to persist return URL",
          storageError,
        );
      }

      const githubAppSlug =
        githubAppSlugProp || process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
      if (!githubAppSlug) {
        setError("GitHub App is not configured. Please contact support.");
        setIsRedirecting(false);
        return;
      }

      const response = await fetch("/api/integrations/github/install-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId,
          returnUrl: currentUrl,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 403) {
          setError(
            "You do not have permission to install the GitHub App for this team.",
          );
        } else if (response.status === 401) {
          setError("You need to sign in first. Redirecting...");
          setTimeout(() => {
            const returnTo = encodeURIComponent(window.location.pathname);
            window.location.href = `/sign-in?after_auth_return_to=${returnTo}`;
          }, 2_000);
        } else {
          setError(`Failed to start installation: ${text}`);
        }
        setIsRedirecting(false);
        return;
      }

      const { state } = (await response.json()) as { state: string };
      const installUrl = new URL(
        `https://github.com/apps/${githubAppSlug}/installations/new`,
      );
      installUrl.searchParams.set("state", state);

      window.location.href = installUrl.toString();
    } catch (err) {
      console.error("[PrivateRepoPrompt] Failed to initiate installation", err);
      setError("An unexpected error occurred. Please try again.");
      setIsRedirecting(false);
    }
  }, [githubAppSlugProp, teamSlugOrId]);

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <div className="h-12 w-12 rounded-full bg-amber-50 flex items-center justify-center">
                <AlertCircle className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-neutral-900">
                Private Repository Access Required
              </h1>
              <p className="mt-3 text-base text-neutral-600 leading-relaxed">
                The repository
                <span className="mx-1 font-mono font-medium text-neutral-900">
                  {githubOwner}/{repo}
                </span>
                appears to be private or you do not have permission to view it.
              </p>

              <div className="mt-6 space-y-4">
                <div className="rounded-lg bg-neutral-50 p-4 border border-neutral-200">
                  <h2 className="text-sm font-semibold text-neutral-900 mb-2">
                    To continue, you need to:
                  </h2>
                  <ol className="space-y-2 text-sm text-neutral-600">
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 font-semibold text-neutral-900">
                        1.
                      </span>
                      <span>Install the cmux GitHub App</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 font-semibold text-neutral-900">
                        2.
                      </span>
                      <span>Grant access to this repository</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="shrink-0 font-semibold text-neutral-900">
                        3.
                      </span>
                      <span>You will be redirected back automatically</span>
                    </li>
                  </ol>
                </div>

                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleInstallApp}
                  disabled={isRedirecting}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRedirecting ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Redirecting to GitHub…</span>
                    </>
                  ) : (
                    <>
                      <Github className="h-5 w-5" />
                      <span>Install GitHub App</span>
                    </>
                  )}
                </button>

                <p className="text-xs text-center text-neutral-500">
                  You will be redirected to github.com to authorize the cmux app.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
