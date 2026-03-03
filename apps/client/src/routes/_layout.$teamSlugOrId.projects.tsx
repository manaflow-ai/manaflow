import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/$teamSlugOrId/projects")({
  component: ProjectsLayout,
});

function ProjectsLayout() {
  return <Outlet />;
}
