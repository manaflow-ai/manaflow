"use client";

import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCallback, useEffect, useState } from "react";

// X (Twitter) icon component
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

interface ConnectXButtonProps {
  className?: string;
}

export function ConnectXButton({ className = "" }: ConnectXButtonProps) {
  const twitterConnection = useQuery(api.twitter.getTwitterConnection);
  const mintOAuthState = useMutation(api.twitter.mintTwitterOAuthState);
  const disconnectTwitter = useMutation(api.twitter.disconnectTwitter);
  const testConnection = useAction(api.twitter.testTwitterConnection);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Get X OAuth client ID from env
  const clientId = process.env.NEXT_PUBLIC_X_CLIENT_ID;
  const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  const redirectUri = convexSiteUrl ? `${convexSiteUrl}/twitter_callback` : null;

  // Handle connect X account
  const handleConnect = useCallback(async () => {
    if (!clientId || !redirectUri) {
      alert("X OAuth not configured");
      return;
    }

    setIsConnecting(true);
    try {
      const returnUrl = window.location.href;
      const { state, codeChallenge, codeChallengeMethod } = await mintOAuthState({ returnUrl });

      // Build authorization URL
      // Reference: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "tweet.read users.read offline.access",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      });

      const authUrl = `https://x.com/i/oauth2/authorize?${params.toString()}`;

      // Open in a centered popup
      const width = 600;
      const height = 700;
      const left = Math.max(0, (window.outerWidth - width) / 2 + window.screenX);
      const top = Math.max(0, (window.outerHeight - height) / 2 + window.screenY);
      const features = `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;

      window.open(authUrl, "twitter-oauth", features);
    } catch (err) {
      console.error("Failed to start X OAuth:", err);
      alert("Failed to start connection. Please try again.");
      setIsConnecting(false);
    }
  }, [clientId, redirectUri, mintOAuthState]);

  // Handle disconnect
  const handleDisconnect = useCallback(async () => {
    if (!confirm("Are you sure you want to disconnect your X account?")) {
      return;
    }

    try {
      await disconnectTwitter();
      setTestResult(null);
    } catch (err) {
      console.error("Failed to disconnect X:", err);
      alert("Failed to disconnect. Please try again.");
    }
  }, [disconnectTwitter]);

  // Handle test connection
  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection();
      if (result.success && result.user) {
        setTestResult(`API Test OK: @${result.user.username} (${result.user.name})`);
      } else {
        setTestResult(`API Test Failed: ${result.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Test connection failed:", err);
      setTestResult("API Test Failed: Request error");
    } finally {
      setIsTesting(false);
    }
  }, [testConnection]);

  // Listen for popup completion message
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const expectedOrigin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      if (event.origin !== expectedOrigin) return;

      if (event.data?.type === "twitter-oauth-complete") {
        setIsConnecting(false);
        if (!event.data.success && event.data.error) {
          alert(`Connection failed: ${event.data.error}`);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Not configured
  if (!clientId || !redirectUri) {
    return null;
  }

  // Loading state
  if (twitterConnection === undefined) {
    return (
      <button
        disabled
        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-neutral-800 text-neutral-400 ${className}`}
      >
        <XIcon className="w-4 h-4" />
        <span>Loading...</span>
      </button>
    );
  }

  // Connected state
  if (twitterConnection) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-neutral-800 text-neutral-200">
            {twitterConnection.twitterProfileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={twitterConnection.twitterProfileImageUrl}
                alt={twitterConnection.twitterUsername || "X"}
                className="w-5 h-5 rounded-full"
              />
            ) : (
              <XIcon className="w-4 h-4" />
            )}
            <span>@{twitterConnection.twitterUsername}</span>
          </div>
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="text-xs text-neutral-400 hover:text-blue-400 transition-colors disabled:opacity-50"
          >
            {isTesting ? "Testing..." : "Test API"}
          </button>
          <button
            onClick={handleDisconnect}
            className="text-xs text-neutral-500 hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        </div>
        {testResult && (
          <span className={`text-xs ${testResult.includes("OK") ? "text-green-400" : "text-red-400"}`}>
            {testResult}
          </span>
        )}
      </div>
    );
  }

  // Disconnected state - show connect button
  return (
    <button
      onClick={handleConnect}
      disabled={isConnecting}
      className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <XIcon className="w-4 h-4" />
      <span>{isConnecting ? "Connecting..." : "Connect X Account"}</span>
    </button>
  );
}

export default ConnectXButton;
