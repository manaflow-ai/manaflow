"use client";

import { getRandomKitty } from "@/components/kitties";
import CmuxLogoMarkAnimated from "@/components/logo/cmux-logo-mark-animated";
import { useQuery } from "@tanstack/react-query";
import { ConvexProvider } from "convex/react";
import { type ReactNode, useEffect, useState } from "react";
import { convexAuthReadyPromise } from "./convex-auth-ready";
import { convexQueryClient } from "./convex-query-client";
import { authJsonQueryOptions } from "./authJsonQueryOptions";
import clsx from "clsx";

function BootLoader({ children }: { children: ReactNode }) {
  const [minimumDelayPassed, setMinimumDelayPassed] = useState(false);
  const convexAuthReadyQuery = useQuery({
    queryKey: ["convexAuthReadyPromise"],
    queryFn: () => convexAuthReadyPromise,
  });

  // Also wait for auth token to be available so socket can connect
  const authJsonQuery = useQuery(authJsonQueryOptions());
  const hasAuthToken = Boolean(authJsonQuery.data?.accessToken);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinimumDelayPassed(true);
    }, 250);
    return () => clearTimeout(timer);
  }, []);

  const isReady = convexAuthReadyQuery.data && hasAuthToken && minimumDelayPassed;
  return (
    <>
      <div
        className={clsx(
          "absolute inset-0 w-screen h-dvh flex flex-col items-center justify-center bg-white dark:bg-black z-[var(--z-global-blocking)] transition-opacity",
          isReady ? "opacity-0 pointer-events-none" : "opacity-100",
        )}
      >
        <CmuxLogoMarkAnimated height={40} duration={2.9} />
        <pre className="text-xs font-mono text-neutral-200 dark:text-neutral-800 absolute bottom-0 left-0 pl-4 pb-4">
          {getRandomKitty()}
        </pre>
      </div>
      {children}
    </>
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <BootLoader>
        <ConvexProvider client={convexQueryClient.convexClient}>
          {children}
        </ConvexProvider>
      </BootLoader>
    </>
  );
}
