"use client";

import { CmuxLoadingOverlay } from "@/components/cmux-loading-overlay";
import { useQuery } from "@tanstack/react-query";
import { ConvexProvider } from "convex/react";
import { type ReactNode, useEffect, useState } from "react";
import { convexAuthReadyPromise } from "./convex-auth-ready";
import { convexQueryClient } from "./convex-query-client";

function BootLoader({ children }: { children: ReactNode }) {
  const [minimumDelayPassed, setMinimumDelayPassed] = useState(false);
  const convexAuthReadyQuery = useQuery({
    queryKey: ["convexAuthReadyPromise"],
    queryFn: () => convexAuthReadyPromise,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinimumDelayPassed(true);
    }, 250);
    return () => clearTimeout(timer);
  }, []);

  const isReady = convexAuthReadyQuery.data && minimumDelayPassed;
  return (
    <>
      <CmuxLoadingOverlay visible={!isReady} />
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
