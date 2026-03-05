/**
 * Projects Index - Redirects to Projects Dashboard
 */

import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/$teamSlugOrId/projects/")({
  component: ProjectsRedirect,
});

function ProjectsRedirect() {
  const { teamSlugOrId } = Route.useParams();
  return <Navigate to="/$teamSlugOrId/projects/dashboard" params={{ teamSlugOrId }} replace />;
}
