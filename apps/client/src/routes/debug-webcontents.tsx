import { ElectronWebContentsPage } from "@/components/ElectronWebContentsPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/debug-webcontents")({
  component: DebugWebContentsRoute,
});

function DebugWebContentsRoute() {
  return <ElectronWebContentsPage forceWebContentsView />;
}
