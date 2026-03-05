/**
 * GitHub Projects listing page - View and manage GitHub Projects for roadmap/planning
 */

import { PlanImportDialog } from "@/components/projects/PlanImportDialog";
import { FloatingPane } from "@/components/floating-pane";
import { TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@cmux/convex/api";
import { getApiIntegrationsGithubProjects } from "@cmux/www-openapi-client";
import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Dropdown } from "@/components/ui/dropdown";
import {
  Building2,
  ChevronDown,
  ExternalLink,
  FileUp,
  FolderKanban,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useUser } from "@stackframe/react";

export const Route = createFileRoute("/_layout/$teamSlugOrId/projects/github")({
  component: GitHubProjectsPage,
});

interface GitHubProject {
  id: string;
  title: string;
  number: number;
  url: string;
  shortDescription: string | null;
  closed: boolean;
  createdAt: string;
  updatedAt: string;
}

function GitHubProjectsPage() {
  const { teamSlugOrId } = Route.useParams();
  const user = useUser({ or: "return-null" });
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

  // Get GitHub connections for this team
  const { data: connections, isLoading: connectionsLoading } = useQuery(
    convexQuery(api.github.listProviderConnections, { teamSlugOrId }),
  );

  // Get active connections, sorted with user connections first for easy testing
  // of the OAuth scope grant flow. User projects need 'project' OAuth scope.
  const activeConnections = (connections?.filter((c) => c.isActive) ?? []).sort(
    (a, b) => {
      if (a.accountType === "User" && b.accountType !== "User") return -1;
      if (a.accountType !== "User" && b.accountType === "User") return 1;
      return 0;
    },
  );

  // Select connection - if selectedConnectionId doesn't match any active connection, fall back to first
  const connectionFromId = selectedConnectionId
    ? activeConnections.find((c) => c.id === selectedConnectionId)
    : undefined;
  const selectedConnection = connectionFromId ?? activeConnections[0];

  const installationId = selectedConnection?.installationId;
  const owner = selectedConnection?.accountLogin;

  // Fetch projects for the selected owner
  const {
    data: projectsData,
    isLoading: projectsLoading,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ["github-projects", teamSlugOrId, installationId, owner],
    queryFn: async () => {
      if (!installationId || !owner) return { projects: [] };
      const res = await getApiIntegrationsGithubProjects({
        query: {
          team: teamSlugOrId,
          installationId,
          owner,
          ownerType:
            selectedConnection?.accountType === "Organization"
              ? "organization"
              : "user",
        },
      });
      return res.data ?? { projects: [] };
    },
    enabled: !!installationId && !!owner,
  });

  const projects = projectsData?.projects ?? [];
  const needsReauthorization = projectsData?.needsReauthorization === true;
  const isLoading = connectionsLoading || projectsLoading;

  return (
    <FloatingPane header={<TitleBar title="GitHub Projects" />}>
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">GitHub Projects</h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              View and manage roadmaps and project boards
            </p>
            <Link
              to="/$teamSlugOrId/projects/dashboard"
              params={{ teamSlugOrId }}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mt-1 inline-block"
            >
              ← Back to Projects Dashboard
            </Link>
          </div>
          <div className="flex gap-2">
            {/* Organization selector - show when multiple org connections available */}
            {activeConnections.length > 1 && (
              <Dropdown.Root>
                <Dropdown.Trigger
                  className="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium rounded-md border border-neutral-200 bg-white px-3 h-8 gap-1 hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-800"
                >
                  <Building2 className="h-4 w-4" />
                  {selectedConnection?.accountLogin ?? "Select account"}
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Dropdown.Trigger>
                <Dropdown.Portal>
                  <Dropdown.Positioner>
                    <Dropdown.Popup>
                      {activeConnections.map((conn) => (
                        <Dropdown.Item
                          key={conn.id}
                          onClick={() => setSelectedConnectionId(conn.id)}
                        >
                          <div className="flex items-center gap-2 px-3 py-2">
                            <Building2 className="h-4 w-4" />
                            {conn.accountLogin}
                            {conn.accountType === "User" && (
                              <span className="text-xs text-neutral-500">(user)</span>
                            )}
                          </div>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Popup>
                  </Dropdown.Positioner>
                </Dropdown.Portal>
              </Dropdown.Root>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchProjects()}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            {selectedConnection && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
                disabled={projects.length === 0}
              >
                <FileUp className="h-4 w-4 mr-2" />
                Import Plan
              </Button>
            )}
            {owner && (
              <Button asChild size="sm">
                <a
                  href={
                    selectedConnection?.accountType === "Organization"
                      ? `https://github.com/orgs/${owner}/projects/new`
                      : `https://github.com/users/${owner}/projects/new`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Project
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Connection Status */}
        {!selectedConnection && !connectionsLoading && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardHeader>
              <CardTitle className="text-amber-600 dark:text-amber-400">
                GitHub Not Connected
              </CardTitle>
              <CardDescription>
                Connect the cmux GitHub App to view and manage GitHub Projects
                v2. Both organization and user projects are supported.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link
                  to="/$teamSlugOrId/settings"
                  params={{ teamSlugOrId }}
                  search={{ section: "git" }}
                >
                  Connect GitHub
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Reauthorization banner for user projects missing 'project' scope */}
        {needsReauthorization && selectedConnection?.accountType === "User" && (
          <Card className="border-blue-500/50 bg-blue-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-blue-600 dark:text-blue-400">
                Additional Permission Required
              </CardTitle>
              <CardDescription>
                Your GitHub OAuth token is missing the &quot;project&quot; scope
                needed to access personal Projects v2. Grant this permission to
                see your user projects, or switch to an organization connection.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                onClick={() => {
                  // Triggers OAuth redirect requesting 'project' scope
                  void user?.getConnectedAccount("github", {
                    or: "redirect",
                    scopes: ["project"],
                  });
                }}
              >
                Grant Project Scope
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Projects Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderKanban className="h-12 w-12 text-neutral-400 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Projects Found</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center max-w-md mb-4">
                Create a GitHub Project to track your roadmap and tasks.
                Projects provide kanban boards, timeline views, and custom
                fields.
              </p>
              {owner && (
                <Button asChild>
                  <a
                    href={
                      selectedConnection?.accountType === "Organization"
                        ? `https://github.com/orgs/${owner}/projects/new`
                        : `https://github.com/users/${owner}/projects/new`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Project
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {projects.map((project: GitHubProject) => (
              <ProjectCard
                key={project.id}
                project={project}
                teamSlugOrId={teamSlugOrId}
                installationId={installationId!}
                owner={owner!}
                ownerType={
                  selectedConnection?.accountType === "Organization"
                    ? "organization"
                    : "user"
                }
              />
            ))}
          </div>
        )}

        {/* Info Section */}
        <Card className="bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
          <CardHeader>
            <CardTitle className="text-base">About GitHub Projects</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-neutral-600 dark:text-neutral-400 space-y-2">
            <p>
              GitHub Projects v2 provides flexible views for planning and
              tracking work:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>
                <strong>Table view</strong> - Spreadsheet-like view with custom
                fields
              </li>
              <li>
                <strong>Board view</strong> - Kanban-style columns for workflow
                stages
              </li>
              <li>
                <strong>Roadmap view</strong> - Timeline visualization for
                planning
              </li>
            </ul>
            <p className="pt-2">
              <a
                href="https://docs.github.com/en/issues/planning-and-tracking-with-projects"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
              >
                Learn more about GitHub Projects
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </CardContent>
        </Card>
      </div>

      <PlanImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        teamSlugOrId={teamSlugOrId}
        installationId={installationId}
        projects={projects}
        onImported={() => {
          void refetchProjects();
        }}
      />
    </FloatingPane>
  );
}

function ProjectCard({
  project,
  teamSlugOrId,
  installationId,
  owner,
  ownerType,
}: {
  project: GitHubProject;
  teamSlugOrId: string;
  installationId: number;
  owner: string;
  ownerType: "user" | "organization";
}) {
  const updatedAt = new Date(project.updatedAt);
  const timeAgo = getTimeAgo(updatedAt);

  return (
    <Card className="hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">
              <Link
                to="/$teamSlugOrId/projects/$projectId"
                params={{
                  teamSlugOrId,
                  projectId: project.id,
                }}
                search={{
                  installationId,
                  owner,
                  ownerType,
                }}
                className="hover:text-blue-600 dark:hover:text-blue-400 inline-flex items-center gap-2"
              >
                <FolderKanban className="h-4 w-4 flex-shrink-0" />
                {project.title}
              </Link>
            </CardTitle>
            {project.shortDescription && (
              <CardDescription className="mt-1 line-clamp-2">
                {project.shortDescription}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1">
            {project.closed && (
              <span className="text-xs bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 rounded">
                Closed
              </span>
            )}
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
              title="Open in GitHub"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
          <span>#{project.number}</span>
          <span>Updated {timeAgo}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}
