"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";

interface PublicRepoAnonymousPromptProps {
  repo: string;
  githubOwner: string;
  pullNumber: number;
}

/**
 * Automatically creates an anonymous session for public repositories.
 */
export function PublicRepoAnonymousPrompt({
  repo,
  githubOwner,
  pullNumber,
}: PublicRepoAnonymousPromptProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAttempted = useRef(false);

  const handleAnonymousSignIn = useCallback(async () => {
    setIsSigningIn(true);
    setError(null);

    try {
      // Call our server-side API to create anonymous user
      const response = await fetch("/api/auth/anonymous/sign-up", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      });

      const data = await response.json();
      console.log("[PublicRepoAnonymousPrompt] API Response:", data);

      if (!response.ok || !data.success) {
        console.error("[PublicRepoAnonymousPrompt] Anonymous sign-up failed:", data);
        setError(data.message || "Failed to create anonymous session");
        setIsSigningIn(false);
        return;
      }

      const currentUrl = new URL(window.location.href);
      let targetPath = currentUrl.pathname;
      if (targetPath.endsWith("/auth")) {
        targetPath = targetPath.slice(0, -"/auth".length) || "/";
      }
      const targetUrl = `${targetPath}${currentUrl.search}${currentUrl.hash}`;

      // Use window.location.href for a full page reload to ensure cookies are properly sent
      window.location.href = targetUrl;
    } catch (err) {
      console.error(
        "[PublicRepoAnonymousPrompt] Failed to create anonymous user",
        err
      );
      setError("An unexpected error occurred. Please try again.");
      setIsSigningIn(false);
    }
  }, []);

  useEffect(() => {
    if (hasAttempted.current) {
      return;
    }
    hasAttempted.current = true;
    void handleAnonymousSignIn();
  }, [handleAnonymousSignIn]);

  return (
    <div className="min-h-dvh bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 flex items-center justify-center px-6">
      <div className="max-w-lg w-full">
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="h-12 w-12 rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center">
              <Eye className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>

            <div>
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                Preparing Guest Access
              </h1>
              <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Creating a guest session for{" "}
                <span className="font-mono font-medium text-neutral-900 dark:text-neutral-100">
                  {githubOwner}/{repo}
                </span>{" "}
                (PR #{pullNumber}).
              </p>
            </div>

            {!error ? (
              <div className="flex flex-col items-center gap-3 text-neutral-600 dark:text-neutral-400">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 dark:border-blue-400 border-t-transparent" />
                <p className="text-sm">
                  Setting up access…
                </p>
              </div>
            ) : (
              <div className="w-full space-y-4">
                <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4">
                  <p className="text-sm text-red-800 dark:text-red-200">
                    {error}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAnonymousSignIn}
                  disabled={isSigningIn}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg bg-blue-600 dark:bg-blue-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSigningIn ? "Retrying…" : "Retry guest sign in"}
                </button>
              </div>
            )}

            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              You will be redirected once the session is ready.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
