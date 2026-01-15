"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ArrowLeft, Github } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type PreviewConfigureConnectGithubProps = {
  teamSlugOrId: string;
  repo: string;
  returnPath: string;
};

function openCenteredPopup(
  url: string,
  name: string,
  width: number,
  height: number
): Window | null {
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
  return window.open(
    url,
    name,
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
  );
}

export function PreviewConfigureConnectGithub({
  teamSlugOrId,
  repo,
  returnPath,
}: PreviewConfigureConnectGithubProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  // Poll for popup close and refresh the page
  useEffect(() => {
    if (!isConnecting) return;

    const interval = setInterval(() => {
      if (popupRef.current?.closed) {
        // Popup was closed - refresh the page to check if installation succeeded
        window.location.reload();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isConnecting]);

  // Listen for postMessage from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "github-app-installed") {
        popupRef.current?.close();
        window.location.reload();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleConnectGithub = useCallback(async () => {
    setIsConnecting(true);
    setErrorMessage(null);

    try {
      // Build return URL that will signal installation complete
      const returnUrl = new URL(returnPath, window.location.origin).toString();

      const response = await fetch("/api/integrations/github/install-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId,
          returnUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as { installUrl: string };

      // Open centered popup for GitHub App installation
      const popup = openCenteredPopup(
        payload.installUrl,
        "github-app-install",
        1000,
        700
      );

      if (!popup) {
        // Popup was blocked - fall back to redirect
        console.warn(
          "[PreviewConfigureConnectGithub] Popup blocked, falling back to redirect"
        );
        window.location.href = payload.installUrl;
        return;
      }

      popupRef.current = popup;
      popup.focus();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to start GitHub connection";
      console.error(
        "[PreviewConfigureConnectGithub] Failed to connect GitHub",
        error
      );
      setErrorMessage(message);
      setIsConnecting(false);
    }
  }, [teamSlugOrId, returnPath]);

  return (
    <div className="min-h-dvh bg-white dark:bg-black font-sans">
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* Back to preview.new link */}
        <div className="mb-3">
          <Link
            href="/preview"
            className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            <ArrowLeft className="h-3 w-3" />
            Go to preview.new
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            Connect GitHub
          </h1>
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400 pt-2">
            <svg
              className="h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
            </svg>
            <span className="font-sans">{repo}</span>
          </div>
        </div>

        {/* Connect GitHub Card */}
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-8">
          <div className="flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center mb-4">
              <Github className="w-6 h-6 text-neutral-600 dark:text-neutral-400" />
            </div>
            <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              GitHub App Required
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-6 max-w-md">
              To set up screenshot previews for{" "}
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {repo}
              </span>
              , you need to install the cmux GitHub App. This allows us to
              receive webhook events when pull requests are created or updated.
            </p>
            <Button
              onClick={handleConnectGithub}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
              )}
              {isConnecting ? "Connecting..." : "Install GitHub App"}
            </Button>
            {errorMessage && (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400">
                {errorMessage}
              </p>
            )}
          </div>
        </div>

        {/* Info section */}
        <div className="mt-6 text-xs text-neutral-500 dark:text-neutral-400">
          <p className="mb-2">The GitHub App will have access to:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Read access to repository metadata and pull requests</li>
            <li>Write access to pull request comments (for posting screenshots)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
