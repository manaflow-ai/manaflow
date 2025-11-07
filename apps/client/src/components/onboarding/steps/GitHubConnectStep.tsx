import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github";
import { ArrowRight, Check, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@cmux/convex/api";
import { useMutation, useQuery } from "convex/react";
import { env } from "@/client-env";

interface GitHubConnectStepProps {
  teamSlugOrId: string;
  onNext: () => void;
  onSkip: () => void;
  onGitHubConnected: () => void;
  hasConnection: boolean;
}

export function GitHubConnectStep({
  teamSlugOrId,
  onNext,
  onSkip,
  onGitHubConnected,
  hasConnection,
}: GitHubConnectStepProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [localHasConnection, setLocalHasConnection] = useState(hasConnection);

  const connections = useQuery(api.github.listProviderConnections, {
    teamSlugOrId,
  });
  const mintInstallState = useMutation(api.github_app.mintInstallState);

  useEffect(() => {
    if (connections && connections.length > 0 && !localHasConnection) {
      setLocalHasConnection(true);
      onGitHubConnected();
    }
  }, [connections, localHasConnection, onGitHubConnected]);

  // Listen for Electron deep link callback
  useEffect(() => {
    if (typeof window === "undefined" || !("cmux" in window)) {
      return; // Not in Electron
    }

    const handleElectronCallback = (...args: unknown[]) => {
      const data = args[0] as { team?: string } | undefined;
      console.log("GitHub connect complete (Electron deep link)", data);
      setLocalHasConnection(true);
      onGitHubConnected();
      setIsConnecting(false);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = (window as any).cmux.on(
      "github-connect-complete",
      handleElectronCallback
    );

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [onGitHubConnected]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      // In Electron, don't pass returnUrl so it uses the deep link flow
      const isElectron = typeof window !== "undefined" && "cmux" in window;
      const { state } = await mintInstallState({
        teamSlugOrId,
        // Only pass returnUrl for browser (not Electron)
        ...(!isElectron ? { returnUrl: window.location.href } : {}),
      });

      const githubAppSlug = env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "cmux-dev";
      const installUrl = new URL(
        `https://github.com/apps/${githubAppSlug}/installations/new`
      );
      installUrl.searchParams.set("state", state);

      const width = 600;
      const height = 800;
      const left = Math.max(0, (window.screen.width - width) / 2);
      const top = Math.max(0, (window.screen.height - height) / 2);

      const popup = window.open(
        installUrl.href,
        "github-install",
        `width=${width},height=${height},left=${left},top=${top},popup=yes`
      );

      if (!popup) {
        throw new Error(
          "Failed to open popup. Please allow popups for this site."
        );
      }

      const handleMessage = (event: MessageEvent) => {
        if (
          event.origin === window.location.origin &&
          event.data?.type === "cmux/github-install-complete"
        ) {
          window.removeEventListener("message", handleMessage);
          setLocalHasConnection(true);
          onGitHubConnected();
          setIsConnecting(false);
        }
      };

      window.addEventListener("message", handleMessage);

      const checkInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkInterval);
          window.removeEventListener("message", handleMessage);
          setIsConnecting(false);
        }
      }, 500);
    } catch (error) {
      console.error("Failed to connect GitHub:", error);
      setIsConnecting(false);
    }
  }, [teamSlugOrId, mintInstallState, onGitHubConnected]);

  return (
    <div className="flex flex-col items-center text-center">
      {/* Header */}
      <div className="mb-12">
        <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-white">
          Connect GitHub
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-md mx-auto">
          Connect your GitHub account to sync repositories and collaborate with your team.
        </p>
      </div>

      {/* Connection Status / Button */}
      {localHasConnection ? (
        <div className="mb-8 w-full max-w-md">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 p-6 backdrop-blur">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Check className="h-5 w-5 text-green-500" />
              <span className="text-lg font-medium text-neutral-900 dark:text-white">
                Connected
              </span>
            </div>
            {connections && connections.length > 0 && (
              <div className="flex flex-wrap justify-center gap-3">
                {connections.map((conn) => (
                  <div
                    key={conn.installationId}
                    className="flex items-center gap-2 rounded-lg bg-neutral-200 dark:bg-neutral-800/50 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300"
                  >
                    <GitHubIcon className="h-4 w-4" />
                    <span>{conn.accountLogin}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-12">
          <Button
            size="lg"
            onClick={handleConnect}
            disabled={isConnecting}
            className="h-12 px-8 text-base gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <GitHubIcon className="h-5 w-5" />
            {isConnecting ? "Connecting..." : "Connect GitHub"}
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={onSkip}
          disabled={isConnecting}
          className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
        >
          Skip for now
        </Button>
        {localHasConnection && (
          <Button
            onClick={onNext}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
