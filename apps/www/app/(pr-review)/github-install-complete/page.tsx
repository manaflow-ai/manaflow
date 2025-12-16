"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

function GitHubInstallCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isRedirecting, setIsRedirecting] = useState(true);
  const [returnPath, setReturnPath] = useState<string | null>(null);

  useEffect(() => {
    console.log("[GitHubInstallComplete] Checking return URL from session storage");
    let storedUrl: string | null = null;
    try {
      storedUrl = sessionStorage.getItem("pr_review_return_url");
    } catch (error) {
      console.warn(
        "[GitHubInstallComplete] Failed to read return URL from storage",
        error,
      );
    }

    if (storedUrl) {
      try {
        const next = new URL(storedUrl);
        const path = `${next.pathname}${next.search}${next.hash}`;
        setReturnPath(path);
        setTimeout(() => {
          router.push(path);
        }, 1_500);
        return;
      } catch (parseError) {
        console.error(
          "[GitHubInstallComplete] Failed to parse stored return URL",
          parseError,
        );
      } finally {
        try {
          sessionStorage.removeItem("pr_review_return_url");
        } catch (error) {
          console.warn(
            "[GitHubInstallComplete] Failed to clear return URL",
            error,
          );
        }
      }
    }

    const teamParam = searchParams.get("team");
    if (teamParam) {
      try {
        const deepLink = `cmux://github-connect-complete?team=${encodeURIComponent(
          teamParam,
        )}`;
        window.location.href = deepLink;
        setTimeout(() => {
          setIsRedirecting(false);
        }, 2_000);
        return;
      } catch (error) {
        console.error(
          "[GitHubInstallComplete] Failed to open deep link",
          error,
        );
      }
    }

    setIsRedirecting(false);
  }, [router, searchParams]);

  if (isRedirecting) {
    return (
      <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto mb-6 grid place-items-center">
            <div className="h-14 w-14 rounded-full bg-neutral-100 ring-8 ring-neutral-50 grid place-items-center">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Installation Complete
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {returnPath
              ? "Redirecting you back to the pull request…"
              : "Opening cmux app…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-semibold text-neutral-900">
                GitHub App Installed Successfully
              </h1>
              <p className="mt-3 text-base text-neutral-600 leading-relaxed">
                The cmux GitHub App has been connected. Return to your pull
                request and refresh the page to continue your review.
              </p>

              <div className="mt-6 rounded-lg bg-neutral-50 p-4 border border-neutral-200">
                <p className="text-sm text-neutral-700">
                  <span className="font-semibold">Next steps:</span>
                </p>
                <ol className="mt-2 space-y-1 text-sm text-neutral-600">
                  <li>1. Use your browser&apos;s back button to return to the PR</li>
                  <li>2. Refresh the page to load your updated permissions</li>
                  <li>3. Restart the automated review if it did not start automatically</li>
                </ol>
              </div>

              <button
                type="button"
                onClick={() => window.history.back()}
                className="mt-4 w-full inline-flex items-center justify-center gap-3 rounded-lg bg-neutral-900 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GitHubInstallCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh bg-neutral-50 text-neutral-900 flex items-center justify-center px-6">
          <div className="text-center">
            <div className="mx-auto mb-6 grid place-items-center">
              <div className="h-14 w-14 rounded-full bg-neutral-100 ring-8 ring-neutral-50 grid place-items-center">
                <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              </div>
            </div>
            <h1 className="text-2xl font-semibold text-neutral-900">
              Loading...
            </h1>
          </div>
        </div>
      }
    >
      <GitHubInstallCompleteContent />
    </Suspense>
  );
}
