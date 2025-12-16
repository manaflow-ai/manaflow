import { useStackApp } from "@stackframe/react";
import { RouterProvider } from "@tanstack/react-router";
import { queryClient } from "./query-client";
import { router } from "./router";

export function RouterProviderWithAuth() {
  const auth = useStackApp();
  return <RouterProvider router={router} context={{ queryClient, auth }} />;
}
