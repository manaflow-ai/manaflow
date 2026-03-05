/**
 * cmux Projects Dashboard Page
 *
 * Displays project tracking dashboard with:
 * - Project cards with progress bars
 * - Status filters
 * - Recommended actions from Obsidian vault
 * - Create project button
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  RefreshCw,
  FolderKanban,
  Search,
  X,
} from "lucide-react";
import clsx from "clsx";

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
import {
  ProjectProgressBar,
} from "@/components/projects/ProjectProgress";
import { PROJECT_STATUS_CONFIG } from "@/components/projects/project-status-config";
import type { ProjectStatus } from "@/components/projects/project-status-config";
import { RecommendedActions } from "@/components/projects/RecommendedActions";
import { api } from "@cmux/convex/api";
import type { Doc } from "@cmux/convex/dataModel";

export const Route = createFileRoute(
  "/_layout/$teamSlugOrId/projects/dashboard"
)({
  component: ProjectsDashboardPage,
});

function ProjectsDashboardPage() {
  const { teamSlugOrId } = Route.useParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");

  // Fetch projects
  const {
    data: projects,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery(
    convexQuery(api.projectQueries.listProjects, {
      teamSlugOrId,
      status: statusFilter === "all" ? undefined : statusFilter,
      limit: 100,
    })
  );

  // Create project mutation
  const createProjectMutation = useMutation({
    mutationFn: useConvexMutation(api.projectQueries.createProject),
    onSuccess: () => {
      setShowCreateDialog(false);
      setNewProjectName("");
      setNewProjectDescription("");
      refetch();
    },
  });

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return;
    createProjectMutation.mutate({
      teamSlugOrId,
      name: newProjectName.trim(),
      description: newProjectDescription.trim() || undefined,
    });
  };

  // Filter projects by search query
  const filteredProjects = projects?.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate summary stats
  const summaryStats = {
    total: projects?.length ?? 0,
    active: projects?.filter((p) => p.status === "active").length ?? 0,
    planning: projects?.filter((p) => p.status === "planning").length ?? 0,
    completed: projects?.filter((p) => p.status === "completed").length ?? 0,
  };

  return (
    <FloatingPane
      header={<TitleBar title="Projects Dashboard" />}
    >
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              Project Tracking
            </h1>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              Manage projects and track progress across agent tasks
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw
                className={clsx("h-4 w-4 mr-2", isRefetching && "animate-spin")}
              />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard
            label="Total Projects"
            value={summaryStats.total}
            loading={isLoading}
          />
          <SummaryCard
            label="Active"
            value={summaryStats.active}
            loading={isLoading}
            color="blue"
          />
          <SummaryCard
            label="Planning"
            value={summaryStats.planning}
            loading={isLoading}
            color="purple"
          />
          <SummaryCard
            label="Completed"
            value={summaryStats.completed}
            loading={isLoading}
            color="green"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Project List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Search and Filter */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <input
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-md border border-neutral-200 bg-white text-sm placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value as ProjectStatus | "all")}
                className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm dark:border-neutral-800 dark:bg-neutral-950"
              >
                <option value="all">All Status</option>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            {/* Project List */}
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2 mt-2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-2 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredProjects?.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FolderKanban className="h-12 w-12 text-neutral-400 mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Projects Found</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center max-w-md mb-4">
                    {searchQuery || statusFilter !== "all"
                      ? "Try adjusting your search or filters."
                      : "Create your first project to start tracking work."}
                  </p>
                  {!searchQuery && statusFilter === "all" && (
                    <Button onClick={() => setShowCreateDialog(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Project
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {filteredProjects?.map((project) => (
                  <ProjectCard
                    key={project._id}
                    project={project}
                    teamSlugOrId={teamSlugOrId}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar - Recommendations */}
          <div className="space-y-4">
            <RecommendedActions
              teamSlugOrId={teamSlugOrId}
              limit={5}
              showDispatch={true}
            />
          </div>
        </div>
      </div>

      {/* Create Project Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Create Project</h2>
              <button
                onClick={() => setShowCreateDialog(false)}
                className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewProjectName(e.target.value)}
                  placeholder="My Project"
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Description
                </label>
                <textarea
                  value={newProjectDescription}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewProjectDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setShowCreateDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim() || createProjectMutation.isPending}
                >
                  {createProjectMutation.isPending ? "Creating..." : "Create Project"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </FloatingPane>
  );
}

// Summary Card Component
function SummaryCard({
  label,
  value,
  loading,
  color,
}: {
  label: string;
  value: number;
  loading: boolean;
  color?: "blue" | "purple" | "green";
}) {
  const colorClasses = {
    blue: "border-blue-200 dark:border-blue-800/50",
    purple: "border-purple-200 dark:border-purple-800/50",
    green: "border-green-200 dark:border-green-800/50",
  };

  return (
    <Card className={clsx(color && colorClasses[color])}>
      <CardContent className="pt-4">
        {loading ? (
          <>
            <Skeleton className="h-4 w-16 mb-2" />
            <Skeleton className="h-8 w-12" />
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
              {label}
            </p>
            <p className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {value}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Project Card Component
function ProjectCard({
  project,
  teamSlugOrId,
}: {
  project: Doc<"projects">;
  teamSlugOrId: string;
}) {
  const statusConfig = PROJECT_STATUS_CONFIG[project.status];
  const progressPercent = project.totalTasks && project.totalTasks > 0
    ? Math.round(((project.completedTasks ?? 0) / project.totalTasks) * 100)
    : 0;

  const runningTasks = project.runningTasks ?? 0;

  return (
    <a
      href={`/${teamSlugOrId}/projects/detail/${project._id}`}
      className="block"
    >
      <Card className="hover:border-neutral-400 dark:hover:border-neutral-600 transition-colors cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base truncate flex items-center gap-2">
                <FolderKanban className="h-4 w-4 flex-shrink-0" />
                {project.name}
              </CardTitle>
              {project.description && (
                <CardDescription className="mt-1 line-clamp-2">
                  {project.description}
                </CardDescription>
              )}
            </div>
            <span className={clsx("inline-flex items-center rounded-full px-2 py-1 text-xs font-medium", statusConfig.bgColor, statusConfig.color)}>
              {statusConfig.label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="space-y-2">
            <ProjectProgressBar
              completed={project.completedTasks ?? 0}
              running={runningTasks}
              failed={project.failedTasks ?? 0}
              pending={Math.max(0, (project.totalTasks ?? 0) - (project.completedTasks ?? 0) - (project.failedTasks ?? 0) - runningTasks)}
              total={project.totalTasks ?? 0}
            />
            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              <span>
                {project.totalTasks ?? 0} tasks
                {(project.completedTasks ?? 0) > 0 && ` (${project.completedTasks} done)`}
              </span>
              <span>{progressPercent}% complete</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}
