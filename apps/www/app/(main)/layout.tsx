import type { ReactNode } from "react";

import { SentryScopeProvider } from "@/components/providers/sentry-scope-provider";
import { stackServerApp } from "@/lib/utils/stack";
import { StackProvider, StackTheme } from "@stackframe/stack";

export default function MainLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <StackTheme>
      <StackProvider app={stackServerApp}>
        <SentryScopeProvider />
        {children}
      </StackProvider>
    </StackTheme>
  );
}
