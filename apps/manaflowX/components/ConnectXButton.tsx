"use client";

import { useUser } from "@stackframe/stack";
import { useCallback, useState } from "react";

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

// Scopes needed for X API access
// Reference: https://docs.x.com/x-api/fundamentals/authentication/oauth-2-0/authorization-code
const X_SCOPES = ["tweet.read", "users.read", "offline.access"];

export function ConnectXButton({ className = "" }: ConnectXButtonProps) {
  const user = useUser();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [xUserInfo, setXUserInfo] = useState<{
    username: string;
    name: string;
    profile_image_url?: string;
  } | null>(null);

  // Use Stack Auth's connected account for X
  // Reference: Stack Auth OAuth docs - https://docs.stack-auth.com/docs/apps/oauth
  const xAccount = user?.useConnectedAccount("x");
  const accessTokenResult = xAccount?.useAccessToken();

  // Handle connect X account via Stack Auth
  const handleConnect = useCallback(async () => {
    if (!user) return;

    setIsConnecting(true);
    try {
      // This will redirect to X OAuth flow via Stack Auth
      // Reference: Stack Auth OAuth docs - user.getConnectedAccount with { or: 'redirect' }
      await user.getConnectedAccount("x", {
        or: "redirect",
        scopes: X_SCOPES,
      });
    } catch (err) {
      console.error("Failed to connect X account:", err);
      setIsConnecting(false);
    }
  }, [user]);

  // Handle test connection - fetch user profile via server-side proxy (avoids CORS)
  const handleTestConnection = useCallback(async () => {
    if (!accessTokenResult?.accessToken) {
      setTestResult("No access token available");
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // Call our API route which proxies to X API (avoids CORS issues)
      const response = await fetch("/api/x/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accessToken: accessTokenResult.accessToken }),
      });

      const data = await response.json();

      if (data.success && data.user) {
        setXUserInfo({
          username: data.user.username,
          name: data.user.name,
          profile_image_url: data.user.profile_image_url,
        });
        setTestResult(`API Test OK: @${data.user.username} (${data.user.name})`);
      } else {
        setTestResult(`API Test Failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Test connection failed:", err);
      setTestResult("API Test Failed: Request error");
    } finally {
      setIsTesting(false);
    }
  }, [accessTokenResult?.accessToken]);

  // No user logged in
  if (!user) {
    return null;
  }

  // Connected state
  if (xAccount) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-neutral-800 text-neutral-200">
            {xUserInfo?.profile_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={xUserInfo.profile_image_url}
                alt={xUserInfo.username || "X"}
                className="w-5 h-5 rounded-full"
              />
            ) : (
              <XIcon className="w-4 h-4" />
            )}
            <span>
              {xUserInfo ? `@${xUserInfo.username}` : "X Connected"}
            </span>
          </div>
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="text-xs text-neutral-400 hover:text-blue-400 transition-colors disabled:opacity-50"
          >
            {isTesting ? "Testing..." : "Test API"}
          </button>
        </div>
        {testResult && (
          <span
            className={`text-xs ${testResult.includes("OK") ? "text-green-400" : "text-red-400"}`}
          >
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
