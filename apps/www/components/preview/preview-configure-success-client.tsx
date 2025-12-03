"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Github,
  ExternalLink,
  Clock,
  GitPullRequest,
  Loader2,
  ArrowRight,
} from "lucide-react";
import clsx from "clsx";

type PreviewConfigureSuccessClientProps = {
  repoFullName: string;
  previewConfigId: string;
  teamSlugOrId: string;
  repoDefaultBranch: string;
};

export function PreviewConfigureSuccessClient({
  repoFullName,
  previewConfigId,
  teamSlugOrId,
  repoDefaultBranch,
}: PreviewConfigureSuccessClientProps) {
  const [isCreatingPR, setIsCreatingPR] = useState(false);
  const [createdPRUrl, setCreatedPRUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCreateTestPR = async () => {
    setIsCreatingPR(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/preview/test-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId,
          previewConfigId,
          repoFullName,
          baseBranch: repoDefaultBranch,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to create test PR");
      }

      const data = await response.json();
      setCreatedPRUrl(data.prUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create test PR";
      setErrorMessage(message);
      console.error("Failed to create test PR:", error);
    } finally {
      setIsCreatingPR(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white dark:bg-black flex items-center justify-center px-6 font-sans">
      <div className="max-w-lg w-full">
        <div className="text-center mb-8">
          <div className="mx-auto mb-6 grid place-items-center">
            <div className="h-16 w-16 rounded-full bg-emerald-50 dark:bg-emerald-950/50 ring-8 ring-emerald-50/50 dark:ring-emerald-950/30 grid place-items-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Preview Environment Configured
          </h1>
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
            <Github className="h-4 w-4" />
            <span>{repoFullName}</span>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6 mb-6">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
            What happens next?
          </h2>
          <ul className="space-y-4 text-sm text-neutral-600 dark:text-neutral-400">
            <li className="flex items-start gap-3">
              <GitPullRequest className="h-5 w-5 text-neutral-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  Open a pull request
                </span>
                <p className="mt-0.5">
                  When you open a PR to the <code className="px-1 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-xs">{repoDefaultBranch}</code> branch, a preview environment will automatically spin up.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <Clock className="h-5 w-5 text-neutral-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-neutral-900 dark:text-neutral-100">
                  Preview takes 2-5 minutes
                </span>
                <p className="mt-0.5">
                  The job runs your maintenance script, starts the dev server, and captures browser screenshots.
                </p>
              </div>
            </li>
          </ul>
        </div>

        {/* Test PR Section */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6 mb-6">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Test your configuration
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
            Create a test PR to verify everything works. This will create a new branch with a small test change and open a pull request.
          </p>

          {errorMessage && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 p-3 mb-4">
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            </div>
          )}

          {createdPRUrl ? (
            <div className="space-y-3">
              <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 p-3">
                <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium">
                  Test PR created successfully!
                </p>
              </div>
              <a
                href={createdPRUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2.5 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition"
              >
                View Pull Request
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCreateTestPR}
              disabled={isCreatingPR}
              className={clsx(
                "inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition",
                isCreatingPR
                  ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-500 cursor-not-allowed"
                  : "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
              )}
            >
              {isCreatingPR ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating test PR...
                </>
              ) : (
                <>
                  <GitPullRequest className="h-4 w-4" />
                  Create Test PR
                </>
              )}
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link
            href="/preview"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
          >
            Go to Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={`https://github.com/${repoFullName}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 transition"
          >
            <Github className="h-4 w-4" />
            View repository on GitHub
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
