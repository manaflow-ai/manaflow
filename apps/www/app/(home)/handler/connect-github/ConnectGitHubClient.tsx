"use client";

import { useUser } from "@stackframe/stack";
import { JetBrains_Mono } from "next/font/google";
import { useCallback, useEffect, useState } from "react";

const jetbrains = JetBrains_Mono({ subsets: ["latin"], preload: true });

type ConnectGitHubClientProps =
  | { href: string; alreadyConnected: true; teamSlugOrId?: never }
  | { teamSlugOrId: string | null; href?: never; alreadyConnected?: never };

export function ConnectGitHubClient(props: ConnectGitHubClientProps) {
  const user = useUser({ or: "redirect" });
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already connected, just redirect to deep link
  useEffect(() => {
    if (props.alreadyConnected && props.href) {
      try {
        window.location.href = props.href;
      } catch {
        console.error("Failed to open Manaflow", props.href);
      }
    }
  }, [props.alreadyConnected, props.href]);

  const handleConnect = useCallback(async () => {
    if (!user || props.alreadyConnected) return;

    setIsConnecting(true);
    setError(null);

    try {
      // This will redirect to GitHub OAuth
      await user.getConnectedAccount("github", { or: "redirect" });
    } catch (err) {
      console.error("Failed to connect GitHub:", err);
      setError(err instanceof Error ? err.message : "Failed to connect GitHub");
      setIsConnecting(false);
    }
  }, [user, props.alreadyConnected]);

  // Auto-start OAuth flow on mount
  useEffect(() => {
    if (!props.alreadyConnected && user) {
      // Small delay to ensure the page is fully loaded
      const timer = setTimeout(() => {
        void handleConnect();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [props.alreadyConnected, user, handleConnect]);

  if (props.alreadyConnected) {
    return (
      <div
        className={`min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-black ${jetbrains.className}`}
      >
        <div className="w-full max-w-md text-center rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            GitHub Connected
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Opening Manaflow...
          </p>
          <div className="mt-5">
            <a
              href={props.href}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90"
            >
              Open Manaflow
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-black ${jetbrains.className}`}
    >
      <div className="w-full max-w-md text-center rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {isConnecting ? "Connecting to GitHub..." : "Connect GitHub"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
          {isConnecting
            ? "You'll be redirected to GitHub to authorize access."
            : "Click the button below to connect your GitHub account."}
        </p>
        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        <div className="mt-5">
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 disabled:opacity-50"
          >
            {isConnecting ? "Redirecting..." : "Connect GitHub"}
          </button>
        </div>
      </div>
    </div>
  );
}
